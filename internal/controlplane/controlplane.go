// Package controlplane implements the OPA management APIs on the Studio side
// so OPA agents can be pointed at Studio:
//
//   - Bundle service:   GET  /cp/bundles/{name}           (bundles plugin)
//   - Discovery:        GET  /cp/discovery/{name}         (discovery plugin)
//   - Decision logs:    POST /cp/logs                     (decision_logs plugin)
//   - Status:           POST /cp/status                   (status plugin)
//
// Everything OPA reports is kept in bounded in-memory buffers (and decision
// logs are additionally appended to a JSONL file) for inspection in the UI.
package controlplane

import (
	"bytes"
	"compress/gzip"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/alasgarovnamig/opa-studio/internal/bundle"
)

// ErrNotFound is returned for unknown bundles or discovery documents.
var ErrNotFound = errors.New("not found")

var nameRe = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`)

// BundleMeta describes a published bundle.
type BundleMeta struct {
	Name        string     `json:"name"`
	Revision    string     `json:"revision,omitempty"`
	Source      string     `json:"source,omitempty"`
	Size        int64      `json:"size"`
	SHA256      string     `json:"sha256"`
	ETag        string     `json:"etag"`
	Signed      bool       `json:"signed"`
	PublishedAt time.Time  `json:"publishedAt"`
	Downloads   int64      `json:"downloads"`
	NotModified int64      `json:"notModified"`
	LastFetch   *time.Time `json:"lastFetch,omitempty"`
	LastClient  string     `json:"lastClient,omitempty"`
}

// Discovery is a discovery document served as a bundle.
type Discovery struct {
	Name      string          `json:"name"`
	Decision  string          `json:"decision"` // slash separated path, e.g. "example/discovery"
	Config    json.RawMessage `json:"config"`   // the OPA configuration to distribute
	UpdatedAt time.Time       `json:"updatedAt"`
}

// Decision is one decision log event as sent by OPA.
type Decision struct {
	ReceivedAt time.Time       `json:"received_at"`
	Remote     string          `json:"remote"`
	DecisionID string          `json:"decision_id,omitempty"`
	Path       string          `json:"path,omitempty"`
	Timestamp  string          `json:"timestamp,omitempty"`
	Raw        json.RawMessage `json:"event"`
}

// Status is one status report as sent by OPA.
type Status struct {
	ReceivedAt time.Time       `json:"received_at"`
	Remote     string          `json:"remote"`
	InstanceID string          `json:"instance_id"`
	Raw        json.RawMessage `json:"report"`
}

// Store holds control plane state.
type Store struct {
	dir string

	mu        sync.RWMutex
	bundles   map[string]*BundleMeta
	discovery map[string]*Discovery

	logMu     sync.RWMutex
	decisions []Decision
	decLimit  int
	logFile   *os.File
	decSubs   map[chan Decision]struct{}

	statMu    sync.RWMutex
	statuses  []Status
	statLimit int
	latest    map[string]Status
}

// Open loads persisted bundles and discovery documents from dir.
func Open(dir string, decisionLimit, statusLimit int) (*Store, error) {
	for _, d := range []string{"bundles", "discovery"} {
		if err := os.MkdirAll(filepath.Join(dir, d), 0o755); err != nil {
			return nil, err
		}
	}
	s := &Store{
		dir: dir, bundles: map[string]*BundleMeta{}, discovery: map[string]*Discovery{},
		decLimit: decisionLimit, statLimit: statusLimit, latest: map[string]Status{},
		decSubs: map[chan Decision]struct{}{},
	}
	metas, _ := filepath.Glob(filepath.Join(dir, "bundles", "*.json"))
	for _, p := range metas {
		b, err := os.ReadFile(p)
		if err != nil {
			continue
		}
		m := &BundleMeta{}
		if json.Unmarshal(b, m) == nil && nameRe.MatchString(m.Name) {
			s.bundles[m.Name] = m
		}
	}
	docs, _ := filepath.Glob(filepath.Join(dir, "discovery", "*.json"))
	for _, p := range docs {
		b, err := os.ReadFile(p)
		if err != nil {
			continue
		}
		d := &Discovery{}
		if json.Unmarshal(b, d) == nil && nameRe.MatchString(d.Name) {
			s.discovery[d.Name] = d
		}
	}
	f, err := os.OpenFile(filepath.Join(dir, "decisions.jsonl"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return nil, err
	}
	s.logFile = f
	return s, nil
}

// Close releases resources.
func (s *Store) Close() error { return s.logFile.Close() }

// ---- bundles ---------------------------------------------------------------

// PublishBundle stores an archive under name.
func (s *Store) PublishBundle(name, source string, archive []byte) (*BundleMeta, error) {
	if !nameRe.MatchString(name) {
		return nil, fmt.Errorf("invalid bundle name %q", name)
	}
	sum, err := bundle.Inspect(archive)
	if err != nil {
		return nil, fmt.Errorf("invalid bundle: %w", err)
	}
	meta := &BundleMeta{Name: name, Source: source, Size: int64(len(archive)), SHA256: sum.SHA256, ETag: bundle.ETag(archive), PublishedAt: time.Now().UTC(), Signed: sum.Signatures != nil}
	if sum.Manifest != nil {
		var mf struct {
			Revision string `json:"revision"`
		}
		_ = json.Unmarshal(sum.Manifest, &mf)
		meta.Revision = mf.Revision
	}
	if err := os.WriteFile(filepath.Join(s.dir, "bundles", name+".tar.gz"), archive, 0o644); err != nil {
		return nil, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.bundles[name] = meta
	return meta, s.saveBundleMeta(meta)
}

func (s *Store) saveBundleMeta(m *BundleMeta) error {
	b, err := json.MarshalIndent(m, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(s.dir, "bundles", m.Name+".json"), b, 0o644)
}

// Bundles lists published bundles.
func (s *Store) Bundles() []BundleMeta {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]BundleMeta, 0, len(s.bundles))
	for _, b := range s.bundles {
		out = append(out, *b)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out
}

// Bundle returns metadata and archive bytes.
func (s *Store) Bundle(name string) (*BundleMeta, []byte, error) {
	s.mu.RLock()
	m, ok := s.bundles[name]
	s.mu.RUnlock()
	if !ok {
		return nil, nil, ErrNotFound
	}
	b, err := os.ReadFile(filepath.Join(s.dir, "bundles", name+".tar.gz"))
	if err != nil {
		return nil, nil, err
	}
	cp := *m
	return &cp, b, nil
}

// RecordFetch updates download statistics.
func (s *Store) RecordFetch(name, client string, notModified bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	m, ok := s.bundles[name]
	if !ok {
		return
	}
	now := time.Now().UTC()
	m.LastFetch, m.LastClient = &now, client
	if notModified {
		m.NotModified++
	} else {
		m.Downloads++
	}
	_ = s.saveBundleMeta(m)
}

// DeleteBundle removes a bundle.
func (s *Store) DeleteBundle(name string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.bundles[name]; !ok {
		return ErrNotFound
	}
	delete(s.bundles, name)
	os.Remove(filepath.Join(s.dir, "bundles", name+".tar.gz"))
	return os.Remove(filepath.Join(s.dir, "bundles", name+".json"))
}

// ---- discovery -------------------------------------------------------------

// PutDiscovery stores a discovery document.
func (s *Store) PutDiscovery(d *Discovery) error {
	if !nameRe.MatchString(d.Name) {
		return fmt.Errorf("invalid name %q", d.Name)
	}
	d.Decision = strings.Trim(strings.ReplaceAll(d.Decision, ".", "/"), "/")
	if d.Decision == "" {
		return errors.New("decision path is required (e.g. example/discovery)")
	}
	var cfg map[string]any
	if err := json.Unmarshal(d.Config, &cfg); err != nil {
		return fmt.Errorf("config must be a JSON object: %w", err)
	}
	d.UpdatedAt = time.Now().UTC()
	b, err := json.MarshalIndent(d, "", "  ")
	if err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.discovery[d.Name] = d
	return os.WriteFile(filepath.Join(s.dir, "discovery", d.Name+".json"), b, 0o644)
}

// Discoveries lists discovery documents.
func (s *Store) Discoveries() []Discovery {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]Discovery, 0, len(s.discovery))
	for _, d := range s.discovery {
		out = append(out, *d)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out
}

// DiscoveryBundle builds the bundle served for a discovery document.
func (s *Store) DiscoveryBundle(name string) ([]byte, error) {
	s.mu.RLock()
	d, ok := s.discovery[name]
	s.mu.RUnlock()
	if !ok {
		return nil, ErrNotFound
	}
	var cfg any
	if err := json.Unmarshal(d.Config, &cfg); err != nil {
		return nil, err
	}
	return bundle.FromData(map[string]any{d.Decision: cfg}, map[string]any{
		"revision": d.UpdatedAt.Format(time.RFC3339Nano),
		"roots":    []string{d.Decision},
	})
}

// DeleteDiscovery removes a discovery document.
func (s *Store) DeleteDiscovery(name string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.discovery[name]; !ok {
		return ErrNotFound
	}
	delete(s.discovery, name)
	return os.Remove(filepath.Join(s.dir, "discovery", name+".json"))
}

// ---- decision logs ---------------------------------------------------------

// maybeGunzip transparently decompresses gzip payloads (OPA gzips decision logs).
func maybeGunzip(body []byte, limit int64) ([]byte, error) {
	if len(body) < 2 || body[0] != 0x1f || body[1] != 0x8b {
		return body, nil
	}
	zr, err := gzip.NewReader(bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	defer zr.Close()
	out, err := io.ReadAll(io.LimitReader(zr, limit+1))
	if err != nil {
		return nil, err
	}
	if int64(len(out)) > limit {
		return nil, errors.New("decompressed payload too large")
	}
	return out, nil
}

// IngestDecisions parses a decision log upload (JSON array, possibly gzipped).
func (s *Store) IngestDecisions(body []byte, remote string, limit int64) (int, error) {
	raw, err := maybeGunzip(body, limit)
	if err != nil {
		return 0, err
	}
	var events []json.RawMessage
	if err := json.Unmarshal(raw, &events); err != nil {
		// Some OPA versions/configurations send a single object.
		var one json.RawMessage
		if err2 := json.Unmarshal(raw, &one); err2 != nil {
			return 0, fmt.Errorf("decode decision logs: %w", err)
		}
		events = []json.RawMessage{one}
	}
	now := time.Now().UTC()
	batch := make([]Decision, 0, len(events))
	for _, e := range events {
		var hdr struct {
			DecisionID string `json:"decision_id"`
			Path       string `json:"path"`
			Timestamp  string `json:"timestamp"`
		}
		_ = json.Unmarshal(e, &hdr)
		batch = append(batch, Decision{ReceivedAt: now, Remote: remote, DecisionID: hdr.DecisionID, Path: hdr.Path, Timestamp: hdr.Timestamp, Raw: e})
	}
	s.logMu.Lock()
	defer s.logMu.Unlock()
	for _, d := range batch {
		if line, err := json.Marshal(d); err == nil {
			_, _ = s.logFile.Write(append(line, '\n'))
		}
		for ch := range s.decSubs {
			select {
			case ch <- d:
			default:
			}
		}
	}
	s.decisions = append(s.decisions, batch...)
	if over := len(s.decisions) - s.decLimit; over > 0 {
		s.decisions = append([]Decision(nil), s.decisions[over:]...)
	}
	return len(batch), nil
}

// DecisionQuery filters decision logs.
type DecisionQuery struct {
	Path   string
	Search string
	Limit  int
	Offset int
}

// Decisions returns newest-first decisions matching q and the total match count.
func (s *Store) Decisions(q DecisionQuery) ([]Decision, int) {
	s.logMu.RLock()
	defer s.logMu.RUnlock()
	matched := []Decision{}
	search := strings.ToLower(q.Search)
	for i := len(s.decisions) - 1; i >= 0; i-- {
		d := s.decisions[i]
		if q.Path != "" && !strings.HasPrefix(d.Path, strings.Trim(q.Path, "/")) {
			continue
		}
		if search != "" && !strings.Contains(strings.ToLower(string(d.Raw)), search) {
			continue
		}
		matched = append(matched, d)
	}
	total := len(matched)
	if q.Offset > len(matched) {
		q.Offset = len(matched)
	}
	matched = matched[q.Offset:]
	if q.Limit > 0 && len(matched) > q.Limit {
		matched = matched[:q.Limit]
	}
	return matched, total
}

// ClearDecisions empties the in-memory buffer and truncates the JSONL file.
func (s *Store) ClearDecisions() error {
	s.logMu.Lock()
	defer s.logMu.Unlock()
	s.decisions = nil
	return s.logFile.Truncate(0)
}

// SubscribeDecisions streams newly ingested decisions.
func (s *Store) SubscribeDecisions() (<-chan Decision, func()) {
	ch := make(chan Decision, 256)
	s.logMu.Lock()
	s.decSubs[ch] = struct{}{}
	s.logMu.Unlock()
	return ch, func() {
		s.logMu.Lock()
		delete(s.decSubs, ch)
		s.logMu.Unlock()
	}
}

// ---- status ----------------------------------------------------------------

// IngestStatus records a status report.
func (s *Store) IngestStatus(body []byte, remote string, limit int64) error {
	raw, err := maybeGunzip(body, limit)
	if err != nil {
		return err
	}
	var hdr struct {
		Labels map[string]string `json:"labels"`
	}
	if err := json.Unmarshal(raw, &hdr); err != nil {
		return fmt.Errorf("decode status: %w", err)
	}
	id := hdr.Labels["id"]
	if id == "" {
		id = remote
	}
	st := Status{ReceivedAt: time.Now().UTC(), Remote: remote, InstanceID: id, Raw: raw}
	s.statMu.Lock()
	defer s.statMu.Unlock()
	s.statuses = append(s.statuses, st)
	if over := len(s.statuses) - s.statLimit; over > 0 {
		s.statuses = append([]Status(nil), s.statuses[over:]...)
	}
	s.latest[id] = st
	return nil
}

// Statuses returns newest-first status reports (optionally for one instance).
func (s *Store) Statuses(instance string, limit int) []Status {
	s.statMu.RLock()
	defer s.statMu.RUnlock()
	out := []Status{}
	for i := len(s.statuses) - 1; i >= 0 && (limit <= 0 || len(out) < limit); i-- {
		if instance == "" || s.statuses[i].InstanceID == instance {
			out = append(out, s.statuses[i])
		}
	}
	return out
}

// Instances returns the latest status per OPA instance.
func (s *Store) Instances() []Status {
	s.statMu.RLock()
	defer s.statMu.RUnlock()
	out := make([]Status, 0, len(s.latest))
	for _, st := range s.latest {
		out = append(out, st)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].InstanceID < out[j].InstanceID })
	return out
}

// ClearStatuses empties the status buffers.
func (s *Store) ClearStatuses() {
	s.statMu.Lock()
	defer s.statMu.Unlock()
	s.statuses = nil
	s.latest = map[string]Status{}
}
