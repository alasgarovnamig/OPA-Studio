/** Starter snippets written in the Rego dialect measured for the OPA version. */
export function policyTemplate(dialect: string | undefined, pkg = 'example'): string {
  switch (dialect) {
    case 'v1':
      return `package ${pkg}\n\ndefault allow := false\n\nallow if {\n\tinput.user == "alice"\n}\n`
    case 'rego.v1':
      return `package ${pkg}\n\nimport rego.v1\n\ndefault allow := false\n\nallow if {\n\tinput.user == "alice"\n}\n`
    case 'future-keywords':
      return `package ${pkg}\n\nimport future.keywords.if\n\ndefault allow := false\n\nallow if {\n\tinput.user == "alice"\n}\n`
    case 'legacy-assign':
      return `package ${pkg}\n\ndefault allow = false\n\nallow {\n\tinput.user == "alice"\n}\n`
    case 'legacy':
      return `package ${pkg}\n\ndefault allow = false\n\nallow {\n\tinput.user = "alice"\n}\n`
    case 'datalog':
      return `package ${pkg}\n\ndefault allow = false\n\nallow :- input.user = "alice"\n`
    default:
      return `package ${pkg}\n\nadmins = ["alice"]\n\nallow :- admins[_] = "alice"\n`
  }
}

/** A custom health check policy (system.health) in the right dialect. */
export function healthTemplate(dialect: string | undefined): string {
  const v1 = dialect === 'v1' || dialect === 'rego.v1' || dialect === 'future-keywords'
  const imp = dialect === 'rego.v1' ? 'import rego.v1\n\n' : dialect === 'future-keywords' ? 'import future.keywords.if\n\n' : ''
  if (v1) {
    return `package system.health\n\n${imp}# GET /health/live succeeds when live is true.\nlive := true\n\n# GET /health/ready succeeds when every plugin is OK.\ndefault ready := false\n\nready if {\n\tinput.plugins_ready\n\tinput.plugin_state.bundle == "OK"\n}\n\nready if {\n\tinput.plugins_ready\n\tnot input.plugin_state.bundle\n}\n`
  }
  return `package system.health\n\nlive = true\n\ndefault ready = false\n\nready {\n\tinput.plugins_ready\n}\n`
}

/** Starter query for a dialect. */
export function sampleQuery(dialect: string | undefined): string {
  return dialect === 'datalog-noinput' ? 'data.app.rbac.allow' : 'data.app.rbac.allow'
}
