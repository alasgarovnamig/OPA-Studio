// Package localopa supervises an OPA server process ("Local OPA") so that
// Studio is useful out of the box and every server-side feature of the
// bundled OPA version can be exercised without external infrastructure.
package localopa

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/alasgarovnamig/opa-studio/internal/manifest"
)

// Settings are user-editable and persisted between restarts.
type Settings struct {
	Addr      string   `json:"addr"`
	Autostart bool     `json:"autostart"`
	ExtraArgs []string `json:"extraArgs"`
	// Config is an OPA configuration file (YAML or JSON) passed with --config-file.
	Config string `json:"config"`
	// Workspace, when set, is loaded on start (`opa run -s <workspace dir>`).
	Workspace string `json:"workspace"`
	// Watch reloads workspace files on change (--watch).
	Watch bool `json:"watch"`
	// LogLevel is passed with --log-level when supported.
	LogLevel string `json:"logLevel"`
	// RestartOnFailure restarts the process when it exits unexpectedly.
	RestartOnFailure bool `json:"restartOnFailure"`
}

// State is the observable state of the process.
type State struct {
	Status    string     `json:"status"` // stopped, starting, running, exited, failed
	PID       int        `json:"pid,omitempty"`
	StartedAt *time.Time `json:"startedAt,omitempty"`
	ExitedAt  *time.Time `json:"exitedAt,omitempty"`
	ExitCode  *int       `json:"exitCode,omitempty"`
	Error     string     `json:"error,omitempty"`
	Command   []string   `json:"command,omitempty"`
	Restarts  int        `json:"restarts"`
	URL       string     `json:"url"`
}

// LogLine is one line of process output.
type LogLine struct {
	Seq    int64     `json:"seq"`
	Time   time.Time `json:"time"`
	Stream string    `json:"stream"`
	Text   string    `json:"text"`
}

// WorkspaceResolver maps a workspace id to its directory.
type WorkspaceResolver func(id string) (string, error)

// Manager owns the OPA process.
type Manager struct {
	binary   string
	manifest *manifest.Manifest
	dir      string
	log      *slog.Logger
	resolve  WorkspaceResolver

	mu       sync.Mutex
	settings Settings
	state    State
	cmd      *exec.Cmd
	desired  bool
	done     chan struct{}

	logMu   sync.Mutex
	logs    []LogLine
	seq     int64
	subs    map[chan LogLine]struct{}
	maxLogs int
}

// New creates a manager; settings are loaded from dir/settings.json.
func New(binary string, m *manifest.Manifest, dir string, defaults Settings, resolve WorkspaceResolver, log *slog.Logger) (*Manager, error) {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}
	mg := &Manager{
		binary: binary, manifest: m, dir: dir, log: log, resolve: resolve,
		settings: defaults, subs: map[chan LogLine]struct{}{}, maxLogs: 5000,
	}
	if b, err := os.ReadFile(filepath.Join(dir, "settings.json")); err == nil {
		var s Settings
		if json.Unmarshal(b, &s) == nil {
			if s.Addr == "" {
				s.Addr = defaults.Addr
			}
			mg.settings = s
		}
	}
	mg.state = State{Status: "stopped", URL: mg.url()}
	return mg, nil
}

func (m *Manager) url() string {
	addr := m.settings.Addr
	if strings.HasPrefix(addr, ":") {
		addr = "127.0.0.1" + addr
	}
	addr = strings.Replace(addr, "0.0.0.0:", "127.0.0.1:", 1)
	return "http://" + addr
}

// URL returns the base URL of the managed server.
func (m *Manager) URL() string {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.url()
}

// Settings returns the current settings.
func (m *Manager) Settings() Settings {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.settings
}

// SetSettings persists new settings. They take effect on the next (re)start.
func (m *Manager) SetSettings(s Settings) error {
	if strings.TrimSpace(s.Addr) == "" {
		return errors.New("addr is required")
	}
	for _, a := range s.ExtraArgs {
		if a == "--addr" || strings.HasPrefix(a, "--addr=") || a == "-a" {
			return errors.New("set the address with the addr field, not extra args")
		}
	}
	b, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(m.dir, "settings.json"), b, 0o600); err != nil {
		return err
	}
	m.mu.Lock()
	m.settings = s
	if m.state.Status != "running" && m.state.Status != "starting" {
		m.state.URL = m.url()
	}
	m.mu.Unlock()
	return nil
}

// State returns a snapshot of the process state.
func (m *Manager) State() State {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.state
}

// Args builds the `opa run` command line for the current settings, using
// only flags the OPA version supports.
func (m *Manager) Args() ([]string, error) {
	s := m.settings
	args := []string{"run", "--server", "--addr", s.Addr}
	has := func(f string) bool { return m.manifest == nil || m.manifest.HasFlag("run", f) }
	if s.LogLevel != "" && has("log-level") {
		args = append(args, "--log-level", s.LogLevel)
	}
	if strings.TrimSpace(s.Config) != "" {
		if !has("config-file") {
			return nil, errors.New("this OPA version does not support --config-file")
		}
		p := filepath.Join(m.dir, "config.yaml")
		if err := os.WriteFile(p, []byte(s.Config), 0o600); err != nil {
			return nil, err
		}
		args = append(args, "--config-file", p)
	}
	if s.Watch && s.Workspace != "" {
		if !has("watch") {
			return nil, errors.New("this OPA version does not support --watch")
		}
		args = append(args, "--watch")
	}
	args = append(args, s.ExtraArgs...)
	if s.Workspace != "" && m.resolve != nil {
		d, err := m.resolve(s.Workspace)
		if err != nil {
			return nil, fmt.Errorf("workspace %s: %w", s.Workspace, err)
		}
		load, err := LoadArgs(d, has("ignore"))
		if err != nil {
			return nil, err
		}
		args = append(args, load...)
	}
	return args, nil
}

// LoadArgs returns the arguments that make OPA load a workspace directory
// without its sample input documents (input*.json). Releases that support
// --ignore get the directory itself (preserving OPA's directory-based data
// namespacing); older releases get an explicit list of policy and data files.
func LoadArgs(dir string, supportsIgnore bool) ([]string, error) {
	if supportsIgnore {
		return []string{"--ignore", "input*.json", "--ignore", ".*", dir}, nil
	}
	var files []string
	err := filepath.WalkDir(dir, func(p string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		name := d.Name()
		if d.IsDir() {
			if p != dir && strings.HasPrefix(name, ".") {
				return filepath.SkipDir
			}
			return nil
		}
		switch {
		case strings.HasPrefix(name, "."), strings.HasPrefix(name, "input"):
		case strings.HasSuffix(name, ".rego"), name == "data.json", name == "data.yaml", name == "data.yml":
			files = append(files, p)
		}
		return nil
	})
	return files, err
}

// Start launches the process if it is not running.
func (m *Manager) Start() error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.binary == "" {
		return errors.New("opa binary not available")
	}
	if m.cmd != nil {
		return nil
	}
	m.desired = true
	m.state.Restarts = 0
	return m.startLocked()
}

func (m *Manager) startLocked() error {
	args, err := m.Args()
	if err != nil {
		m.state.Status, m.state.Error = "failed", err.Error()
		return err
	}
	cmd := exec.Command(m.binary, args...)
	cmd.Dir = m.dir
	cmd.Env = []string{"HOME=" + m.dir, "PATH=/usr/local/bin:/usr/bin:/bin"}
	stdout, _ := cmd.StdoutPipe()
	stderr, _ := cmd.StderrPipe()
	if err := cmd.Start(); err != nil {
		m.state.Status, m.state.Error = "failed", err.Error()
		return err
	}
	now := time.Now().UTC()
	m.cmd = cmd
	m.done = make(chan struct{})
	m.state = State{Status: "starting", PID: cmd.Process.Pid, StartedAt: &now, Command: append([]string{"opa"}, args...), Restarts: m.state.Restarts, URL: m.url()}
	m.emit("studio", "started: opa "+strings.Join(args, " "))
	var wg sync.WaitGroup
	wg.Add(2)
	go m.pump(stdout, "stdout", &wg)
	go m.pump(stderr, "stderr", &wg)
	go m.waitReady(cmd)
	go func(cmd *exec.Cmd, done chan struct{}) {
		wg.Wait()
		err := cmd.Wait()
		m.exited(cmd, err)
		close(done)
	}(cmd, m.done)
	return nil
}

func (m *Manager) waitReady(cmd *exec.Cmd) {
	client := &http.Client{Timeout: 2 * time.Second}
	for i := 0; i < 150; i++ {
		m.mu.Lock()
		if m.cmd != cmd {
			m.mu.Unlock()
			return
		}
		u := m.url()
		m.mu.Unlock()
		// /v1/policies exists in every OPA release, /health only since v0.?.
		if resp, err := client.Get(u + "/v1/policies"); err == nil {
			resp.Body.Close()
			m.mu.Lock()
			if m.cmd == cmd && m.state.Status == "starting" {
				m.state.Status = "running"
			}
			m.mu.Unlock()
			m.emit("studio", "ready at "+u)
			return
		}
		time.Sleep(200 * time.Millisecond)
	}
}

func (m *Manager) exited(cmd *exec.Cmd, err error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.cmd != cmd {
		return
	}
	now := time.Now().UTC()
	code := -1
	if cmd.ProcessState != nil {
		code = cmd.ProcessState.ExitCode()
	}
	m.cmd = nil
	m.state.ExitedAt = &now
	m.state.ExitCode = &code
	m.state.PID = 0
	if !m.desired {
		m.state.Status = "stopped"
		m.emit("studio", "stopped")
		return
	}
	m.state.Status = "exited"
	if err != nil {
		m.state.Error = err.Error()
	}
	m.emit("studio", fmt.Sprintf("process exited unexpectedly (code %d)", code))
	if m.settings.RestartOnFailure && m.state.Restarts < 5 {
		m.state.Restarts++
		backoff := time.Duration(m.state.Restarts) * 2 * time.Second
		m.emit("studio", fmt.Sprintf("restarting in %s", backoff))
		go func() {
			time.Sleep(backoff)
			m.mu.Lock()
			defer m.mu.Unlock()
			if m.desired && m.cmd == nil {
				_ = m.startLocked()
			}
		}()
	}
}

// Stop terminates the process gracefully (SIGINT/kill after 10s).
func (m *Manager) Stop() error {
	m.mu.Lock()
	m.desired = false
	cmd, done := m.cmd, m.done
	m.mu.Unlock()
	if cmd == nil {
		return nil
	}
	_ = interrupt(cmd.Process)
	select {
	case <-done:
	case <-time.After(10 * time.Second):
		_ = cmd.Process.Kill()
		<-done
	}
	return nil
}

// Restart stops and starts the process.
func (m *Manager) Restart() error {
	if err := m.Stop(); err != nil {
		return err
	}
	return m.Start()
}

// Shutdown stops the process during Studio shutdown.
func (m *Manager) Shutdown(ctx context.Context) {
	ch := make(chan struct{})
	go func() { _ = m.Stop(); close(ch) }()
	select {
	case <-ch:
	case <-ctx.Done():
	}
}

func (m *Manager) pump(r io.Reader, stream string, wg *sync.WaitGroup) {
	defer wg.Done()
	sc := bufio.NewScanner(r)
	sc.Buffer(make([]byte, 64*1024), 1<<20)
	for sc.Scan() {
		m.emit(stream, sc.Text())
	}
}

func (m *Manager) emit(stream, text string) {
	m.logMu.Lock()
	defer m.logMu.Unlock()
	m.seq++
	l := LogLine{Seq: m.seq, Time: time.Now().UTC(), Stream: stream, Text: text}
	m.logs = append(m.logs, l)
	if len(m.logs) > m.maxLogs {
		m.logs = m.logs[len(m.logs)-m.maxLogs:]
	}
	for ch := range m.subs {
		select {
		case ch <- l:
		default: // slow subscriber: drop rather than block the process
		}
	}
	if m.log != nil {
		m.log.Debug("local-opa", "stream", stream, "line", text)
	}
}

// Logs returns buffered lines with Seq > after.
func (m *Manager) Logs(after int64) []LogLine {
	m.logMu.Lock()
	defer m.logMu.Unlock()
	out := []LogLine{}
	for _, l := range m.logs {
		if l.Seq > after {
			out = append(out, l)
		}
	}
	return out
}

// ClearLogs empties the log buffer.
func (m *Manager) ClearLogs() {
	m.logMu.Lock()
	m.logs = nil
	m.logMu.Unlock()
}

// Subscribe streams new log lines until cancel is called.
func (m *Manager) Subscribe() (<-chan LogLine, func()) {
	ch := make(chan LogLine, 256)
	m.logMu.Lock()
	m.subs[ch] = struct{}{}
	m.logMu.Unlock()
	return ch, func() {
		m.logMu.Lock()
		delete(m.subs, ch)
		m.logMu.Unlock()
	}
}
