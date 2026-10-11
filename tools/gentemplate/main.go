// Command gentemplate writes the example workspace for a Rego dialect to a
// directory. It is used by tools/validate-templates.sh to prove that the
// example compiles and its tests pass on every OPA release.
package main

import (
	"flag"
	"fmt"
	"os"
	"path/filepath"

	"github.com/alasgarovnamig/opa-studio/internal/api"
)

func main() {
	dialect := flag.String("dialect", "v1", "Rego dialect (see manifest preferred_dialect)")
	out := flag.String("out", "", "output directory")
	flag.Parse()
	if *out == "" {
		fmt.Fprintln(os.Stderr, "-out is required")
		os.Exit(2)
	}
	for name, content := range api.Template("rbac", *dialect) {
		p := filepath.Join(*out, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			panic(err)
		}
		if err := os.WriteFile(p, []byte(content), 0o644); err != nil {
			panic(err)
		}
	}
}
