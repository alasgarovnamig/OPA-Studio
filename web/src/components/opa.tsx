import { useState, type ReactNode } from 'react'
import { opaError, type OpaResponse } from '../api/client'
import { Alert, Badge, Code, JsonView, Tabs } from './ui'
import { nanos } from '../lib/format'

/**
 * OPA wrapped responses in {"result": ...} starting with v0.4; earlier
 * releases returned the bare value. unwrap handles both.
 */
export function unwrap(j: unknown): unknown {
  if (j && typeof j === 'object' && !Array.isArray(j) && 'result' in (j as object)) return (j as { result: unknown }).result
  if (j && typeof j === 'object' && !Array.isArray(j) && Object.keys(j as object).length === 0) return undefined
  return j
}

export interface PolicyEntry {
  id: string
  raw: string
  ast?: unknown
}

/** Normalises GET /v1/policies across releases ({result:[{id,raw,ast}]} or [{ID,Module}]). */
export function normalizePolicies(j: unknown): PolicyEntry[] {
  const list = unwrap(j)
  if (!Array.isArray(list)) return []
  return list.filter((p) => p && typeof p === 'object').map((p: Record<string, unknown>) => ({
    id: String(p.id ?? p.ID ?? ''),
    raw: String(p.raw ?? p.Raw ?? ''),
    ast: p.ast ?? p.Module ?? p.module,
  }))
}

/**
 * Policy ids are often file paths. Newer OPA releases accept them URL-encoded
 * as one segment; older routers reject %2F, so the id is then sent as a path.
 */
export function policyPath(id: string, style: 'encoded' | 'path'): string {
  if (style === 'encoded') return `/v1/policies/${encodeURIComponent(id)}`
  return `/v1/policies/${id.replace(/^\/+/, '').split('/').map(encodeURIComponent).join('/')}`
}

export function StatusBadge({ r }: { r: OpaResponse }) {
  const kind = r.status >= 200 && r.status < 300 ? 'ok' : r.status === 304 ? 'info' : r.status >= 500 || r.status === 0 ? 'err' : 'warn'
  return <Badge kind={kind}>HTTP {r.status}</Badge>
}

function MetricsTable({ metrics }: { metrics: Record<string, unknown> }) {
  const rows = Object.entries(metrics).sort(([a], [b]) => a.localeCompare(b))
  return (
    <div className="table-wrap" style={{ maxHeight: 420 }}>
      <table className="table">
        <thead>
          <tr><th>Metric</th><th>Value</th></tr>
        </thead>
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k}>
              <td className="mono">{k}</td>
              <td className="mono">{typeof v === 'number' && k.endsWith('_ns') ? `${nanos(v)} (${v})` : typeof v === 'object' ? JSON.stringify(v) : String(v)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

interface TraceEvent {
  Op?: string
  op?: string
  Node?: unknown
  node?: unknown
  QueryID?: number
  query_id?: number
  ParentID?: number
  parent_id?: number
  Locals?: unknown
  locals?: unknown
  Location?: { file?: string; row?: number; col?: number }
  location?: { file?: string; row?: number; col?: number }
  Message?: string
  message?: string
  type?: string
}

function nodeText(n: unknown): string {
  if (n === undefined || n === null) return ''
  if (typeof n === 'string') return n
  try {
    return JSON.stringify(n).slice(0, 240)
  } catch {
    return ''
  }
}

/** Renders OPA explanations: either pretty text or the JSON trace events. */
export function Explanation({ value }: { value: unknown }) {
  if (typeof value === 'string') return <Code>{value}</Code>
  if (Array.isArray(value) && value.every((v) => typeof v === 'string')) return <Code>{(value as string[]).join('\n')}</Code>
  if (!Array.isArray(value)) return <JsonView value={value} />
  const events = value as TraceEvent[]
  return (
    <div className="table-wrap" style={{ maxHeight: 480 }}>
      <table className="table">
        <thead>
          <tr><th>#</th><th>Op</th><th>Query</th><th>Location</th><th>Node</th></tr>
        </thead>
        <tbody>
          {events.map((e, i) => {
            const loc = e.location ?? e.Location
            return (
              <tr key={i}>
                <td className="muted">{i + 1}</td>
                <td><span className="badge">{e.op ?? e.Op}</span></td>
                <td className="mono small">{e.query_id ?? e.QueryID}{(e.parent_id ?? e.ParentID) !== undefined ? ` ← ${e.parent_id ?? e.ParentID}` : ''}</td>
                <td className="mono small">{loc ? `${loc.file ?? ''}:${loc.row ?? ''}` : ''}</td>
                <td className="mono small" style={{ wordBreak: 'break-all' }}>{e.message ?? e.Message ?? nodeText(e.node ?? e.Node)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

type ViewTab = 'result' | 'explanation' | 'metrics' | 'provenance' | 'warning' | 'raw' | 'headers'

/** Shows an OPA REST response with structured tabs. */
export function ResponseView({ r, extra }: { r: OpaResponse; extra?: ReactNode }) {
  const j = r.json as Record<string, unknown> | undefined
  const isObj = j && typeof j === 'object' && !Array.isArray(j)
  const err = opaError(r)
  const tabs: { id: ViewTab; label: string; hidden?: boolean }[] = [
    { id: 'result', label: 'Result' },
    { id: 'explanation', label: 'Explanation', hidden: !(isObj && j?.explanation) },
    { id: 'metrics', label: 'Metrics', hidden: !(isObj && j?.metrics) },
    { id: 'provenance', label: 'Provenance', hidden: !(isObj && j?.provenance) },
    { id: 'warning', label: 'Warning', hidden: !(isObj && j?.warning) },
    { id: 'raw', label: 'Raw' },
    { id: 'headers', label: 'Headers' },
  ]
  const [tab, setTab] = useState<ViewTab>('result')
  return (
    <div className="card">
      <div className="card-header">
        <h3>Response</h3>
        <StatusBadge r={r} />
        <span className="muted small">{r.durationMs} ms</span>
        {r.target && <span className="muted small ellipsis mono" title={r.target}>{r.target}</span>}
        <div className="actions">{extra}</div>
      </div>
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      <div className="card-body">
        {tab === 'result' && (
          <div className="stack">
            {err && !r.ok && <Alert kind="err"><pre>{err}</pre></Alert>}
            {r.ok && (j !== undefined ? <JsonView value={unwrap(j)} open={3} maxHeight={560} /> : <Code>{r.text || '(empty body)'}</Code>)}
            {!r.ok && j !== undefined && <JsonView value={j} />}
          </div>
        )}
        {tab === 'explanation' && <Explanation value={j?.explanation} />}
        {tab === 'metrics' && j?.metrics !== undefined && <MetricsTable metrics={j.metrics as Record<string, unknown>} />}
        {tab === 'provenance' && <JsonView value={j?.provenance} open={4} />}
        {tab === 'warning' && <JsonView value={j?.warning} open={4} />}
        {tab === 'raw' && <Code>{r.text || '(empty body)'}</Code>}
        {tab === 'headers' && (
          <div className="table-wrap">
            <table className="table">
              <tbody>
                {Object.entries(r.headers).filter(([k]) => !k.startsWith('x-studio')).map(([k, v]) => (
                  <tr key={k}><td className="mono">{k}</td><td className="mono">{v}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

export { MetricsTable }
