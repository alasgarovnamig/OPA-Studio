import { useState } from 'react'
import { opa, type OpaResponse } from '../api/client'
import { Editor } from '../components/Editor'
import { ResponseView } from '../components/opa'
import { Badge, Button, Card, Field, useToast } from '../components/ui'
import { hasEndpoint, type EndpointKey } from '../lib/features'
import { useApp } from '../state/app'

interface Preset {
  group: string
  name: string
  method: string
  path: string
  query?: string
  body?: string
  headers?: string
  endpoint?: EndpointKey
}

const PRESETS: Preset[] = [
  { group: 'Policy API', name: 'List policies', method: 'GET', path: '/v1/policies', endpoint: 'policies_list' },
  { group: 'Policy API', name: 'Get a policy', method: 'GET', path: '/v1/policies/example.rego', endpoint: 'policies_get' },
  { group: 'Policy API', name: 'Create or update a policy', method: 'PUT', path: '/v1/policies/example.rego', headers: 'Content-Type: text/plain', body: 'package example\n\ndefault allow := false\n', endpoint: 'policies_put' },
  { group: 'Policy API', name: 'Delete a policy', method: 'DELETE', path: '/v1/policies/example.rego', endpoint: 'policies_delete' },
  { group: 'Data API', name: 'Get a document', method: 'GET', path: '/v1/data/app/rbac', query: 'pretty', endpoint: 'data_get' },
  { group: 'Data API', name: 'Get a document with input', method: 'POST', path: '/v1/data/app/rbac/allow', body: '{"input": {"user": "alice"}}', endpoint: 'data_get_input' },
  { group: 'Data API', name: 'Explain a decision', method: 'POST', path: '/v1/data/app/rbac/allow', query: 'explain=full&pretty', body: '{"input": {"user": "bob", "action": "update", "type": "dog"}}', endpoint: 'data_explain_full' },
  { group: 'Data API', name: 'Decision with metrics & instrumentation', method: 'POST', path: '/v1/data/app/rbac/allow', query: 'metrics&instrument', body: '{"input": {"user": "alice"}}', endpoint: 'data_instrument' },
  { group: 'Data API', name: 'Decision with provenance', method: 'POST', path: '/v1/data/app/rbac/allow', query: 'provenance', body: '{"input": {}}', endpoint: 'data_provenance' },
  { group: 'Data API', name: 'Create or overwrite a document', method: 'PUT', path: '/v1/data/example', body: '{"servers": []}', endpoint: 'data_put' },
  { group: 'Data API', name: 'Create only if absent', method: 'PUT', path: '/v1/data/example', headers: 'If-None-Match: *', body: '{"servers": []}', endpoint: 'data_put_if_none_match' },
  { group: 'Data API', name: 'Patch a document', method: 'PATCH', path: '/v1/data/example', headers: 'Content-Type: application/json-patch+json', body: '[{"op": "add", "path": "/servers/-", "value": {"id": "s1"}}]', endpoint: 'data_patch' },
  { group: 'Data API', name: 'Delete a document', method: 'DELETE', path: '/v1/data/example', endpoint: 'data_delete' },
  { group: 'Data API', name: 'v0 webhook decision', method: 'POST', path: '/v0/data/app/rbac/allow', body: '{"user": "alice"}', endpoint: 'data_webhook_v0' },
  { group: 'Query API', name: 'Ad-hoc query (GET)', method: 'GET', path: '/v1/query', query: 'q=x := 1 + 1', endpoint: 'query_get' },
  { group: 'Query API', name: 'Ad-hoc query (POST)', method: 'POST', path: '/v1/query', body: '{"query": "data.app.rbac.allow", "input": {"user": "alice"}}', endpoint: 'query_post' },
  { group: 'Query API', name: 'Default decision', method: 'POST', path: '/', body: '{"user": "alice"}', endpoint: 'default_decision' },
  { group: 'Compile API', name: 'Partial evaluation', method: 'POST', path: '/v1/compile', body: '{"query": "data.app.rbac.allow == true", "input": {"user": "bob"}, "unknowns": ["input.action", "input.type"]}', endpoint: 'compile' },
  { group: 'Compile API', name: 'Data filtering (UCAST)', method: 'POST', path: '/v1/compile/app/rbac/allow', headers: 'Accept: application/vnd.opa.ucast.all+json', body: '{"input": {"user": "bob"}, "unknowns": ["input.type"]}', endpoint: 'compile_path' },
  { group: 'Compile API', name: 'Data filtering (SQL)', method: 'POST', path: '/v1/compile/app/rbac/allow', headers: 'Accept: application/vnd.opa.sql.postgresql+json', body: '{"input": {"user": "bob"}, "unknowns": ["input.type"]}', endpoint: 'compile_path_sql' },
  { group: 'Health API', name: 'Health', method: 'GET', path: '/health', endpoint: 'health' },
  { group: 'Health API', name: 'Health incl. bundles & plugins', method: 'GET', path: '/health', query: 'bundles&plugins', endpoint: 'health_plugins' },
  { group: 'Health API', name: 'Liveness (custom policy)', method: 'GET', path: '/health/live', endpoint: 'health_live' },
  { group: 'Health API', name: 'Readiness (custom policy)', method: 'GET', path: '/health/ready', endpoint: 'health_ready' },
  { group: 'Config & Status', name: 'Get configuration', method: 'GET', path: '/v1/config', endpoint: 'config' },
  { group: 'Config & Status', name: 'Get status', method: 'GET', path: '/v1/status', endpoint: 'status' },
  { group: 'Monitoring', name: 'Prometheus metrics', method: 'GET', path: '/metrics', endpoint: 'metrics' },
  { group: 'Monitoring', name: 'pprof index (requires --pprof)', method: 'GET', path: '/debug/pprof/' },
  { group: 'Misc', name: 'Built-in index page', method: 'GET', path: '/', endpoint: 'index' },
]

function parseHeaders(s: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of s.split('\n')) {
    const i = line.indexOf(':')
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim()
  }
  return out
}

interface HistoryItem {
  method: string
  path: string
  query: string
  status: number
  at: string
}

export default function ApiConsole() {
  const { conn, server, readOnly } = useApp()
  const toast = useToast()
  const [method, setMethod] = useState('GET')
  const [path, setPath] = useState('/v1/data')
  const [query, setQuery] = useState('pretty')
  const [headers, setHeaders] = useState('')
  const [body, setBody] = useState('')
  const [resp, setResp] = useState<OpaResponse | null>(null)
  const [history, setHistory] = useState<HistoryItem[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('studio.apiHistory') ?? '[]') as HistoryItem[]
    } catch {
      return []
    }
  })

  const apply = (p: Preset) => {
    setMethod(p.method)
    setPath(p.path)
    setQuery(p.query ?? '')
    setHeaders(p.headers ?? '')
    setBody(p.body ?? '')
  }

  const send = async () => {
    const h = parseHeaders(headers)
    const ct = Object.entries(h).find(([k]) => k.toLowerCase() === 'content-type')?.[1]
    const hasBody = !['GET', 'HEAD', 'DELETE'].includes(method) || body.trim() !== ''
    const qs = query.trim()
    const fullPath = qs ? `${path}?${qs.split('&').map((kv) => kv.split('=').map(encodeURIComponent).join('=')).join('&')}` : path
    try {
      const r = await opa(conn, method, fullPath, hasBody ? { raw: body, contentType: ct ?? 'application/json', headers: h } : { headers: h })
      setResp(r)
      const item = { method, path, query, status: r.status, at: new Date().toISOString() }
      const next = [item, ...history.filter((x) => !(x.method === method && x.path === path && x.query === query))].slice(0, 25)
      setHistory(next)
      try {
        localStorage.setItem('studio.apiHistory', JSON.stringify(next))
      } catch {
        /* ignore */
      }
    } catch (e) {
      toast((e as Error).message, 'err')
    }
  }

  const groups = [...new Set(PRESETS.map((p) => p.group))]
  return (
    <div className="page">
      <div className="split sidebar-left" style={{ gridTemplateColumns: '320px minmax(0,1fr)' }}>
        <div className="stack">
          <Card title="Operations" subtitle="Every documented OPA REST operation" flush>
            <div style={{ maxHeight: 'calc(100vh - 420px)', overflow: 'auto' }}>
              {groups.map((g) => (
                <div key={g}>
                  <div className="nav-group-title" style={{ color: 'var(--muted)' }}>{g}</div>
                  {PRESETS.filter((p) => p.group === g).map((p) => {
                    const avail = p.endpoint ? hasEndpoint(server, p.endpoint) : undefined
                    return (
                      <div key={p.name} className="list-item" onClick={() => apply(p)} style={avail === false ? { opacity: 0.45 } : undefined} title={avail === false ? `Not available in OPA ${server?.opa.version}` : p.path}>
                        <span className={`method ${p.method}`}>{p.method}</span>
                        <span className="ellipsis small">{p.name}</span>
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>
          </Card>
          <Card title="History" flush>
            {history.map((h, i) => (
              <div key={i} className="list-item" onClick={() => { setMethod(h.method); setPath(h.path); setQuery(h.query) }}>
                <span className={`method ${h.method}`}>{h.method}</span>
                <span className="ellipsis mono small grow">{h.path}{h.query ? `?${h.query}` : ''}</span>
                <Badge kind={h.status < 300 ? 'ok' : 'warn'}>{h.status}</Badge>
              </div>
            ))}
            {!history.length && <div className="empty small">No requests yet.</div>}
          </Card>
        </div>
        <div className="stack">
          <Card title="Request" actions={<Button icon="play" variant="primary" onClick={() => void send()} disabled={readOnly && ['PUT', 'PATCH', 'DELETE'].includes(method)}>Send</Button>}>
            <div className="stack">
              <div className="row nowrap">
                <select value={method} onChange={(e) => setMethod(e.target.value)} style={{ width: 110 }}>
                  {['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'].map((m) => <option key={m}>{m}</option>)}
                </select>
                <input className="grow mono" value={path} onChange={(e) => setPath(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void send()} />
              </div>
              <div className="grid cols-2">
                <Field label="Query string" hint="e.g. pretty&explain=full&metrics">
                  <input className="mono" value={query} onChange={(e) => setQuery(e.target.value)} />
                </Field>
                <Field label="Headers" hint="One per line: Name: value (Authorization overrides the connection token)">
                  <textarea rows={2} value={headers} onChange={(e) => setHeaders(e.target.value)} />
                </Field>
              </div>
              <Field label="Body">
                <Editor value={body} onChange={setBody} language={body.trim().startsWith('package') ? 'rego' : 'json'} height={200} onSubmit={() => void send()} />
              </Field>
            </div>
          </Card>
          {resp && <ResponseView r={resp} />}
        </div>
      </div>
    </div>
  )
}
