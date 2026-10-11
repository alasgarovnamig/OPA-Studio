package workspace

import (
	"errors"
	"testing"
)

func TestWorkspaceLifecycle(t *testing.T) {
	s, err := NewStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	w, err := s.Create("", "My Policies!", "desc", map[string]string{"a/b.rego": "package a.b\n", "data.json": "{}"})
	if err != nil {
		t.Fatal(err)
	}
	if w.ID != "my-policies" {
		t.Errorf("id = %s", w.ID)
	}
	if _, err := s.Create("my-policies", "dup", "", nil); err == nil {
		t.Error("duplicate id must fail")
	}
	files, err := s.Files(w.ID)
	if err != nil || len(files) != 2 {
		t.Fatalf("files = %v, %v", files, err)
	}
	if files[0].Path != "a/b.rego" || files[0].Kind != "rego" || files[1].Kind != "data" {
		t.Errorf("files = %+v", files)
	}
	if err := s.WriteFile(w.ID, "a/b_test.rego", []byte("package a.b_test")); err != nil {
		t.Fatal(err)
	}
	if err := s.RenameFile(w.ID, "a/b_test.rego", "tests/b_test.rego"); err != nil {
		t.Fatal(err)
	}
	b, err := s.ReadFile(w.ID, "tests/b_test.rego")
	if err != nil || string(b) != "package a.b_test" {
		t.Errorf("read = %q, %v", b, err)
	}
	if err := s.DeleteFile(w.ID, "tests/b_test.rego"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.ReadFile(w.ID, "tests/b_test.rego"); !errors.Is(err, ErrNotFound) {
		t.Errorf("err = %v", err)
	}

	for _, bad := range []string{"../x", "/../../etc/passwd", ".git/config", ".studio-workspace.json", "a/../../x"} {
		if err := s.WriteFile(w.ID, bad, []byte("x")); err == nil {
			t.Errorf("WriteFile(%q) should fail", bad)
		}
	}
	if _, err := s.Dir("../../etc"); err == nil {
		t.Error("invalid id must fail")
	}

	archive, err := s.Bundle(w.ID, map[string]any{"revision": "1"})
	if err != nil {
		t.Fatal(err)
	}
	w2, _ := s.Create("copy", "Copy", "", nil)
	names, err := s.Import(w2.ID, archive)
	if err != nil || len(names) != 3 {
		t.Fatalf("import = %v, %v", names, err)
	}
	all, _ := s.ReadAll(w2.ID)
	if all["a/b.rego"] != "package a.b\n" {
		t.Errorf("imported = %v", all)
	}

	list, _ := s.List()
	if len(list) != 2 {
		t.Errorf("list = %d", len(list))
	}
	if err := s.Delete(w.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Get(w.ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("get after delete = %v", err)
	}
}
