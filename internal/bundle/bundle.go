// Package bundle reads and writes OPA bundle archives (gzipped tarballs).
//
// The native implementation is used to serve bundles from the control plane
// and to show bundle contents for OPA versions that predate `opa build` and
// `opa inspect`. When the CLI supports it, Studio prefers `opa build`.
package bundle

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// MaxFileSize bounds individual files extracted from archives.
const MaxFileSize = 128 << 20

// MaxArchiveSize bounds the total size of extracted archives.
const MaxArchiveSize = 512 << 20

// Entry is a file inside a bundle.
type Entry struct {
	Path   string `json:"path"`
	Size   int64  `json:"size"`
	SHA256 string `json:"sha256"`
	Kind   string `json:"kind"` // rego, data, manifest, signatures, wasm, plan, other
}

// Summary describes a bundle archive.
type Summary struct {
	Entries    []Entry         `json:"entries"`
	Manifest   json.RawMessage `json:"manifest,omitempty"`
	Signatures json.RawMessage `json:"signatures,omitempty"`
	Size       int64           `json:"size"`
	SHA256     string          `json:"sha256"`
}

func kindOf(p string) string {
	base := path.Base(p)
	switch {
	case base == ".manifest":
		return "manifest"
	case base == ".signatures.json":
		return "signatures"
	case strings.HasSuffix(p, ".rego"):
		return "rego"
	case base == "data.json" || base == "data.yaml" || base == "data.yml":
		return "data"
	case strings.HasSuffix(p, ".wasm"):
		return "wasm"
	case base == "plan.json":
		return "plan"
	}
	return "other"
}

// Include reports whether a workspace file belongs in a bundle.
func Include(rel string) bool {
	base := path.Base(rel)
	if strings.HasPrefix(base, ".") && base != ".manifest" {
		return false
	}
	switch kindOf(rel) {
	case "rego", "data", "manifest", "wasm", "plan":
		return true
	}
	return false
}

// Build creates a bundle archive from the regular files under dir.
// Only bundle-relevant files are included (see Include). When manifest is
// non-nil it is written as /.manifest, overriding any file on disk.
func Build(dir string, manifest map[string]any) ([]byte, error) {
	var files []string
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
		if !d.Type().IsRegular() {
			return nil
		}
		rel, err := filepath.Rel(dir, p)
		if err != nil {
			return err
		}
		rel = filepath.ToSlash(rel)
		if Include(rel) && !(manifest != nil && rel == ".manifest") {
			files = append(files, rel)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	sort.Strings(files)
	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	tw := tar.NewWriter(gz)
	now := time.Unix(0, 0)
	add := func(name string, data []byte) error {
		hdr := &tar.Header{Name: "/" + name, Mode: 0o644, Size: int64(len(data)), ModTime: now, Typeflag: tar.TypeReg}
		if err := tw.WriteHeader(hdr); err != nil {
			return err
		}
		_, err := tw.Write(data)
		return err
	}
	if manifest != nil {
		b, err := json.Marshal(manifest)
		if err != nil {
			return nil, err
		}
		if err := add(".manifest", b); err != nil {
			return nil, err
		}
	}
	for _, f := range files {
		data, err := os.ReadFile(filepath.Join(dir, filepath.FromSlash(f)))
		if err != nil {
			return nil, err
		}
		if err := add(f, data); err != nil {
			return nil, err
		}
	}
	if err := tw.Close(); err != nil {
		return nil, err
	}
	if err := gz.Close(); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// FromData creates a bundle that only contains data documents. Keys of docs
// are slash separated paths (e.g. "example/discovery"). The archive is built
// in memory so it works on read-only root filesystems.
func FromData(docs map[string]any, manifest map[string]any) ([]byte, error) {
	paths := make([]string, 0, len(docs))
	for p := range docs {
		paths = append(paths, p)
	}
	sort.Strings(paths)
	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	tw := tar.NewWriter(gz)
	add := func(name string, v any) error {
		b, err := json.Marshal(v)
		if err != nil {
			return err
		}
		hdr := &tar.Header{Name: "/" + name, Mode: 0o644, Size: int64(len(b)), ModTime: time.Unix(0, 0), Typeflag: tar.TypeReg}
		if err := tw.WriteHeader(hdr); err != nil {
			return err
		}
		_, err = tw.Write(b)
		return err
	}
	if manifest != nil {
		if err := add(".manifest", manifest); err != nil {
			return nil, err
		}
	}
	for _, p := range paths {
		clean := strings.Trim(path.Clean("/"+p), "/")
		name := "data.json"
		if clean != "" {
			name = clean + "/data.json"
		}
		if err := add(name, docs[p]); err != nil {
			return nil, err
		}
	}
	if err := tw.Close(); err != nil {
		return nil, err
	}
	if err := gz.Close(); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// Walk calls fn for each regular file of a gzipped tar archive.
func Walk(r io.Reader, fn func(name string, data []byte) error) error {
	gz, err := gzip.NewReader(r)
	if err != nil {
		return fmt.Errorf("not a gzip archive: %w", err)
	}
	defer gz.Close()
	tr := tar.NewReader(gz)
	var total int64
	for {
		hdr, err := tr.Next()
		if errors.Is(err, io.EOF) {
			return nil
		}
		if err != nil {
			return err
		}
		if hdr.Typeflag != tar.TypeReg && hdr.Typeflag != tar.TypeRegA {
			continue
		}
		if hdr.Size > MaxFileSize {
			return fmt.Errorf("%s: file too large", hdr.Name)
		}
		total += hdr.Size
		if total > MaxArchiveSize {
			return errors.New("archive too large")
		}
		data, err := io.ReadAll(io.LimitReader(tr, MaxFileSize+1))
		if err != nil {
			return err
		}
		name := strings.TrimPrefix(path.Clean("/"+hdr.Name), "/")
		if err := fn(name, data); err != nil {
			return err
		}
	}
}

// Inspect summarises a bundle archive.
func Inspect(archive []byte) (*Summary, error) {
	sum := sha256.Sum256(archive)
	s := &Summary{Size: int64(len(archive)), SHA256: hex.EncodeToString(sum[:])}
	err := Walk(bytes.NewReader(archive), func(name string, data []byte) error {
		h := sha256.Sum256(data)
		e := Entry{Path: name, Size: int64(len(data)), SHA256: hex.EncodeToString(h[:]), Kind: kindOf(name)}
		s.Entries = append(s.Entries, e)
		switch e.Kind {
		case "manifest":
			if json.Valid(data) {
				s.Manifest = data
			}
		case "signatures":
			if json.Valid(data) {
				s.Signatures = data
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	sort.Slice(s.Entries, func(i, j int) bool { return s.Entries[i].Path < s.Entries[j].Path })
	return s, nil
}

// Extract writes the archive's files below dir, refusing unsafe paths.
func Extract(archive []byte, dir string) ([]string, error) {
	var names []string
	err := Walk(bytes.NewReader(archive), func(name string, data []byte) error {
		if name == "" || strings.HasPrefix(name, "..") {
			return fmt.Errorf("unsafe path %q", name)
		}
		target := filepath.Join(dir, filepath.FromSlash(name))
		if !strings.HasPrefix(target, filepath.Clean(dir)+string(filepath.Separator)) {
			return fmt.Errorf("unsafe path %q", name)
		}
		if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
			return err
		}
		names = append(names, name)
		return os.WriteFile(target, data, 0o644)
	})
	return names, err
}

// ETag returns a strong entity tag for archive bytes.
func ETag(archive []byte) string {
	sum := sha256.Sum256(archive)
	return `"` + hex.EncodeToString(sum[:16]) + `"`
}
