import { useCallback, useEffect, useRef, useState } from 'react'
import { api, stream } from '../api/client'
import type { BundleMeta, BundleSummary, Decision, Discovery, StatusReport } from '../api/types'
import { Editor } from '../components/Editor'
import { Alert, Badge, Button, Card, Check, Code, Empty, Field, JsonView, KV, Tabs, useToast } from '../components/ui'
import { compareVersions } from '../lib/features'
import { ago, bytes } from '../lib/format'
import { useApp } from '../state/app'

type Tab = 'bundles' | 'discovery' | 'decisions' | 'status' | 'config'

function BundlesTab() {
  const { ws, workspaces, readOnly } = useApp()
  const toast = useToast()
  const [list, setList] = useState<BundleMeta[]>([])
  const [name, setName] = useState('app')
  const [source, setSource] = useState(ws)
  const [revision, setRevision] = useState('')
  const [roots, setRoots] = useState('')
  const [summary, setSummary] = useState<{ name: string; s: BundleSummary } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const load = useCallback(async () => setList(await api.cpBundles()), [])
  useEffect(() => {
    void load()
    const t = setInterval(() => void load(), 5000)
    return () => clearInterval(t)
  }, [load])

  return (
    <div className="stack">
      <Card title="Publish a bundle" subtitle="OPA agents download it from /cp/bundles/{name} (ETag / If-None-Match supported)." actions={
        <>
          <input ref={fileRef} type="file" hidden accept=".tar.gz,.tgz" onChange={async (e) => {
            const f = e.target.files?.[0]
            if (!f) return
            try {
              await api.cpPublishArchive(name, f)
              toast(`Published ${name}`, 'ok')
              void load()
            } catch (err) {
              toast((err as Error).message, 'err')
            }
            e.target.value = ''
          }} />
          <Button icon="upload" disabled={readOnly} onClick={() => fileRef.current?.click()}>Upload archive…</Button>
          <Button icon="cloud" variant="primary" disabled={readOnly} onClick={async () => {
            try {
              await api.cpPublishWorkspace(name, { workspace: source, revision: revision || new Date().toISOString(), roots: roots.split(',').map((s) => s.trim()).filter(Boolean) })
              toast(`Published ${name} from workspace`, 'ok')
              void load()
            } catch (err) {
              toast((err as Error).message, 'err')
            }
          }}>Publish workspace</Button>
        </>
      }>
        <div className="form-grid">
          <Field label="Bundle name"><input value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Source workspace"><select value={source} onChange={(e) => setSource(e.target.value)}>{workspaces.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></Field>
          <Field label="Revision" hint="defaults to the current time"><input value={revision} onChange={(e) => setRevision(e.target.value)} /></Field>
          <Field label="Roots" hint="comma separated, e.g. app,rbac (empty = all paths)"><input value={roots} onChange={(e) => setRoots(e.target.value)} /></Field>
        </div>
      </Card>
      <Card title={`Published bundles (${list.length})`} flush>
        {list.length ? (
          <table className="table">
            <thead><tr><th>Name</th><th>Revision</th><th>Size</th><th>Signed</th><th>Downloads</th><th>304s</th><th>Last fetch</th><th /></tr></thead>
            <tbody>
              {list.map((b) => (
                <tr key={b.name}>
                  <td><div className="mono">{b.name}</div><div className="muted small">{b.source}</div></td>
                  <td className="mono small">{b.revision || '—'}</td>
                  <td>{bytes(b.size)}</td>
                  <td>{b.signed ? <Badge kind="ok">yes</Badge> : <Badge>no</Badge>}</td>
                  <td>{b.downloads}</td>
                  <td>{b.notModified}</td>
                  <td title={b.lastClient}>{ago(b.lastFetch)}</td>
                  <td>
                    <div className="row nowrap">
                      <Button size="sm" onClick={async () => setSummary({ name: b.name, s: await api.cpInspectBundle(b.name) })}>Inspect</Button>
                      <a className="btn sm" href={api.cpBundleUrl(b.name)} download>Download</a>
                      <Button size="sm" variant="danger" icon="trash" disabled={readOnly} onClick={async () => { if (window.confirm(`Delete ${b.name}?`)) { await api.cpDeleteBundle(b.name); void load() } }} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <Empty title="No bundles published" icon="bundle" />}
      </Card>
      {summary && (
        <Card title={`Contents of ${summary.name}`} actions={<Button size="sm" icon="x" onClick={() => setSummary(null)} />}>
          <table className="table">
            <thead><tr><th>Path</th><th>Kind</th><th>Size</th></tr></thead>
            <tbody>{summary.s.entries.map((e) => <tr key={e.path}><td className="mono small">{e.path}</td><td><Badge>{e.kind}</Badge></td><td>{bytes(e.size)}</td></tr>)}</tbody>
          </table>
          {summary.s.manifest !== undefined && <JsonView value={summary.s.manifest} />}
        </Card>
      )}
    </div>
  )
}

const DISCOVERY_EXAMPLE = JSON.stringify({
  bundles: { app: { service: 'studio', resource: 'bundles/app' } },
  decision_logs: { service: 'studio', reporting: { min_delay_seconds: 5, max_delay_seconds: 10 } },
  status: { service: 'studio' },
}, null, 2)

function DiscoveryTab() {
  const { readOnly } = useApp()
  const toast = useToast()
  const [list, setList] = useState<Discovery[]>([])
  const [name, setName] = useState('default')
  const [decision, setDecision] = useState('studio/discovery')
  const [config, setConfig] = useState(DISCOVERY_EXAMPLE)
  const load = useCallback(async () => setList(await api.cpDiscovery()), [])
  useEffect(() => {
    void load()
  }, [load])
  return (
    <div className="split">
      <Card title="Discovery document" subtitle="Served as a bundle at /cp/discovery/{name}; OPA evaluates the decision path to obtain its configuration." actions={
        <Button icon="save" variant="primary" disabled={readOnly} onClick={async () => {
          try {
            await api.cpPutDiscovery(name, { decision, config: JSON.parse(config) })
            toast('Discovery document saved', 'ok')
            void load()
          } catch (e) {
            toast((e as Error).message, 'err')
          }
        }}>Save</Button>
      }>
        <div className="stack">
          <div className="grid cols-2">
            <Field label="Name"><input value={name} onChange={(e) => setName(e.target.value)} /></Field>
            <Field label="Decision path" hint="config is placed at data.<decision>"><input className="mono" value={decision} onChange={(e) => setDecision(e.target.value)} /></Field>
          </div>
          <Field label="Distributed OPA configuration (JSON)">
            <Editor value={config} onChange={setConfig} language="json" height={320} />
          </Field>
        </div>
      </Card>
      <Card title="Documents" flush>
        {list.length ? list.map((d) => (
          <div key={d.name} className="list-item" onClick={() => { setName(d.name); setDecision(d.decision); setConfig(JSON.stringify(d.config, null, 2)) }}>
            <span className="mono">{d.name}</span>
            <span className="muted small">data.{d.decision.replace(/\//g, '.')}</span>
            <span className="right muted small">{ago(d.updatedAt)}</span>
            <Button size="sm" variant="danger" icon="trash" disabled={readOnly} onClick={async (e) => { e.stopPropagation(); await api.cpDeleteDiscovery(d.name); void load() }} />
          </div>
        )) : <Empty title="No discovery documents" />}
      </Card>
    </div>
  )
}

function DecisionsTab() {
  const [items, setItems] = useState<Decision[]>([])
  const [total, setTotal] = useState(0)
  const [path, setPath] = useState('')
  const [search, setSearch] = useState('')
  const [live, setLive] = useState(true)
  const [sel, setSel] = useState<Decision | null>(null)
  const load = useCallback(async () => {
    const r = await api.cpDecisions({ path, search, limit: 200 })
    setItems(r.items ?? [])
    setTotal(r.total)
  }, [path, search])
  useEffect(() => {
    void load()
  }, [load])
  useEffect(() => {
    if (!live) return
    return stream<Decision>('/api/control/decisions/stream', (d) => {
      setItems((x) => [d, ...x].slice(0, 500))
      setTotal((t) => t + 1)
    })
  }, [live])
  const ev = sel?.event as Record<string, unknown> | undefined
  return (
    <div className="stack">
      <div className="row">
        <input placeholder="Path prefix, e.g. app/rbac" value={path} onChange={(e) => setPath(e.target.value)} />
        <input placeholder="Search text in events" value={search} onChange={(e) => setSearch(e.target.value)} style={{ width: 280 }} />
        <Check label="live tail" checked={live} onChange={setLive} />
        <Button icon="refresh" onClick={() => void load()}>Reload</Button>
        <Button icon="trash" variant="danger" onClick={async () => { if (window.confirm('Delete all decision logs?')) { await api.cpClearDecisions(); void load() } }}>Clear</Button>
        <span className="muted small right">{total} events · POST /cp/logs</span>
      </div>
      <div className="split">
        <Card flush>
          <div className="table-wrap" style={{ maxHeight: 'calc(100vh - 280px)' }}>
            <table className="table">
              <thead><tr><th>Time</th><th>Path</th><th>Result</th><th>Agent</th></tr></thead>
              <tbody>
                {items.map((d, i) => (
                  <tr key={`${d.decision_id}-${i}`} className={`clickable ${sel === d ? 'selected' : ''}`} onClick={() => setSel(d)}>
                    <td className="small" style={{ whiteSpace: 'nowrap' }}>{d.timestamp ? new Date(d.timestamp).toLocaleTimeString() : ago(d.received_at)}</td>
                    <td className="mono small">{d.path || (typeof (d.event as Record<string, unknown>).query === 'string' ? <span title="ad-hoc query">? {String((d.event as Record<string, unknown>).query).slice(0, 40)}</span> : '—')}</td>
                    <td className="mono small">{JSON.stringify((d.event as Record<string, unknown>).result)?.slice(0, 40)}</td>
                    <td className="muted small ellipsis" style={{ maxWidth: 160 }}>{d.remote}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!items.length && <Empty title="No decision logs yet">Configure decision_logs with the "studio" service (see the OPA config tab).</Empty>}
          </div>
        </Card>
        <Card title="Event">
          {ev ? (
            <div className="stack">
              <KV items={[
                ['Decision id', <code>{String(ev.decision_id ?? '—')}</code>],
                ['Path', <code>{String(ev.path ?? '—')}</code>],
                ['Timestamp', String(ev.timestamp ?? '—')],
                ['Bundles', JSON.stringify(ev.bundles ?? {})],
                ['Labels', JSON.stringify(ev.labels ?? {})],
                ['Requested by', String(ev.requested_by ?? '—')],
              ]} />
              <strong className="small">input</strong><JsonView value={ev.input} open={2} />
              <strong className="small">result</strong><JsonView value={ev.result} open={2} />
              {ev.metrics !== undefined && <><strong className="small">metrics</strong><JsonView value={ev.metrics} /></>}
              <details><summary className="small">raw event</summary><JsonView value={ev} open={1} /></details>
            </div>
          ) : <span className="muted">Select an event.</span>}
        </Card>
      </div>
    </div>
  )
}

function StatusTab() {
  const [instances, setInstances] = useState<StatusReport[]>([])
  const [sel, setSel] = useState<string>('')
  const [history, setHistory] = useState<StatusReport[]>([])
  const load = useCallback(async () => {
    setInstances(await api.cpInstances())
    setHistory(await api.cpStatuses(sel || undefined))
  }, [sel])
  useEffect(() => {
    void load()
    const t = setInterval(() => void load(), 5000)
    return () => clearInterval(t)
  }, [load])
  return (
    <div className="stack">
      <div className="row">
        <Button icon="refresh" onClick={() => void load()}>Reload</Button>
        <Button icon="trash" variant="danger" onClick={async () => { await api.cpClearStatuses(); void load() }}>Clear</Button>
        <span className="muted small right">POST /cp/status</span>
      </div>
      <Card title={`Agents (${instances.length})`} flush>
        {instances.length ? (
          <table className="table">
            <thead><tr><th>Instance</th><th>Version</th><th>Bundles</th><th>Plugins</th><th>Last report</th></tr></thead>
            <tbody>
              {instances.map((s) => {
                const r = s.report as { labels?: Record<string, string>; bundles?: Record<string, { active_revision?: string; code?: string }>; plugins?: Record<string, { state: string }> }
                return (
                  <tr key={s.instance_id} className={`clickable ${sel === s.instance_id ? 'selected' : ''}`} onClick={() => setSel(sel === s.instance_id ? '' : s.instance_id)}>
                    <td className="mono small">{s.instance_id}<div className="muted">{s.remote}</div></td>
                    <td>{r.labels?.version ?? '—'}</td>
                    <td className="small">{Object.entries(r.bundles ?? {}).map(([n, b]) => <div key={n}>{n} <code>{b.active_revision}</code> {b.code && <Badge kind="err">{b.code}</Badge>}</div>)}</td>
                    <td className="small">{Object.entries(r.plugins ?? {}).map(([n, p]) => <Badge key={n} kind={p.state === 'OK' ? 'ok' : 'warn'}>{n}</Badge>)}</td>
                    <td>{ago(s.received_at)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        ) : <Empty title="No status reports yet">Enable the status plugin with the "studio" service.</Empty>}
      </Card>
      {history[0] && <Card title={`Latest report${sel ? ` of ${sel}` : ''}`}><JsonView value={history[0].report} open={2} /></Card>}
    </div>
  )
}

function ConfigTab() {
  const { info, cli, conn } = useApp()
  const toast = useToast()
  const legacy = cli ? compareVersions(cli.opa.version, 'v0.13.0') < 0 : false
  const [opts, setOpts] = useState({ bundle: 'app', discovery: '', decisionLogs: true, status: true, legacy })
  const [yaml, setYaml] = useState('')
  useEffect(() => {
    void api.cpConfig({ bundle: opts.bundle, discovery: opts.discovery, decisionLogs: String(opts.decisionLogs), status: String(opts.status), style: opts.legacy ? 'legacy' : '' }).then(setYaml)
  }, [opts])
  const applyLocal = async () => {
    const st = await api.localState()
    if (!st.enabled || !st.settings) return toast('Local OPA is disabled', 'err')
    await api.localSettings({ ...st.settings, config: yaml.replace('"${OPA_STUDIO_CONTROL_PLANE_TOKEN}"', '"set-the-token"') })
    await api.localAction('restart')
    toast('Local OPA restarted with this configuration', 'ok')
  }
  return (
    <div className="split">
      <Card title="Generate OPA configuration" subtitle="Point any OPA agent at this Studio instance.">
        <div className="stack">
          <div className="form-grid">
            <Field label="Bundle to download"><input value={opts.bundle} onChange={(e) => setOpts({ ...opts, bundle: e.target.value })} /></Field>
            <Field label="Discovery document"><input value={opts.discovery} onChange={(e) => setOpts({ ...opts, discovery: e.target.value })} placeholder="(none)" /></Field>
          </div>
          <div className="row">
            <Check label="decision_logs" checked={opts.decisionLogs} onChange={(v) => setOpts({ ...opts, decisionLogs: v })} />
            <Check label="status" checked={opts.status} onChange={(v) => setOpts({ ...opts, status: v })} />
            <Check label="legacy single `bundle:` key (OPA < v0.13)" checked={opts.legacy} onChange={(v) => setOpts({ ...opts, legacy: v })} />
          </div>
          {info.settings.controlPlaneTokenRequired && <Alert kind="info">The control plane requires a bearer token; replace the placeholder with OPA_STUDIO_CONTROL_PLANE_TOKEN.</Alert>}
          {conn === 'local' && <Button icon="server" onClick={() => void applyLocal()}>Apply to Local OPA &amp; restart</Button>}
        </div>
      </Card>
      <Card title="opa-config.yaml" actions={<Button size="sm" icon="copy" onClick={() => { void navigator.clipboard?.writeText(yaml); toast('Copied', 'ok') }}>Copy</Button>}>
        <Code>{yaml}</Code>
        <p className="muted small" style={{ marginTop: 8 }}>Run: <code>opa run --server --config-file opa-config.yaml</code></p>
      </Card>
    </div>
  )
}

export default function ControlPlane() {
  const [tab, setTab] = useState<Tab>('bundles')
  return (
    <div className="page">
      <Tabs
        tabs={[
          { id: 'bundles', label: 'Bundle service' },
          { id: 'discovery', label: 'Discovery' },
          { id: 'decisions', label: 'Decision logs' },
          { id: 'status', label: 'Status reports' },
          { id: 'config', label: 'OPA config' },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'bundles' && <BundlesTab />}
      {tab === 'discovery' && <DiscoveryTab />}
      {tab === 'decisions' && <DecisionsTab />}
      {tab === 'status' && <StatusTab />}
      {tab === 'config' && <ConfigTab />}
    </div>
  )
}
