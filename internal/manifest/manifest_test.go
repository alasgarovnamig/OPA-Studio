package manifest

import (
	"testing"
)

const cobraHelp = `Usage:
  opa eval <query> [flags]

Available Commands:
  bench        Benchmark a Rego query
  capabilities Print the capabilities of OPA
  help         Help about any command

Flags:
  -d, --data stringArray           set policy or data file(s)
      --explain {off,full,notes}   enable query explanations (default off)
  -f, --format {json,values}       set output format (default json)
      --metrics                    report query performance metrics
  -h, --help                       help for eval

Global Flags:
      --v1-compatible   opt-in to OPA features and behaviors

Use "opa eval [command] --help" for more information about a command.
`

func TestParseCommands(t *testing.T) {
	got := ParseCommands(cobraHelp)
	for _, want := range []string{"bench", "capabilities", "help"} {
		if _, ok := got[want]; !ok {
			t.Errorf("missing command %q in %v", want, got)
		}
	}
	if got["capabilities"] != "Print the capabilities of OPA" {
		t.Errorf("description = %q", got["capabilities"])
	}
}

func TestParseFlags(t *testing.T) {
	f := ParseFlags(cobraHelp)
	if f["data"].Short != "d" || f["data"].Type != "stringArray" {
		t.Errorf("data flag = %+v", f["data"])
	}
	if f["explain"].Type != "{off,full,notes}" || f["explain"].Default != "off" {
		t.Errorf("explain flag = %+v", f["explain"])
	}
	if f["metrics"].Type != "bool" {
		t.Errorf("metrics type = %q", f["metrics"].Type)
	}
	if !f["v1-compatible"].Global {
		t.Error("v1-compatible should be global")
	}
	if UsageLine(cobraHelp) != "opa eval <query> [flags]" {
		t.Errorf("usage = %q", UsageLine(cobraHelp))
	}
}

func TestNormalizeAndCompare(t *testing.T) {
	cases := map[string]string{"1.0.0": "v1.0.0", "v0.1.0": "v0.1.0", "Version: 0.46.0": "v0.46.0"}
	for in, want := range cases {
		if got := Normalize(in); got != want {
			t.Errorf("Normalize(%q) = %q, want %q", in, got, want)
		}
	}
	ordered := []string{"v0.1.0", "v0.2.0", "v0.10.0", "v0.19.0-rc1", "v0.19.0", "v1.0.0", "v1.21.1"}
	for i := 1; i < len(ordered); i++ {
		if Compare(ordered[i-1], ordered[i]) != -1 || Compare(ordered[i], ordered[i-1]) != 1 {
			t.Errorf("expected %s < %s", ordered[i-1], ordered[i])
		}
	}
	if Compare("v1.2.3", "1.2.3") != 0 {
		t.Error("v-prefix must not matter")
	}
}

func TestEndpointAvailable(t *testing.T) {
	cases := []struct {
		e    Endpoint
		want bool
	}{
		{Endpoint{Status: 200}, true},
		{Endpoint{Status: 500}, true},
		{Endpoint{Status: 400}, true},
		{Endpoint{Status: 404, ContentType: "application/json"}, true},
		{Endpoint{Status: 404, ContentType: "text/plain; charset=utf-8"}, false},
		{Endpoint{Status: 405}, false},
		{Endpoint{Status: 0}, false},
	}
	for _, c := range cases {
		if got := c.e.Available(); got != c.want {
			t.Errorf("%+v.Available() = %v, want %v", c.e, got, c.want)
		}
	}
}

func TestEmbeddedManifests(t *testing.T) {
	vs, err := Versions()
	if err != nil {
		t.Fatal(err)
	}
	if len(vs) < 216 {
		t.Fatalf("expected every OPA release to be tracked, got %d", len(vs))
	}
	if vs[0].Tag != "v0.1.0" {
		t.Errorf("first version = %s", vs[0].Tag)
	}
	for i := 1; i < len(vs); i++ {
		if Compare(vs[i-1].Tag, vs[i].Tag) >= 0 {
			t.Fatalf("versions not sorted: %s before %s", vs[i-1].Tag, vs[i].Tag)
		}
	}
	for _, v := range vs {
		m, err := Get(v.Tag)
		if err != nil {
			t.Fatalf("%s: %v", v.Tag, err)
		}
		if m.PreferredDialect == "" || !m.Server.Started || !m.HasCommand("run") {
			t.Errorf("%s: incomplete manifest", v.Tag)
		}
	}
	latest, _ := Get("v1.21.1")
	if latest.PreferredDialect != "v1" || !latest.HasFlag("eval", "explain") || !latest.Server.Endpoints["compile_path"].Available() {
		t.Error("v1.21.1 manifest does not describe OPA 1.x")
	}
	first, _ := Get("v0.1.0")
	if first.HasCommand("eval") || first.PreferredDialect != "datalog-noinput" {
		t.Error("v0.1.0 manifest does not describe the first OPA release")
	}
	if Nearest("v1.21.1-dev") != "v1.21.0" && Nearest("v1.21.1-dev") != "v1.21.1" {
		t.Errorf("Nearest = %s", Nearest("v1.21.1-dev"))
	}
	if s := Summaries(); len(s) != len(vs) {
		t.Errorf("summaries = %d", len(s))
	}
}

func TestLive(t *testing.T) {
	m := Live("0.70.0", func(args ...string) string {
		if len(args) == 1 && args[0] == "help" {
			return cobraHelp
		}
		return cobraHelp
	})
	if !m.Live || m.OPA.Version != "v0.70.0" || !m.HasCommand("bench") || !m.HasFlag("bench", "metrics") {
		t.Errorf("live manifest = %+v", m)
	}
	if m.PreferredDialect != "legacy-assign" {
		t.Errorf("dialect = %s", m.PreferredDialect)
	}
}
