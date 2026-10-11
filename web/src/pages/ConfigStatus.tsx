import { useCallback, useEffect, useState } from 'react'
import { opa, type OpaResponse } from '../api/client'
import { ResponseView, unwrap } from '../components/opa'
import { Alert, Badge, Button, Card, Check, JsonView, KV, Tabs } from '../components/ui'
import { hasEndpoint } from '../lib/features'
import { ago } from '../lib/format'
import { useApp } from '../state/app'

type Tab = 'config' | 'status'

interface StatusDoc {
  labels?: Record<string, string>
  bundles?: Record<string, { name?: string; active_revision?: string; last_successful_download?: string; last_successful_activation?: string; last_request?: string; code?: string; message?: string; errors?: unknown[]; metrics?: unknown }>
  plugins?: Record<string, { state: string; message?: string }>
  discovery?: Record<string, unknown>
  decision_logs?: Record<string, unknown>
  metrics?: Record<string, unknown>
}

export default function ConfigStatus() {
  const { conn, server } = useApp()
  const hasConfig = hasEndpoint(server, 'config') !== false
  const hasStatus = hasEndpoint(server, 'status') !== false
  const [tab, setTab] = useState<Tab>(hasConfig ? 'config' : 'status')
  const [pretty, setPretty] = useState(false)
  const [r, setR] = useState<OpaResponse | null>(null)

  const load = useCallback(async () => {
    setR(await opa(conn, 'GET', tab === 'config' ? '/v1/config' : '/v1/status', { query: { pretty } }))
  }, [conn, tab, pretty])

  useEffect(() => {
    void load()
  }, [load])

  const doc = r?.ok ? (unwrap(r.json) as Record<string, unknown>) : undefined
  const st = doc as StatusDoc | undefined

  return (
    <div className="page">
      <Tabs
        tabs={[
          { id: 'config', label: 'Config API (/v1/config)', hidden: !hasConfig },
          { id: 'status', label: 'Status API (/v1/status)', hidden: !hasStatus },
        ]}
        value={tab}
        onChange={setTab}
      />
      <div className="row">
        <Check label="pretty" checked={pretty} onChange={setPretty} />
        <Button icon="refresh" onClick={() => void load()}>Reload</Button>
      </div>
      {r && !r.ok && tab === 'status' && r.status === 500 && (
        <Alert kind="info" title="The status plugin is not enabled on this server">
          Enable it with <code>status: {'{'}service: …{'}'}</code> or <code>status.prometheus: true</code> in the OPA configuration — the Control Plane page generates one that reports to Studio.
        </Alert>
      )}
      {doc && tab === 'config' && (
        <div className="grid cols-2">
          <Card title="Summary">
            <KV
              items={[
                ['Labels', Object.entries((doc.labels as Record<string, string>) ?? {}).map(([k, v]) => `${k}=${v}`).join(', ')],
                ['Default decision', String(doc.default_decision ?? '—')],
                ['Default authorization decision', String(doc.default_authorization_decision ?? '—')],
                ['Services', Object.keys((doc.services as object) ?? {}).join(', ') || '—'],
                ['Bundles', Object.keys((doc.bundles as object) ?? {}).join(', ') || '—'],
                ['Decision logs', doc.decision_logs ? 'configured' : '—'],
                ['Status', doc.status ? 'configured' : '—'],
                ['Discovery', doc.discovery ? 'configured' : '—'],
                ['Keys', Object.keys((doc.keys as object) ?? {}).join(', ') || '—'],
              ]}
            />
            <p className="muted small" style={{ marginTop: 10 }}>Credentials are redacted by OPA in this API.</p>
          </Card>
          <Card title="Configuration document"><JsonView value={doc} open={3} /></Card>
        </div>
      )}
      {st && tab === 'status' && (
        <div className="grid cols-2">
          <Card title="Plugins" flush>
            <table className="table">
              <thead><tr><th>Plugin</th><th>State</th><th>Message</th></tr></thead>
              <tbody>
                {Object.entries(st.plugins ?? {}).map(([k, v]) => (
                  <tr key={k}><td className="mono">{k}</td><td><Badge kind={v.state === 'OK' ? 'ok' : v.state === 'NOT_READY' ? 'warn' : 'err'}>{v.state}</Badge></td><td className="small">{v.message ?? ''}</td></tr>
                ))}
              </tbody>
            </table>
          </Card>
          <Card title="Bundles" flush>
            <table className="table">
              <thead><tr><th>Bundle</th><th>Revision</th><th>Downloaded</th><th>Activated</th><th>Result</th></tr></thead>
              <tbody>
                {Object.entries(st.bundles ?? {}).map(([k, b]) => (
                  <tr key={k}>
                    <td className="mono">{k}</td>
                    <td className="mono small">{b.active_revision ?? '—'}</td>
                    <td>{ago(b.last_successful_download)}</td>
                    <td>{ago(b.last_successful_activation)}</td>
                    <td>{b.code ? <Badge kind="err">{b.code}</Badge> : <Badge kind="ok">OK</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          <Card title="Status document"><JsonView value={st} open={2} /></Card>
        </div>
      )}
      {r && <ResponseView r={r} />}
    </div>
  )
}
