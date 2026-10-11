// Package store persists user-defined OPA server connections.
package store

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/alasgarovnamig/opa-studio/internal/config"
)

// ErrNotFound is returned for unknown connections.
var ErrNotFound = errors.New("connection not found")

// ErrReadOnly is returned when changing a connection defined in configuration.
var ErrReadOnly = errors.New("connection is defined in configuration and cannot be changed")

// Connection is an OPA server Studio can talk to.
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
	// Source is "local" (managed OPA), "config" (read-only) or "user".
	Source    string    `json:"source"`
	CreatedAt time.Time `json:"createdAt,omitempty"`
	UpdatedAt time.Time `json:"updatedAt,omitempty"`
}

// Public returns a copy safe to send to the browser: secrets are masked.
func (c Connection) Public() Connection {
	out := c
	if out.Token != "" {
		out.Token = "********"
	}
	if out.ClientKey != "" {
		out.ClientKey = "********"
	}
	if len(c.Headers) > 0 {
		out.Headers = map[string]string{}
		for k, v := range c.Headers {
			if strings.EqualFold(k, "authorization") || strings.Contains(strings.ToLower(k), "token") || strings.Contains(strings.ToLower(k), "key") {
				v = "********"
			}
			out.Headers[k] = v
		}
	}
	return out
}

// Store keeps connections in a JSON file (mode 0600: it holds credentials).
type Store struct {
	path   string
	mu     sync.RWMutex
	user   map[string]Connection
	static map[string]Connection
}

var idRe = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,62}$`)

// Open loads (or creates) the store file and merges configured connections.
func Open(path string, configured []config.Connection, local *Connection) (*Store, error) {
	s := &Store{path: path, user: map[string]Connection{}, static: map[string]Connection{}}
	if local != nil {
		s.static[local.ID] = *local
	}
	for _, c := range configured {
		s.static[c.ID] = Connection{
			ID: c.ID, Name: c.Name, URL: strings.TrimRight(c.URL, "/"), Token: c.Token, Headers: c.Headers,
			CACert: c.CACert, ClientCert: c.ClientCert, ClientKey: c.ClientKey, InsecureSkipVerify: c.InsecureSkipVerify,
			Source: "config",
		}
	}
	b, err := os.ReadFile(path)
	switch {
	case errors.Is(err, os.ErrNotExist):
	case err != nil:
		return nil, err
	default:
		var list []Connection
		if err := json.Unmarshal(b, &list); err != nil {
			return nil, fmt.Errorf("parse %s: %w", path, err)
		}
		for _, c := range list {
			if _, clash := s.static[c.ID]; clash {
				continue
			}
			c.Source = "user"
			s.user[c.ID] = c
		}
	}
	return s, nil
}

func (s *Store) save() error {
	list := make([]Connection, 0, len(s.user))
	for _, c := range s.user {
		list = append(list, c)
	}
	sort.Slice(list, func(i, j int) bool { return list[i].ID < list[j].ID })
	b, err := json.MarshalIndent(list, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(s.path), 0o700); err != nil {
		return err
	}
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, s.path)
}

// List returns every connection (local first, then configured, then user).
func (s *Store) List() []Connection {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]Connection, 0, len(s.static)+len(s.user))
	for _, c := range s.static {
		out = append(out, c)
	}
	for _, c := range s.user {
		out = append(out, c)
	}
	rank := map[string]int{"local": 0, "config": 1, "user": 2}
	sort.Slice(out, func(i, j int) bool {
		if rank[out[i].Source] != rank[out[j].Source] {
			return rank[out[i].Source] < rank[out[j].Source]
		}
		return out[i].Name < out[j].Name
	})
	return out
}

// Get returns the connection with the given id.
func (s *Store) Get(id string) (Connection, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if c, ok := s.static[id]; ok {
		return c, nil
	}
	if c, ok := s.user[id]; ok {
		return c, nil
	}
	return Connection{}, ErrNotFound
}

func validate(c *Connection) error {
	c.URL = strings.TrimRight(strings.TrimSpace(c.URL), "/")
	u, err := url.Parse(c.URL)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return fmt.Errorf("invalid URL %q: must be http(s)://host[:port][/prefix]", c.URL)
	}
	if strings.TrimSpace(c.Name) == "" {
		c.Name = u.Host
	}
	return nil
}

// Create adds a user connection.
func (s *Store) Create(c Connection) (Connection, error) {
	if err := validate(&c); err != nil {
		return c, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if c.ID == "" {
		b := make([]byte, 4)
		_, _ = rand.Read(b)
		c.ID = "conn-" + hex.EncodeToString(b)
	}
	if !idRe.MatchString(c.ID) {
		return c, fmt.Errorf("invalid id %q", c.ID)
	}
	if _, ok := s.static[c.ID]; ok {
		return c, fmt.Errorf("id %q is reserved", c.ID)
	}
	if _, ok := s.user[c.ID]; ok {
		return c, fmt.Errorf("connection %q already exists", c.ID)
	}
	c.Source = "user"
	c.CreatedAt = time.Now().UTC()
	c.UpdatedAt = c.CreatedAt
	s.user[c.ID] = c
	return c, s.save()
}

// Update replaces a user connection. Masked secrets keep their stored value.
func (s *Store) Update(id string, c Connection) (Connection, error) {
	if err := validate(&c); err != nil {
		return c, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.static[id]; ok {
		return c, ErrReadOnly
	}
	old, ok := s.user[id]
	if !ok {
		return c, ErrNotFound
	}
	if c.Token == "********" {
		c.Token = old.Token
	}
	if c.ClientKey == "********" {
		c.ClientKey = old.ClientKey
	}
	for k, v := range c.Headers {
		if v == "********" {
			c.Headers[k] = old.Headers[k]
		}
	}
	c.ID = id
	c.Source = "user"
	c.CreatedAt = old.CreatedAt
	c.UpdatedAt = time.Now().UTC()
	s.user[id] = c
	return c, s.save()
}

// Delete removes a user connection.
func (s *Store) Delete(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.static[id]; ok {
		return ErrReadOnly
	}
	if _, ok := s.user[id]; !ok {
		return ErrNotFound
	}
	delete(s.user, id)
	return s.save()
}
