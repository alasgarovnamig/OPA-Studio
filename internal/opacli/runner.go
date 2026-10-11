// Package opacli runs the bundled OPA binary on behalf of the UI.
//
// Every invocation runs in a fresh temporary directory populated with the
// files supplied by the caller (or a copy of a workspace), with a scrubbed
// environment, a timeout and capped output. In sandbox mode arguments that
// point outside that directory are rejected.
package opacli

import (
	"bytes"
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/alasgarovnamig/opa-studio/internal/manifest"
)

// ErrNoBinary is returned when no opa binary could be located.
var ErrNoBinary = errors.New("opa binary not available")

// Binary describes the OPA executable Studio drives.
type Binary struct {
	Path    string `json:"path"`
	Version string `json:"version"`
	Raw     string `json:"raw"`
}

// Locate resolves the OPA binary: an explicit path, else "opa" on PATH.
func Locate(explicit string) (string, error) {
	if explicit != "" {
		if _, err := os.Stat(explicit); err != nil {
			return "", fmt.Errorf("opa binary %q: %w", explicit, err)
		}
		return filepath.Abs(explicit)
	}
	p, err := exec.LookPath("opa")
	if err != nil {
		return "", ErrNoBinary
	}
	return p, nil
}

// Detect runs `opa version` and parses the result.
func Detect(path string) (*Binary, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, path, "version").CombinedOutput()
	if err != nil {
		return nil, fmt.Errorf("opa version: %w: %s", err, out)
	}
	b := &Binary{Path: path, Raw: string(out)}
	for _, line := range strings.Split(string(out), "\n") {
		if strings.HasPrefix(line, "Version:") {
			b.Version = manifest.Normalize(line)
		}
	}
	if b.Version == "" {
		return nil, fmt.Errorf("cannot parse opa version output: %q", out)
	}
	return b, nil
}

// File is an output file collected after a run.
type File struct {
	Size   int64  `json:"size"`
	Text   string `json:"text,omitempty"`
	Base64 string `json:"base64,omitempty"`
}

// Request is a single CLI invocation.
type Request struct {
	Args []string `json:"args"`
	// Files are written into the working directory before the run (UTF-8 text).
	Files map[string]string `json:"files,omitempty"`
	// BinaryFiles are base64 encoded files written into the working directory.
	BinaryFiles map[string]string `json:"binaryFiles,omitempty"`
	// Stdin is piped to the process.
	Stdin string `json:"stdin,omitempty"`
	// TimeoutSeconds overrides the default timeout (bounded by the server limit).
	TimeoutSeconds int `json:"timeoutSeconds,omitempty"`
	// Collect lists glob patterns (relative to the working directory) of files
	// to return after the run, e.g. "bundle.tar.gz" or "*.json".
	Collect []string `json:"collect,omitempty"`
}

// Result is the outcome of a CLI invocation.
type Result struct {
	Command    []string        `json:"command"`
	ExitCode   int             `json:"exitCode"`
	Stdout     string          `json:"stdout"`
	Stderr     string          `json:"stderr"`
	DurationMs int64           `json:"durationMs"`
	TimedOut   bool            `json:"timedOut"`
	Truncated  bool            `json:"truncated"`
	Files      map[string]File `json:"files,omitempty"`
	// Changed lists files of the working directory modified by the run
	// (e.g. by `opa fmt -w`), keyed by relative path, with their new content.
	Changed map[string]string `json:"changed,omitempty"`
}

// Runner executes OPA commands.
type Runner struct {
	binary    *Binary
	manifest  *manifest.Manifest
	sandbox   bool
	timeout   time.Duration
	maxOutput int64
	sem       chan struct{}
	tmpRoot   string
}

// Options configures a Runner.
type Options struct {
	Binary      *Binary
	Manifest    *manifest.Manifest
	Sandbox     bool
	Timeout     time.Duration
	MaxOutput   int64
	Concurrency int
	TmpRoot     string
}

// New returns a Runner. Binary may be nil, in which case Run fails with ErrNoBinary.
func New(o Options) *Runner {
	if o.Concurrency < 1 {
		o.Concurrency = 1
	}
	return &Runner{
		binary: o.Binary, manifest: o.Manifest, sandbox: o.Sandbox, timeout: o.Timeout,
		maxOutput: o.MaxOutput, sem: make(chan struct{}, o.Concurrency), tmpRoot: o.TmpRoot,
	}
}

// Binary returns the binary in use (nil when unavailable).
func (r *Runner) Binary() *Binary { return r.binary }

// Manifest returns the manifest describing the binary.
func (r *Runner) Manifest() *manifest.Manifest { return r.manifest }

// Commands that never terminate on their own or that need a TTY are handled
// by dedicated subsystems (local OPA manager, REPL) instead of one-shot runs.
var longRunning = map[string]string{
	"run": "use the Local OPA server or REPL pages to start `opa run`",
}

// ValidateArgs enforces the command allow-list and the sandbox rules.
func (r *Runner) ValidateArgs(args []string) error {
	if len(args) == 0 {
		return errors.New("missing command")
	}
	cmd := args[0]
	if msg, ok := longRunning[cmd]; ok {
		return fmt.Errorf("command %q is not allowed here: %s", cmd, msg)
	}
	if r.manifest != nil && len(r.manifest.CLI.Commands) > 0 && !r.manifest.HasCommand(cmd) && cmd != "version" {
		return fmt.Errorf("command %q is not supported by OPA %s", cmd, r.manifest.OPA.Version)
	}
	return r.ValidateFlags(args[1:])
}

// ValidateFlags applies the sandbox rules to command arguments.
func (r *Runner) ValidateFlags(args []string) error {
	if !r.sandbox {
		return nil
	}
	for _, a := range args {
		v := a
		if strings.HasPrefix(a, "-") {
			if i := strings.IndexByte(a, '='); i >= 0 {
				v = a[i+1:]
			} else {
				continue
			}
		}
		if err := checkPathArg(v); err != nil {
			return err
		}
	}
	return nil
}

func checkPathArg(v string) error {
	if strings.Contains(v, "://") {
		// URLs (e.g. --capabilities https://...) are not filesystem paths.
		return nil
	}
	for _, part := range strings.Split(v, ":") {
		p := strings.TrimSpace(part)
		if strings.HasPrefix(p, "/") || strings.HasPrefix(p, "~") || strings.HasPrefix(p, `\`) || filepath.VolumeName(p) != "" {
			return fmt.Errorf("sandbox: absolute path %q not allowed; upload the file instead", p)
		}
		for _, seg := range strings.FieldsFunc(p, func(r rune) bool { return r == '/' || r == '\\' }) {
			if seg == ".." {
				return fmt.Errorf("sandbox: path traversal %q not allowed", p)
			}
		}
	}
	return nil
}

// SafeJoin joins rel under root and refuses anything escaping root.
func SafeJoin(root, rel string) (string, error) {
	rel = filepath.FromSlash(strings.TrimPrefix(rel, "/"))
	clean := filepath.Clean(rel)
	if clean == "." || clean == ".." || strings.HasPrefix(clean, ".."+string(filepath.Separator)) || filepath.IsAbs(clean) {
		return "", fmt.Errorf("invalid file name %q", rel)
	}
	return filepath.Join(root, clean), nil
}

// Prepare creates a working directory populated from req and an optional
// source directory (a workspace). The caller must remove it.
func (r *Runner) Prepare(req *Request, sourceDir string) (string, error) {
	dir, err := os.MkdirTemp(r.tmpRoot, "opa-run-")
	if err != nil {
		return "", err
	}
	if sourceDir != "" {
		if err := copyTree(sourceDir, dir); err != nil {
			os.RemoveAll(dir)
			return "", err
		}
	}
	for name, content := range req.Files {
		if err := writeFile(dir, name, []byte(content)); err != nil {
			os.RemoveAll(dir)
			return "", err
		}
	}
	for name, b64 := range req.BinaryFiles {
		data, err := base64.StdEncoding.DecodeString(b64)
		if err != nil {
			os.RemoveAll(dir)
			return "", fmt.Errorf("file %s: invalid base64: %w", name, err)
		}
		if err := writeFile(dir, name, data); err != nil {
			os.RemoveAll(dir)
			return "", err
		}
	}
	return dir, nil
}

func writeFile(root, name string, data []byte) error {
	p, err := SafeJoin(root, name)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		return err
	}
	return os.WriteFile(p, data, 0o644)
}

func copyTree(src, dst string) error {
	return filepath.WalkDir(src, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(src, p)
		if err != nil {
			return err
		}
		target := filepath.Join(dst, rel)
		// Hidden files (Studio metadata, VCS folders) never reach OPA.
		if p != src && strings.HasPrefix(d.Name(), ".") && d.Name() != ".manifest" {
			if d.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if d.IsDir() {
			return os.MkdirAll(target, 0o755)
		}
		if !d.Type().IsRegular() {
			return nil // skip symlinks and special files
		}
		in, err := os.Open(p)
		if err != nil {
			return err
		}
		defer in.Close()
		out, err := os.Create(target)
		if err != nil {
			return err
		}
		if _, err := io.Copy(out, in); err != nil {
			out.Close()
			return err
		}
		return out.Close()
	})
}

type capped struct {
	buf       bytes.Buffer
	limit     int64
	truncated bool
	mu        sync.Mutex
}

func (c *capped) Write(p []byte) (int, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	room := c.limit - int64(c.buf.Len())
	if room <= 0 {
		c.truncated = true
		return len(p), nil
	}
	if int64(len(p)) > room {
		c.buf.Write(p[:room])
		c.truncated = true
		return len(p), nil
	}
	return c.buf.Write(p)
}

func snapshot(dir string) map[string]string {
	out := map[string]string{}
	_ = filepath.WalkDir(dir, func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return nil
		}
		info, err := d.Info()
		if err != nil || info.Size() > 4<<20 {
			return nil
		}
		b, err := os.ReadFile(p)
		if err != nil || !utf8.Valid(b) {
			return nil
		}
		rel, _ := filepath.Rel(dir, p)
		out[filepath.ToSlash(rel)] = string(b)
		return nil
	})
	return out
}

// Run executes req inside a fresh working directory. If sourceDir is set its
// content is copied in first.
func (r *Runner) Run(ctx context.Context, req *Request, sourceDir string) (*Result, error) {
	if r.binary == nil {
		return nil, ErrNoBinary
	}
	if err := r.ValidateArgs(req.Args); err != nil {
		return nil, err
	}
	select {
	case r.sem <- struct{}{}:
		defer func() { <-r.sem }()
	case <-ctx.Done():
		return nil, ctx.Err()
	}
	dir, err := r.Prepare(req, sourceDir)
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(dir)
	before := snapshot(dir)

	timeout := r.timeout
	if req.TimeoutSeconds > 0 && time.Duration(req.TimeoutSeconds)*time.Second < timeout {
		timeout = time.Duration(req.TimeoutSeconds) * time.Second
	}
	cctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	cmd := exec.CommandContext(cctx, r.binary.Path, req.Args...)
	cmd.Dir = dir
	// A scrubbed environment keeps Studio secrets (tokens, passwords) out of
	// reach of opa.runtime().env and of policies evaluated through the CLI.
	cmd.Env = []string{"HOME=" + dir, "PATH=/usr/local/bin:/usr/bin:/bin", "TMPDIR=" + dir, "NO_COLOR=1"}
	if req.Stdin != "" {
		cmd.Stdin = strings.NewReader(req.Stdin)
	}
	stdout := &capped{limit: r.maxOutput}
	stderr := &capped{limit: r.maxOutput}
	cmd.Stdout, cmd.Stderr = stdout, stderr
	cmd.WaitDelay = 5 * time.Second

	start := time.Now()
	runErr := cmd.Run()
	res := &Result{
		Command:    append([]string{"opa"}, req.Args...),
		Stdout:     stdout.buf.String(),
		Stderr:     stderr.buf.String(),
		DurationMs: time.Since(start).Milliseconds(),
		Truncated:  stdout.truncated || stderr.truncated,
	}
	if cctx.Err() == context.DeadlineExceeded {
		res.TimedOut = true
		res.ExitCode = -1
	} else if runErr != nil {
		var ee *exec.ExitError
		if errors.As(runErr, &ee) {
			res.ExitCode = ee.ExitCode()
		} else {
			return nil, runErr
		}
	}

	after := snapshot(dir)
	for name, content := range after {
		if old, ok := before[name]; ok && old != content {
			if res.Changed == nil {
				res.Changed = map[string]string{}
			}
			res.Changed[name] = content
		}
	}
	if len(req.Collect) > 0 {
		res.Files = map[string]File{}
		for _, pattern := range req.Collect {
			if err := checkPathArg(pattern); err != nil {
				return nil, err
			}
			matches, _ := filepath.Glob(filepath.Join(dir, filepath.FromSlash(pattern)))
			for _, m := range matches {
				info, err := os.Stat(m)
				if err != nil || info.IsDir() || info.Size() > 256<<20 {
					continue
				}
				data, err := os.ReadFile(m)
				if err != nil {
					continue
				}
				rel, _ := filepath.Rel(dir, m)
				f := File{Size: info.Size()}
				if utf8.Valid(data) && !strings.HasSuffix(m, ".gz") && !strings.HasSuffix(m, ".wasm") {
					f.Text = string(data)
				} else {
					f.Base64 = base64.StdEncoding.EncodeToString(data)
				}
				res.Files[filepath.ToSlash(rel)] = f
			}
		}
	}
	return res, nil
}

// Help runs `opa <args...>` and returns combined output (used for live introspection).
func Help(path string) manifest.HelpRunner {
	return func(args ...string) string {
		ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
		defer cancel()
		out, _ := exec.CommandContext(ctx, path, args...).CombinedOutput()
		return string(out)
	}
}
