import { useEffect, useMemo, useState } from 'react'
import { api } from '../api/client'
import type { Manifest } from '../api/types'
import { Alert, Badge, Card, Check, Empty, JsonView, KV, Tabs } from '../components/ui'
import { DIALECT_LABELS } from '../lib/features'
import { date } from '../lib/format'
import { useApp } from '../state/app'

interface Summary {
  version: string
  published_at: string
  prerelease: boolean
  github_release: boolean
  dialect: string
  commands: string[]
  endpoints: string[]
  builtins: number
  flags: number
  quirks?: string[]
  highlights?: { type: string; text: string }[]
  release_url: string
}

const KEY_ENDPOINTS: [string, string][] = [
  ['policies_list', 'Policy API'],
  ['data_put', 'Data writes'],
  ['data_get_input', 'Data + input'],
  ['query_post', 'Query POST'],
  ['compile', 'Compile'],
  ['compile_path', 'Data filtering'],
  ['health', 'Health'],
  ['health_live', 'Custom health'],
  ['metrics', 'Metrics'],
  ['config', 'Config API'],
  ['status', 'Status API'],
]

function diff(a: string[], b: string[]) {
  return { added: b.filter((x) => !a.includes(x)), removed: a.filter((x) => !b.includes(x)) }
}

export default function Compatibility() {
  const { info } = useApp()
  const [rows, setRows] = useState<Summary[]>([])
  const [q, setQ] = useState('')
  const [onlyChanges, setOnlyChanges] = useState(false)
  const [sel, setSel] = useState<string>(info.studio.targetOpaVersion)
  const [m, setM] = useState<Manifest | null>(null)
  const [tab, setTab] = useState<'overview' | 'cli' | 'api' | 'changes'>('overview')

  useEffect(() => {
    void api.versions().then(() => undefined)
    void fetch('/api/versions/summary', { credentials: 'same-origin' }).then((r) => r.json()).then((x: Summary[]) => setRows(x))
  }, [])
  useEffect(() => {
    if (sel) void api.versionManifest(sel).then(setM).catch(() => setM(null))
  }, [sel])

  const idx = rows.findIndex((r) => r.version === sel)
  const cur = rows[idx]
  const prev = idx > 0 ? rows[idx - 1] : undefined
  const shown = useMemo(() => {
    const desc = [...rows].reverse()
    return desc.filter((r, i) => {
      if (q && !r.version.includes(q)) return false
      if (!onlyChanges) return true
      const p = desc[i + 1]
      if (!p) return true
      return p.dialect !== r.dialect || diff(p.commands, r.commands).added.length > 0 || diff(p.endpoints, r.endpoints).added.length > 0
    })
  }, [rows, q, onlyChanges])

  return (
    <div className="page">
      <Alert kind="info">
        Every row was measured by running the official binary of that release (CLI help, dialect parsing and live REST probes).
        OPA Studio publishes one release per OPA version — tag <code>vX.Y.Z</code> of Studio targets OPA <code>vX.Y.Z</code>.
      </Alert>
      <div className="split sidebar-left" style={{ gridTemplateColumns: 'minmax(0, 1.25fr) minmax(0, 1fr)' }}>
        <Card title={`OPA releases (${rows.length})`} flush actions={<><input placeholder="Filter…" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 120 }} /><Check label="only feature changes" checked={onlyChanges} onChange={setOnlyChanges} /></>}>
          <div className="table-wrap" style={{ maxHeight: 'calc(100vh - 290px)' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Version</th><th>Date</th><th>Dialect</th><th>Cmds</th>
                  {KEY_ENDPOINTS.map(([, l]) => <th key={l} title={l} style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)', padding: '6px 4px' }}>{l}</th>)}
                  <th>Built-ins</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.version} className={`clickable ${r.version === sel ? 'selected' : ''}`} onClick={() => setSel(r.version)}>
                    <td className="mono">
                      {r.version}
                      {r.version === info.studio.targetOpaVersion && <> <Badge kind="accent">this</Badge></>}
                      {r.prerelease && <> <Badge kind="warn">pre</Badge></>}
                      {!r.github_release && <> <Badge title="Tag without GitHub release (Docker image only)">tag</Badge></>}
                      {r.quirks?.length ? <> <Badge kind="err" title={r.quirks.join(', ')}>quirk</Badge></> : null}
                    </td>
                    <td className="small" style={{ whiteSpace: 'nowrap' }}>{date(r.published_at)}</td>
                    <td className="small mono">{r.dialect}</td>
                    <td>{r.commands.length}</td>
                    {KEY_ENDPOINTS.map(([k]) => <td key={k} className="center">{r.endpoints.includes(k) ? '✓' : <span className="muted">·</span>}</td>)}
                    <td>{r.builtins || <span className="muted">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!rows.length && <Empty title="Loading…" />}
          </div>
        </Card>
        <Card title={<span className="mono">OPA {sel}</span>} flush>
          <Tabs tabs={[{ id: 'overview', label: 'Overview' }, { id: 'changes', label: 'Changes' }, { id: 'cli', label: 'CLI' }, { id: 'api', label: 'REST API' }]} value={tab} onChange={setTab} />
          <div className="card-body">
            {cur && tab === 'overview' && (
              <div className="stack">
                <KV items={[
                  ['Released', date(cur.published_at)],
                  ['Rego dialect', DIALECT_LABELS[cur.dialect] ?? cur.dialect],
                  ['CLI commands', cur.commands.join(', ')],
                  ['CLI flags', cur.flags],
                  ['Built-ins', cur.builtins || 'not introspectable (opa capabilities arrived in v0.40.0)'],
                  ['Studio release', <code>{cur.version}</code>],
                  ['Upstream', <a href={cur.release_url} target="_blank" rel="noreferrer">{cur.release_url.replace('https://', '')}</a>],
                ]} />
                {cur.quirks?.includes('write_lock_after_policy_error') && <Alert kind="warn">A rejected policy upload locks the store until restart in this release.</Alert>}
                {cur.highlights?.length ? (
                  <div className="stack" style={{ gap: 4 }}>
                    <strong className="small">Release note highlights</strong>
                    {cur.highlights.slice(0, 18).map((h, i) => h.type === 'heading' ? <div key={i} className="small" style={{ fontWeight: 600, marginTop: 4 }}>{h.text}</div> : <div key={i} className="small muted">• {h.text}</div>)}
                  </div>
                ) : null}
              </div>
            )}
            {cur && tab === 'changes' && (
              prev ? (
                <div className="stack">
                  <span className="muted small">Compared with {prev.version}</span>
                  {(() => {
                    const c = diff(prev.commands, cur.commands)
                    const e = diff(prev.endpoints, cur.endpoints)
                    const none = !c.added.length && !c.removed.length && !e.added.length && !e.removed.length && prev.dialect === cur.dialect && prev.builtins === cur.builtins
                    return (
                      <>
                        {c.added.map((x) => <div key={x}><Badge kind="ok">+ command</Badge> <code>{x}</code></div>)}
                        {c.removed.map((x) => <div key={x}><Badge kind="err">− command</Badge> <code>{x}</code></div>)}
                        {e.added.map((x) => <div key={x}><Badge kind="ok">+ endpoint</Badge> <code>{x}</code></div>)}
                        {e.removed.map((x) => <div key={x}><Badge kind="err">− endpoint</Badge> <code>{x}</code></div>)}
                        {prev.dialect !== cur.dialect && <div><Badge kind="info">dialect</Badge> {prev.dialect} → {cur.dialect}</div>}
                        {prev.builtins !== cur.builtins && <div><Badge kind="info">built-ins</Badge> {prev.builtins} → {cur.builtins}</div>}
                        {prev.flags !== cur.flags && <div><Badge kind="info">CLI flags</Badge> {prev.flags} → {cur.flags}</div>}
                        {none && prev.flags === cur.flags && <span className="muted">No measurable CLI/API surface change (bug-fix or internal release).</span>}
                      </>
                    )
                  })()}
                </div>
              ) : <span className="muted">First OPA release.</span>
            )}
            {m && tab === 'cli' && (
              <div className="stack">
                {Object.entries(m.cli.commands).filter(([n]) => n !== 'help').map(([n, c]) => (
                  <details key={n}>
                    <summary><code>opa {n}</code> <span className="muted small">— {c.description} ({Object.keys(c.flags ?? {}).length} flags)</span></summary>
                    <table className="table" style={{ marginTop: 6 }}>
                      <tbody>{Object.entries(c.flags ?? {}).map(([f, d]) => <tr key={f}><td className="mono small">--{f}{d.short ? `, -${d.short}` : ''}</td><td className="small muted">{d.type}</td><td className="small">{d.description}</td></tr>)}</tbody>
                    </table>
                  </details>
                ))}
              </div>
            )}
            {m && tab === 'api' && (
              <table className="table">
                <thead><tr><th>Probe</th><th>Request</th><th>Status</th></tr></thead>
                <tbody>
                  {Object.entries(m.server?.endpoints ?? {}).sort(([a], [b]) => a.localeCompare(b)).map(([k, e]) => (
                    <tr key={k}><td className="mono small">{k}</td><td className="mono small"><span className={`method ${e.method}`}>{e.method}</span> {e.path}</td><td><Badge kind={e.status === 0 ? 'err' : e.status < 300 ? 'ok' : e.status === 404 ? undefined : 'warn'}>{e.status || 'timeout'}</Badge></td></tr>
                  ))}
                </tbody>
              </table>
            )}
            {m && tab === 'overview' && <details style={{ marginTop: 12 }}><summary className="small">raw manifest</summary><JsonView value={{ ...m, capabilities: m.capabilities ? `${m.capabilities.builtins.length} builtins…` : null }} open={1} /></details>}
          </div>
        </Card>
      </div>
    </div>
  )
}
