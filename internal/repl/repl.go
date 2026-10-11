// Package repl hosts interactive `opa run` (REPL) sessions for the browser.
package repl

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"io"
	"os"
	"os/exec"
	"sync"
	"time"
)

// Event is a chunk of REPL output.
type Event struct {
	Seq    int64  `json:"seq"`
	Stream string `json:"stream"` // stdout, stderr, input, system
	Text   string `json:"text"`
}

// Session is one running REPL.
type Session struct {
	ID        string    `json:"id"`
	Workspace string    `json:"workspace,omitempty"`
	StartedAt time.Time `json:"startedAt"`
	Running   bool      `json:"running"`

	cmd     *exec.Cmd
	stdin   io.WriteCloser
	dir     string
	mu      sync.Mutex
	events  []Event
	seq     int64
	subs    map[chan Event]struct{}
	lastUse time.Time
}

// Manager tracks sessions.
type Manager struct {
	binary string
	max    int
	idle   time.Duration
	mu     sync.Mutex
	byID   map[string]*Session
	stop   chan struct{}
}

// New creates a manager and starts the idle reaper.
func New(binary string, max int, idle time.Duration) *Manager {
	m := &Manager{binary: binary, max: max, idle: idle, byID: map[string]*Session{}, stop: make(chan struct{})}
	go m.reap()
	return m
}

func (m *Manager) reap() {
	t := time.NewTicker(30 * time.Second)
	defer t.Stop()
	for {
		select {
		case <-m.stop:
			return
		case <-t.C:
			m.mu.Lock()
			var stale []string
			for id, s := range m.byID {
				s.mu.Lock()
				if time.Since(s.lastUse) > m.idle {
					stale = append(stale, id)
				}
				s.mu.Unlock()
			}
			m.mu.Unlock()
			for _, id := range stale {
				_ = m.Close(id)
			}
		}
	}
}

// Start launches `opa run [args...]` in dir (which the session owns and removes on close).
func (m *Manager) Start(dir, workspace string, args []string) (*Session, error) {
	if m.binary == "" {
		return nil, errors.New("opa binary not available")
	}
	m.mu.Lock()
	if len(m.byID) >= m.max {
		m.mu.Unlock()
		return nil, errors.New("too many REPL sessions; close one first")
	}
	m.mu.Unlock()
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	s := &Session{ID: hex.EncodeToString(b), Workspace: workspace, StartedAt: time.Now().UTC(), dir: dir, subs: map[chan Event]struct{}{}, lastUse: time.Now()}
	cmd := exec.Command(m.binary, append([]string{"run"}, args...)...)
	cmd.Dir = dir
	cmd.Env = []string{"HOME=" + dir, "PATH=/usr/local/bin:/usr/bin:/bin", "TERM=dumb"}
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, err
	}
	stdout, _ := cmd.StdoutPipe()
	stderr, _ := cmd.StderrPipe()
	if err := cmd.Start(); err != nil {
		return nil, err
	}
	s.cmd, s.stdin, s.Running = cmd, stdin, true
	var wg sync.WaitGroup
	wg.Add(2)
	go s.pump(stdout, "stdout", &wg)
	go s.pump(stderr, "stderr", &wg)
	go func() {
		wg.Wait()
		_ = cmd.Wait()
		s.mu.Lock()
		s.Running = false
		s.mu.Unlock()
		s.emit("system", "\n[session ended]\n")
	}()
	m.mu.Lock()
	m.byID[s.ID] = s
	m.mu.Unlock()
	return s, nil
}

func (s *Session) pump(r io.Reader, stream string, wg *sync.WaitGroup) {
	defer wg.Done()
	buf := make([]byte, 8192)
	for {
		n, err := r.Read(buf)
		if n > 0 {
			s.emit(stream, string(buf[:n]))
		}
		if err != nil {
			return
		}
	}
}

func (s *Session) emit(stream, text string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.seq++
	e := Event{Seq: s.seq, Stream: stream, Text: text}
	s.events = append(s.events, e)
	if len(s.events) > 5000 {
		s.events = s.events[len(s.events)-5000:]
	}
	for ch := range s.subs {
		select {
		case ch <- e:
		default:
		}
	}
}

// Get returns a session.
func (m *Manager) Get(id string) (*Session, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	s, ok := m.byID[id]
	return s, ok
}

// List returns all sessions.
func (m *Manager) List() []*Session {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]*Session, 0, len(m.byID))
	for _, s := range m.byID {
		out = append(out, s)
	}
	return out
}

// Input writes a line to the REPL.
func (s *Session) Input(line string) error {
	s.mu.Lock()
	s.lastUse = time.Now()
	running := s.Running
	s.mu.Unlock()
	if !running {
		return errors.New("session has ended")
	}
	s.emit("input", line+"\n")
	_, err := io.WriteString(s.stdin, line+"\n")
	return err
}

// Events returns buffered events after seq.
func (s *Session) Events(after int64) []Event {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.lastUse = time.Now()
	out := []Event{}
	for _, e := range s.events {
		if e.Seq > after {
			out = append(out, e)
		}
	}
	return out
}

// Subscribe streams new events.
func (s *Session) Subscribe() (<-chan Event, func()) {
	ch := make(chan Event, 256)
	s.mu.Lock()
	s.subs[ch] = struct{}{}
	s.mu.Unlock()
	return ch, func() {
		s.mu.Lock()
		delete(s.subs, ch)
		s.mu.Unlock()
	}
}

// Close terminates a session and removes its working directory.
func (m *Manager) Close(id string) error {
	m.mu.Lock()
	s, ok := m.byID[id]
	delete(m.byID, id)
	m.mu.Unlock()
	if !ok {
		return errors.New("session not found")
	}
	_ = s.stdin.Close()
	if s.cmd.Process != nil {
		_ = s.cmd.Process.Kill()
	}
	return os.RemoveAll(s.dir)
}

// Shutdown closes all sessions.
func (m *Manager) Shutdown() {
	close(m.stop)
	for _, s := range m.List() {
		_ = m.Close(s.ID)
	}
}
