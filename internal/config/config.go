// Package config loads OPA Studio settings from flags and OPA_STUDIO_* environment variables.
//
// Precedence: command-line flag > environment variable > default.
package config

import (
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// AuthMode selects how users authenticate against OPA Studio itself.
type AuthMode string

const (
	AuthNone  AuthMode = "none"
	AuthBasic AuthMode = "basic"
	AuthToken AuthMode = "token"
)

// Connection is an OPA server connection declared in configuration (read-only in the UI).
type Connection struct {
	ID                 string            `json:"id"`
	Name               string            `json:"name"`
	URL                string            `json:"url"`
	Token              string            `json:"token,omitempty"`
	Headers            map[string]string `json:"headers,omitempty"`
	CACert             string            `json:"caCert,omitempty"`
	ClientCert         string            `json:"clientCert,omitempty"`
	ClientKey          string            `json:"clientKey,omitempty"`
	InsecureSkipVerify bool              `json:"insecureSkipVerify,omitempty"`
}

// Config is the complete runtime configuration.
type Config struct {
	Addr        string
	TLSCertFile string
	TLSKeyFile  string
	DataDir     string
	PublicURL   string // externally reachable base URL, used in generated OPA configs
	LogLevel    string
	LogFormat   string

	AuthMode      AuthMode
	BasicUser     string
	BasicPassword string
	AuthToken     string
	ReadOnly      bool
	CORSOrigins   []string

	OPABinary string

	CLISandbox     bool
	CLITimeout     time.Duration
	CLIConcurrency int
	CLIMaxOutput   int64

	LocalOPA          bool
	LocalOPAAutostart bool
	LocalOPAAddr      string
	LocalOPAArgs      []string

	ControlPlaneToken string
	DecisionLogLimit  int
	StatusLimit       int

	REPLMaxSessions int
	REPLIdleTimeout time.Duration

	ProxyTimeout time.Duration
	MaxBodyBytes int64

	Connections []Connection
}

func env(key, def string) string {
	if v, ok := os.LookupEnv("OPA_STUDIO_" + key); ok {
		return v
	}
	return def
}

func envBool(key string, def bool) bool {
	v, ok := os.LookupEnv("OPA_STUDIO_" + key)
	if !ok {
		return def
	}
	b, err := strconv.ParseBool(v)
	if err != nil {
		return def
	}
	return b
}

func envInt(key string, def int) int {
	v, ok := os.LookupEnv("OPA_STUDIO_" + key)
	if !ok {
		return def
	}
	i, err := strconv.Atoi(v)
	if err != nil {
		return def
	}
	return i
}

func envDuration(key string, def time.Duration) time.Duration {
	v, ok := os.LookupEnv("OPA_STUDIO_" + key)
	if !ok {
		return def
	}
	d, err := time.ParseDuration(v)
	if err != nil {
		return def
	}
	return d
}

func splitList(s string) []string {
	var out []string
	for _, p := range strings.Split(s, ",") {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}

// Load parses args (usually os.Args[1:]) together with the environment.
func Load(args []string) (*Config, error) {
	c := &Config{}
	fs := flag.NewFlagSet("opa-studio", flag.ContinueOnError)
	fs.StringVar(&c.Addr, "addr", env("ADDR", ":9080"), "listen address")
	fs.StringVar(&c.TLSCertFile, "tls-cert-file", env("TLS_CERT_FILE", ""), "TLS certificate file (enables HTTPS)")
	fs.StringVar(&c.TLSKeyFile, "tls-key-file", env("TLS_KEY_FILE", ""), "TLS private key file")
	fs.StringVar(&c.DataDir, "data-dir", env("DATA_DIR", "./data"), "directory for persistent state")
	fs.StringVar(&c.PublicURL, "public-url", env("PUBLIC_URL", ""), "externally reachable URL of OPA Studio (used for generated OPA configs)")
	fs.StringVar(&c.LogLevel, "log-level", env("LOG_LEVEL", "info"), "log level: debug, info, warn, error")
	fs.StringVar(&c.LogFormat, "log-format", env("LOG_FORMAT", "text"), "log format: text or json")

	authMode := fs.String("auth-mode", env("AUTH_MODE", "none"), "authentication: none, basic or token")
	fs.StringVar(&c.BasicUser, "basic-user", env("BASIC_USER", "admin"), "user name for basic auth")
	fs.StringVar(&c.BasicPassword, "basic-password", env("BASIC_PASSWORD", ""), "password for basic auth")
	fs.StringVar(&c.AuthToken, "auth-token", env("AUTH_TOKEN", ""), "bearer token for token auth")
	fs.BoolVar(&c.ReadOnly, "read-only", envBool("READ_ONLY", false), "reject every mutating operation")
	cors := fs.String("cors-origins", env("CORS_ORIGINS", ""), "comma separated list of allowed CORS origins")

	fs.StringVar(&c.OPABinary, "opa-binary", env("OPA_BINARY", ""), "path to the opa binary (default: search PATH)")

	fs.BoolVar(&c.CLISandbox, "cli-sandbox", envBool("CLI_SANDBOX", true), "reject absolute paths and path traversal in CLI arguments")
	fs.DurationVar(&c.CLITimeout, "cli-timeout", envDuration("CLI_TIMEOUT", 2*time.Minute), "maximum duration of a single CLI invocation")
	fs.IntVar(&c.CLIConcurrency, "cli-concurrency", envInt("CLI_CONCURRENCY", 4), "maximum concurrent CLI invocations")
	maxOut := fs.Int("cli-max-output-mb", envInt("CLI_MAX_OUTPUT_MB", 16), "maximum captured stdout/stderr per CLI invocation (MiB)")

	fs.BoolVar(&c.LocalOPA, "local-opa", envBool("LOCAL_OPA", true), "enable the managed local OPA server")
	fs.BoolVar(&c.LocalOPAAutostart, "local-opa-autostart", envBool("LOCAL_OPA_AUTOSTART", true), "start the managed local OPA server on boot")
	fs.StringVar(&c.LocalOPAAddr, "local-opa-addr", env("LOCAL_OPA_ADDR", "127.0.0.1:8181"), "listen address of the managed local OPA server")
	localArgs := fs.String("local-opa-args", env("LOCAL_OPA_ARGS", ""), "extra arguments for the managed OPA server (comma separated)")

	fs.StringVar(&c.ControlPlaneToken, "control-plane-token", env("CONTROL_PLANE_TOKEN", ""), "bearer token OPA agents must present to the control plane endpoints")
	fs.IntVar(&c.DecisionLogLimit, "decision-log-limit", envInt("DECISION_LOG_LIMIT", 10000), "decision log events kept in memory")
	fs.IntVar(&c.StatusLimit, "status-limit", envInt("STATUS_LIMIT", 1000), "status reports kept in memory")

	fs.IntVar(&c.REPLMaxSessions, "repl-max-sessions", envInt("REPL_MAX_SESSIONS", 8), "maximum concurrent REPL sessions")
	fs.DurationVar(&c.REPLIdleTimeout, "repl-idle-timeout", envDuration("REPL_IDLE_TIMEOUT", 15*time.Minute), "idle REPL sessions are closed after this duration")

	fs.DurationVar(&c.ProxyTimeout, "proxy-timeout", envDuration("PROXY_TIMEOUT", 60*time.Second), "timeout for requests forwarded to OPA servers")
	maxBody := fs.Int("max-body-mb", envInt("MAX_BODY_MB", 64), "maximum request body size (MiB)")

	connections := fs.String("connections", env("CONNECTIONS", ""), "JSON array of predefined OPA connections, or @file.json")

	if err := fs.Parse(args); err != nil {
		return nil, err
	}

	c.AuthMode = AuthMode(strings.ToLower(*authMode))
	c.CORSOrigins = splitList(*cors)
	c.LocalOPAArgs = splitList(*localArgs)
	c.CLIMaxOutput = int64(*maxOut) << 20
	c.MaxBodyBytes = int64(*maxBody) << 20

	if s := strings.TrimSpace(*connections); s != "" {
		raw := []byte(s)
		if strings.HasPrefix(s, "@") {
			b, err := os.ReadFile(s[1:])
			if err != nil {
				return nil, fmt.Errorf("read connections file: %w", err)
			}
			raw = b
		}
		if err := json.Unmarshal(raw, &c.Connections); err != nil {
			return nil, fmt.Errorf("parse connections: %w", err)
		}
	}

	abs, err := filepath.Abs(c.DataDir)
	if err != nil {
		return nil, err
	}
	c.DataDir = abs
	return c, c.Validate()
}

// Validate reports configuration mistakes early, before anything is started.
func (c *Config) Validate() error {
	switch c.AuthMode {
	case AuthNone:
	case AuthBasic:
		if c.BasicPassword == "" {
			return errors.New("auth-mode=basic requires OPA_STUDIO_BASIC_PASSWORD")
		}
	case AuthToken:
		if len(c.AuthToken) < 16 {
			return errors.New("auth-mode=token requires OPA_STUDIO_AUTH_TOKEN with at least 16 characters")
		}
	default:
		return fmt.Errorf("unknown auth mode %q", c.AuthMode)
	}
	if (c.TLSCertFile == "") != (c.TLSKeyFile == "") {
		return errors.New("tls-cert-file and tls-key-file must be set together")
	}
	if c.CLIConcurrency < 1 {
		return errors.New("cli-concurrency must be >= 1")
	}
	seen := map[string]bool{"local": true}
	for i, conn := range c.Connections {
		if conn.ID == "" || conn.URL == "" {
			return fmt.Errorf("connection #%d needs id and url", i)
		}
		if seen[conn.ID] {
			return fmt.Errorf("duplicate connection id %q", conn.ID)
		}
		seen[conn.ID] = true
	}
	return nil
}
