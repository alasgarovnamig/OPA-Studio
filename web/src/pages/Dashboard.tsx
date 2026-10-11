import { useCallback, useEffect, useState } from 'react'
import { api, opa } from '../api/client'
import type { BundleMeta, Decision } from '../api/types'
import { normalizePolicies, unwrap } from '../components/opa'
import { Alert, Badge, Button, Card, KV, Stat } from '../components/ui'
import { DIALECT_LABELS, hasEndpoint } from '../lib/features'
import { ago, date } from '../lib/format'
import { Link } from '../lib/router'
import { useApp } from '../state/app'

interface Snapshot {
  policies?: number
  dataKeys?: string[]
  health?: { status: number; body: unknown }
  status?: Record<string, unknown>
  config?: Record<string, unknown>
}

export default function Dashboard() {
  const { conn, probe, reprobe, info, server, cli, workspaces, connections } = useApp()
  const [snap, setSnap] = useState<Snapshot>({})
  const [bundles, setBundles] = useState<BundleMeta[]>([])
  const [decisions, setDecisions] = useState<{ total: number; items: Decision[] }>({ total: 0, items: [] })
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    const s: Snapshot = {}
    try {
      const [pol, data] = await Promise.all([opa(conn, 'GET', '/v1/policies'), opa(conn, 'GET', '/v1/data')])
      if (pol.ok) s.policies = normalizePolicies(pol.json).length
      const d = unwrap(data.json)
      if (data.ok && d && typeof d === 'object') s.dataKeys = Object.keys(d as object)
      if (hasEndpoint(server, 'health') !== false) {
        const h = await opa(conn, 'GET', '/health', { query: { bundles: hasEndpoint(server, 'health_bundles') !== false, plugins: hasEndpoint(server, 'health_plugins') !== false } })
        s.health = { status: h.status, body: h.json }
      }
      if (hasEndpoint(server, 'status') !== false) {
        const st = await opa(conn, 'GET', '/v1/status')
        if (st.ok) s.status = unwrap(st.json) as Record<string, unknown>
      }
      if (hasEndpoint(server, 'config') !== false) {
        const c = await opa(conn, 'GET', '/v1/config')
        if (c.ok) s.config = unwrap(c.json) as Record<string, unknown>
      }
    } catch {
      /* connection errors are shown via probe */
    }
    setSnap(s)
    setBundles(await api.cpBundles().catch(() => []))
    setDecisions(await api.cpDecisions({ limit: 5 }).then((d) => ({ total: d.total, items: d.items ?? [] })).catch(() => ({ total: 0, items: [] })))
    setLoading(false)
  }, [conn, server])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const connection = connections.find((c) => c.id === conn)
  const quirk = server?.server?.quirks?.write_lock_after_policy_error
  const plugins = (snap.status?.plugins ?? {}) as Record<string, { state: string }>
  const statusBundles = (snap.status?.bundles ?? {}) as Record<string, { active_revision?: string; last_successful_activation?: string; errors?: unknown[] }>

  return (
    <div className="page">
      <div className="row">
        <span className="muted">
          Connected to <strong>{connection?.name ?? conn}</strong> <span className="mono small">{probe?.url}</span>
        </span>
        <div className="right row">
          <Button icon="refresh" onClick={() => { void reprobe(); void refresh() }} disabled={loading}>Refresh</Button>
        </div>
      </div>
      {probe && !probe.reachable && <Alert kind="err" title="OPA server unreachable">{probe.error}</Alert>}
      {probe?.version && probe.version !== info.studio.targetOpaVersion && (
        <Alert kind="warn" title={`Server runs OPA ${probe.version}; this Studio release targets OPA ${info.studio.targetOpaVersion}`}>
          Server features are gated with the measured manifest of {probe.version}. For a perfect match use the OPA Studio release tagged{' '}
          <code>{probe.version}</code>.
        </Alert>
      )}
      {quirk && (
        <Alert kind="warn" title={`Known OPA ${server?.opa.version} issue`}>
          A rejected policy upload leaves the store locked in this OPA release, so later writes hang until OPA restarts (fixed upstream in v0.12.0).
          Validate policies with Check &amp; Format before uploading them.
        </Alert>
      )}

      <div className="grid cols-4">
        <Stat label="OPA server" value={probe?.version ?? (probe?.reachable ? 'unknown' : '—')} foot={probe ? `${probe.latencyMs} ms · ${probe.reachable ? 'reachable' : 'down'}` : 'probing…'} />
        <Stat label="Policies" value={snap.policies ?? '—'} foot={<Link to="/policies">Open Policy API →</Link>} />
        <Stat label="Top-level data documents" value={snap.dataKeys?.length ?? '—'} foot={snap.dataKeys?.slice(0, 4).join(', ') || <Link to="/data">Open Data API →</Link>} />
        <Stat
          label="Health"
          value={snap.health ? (snap.health.status === 200 ? <Badge kind="ok">healthy</Badge> : <Badge kind="err">HTTP {snap.health.status}</Badge>) : '—'}
          foot={hasEndpoint(server, 'health') === false ? 'Health API not in this release' : <Link to="/health">Health checks →</Link>}
        />
      </div>

      <div className="grid cols-2">
        <Card title="This Studio">
          <KV
            items={[
              ['Studio release', <><code>{info.studio.version}</code> {/^[0-9a-f]{7,}$/.test(info.studio.commit) && <span className="muted small">commit {info.studio.commit.slice(0, 10)}</span>}</>],
              ['Targets OPA', <code>{info.studio.targetOpaVersion}</code>],
              ['Bundled OPA binary', info.opa.available ? <><code>{info.opa.version}</code> {info.opa.matchesTarget ? <Badge kind="ok">matches</Badge> : <Badge kind="warn">differs</Badge>}</> : <Badge kind="err">not found</Badge>],
              ['Rego dialect', cli?.preferred_dialect ? DIALECT_LABELS[cli.preferred_dialect] ?? cli.preferred_dialect : '—'],
              ['OPA release date', date(cli?.opa.published_at)],
              ['CLI commands', Object.keys(cli?.cli.commands ?? {}).filter((c) => c !== 'help' && c !== 'completion').join(', ')],
              ['Workspaces', workspaces.length],
              ['Mode', <>{info.settings.readOnly ? <Badge kind="warn">read-only</Badge> : <Badge kind="ok">read-write</Badge>} <Badge>auth: {info.settings.authMode}</Badge></>],
            ]}
          />
        </Card>
        <Card title="Server runtime" subtitle="from /v1/config and /v1/status">
          {snap.config ? (
            <KV
              items={[
                ['Instance id', <code>{String((snap.config.labels as Record<string, string>)?.id ?? '—')}</code>],
                ['Version label', String((snap.config.labels as Record<string, string>)?.version ?? '—')],
                ['Default decision', String(snap.config.default_decision ?? '—')],
                ['Authorization decision', String(snap.config.default_authorization_decision ?? '—')],
                ['Services', Object.keys((snap.config.services as object) ?? {}).join(', ') || '—'],
                ['Bundles', Object.keys((snap.config.bundles as object) ?? {}).join(', ') || '—'],
                ['Plugins', Object.entries(plugins).map(([k, v]) => `${k} (${v.state})`).join(', ') || '—'],
              ]}
            />
          ) : (
            <span className="muted">{hasEndpoint(server, 'config') === false ? 'The Config API was introduced in OPA v0.28.0.' : 'No configuration available.'}</span>
          )}
          {Object.keys(statusBundles).length > 0 && (
            <table className="table" style={{ marginTop: 12 }}>
              <thead><tr><th>Bundle</th><th>Revision</th><th>Activated</th><th>Errors</th></tr></thead>
              <tbody>
                {Object.entries(statusBundles).map(([n, b]) => (
                  <tr key={n}><td>{n}</td><td className="mono">{b.active_revision ?? '—'}</td><td>{ago(b.last_successful_activation)}</td><td>{b.errors?.length ?? 0}</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      <div className="grid cols-2">
        <Card title="Control plane" actions={<Link to="/control-plane">Open →</Link>}>
          <KV
            items={[
              ['Published bundles', bundles.length ? bundles.map((b) => b.name).join(', ') : 'none'],
              ['Decision log events', decisions.total],
              ['Agent endpoint', <code>{(info.settings.publicUrl || window.location.origin) + '/cp'}</code>],
            ]}
          />
        </Card>
        <Card title="Recent decisions" flush>
          {decisions.items.length ? (
            <table className="table">
              <thead><tr><th>Path</th><th>Decision id</th><th>Received</th></tr></thead>
              <tbody>
                {decisions.items.map((d, i) => (
                  <tr key={i}><td className="mono">{d.path ?? '—'}</td><td className="mono small">{d.decision_id ?? '—'}</td><td>{ago(d.received_at)}</td></tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="empty small">No decision logs yet. Point an OPA agent at the control plane to collect them.</div>
          )}
        </Card>
      </div>
    </div>
  )
}
