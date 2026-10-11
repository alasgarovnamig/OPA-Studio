import { useMemo, useState } from 'react'
import { api } from '../api/client'
import { Alert, Badge, Button, Card, Empty, Tabs, useToast } from '../components/ui'
import { hasCommand } from '../lib/features'
import { download } from '../lib/format'
import { Link } from '../lib/router'
import { useApp } from '../state/app'

export default function Builtins() {
  const { cli, info } = useApp()
  const toast = useToast()
  const caps = cli?.capabilities
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('')
  const [tab, setTab] = useState<'builtins' | 'keywords'>('builtins')
  const builtins = caps?.builtins ?? []
  const categories = useMemo(() => [...new Set(builtins.flatMap((b) => b.categories ?? []))].sort(), [builtins])
  const shown = builtins.filter((b) => (!q || b.name.includes(q) || (b.description ?? '').toLowerCase().includes(q.toLowerCase())) && (!cat || (b.categories ?? []).includes(cat)))

  if (!caps) {
    return (
      <div className="page">
        <Alert kind="info" title={`OPA ${cli?.opa.version ?? info.studio.targetOpaVersion} cannot describe its built-ins`}>
          The <code>opa capabilities</code> command (which lists built-in functions, keywords and features) was introduced in OPA v0.40.0.
          Built-ins of this release are documented at{' '}
          <a href={`https://github.com/open-policy-agent/opa/tree/${cli?.opa.version}/docs`} target="_blank" rel="noreferrer">the docs of this tag</a>.
          See <Link to="/compatibility">Compatibility</Link> for what each release supports.
        </Alert>
      </div>
    )
  }
  return (
    <div className="page">
      <div className="row">
        <Badge kind="accent">{builtins.length} built-ins</Badge>
        <Badge>{(caps.future_keywords ?? []).length} future keywords</Badge>
        <Badge>{(caps.features ?? []).length} features</Badge>
        {hasCommand(cli, 'capabilities') && (
          <Button className="right" icon="download" onClick={async () => {
            const r = await api.cli({ args: ['capabilities', '--current'] })
            if (r.exitCode === 0) download(`capabilities-${cli?.opa.version}.json`, r.stdout, 'application/json')
            else toast(r.stderr, 'err')
          }}>opa capabilities --current</Button>
        )}
      </div>
      <Tabs tabs={[{ id: 'builtins', label: 'Built-in functions', count: builtins.length }, { id: 'keywords', label: 'Keywords & features' }]} value={tab} onChange={setTab} />
      {tab === 'builtins' ? (
        <>
          <div className="row">
            <input placeholder="Search name or description…" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 320 }} />
            <select value={cat} onChange={(e) => setCat(e.target.value)}>
              <option value="">All categories</option>
              {categories.map((c) => <option key={c}>{c}</option>)}
            </select>
            <span className="muted small">{shown.length} shown</span>
          </div>
          <Card flush>
            <div className="table-wrap" style={{ maxHeight: 'calc(100vh - 300px)' }}>
              <table className="table">
                <thead><tr><th>Function</th><th>Signature</th><th>Description</th><th>Categories</th></tr></thead>
                <tbody>
                  {shown.map((b) => (
                    <tr key={b.name}>
                      <td className="mono">{b.name}{b.infix && <div className="muted">infix {b.infix}</div>}</td>
                      <td className="mono small">({(b.args ?? []).filter(Boolean).join(', ')}) → {b.result ?? '—'}</td>
                      <td className="small">{b.description ?? ''}{b.nondeterministic && <> <Badge kind="warn">non-deterministic</Badge></>}{b.relation && <> <Badge>relation</Badge></>}</td>
                      <td className="small">{(b.categories ?? []).join(', ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!shown.length && <Empty title="No match" />}
            </div>
          </Card>
        </>
      ) : (
        <div className="grid cols-3">
          <Card title="Future keywords">{(caps.future_keywords ?? []).map((k) => <Badge key={k}>{k}</Badge>)}{!caps.future_keywords?.length && <span className="muted">none</span>}</Card>
          <Card title="Features">{(caps.features ?? []).map((k) => <div key={k}><code>{k}</code></div>)}{!caps.features?.length && <span className="muted">none</span>}</Card>
          <Card title="Wasm ABI versions">{(caps.wasm_abi_versions ?? []).map((v) => <div key={`${v.version}.${v.minor_version}`}><code>{v.version}.{v.minor_version}</code></div>)}</Card>
        </div>
      )}
    </div>
  )
}
