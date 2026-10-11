import type { Endpoint, Manifest } from '../api/types'

/** Endpoint keys measured by tools/introspect for every OPA release. */
export type EndpointKey =
  | 'index' | 'health' | 'health_bundles' | 'health_plugins' | 'health_live' | 'health_ready'
  | 'config' | 'status' | 'metrics' | 'policies_list' | 'policies_put' | 'policies_get' | 'policies_delete'
  | 'data_get' | 'data_get_input' | 'data_get_input_query_param' | 'data_explain_full' | 'data_explain_notes'
  | 'data_explain_fails' | 'data_explain_debug' | 'data_metrics' | 'data_instrument' | 'data_provenance'
  | 'data_strict_builtin_errors' | 'data_pretty' | 'data_put' | 'data_put_if_none_match' | 'data_patch'
  | 'data_delete' | 'data_webhook_v0' | 'query_get' | 'query_post' | 'query_post_input' | 'default_decision'
  | 'compile' | 'compile_path' | 'compile_path_sql' | 'data_watch' | 'pprof'

/** A JSON 404 means the route exists but the document is missing; a text 404 means no route. */
export function endpointAvailable(e: Endpoint | undefined): boolean | undefined {
  if (!e) return undefined
  if (e.status === 0 || e.status === 405) return false
  if (e.status === 404) return (e.content_type ?? '').includes('json')
  return true
}

/** Whether a manifest records the endpoint as available (undefined = unknown). */
export function hasEndpoint(m: Manifest | null | undefined, key: EndpointKey): boolean | undefined {
  if (!m?.server?.endpoints || Object.keys(m.server.endpoints).length === 0) return undefined
  return endpointAvailable(m.server.endpoints[key])
}

/** Whether a response key is present for an endpoint (e.g. "explanation" in data_explain_full). */
export function endpointReturns(m: Manifest | null | undefined, key: EndpointKey, field: string): boolean | undefined {
  const e = m?.server?.endpoints?.[key]
  if (!e) return undefined
  return (e.keys ?? []).includes(field)
}

export function hasCommand(m: Manifest | null | undefined, cmd: string): boolean {
  return !!m?.cli?.commands?.[cmd]
}

export function hasFlag(m: Manifest | null | undefined, cmd: string, flag: string): boolean {
  return !!m?.cli?.commands?.[cmd]?.flags?.[flag]
}

/** Values listed in a flag description like "set format (json, pretty) (default json)". */
export function flagChoices(m: Manifest | null | undefined, cmd: string, flag: string): string[] {
  const f = m?.cli?.commands?.[cmd]?.flags?.[flag]
  if (!f) return []
  const t = f.type ?? ''
  const braces = t.match(/^\{(.+)\}$/)
  if (braces) return braces[1].split(',').map((s) => s.trim()).filter(Boolean)
  const paren = f.description.match(/\(([a-z0-9_,\s-]+(?:\|[a-z0-9_-]+)*)\)/i)
  if (paren) {
    const parts = paren[1].includes('|') ? paren[1].split('|') : paren[1].split(',')
    const cleaned = parts.map((s) => s.trim()).filter((s) => /^[a-z0-9_-]+$/i.test(s))
    if (cleaned.length > 1) return cleaned
  }
  const eg = f.description.match(/one of:?\s*([a-z0-9_,\s-]+)/i)
  if (eg) return eg[1].split(',').map((s) => s.trim()).filter(Boolean)
  return []
}

export function semver(v: string): [number, number, number, string] {
  const m = v.match(/^v?(\d+)\.(\d+)\.(\d+)(?:-(.+))?/)
  if (!m) return [0, 0, 0, '']
  return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] ?? '']
}

export function compareVersions(a: string, b: string): number {
  const x = semver(a)
  const y = semver(b)
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return (x[i] as number) < (y[i] as number) ? -1 : 1
  if (x[3] === y[3]) return 0
  if (!x[3]) return 1
  if (!y[3]) return -1
  return x[3] < y[3] ? -1 : 1
}

export const DIALECT_LABELS: Record<string, string> = {
  'v1': 'Rego v1 (OPA 1.x default)',
  'rego.v1': 'Rego with `import rego.v1`',
  'future-keywords': 'Rego with `future.keywords` (if / contains / in)',
  'legacy-assign': 'Classic Rego (:= and ==)',
  'legacy': 'Classic Rego (unification only)',
  'datalog': 'Datalog-style Rego (`:-` rules, input document)',
  'datalog-noinput': 'Datalog-style Rego (`:-` rules, no input document)',
}
