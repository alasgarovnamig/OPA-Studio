package store

import (
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/alasgarovnamig/opa-studio/internal/config"
)

func TestConnections(t *testing.T) {
	path := filepath.Join(t.TempDir(), "c.json")
	local := &Connection{ID: "local", Name: "Local", URL: "http://127.0.0.1:8181", Source: "local"}
	s, err := Open(path, []config.Connection{{ID: "prod", Name: "Prod", URL: "https://opa.example.com/", Token: "t"}}, local)
	if err != nil {
		t.Fatal(err)
	}
	c, err := s.Create(Connection{Name: "Dev", URL: "http://dev:8181", Token: "secret", Headers: map[string]string{"X-Api-Key": "k", "X-Env": "dev"}})
	if err != nil {
		t.Fatal(err)
	}
	if c.Source != "user" {
		t.Errorf("source = %s", c.Source)
	}
	if _, err := s.Create(Connection{URL: "ftp://x"}); err == nil {
		t.Error("invalid URL must fail")
	}
	if _, err := s.Create(Connection{ID: "local", URL: "http://x"}); err == nil {
		t.Error("reserved id must fail")
	}
	pub := c.Public()
	if pub.Token != "********" || pub.Headers["X-Api-Key"] != "********" || pub.Headers["X-Env"] != "dev" {
		t.Errorf("public = %+v", pub)
	}
	// Masked secrets keep the stored value on update.
	pub.Name = "Dev 2"
	u, err := s.Update(c.ID, pub)
	if err != nil || u.Token != "secret" || u.Headers["X-Api-Key"] != "k" || u.Name != "Dev 2" {
		t.Errorf("update = %+v, %v", u, err)
	}
	if _, err := s.Update("prod", Connection{URL: "http://x"}); !errors.Is(err, ErrReadOnly) {
		t.Errorf("config connection update err = %v", err)
	}
	if err := s.Delete("local"); !errors.Is(err, ErrReadOnly) {
		t.Errorf("local delete err = %v", err)
	}
	info, _ := os.Stat(path)
	if info.Mode().Perm() != 0o600 {
		t.Errorf("connections file mode = %v", info.Mode().Perm())
	}
	list := s.List()
	if len(list) != 3 || list[0].ID != "local" || list[1].ID != "prod" {
		t.Errorf("order = %v", list)
	}
	// Persistence.
	s2, _ := Open(path, nil, nil)
	if got, err := s2.Get(c.ID); err != nil || got.Token != "secret" {
		t.Errorf("reloaded = %+v, %v", got, err)
	}
	if err := s2.Delete(c.ID); err != nil {
		t.Fatal(err)
	}
}
