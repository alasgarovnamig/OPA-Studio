package config

import "testing"

func TestLoadDefaultsAndValidation(t *testing.T) {
	c, err := Load(nil)
	if err != nil {
		t.Fatal(err)
	}
	if c.Addr != ":9080" || c.AuthMode != AuthNone || !c.CLISandbox || !c.LocalOPA {
		t.Errorf("defaults = %+v", c)
	}
	if _, err := Load([]string{"--auth-mode", "basic"}); err == nil {
		t.Error("basic auth without password must fail")
	}
	if _, err := Load([]string{"--auth-mode", "token", "--auth-token", "short"}); err == nil {
		t.Error("short token must fail")
	}
	if _, err := Load([]string{"--tls-cert-file", "a"}); err == nil {
		t.Error("cert without key must fail")
	}
	t.Setenv("OPA_STUDIO_CONNECTIONS", `[{"id":"a","url":"http://a"},{"id":"a","url":"http://b"}]`)
	if _, err := Load(nil); err == nil {
		t.Error("duplicate connection ids must fail")
	}
	t.Setenv("OPA_STUDIO_CONNECTIONS", `[{"id":"a","name":"A","url":"http://a"}]`)
	c, err = Load([]string{"--read-only", "--cors-origins", "http://x, http://y"})
	if err != nil || len(c.Connections) != 1 || !c.ReadOnly || len(c.CORSOrigins) != 2 {
		t.Errorf("config = %+v, %v", c, err)
	}
}
