package api

import "strings"

// The example workspace is written once per Rego dialect so that every OPA
// release gets an example its parser accepts. The dialect of a release is
// measured by tools/introspect (manifest.preferred_dialect).

const rbacData = `{
  "rbac": {
    "user_roles": {
      "alice": ["admin"],
      "bob": ["employee", "billing"],
      "eve": ["customer"]
    },
    "role_grants": {
      "customer": [
        {"action": "read", "type": "dog"},
        {"action": "read", "type": "cat"},
        {"action": "adopt", "type": "dog"},
        {"action": "adopt", "type": "cat"}
      ],
      "employee": [
        {"action": "read", "type": "dog"},
        {"action": "read", "type": "cat"},
        {"action": "update", "type": "dog"},
        {"action": "update", "type": "cat"}
      ],
      "billing": [
        {"action": "read", "type": "finance"},
        {"action": "update", "type": "finance"}
      ]
    }
  }
}
`

const rbacInput = `{
  "user": "bob",
  "action": "update",
  "type": "dog"
}
`

const v1Body = `default allow := false

# Admins may do anything.
allow if user_is_admin

# Everybody else needs a grant for the action and type.
allow if {
	some grant in user_is_granted
	input.action == grant.action
	input.type == grant.type
}

user_is_admin if "admin" in data.rbac.user_roles[input.user]

user_is_granted contains grant if {
	some role in data.rbac.user_roles[input.user]
	some grant in data.rbac.role_grants[role]
}

reasons contains msg if {
	not allow
	msg := sprintf("%s may not %s %s", [input.user, input.action, input.type])
}
`

const v1Test = `test_admin_can_do_anything if {
	allow with input as {"user": "alice", "action": "delete", "type": "dog"}
}

test_employee_can_update_dogs if {
	allow with input as {"user": "bob", "action": "update", "type": "dog"}
}

test_customer_cannot_update if {
	not allow with input as {"user": "eve", "action": "update", "type": "dog"}
}
`

const legacyAssignBody = `default allow = false

# Admins may do anything.
allow {
	user_is_admin
}

# Everybody else needs a grant for the action and type.
allow {
	grant := user_is_granted[_]
	input.action == grant.action
	input.type == grant.type
}

user_is_admin {
	data.rbac.user_roles[input.user][_] == "admin"
}

user_is_granted[grant] {
	role := data.rbac.user_roles[input.user][_]
	grant := data.rbac.role_grants[role][_]
}

reasons[msg] {
	not allow
	msg := sprintf("%s may not %s %s", [input.user, input.action, input.type])
}
`

const legacyAssignTest = `test_admin_can_do_anything {
	allow with input as {"user": "alice", "action": "delete", "type": "dog"}
}

test_employee_can_update_dogs {
	allow with input as {"user": "bob", "action": "update", "type": "dog"}
}

test_customer_cannot_update {
	not allow with input as {"user": "eve", "action": "update", "type": "dog"}
}
`

// legacyBody inlines its data: `opa test` in OPA v0.5.x-v0.6.x does not load
// data files and `with` can only replace input, so tests must not need data.json.
const legacyBody = `user_roles = {"alice": ["admin"], "bob": ["employee", "billing"], "eve": ["customer"]}

role_grants = {
	"customer": [{"action": "read", "type": "dog"}, {"action": "adopt", "type": "dog"}],
	"employee": [{"action": "read", "type": "dog"}, {"action": "update", "type": "dog"}],
	"billing": [{"action": "read", "type": "finance"}, {"action": "update", "type": "finance"}],
}

default allow = false

# Admins may do anything.
allow {
	user_is_admin
}

# Everybody else needs a grant for the action and type.
allow {
	user_is_granted[grant]
	input.action = grant.action
	input.type = grant.type
}

user_is_admin {
	user_roles[input.user][_] = "admin"
}

user_is_granted[grant] {
	role = user_roles[input.user][_]
	grant = role_grants[role][_]
}

reasons["access denied"] {
	not allow
}
`

const datalogBody = `default allow = false

allow :- user_is_admin

allow :- user_is_granted[grant], input.action = grant.action, input.type = grant.type

user_is_admin :- data.rbac.user_roles[input.user][_] = "admin"

user_is_granted[grant] :- role = data.rbac.user_roles[input.user][_], grant = data.rbac.role_grants[role][_]
`

// Releases before v0.4.1 have no input document; the request is described by
// scalar rules (object-valued constants are rejected by some of these parsers).
const datalogNoInputBody = `request_user = "bob"

request_action = "update"

request_type = "dog"

allow :- user_is_admin

allow :- user_is_granted[grant], request_action = grant.action, request_type = grant.type

user_is_admin :- data.rbac.user_roles[request_user][_] = "admin"

user_is_granted[grant] :- role = data.rbac.user_roles[request_user][_], grant = data.rbac.role_grants[role][_]
`

// Template returns the files of a named template for a Rego dialect.
func Template(name, dialect string) map[string]string {
	if name == "empty" {
		return map[string]string{"policy.rego": "package app\n"}
	}
	header := "package app.rbac\n\n"
	testHeader := "package app.rbac_test\n\n"
	var body, test string
	testImport := "import data.app.rbac.allow\n\n"
	switch dialect {
	case "v1":
		body, test = v1Body, v1Test
	case "rego.v1":
		header += "import rego.v1\n\n"
		testHeader += "import rego.v1\n\n"
		body, test = v1Body, v1Test
	case "future-keywords":
		header += "import future.keywords.contains\nimport future.keywords.if\nimport future.keywords.in\n\n"
		testHeader += "import future.keywords.if\n\n"
		body, test = v1Body, v1Test
	case "legacy-assign":
		body, test = legacyAssignBody, legacyAssignTest
	case "legacy":
		body, test = legacyBody, legacyAssignTest
	case "datalog":
		body = datalogBody
	default: // datalog-noinput
		body = datalogNoInputBody
	}
	files := map[string]string{
		"app/rbac.rego": header + "# Role-based access control example shipped with OPA Studio.\n\n" + body,
		"data.json":     rbacData,
		"input.json":    rbacInput,
		"README.md":     "# Example workspace\n\nAn RBAC policy (`app/rbac.rego`), its data (`data.json`), a sample input and tests.\n\nTry `data.app.rbac.allow` in **Evaluate**, run **Test**, then **Deploy** it to an OPA server.\n",
	}
	if test != "" {
		files["app/rbac_test.rego"] = testHeader + testImport + test
	}
	if dialect == "datalog-noinput" || dialect == "" {
		delete(files, "input.json")
	}
	if dialect == "legacy" {
		delete(files, "data.json")
		files["README.md"] = strings.Replace(files["README.md"], "its data (`data.json`)", "its data (inlined: this OPA release's test runner cannot load data files)", 1)
	}
	return files
}

func (a *API) dialect() string {
	if a.Manifest != nil && a.Manifest.PreferredDialect != "" {
		return a.Manifest.PreferredDialect
	}
	return "v1"
}
