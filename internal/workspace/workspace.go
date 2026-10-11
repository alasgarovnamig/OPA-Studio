// Package workspace stores OPA Studio projects (policies, data, inputs, tests)
// as plain directories so they can be versioned, built into bundles and fed
// to the OPA CLI unchanged.
package workspace

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/alasgarovnamig/opa-studio/internal/bundle"
)

// ErrNotFound is returned for unknown workspaces or files.
var ErrNotFound = errors.New("not found")

const metaFile = ".studio-workspace.json"

// MaxFileSize bounds a single workspace file.
const MaxFileSize = 32 << 20

// Workspace is the metadata of a project.
type Workspace struct {
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	Description string    `json:"description,omitempty"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
	Files       int       `json:"files"`
}

// FileInfo describes a file in a workspace.
type FileInfo struct {
	Path     string    `json:"path"`
	Size     int64     `json:"size"`
	Modified time.Time `json:"modified"`
	Kind     string    `json:"kind"`
}

// Store manages workspaces below a root directory.
type Store struct {
	root string
	mu   sync.RWMutex
}

var idRe = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,62}$`)

// NewStore creates the root directory if needed.
func NewStore(root string) (*Store, error) {
	if err := os.MkdirAll(root, 0o755); err != nil {
		return nil, err
	}
	return &Store{root: root}, nil
}

// Dir returns the directory of workspace id.
func (s *Store) Dir(id string) (string, error) {
	if !idRe.MatchString(id) {
		return "", fmt.Errorf("invalid workspace id %q", id)
	}
	d := filepath.Join(s.root, id)
	if _, err := os.Stat(filepath.Join(d, metaFile)); err != nil {
		return "", ErrNotFound
	}
	return d, nil
}

func slug(name string) string {
	s := strings.ToLower(strings.TrimSpace(name))
	s = regexp.MustCompile(`[^a-z0-9]+`).ReplaceAllString(s, "-")
	s = strings.Trim(s, "-")
	if len(s) > 40 {
		s = s[:40]
	}
	if s == "" {
		s = "workspace"
	}
	return s
}

func randSuffix() string {
	b := make([]byte, 3)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func (s *Store) readMeta(id string) (*Workspace, error) {
	b, err := os.ReadFile(filepath.Join(s.root, id, metaFile))
	if err != nil {
		return nil, ErrNotFound
	}
	w := &Workspace{}
	if err := json.Unmarshal(b, w); err != nil {
		return nil, err
	}
	files, _ := s.files(id)
	w.Files = len(files)
	return w, nil
}

func (s *Store) writeMeta(w *Workspace) error {
	b, err := json.MarshalIndent(w, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(s.root, w.ID, metaFile), b, 0o644)
}

// List returns all workspaces sorted by name.
func (s *Store) List() ([]*Workspace, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	entries, err := os.ReadDir(s.root)
	if err != nil {
		return nil, err
	}
	out := []*Workspace{}
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		if w, err := s.readMeta(e.Name()); err == nil {
			out = append(out, w)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out, nil
}

// Get returns one workspace.
func (s *Store) Get(id string) (*Workspace, error) {
	if !idRe.MatchString(id) {
		return nil, ErrNotFound
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.readMeta(id)
}

// Create makes a new workspace with the given files.
func (s *Store) Create(id, name, description string, files map[string]string) (*Workspace, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if id == "" {
		id = slug(name)
		if _, err := os.Stat(filepath.Join(s.root, id)); err == nil {
			id = id + "-" + randSuffix()
		}
	}
	if !idRe.MatchString(id) {
		return nil, fmt.Errorf("invalid workspace id %q", id)
	}
	dir := filepath.Join(s.root, id)
	if _, err := os.Stat(dir); err == nil {
		return nil, fmt.Errorf("workspace %q already exists", id)
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}
	now := time.Now().UTC()
	if name == "" {
		name = id
	}
	w := &Workspace{ID: id, Name: name, Description: description, CreatedAt: now, UpdatedAt: now}
	if err := s.writeMeta(w); err != nil {
		return nil, err
	}
	for p, content := range files {
		if err := s.writeFileLocked(id, p, []byte(content)); err != nil {
			return nil, err
		}
	}
	w.Files = len(files)
	return w, nil
}

// Update changes name and description.
func (s *Store) Update(id, name, description string) (*Workspace, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	w, err := s.readMeta(id)
	if err != nil {
		return nil, err
	}
	if name != "" {
		w.Name = name
	}
	w.Description = description
	w.UpdatedAt = time.Now().UTC()
	return w, s.writeMeta(w)
}

// Delete removes a workspace and all its files.
func (s *Store) Delete(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !idRe.MatchString(id) {
		return ErrNotFound
	}
	dir := filepath.Join(s.root, id)
	if _, err := os.Stat(filepath.Join(dir, metaFile)); err != nil {
		return ErrNotFound
	}
	return os.RemoveAll(dir)
}

func kind(p string) string {
	switch strings.ToLower(filepath.Ext(p)) {
	case ".rego":
		if strings.HasSuffix(p, "_test.rego") {
			return "test"
		}
		return "rego"
	case ".json":
		if filepath.Base(p) == "data.json" {
			return "data"
		}
		if strings.HasPrefix(filepath.Base(p), "input") {
			return "input"
		}
		return "json"
	case ".yaml", ".yml":
		if strings.HasPrefix(filepath.Base(p), "data.") {
			return "data"
		}
		return "yaml"
	case ".pem", ".key", ".crt":
		return "key"
	case ".gz", ".tgz":
		return "archive"
	case ".wasm":
		return "wasm"
	}
	return "file"
}

func (s *Store) files(id string) ([]FileInfo, error) {
	dir := filepath.Join(s.root, id)
	out := []FileInfo{}
	err := filepath.WalkDir(dir, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			if p != dir && strings.HasPrefix(d.Name(), ".") {
				return filepath.SkipDir
			}
			return nil
		}
		if d.Name() == metaFile || !d.Type().IsRegular() {
			return nil
		}
		info, err := d.Info()
		if err != nil {
			return err
		}
		rel, _ := filepath.Rel(dir, p)
		rel = filepath.ToSlash(rel)
		out = append(out, FileInfo{Path: rel, Size: info.Size(), Modified: info.ModTime().UTC(), Kind: kind(rel)})
		return nil
	})
	sort.Slice(out, func(i, j int) bool { return out[i].Path < out[j].Path })
	return out, err
}

// Files lists the files of a workspace.
func (s *Store) Files(id string) ([]FileInfo, error) {
	if _, err := s.Dir(id); err != nil {
		return nil, err
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.files(id)
}

func (s *Store) path(id, rel string) (string, error) {
	dir := filepath.Join(s.root, id)
	clean := filepath.Clean(filepath.FromSlash(strings.TrimPrefix(rel, "/")))
	if clean == "." || clean == ".." || strings.HasPrefix(clean, ".."+string(filepath.Separator)) || filepath.IsAbs(clean) {
		return "", fmt.Errorf("invalid path %q", rel)
	}
	if filepath.Base(clean) == metaFile {
		return "", fmt.Errorf("reserved path %q", rel)
	}
	for _, seg := range strings.Split(filepath.ToSlash(clean), "/") {
		if strings.HasPrefix(seg, ".") && seg != ".manifest" {
			return "", fmt.Errorf("hidden paths are not allowed: %q", rel)
		}
	}
	return filepath.Join(dir, clean), nil
}

// ReadFile returns a file's content.
func (s *Store) ReadFile(id, rel string) ([]byte, error) {
	if _, err := s.Dir(id); err != nil {
		return nil, err
	}
	p, err := s.path(id, rel)
	if err != nil {
		return nil, err
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	b, err := os.ReadFile(p)
	if errors.Is(err, fs.ErrNotExist) {
		return nil, ErrNotFound
	}
	return b, err
}

func (s *Store) writeFileLocked(id, rel string, data []byte) error {
	if len(data) > MaxFileSize {
		return fmt.Errorf("file %s exceeds %d bytes", rel, MaxFileSize)
	}
	p, err := s.path(id, rel)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		return err
	}
	tmp := p + ".tmp-" + randSuffix()
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, p)
}

func (s *Store) touch(id string) {
	if w, err := s.readMeta(id); err == nil {
		w.UpdatedAt = time.Now().UTC()
		_ = s.writeMeta(w)
	}
}

// WriteFile creates or replaces a file atomically.
func (s *Store) WriteFile(id, rel string, data []byte) error {
	if _, err := s.Dir(id); err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.writeFileLocked(id, rel, data); err != nil {
		return err
	}
	s.touch(id)
	return nil
}

// DeleteFile removes a file (and empty parent directories).
func (s *Store) DeleteFile(id, rel string) error {
	dir, err := s.Dir(id)
	if err != nil {
		return err
	}
	p, err := s.path(id, rel)
	if err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := os.Remove(p); err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return ErrNotFound
		}
		return err
	}
	for d := filepath.Dir(p); d != dir; d = filepath.Dir(d) {
		if os.Remove(d) != nil {
			break
		}
	}
	s.touch(id)
	return nil
}

// RenameFile moves a file within a workspace.
func (s *Store) RenameFile(id, from, to string) error {
	if _, err := s.Dir(id); err != nil {
		return err
	}
	src, err := s.path(id, from)
	if err != nil {
		return err
	}
	dst, err := s.path(id, to)
	if err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, err := os.Stat(src); err != nil {
		return ErrNotFound
	}
	if _, err := os.Stat(dst); err == nil {
		return fmt.Errorf("%s already exists", to)
	}
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return err
	}
	if err := os.Rename(src, dst); err != nil {
		return err
	}
	s.touch(id)
	return nil
}

// ReadAll returns every text file of the workspace keyed by relative path.
func (s *Store) ReadAll(id string) (map[string]string, error) {
	files, err := s.Files(id)
	if err != nil {
		return nil, err
	}
	out := map[string]string{}
	for _, f := range files {
		b, err := s.ReadFile(id, f.Path)
		if err != nil {
			return nil, err
		}
		out[f.Path] = string(b)
	}
	return out, nil
}

// Bundle builds a native bundle archive of the workspace.
func (s *Store) Bundle(id string, manifest map[string]any) ([]byte, error) {
	dir, err := s.Dir(id)
	if err != nil {
		return nil, err
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	return bundle.Build(dir, manifest)
}

// Import extracts a bundle/tarball into the workspace (overwriting files).
func (s *Store) Import(id string, archive []byte) ([]string, error) {
	if _, err := s.Dir(id); err != nil {
		return nil, err
	}
	var names []string
	s.mu.Lock()
	defer s.mu.Unlock()
	err := bundle.Walk(strings.NewReader(string(archive)), func(name string, data []byte) error {
		if filepath.Base(name) == ".signatures.json" {
			// Signatures are only valid for the original archive; re-sign after editing.
			return nil
		}
		if err := s.writeFileLocked(id, name, data); err != nil {
			return err
		}
		names = append(names, name)
		return nil
	})
	if err != nil {
		return names, err
	}
	s.touch(id)
	return names, nil
}
