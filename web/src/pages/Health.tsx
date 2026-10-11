import { useState } from 'react'
import { opa, type OpaResponse } from '../api/client'
import { Editor } from '../components/Editor'
import { ResponseView, StatusBadge } from '../components/opa'
import { Alert, Button, Card, Check, Field, useToast } from '../components/ui'
import { hasEndpoint } from '../lib/features'
import { healthTemplate } from '../lib/templates'
import { useApp } from '../state/app'

export default function Health() {
  const { conn, server, readOnly } = useApp()
  const toast = useToast()
  const [bundles, setBundles] = useState(true)
  const [plugins, setPlugins] = useState(true)
  const [exclude, setExclude] = useState('')
  const [results, setResults] = useState<{ label: string; r: OpaResponse }[]>([])
  const [policy, setPolicy] = useState(() => healthTemplate(server?.preferred_dialect))
  const live = hasEndpoint(server, 'health_live') !== false

  const check = async (label: string, path: string, query: Record<string, string | boolean | string[] | undefined> = {}) => {
    const r = await opa(conn, 'GET', path, { query })
    setResults((x) => [{ label, r }, ...x].slice(0, 12))
  }

  const runAll = async () => {
    const ex = exclude.split(',').map((s) => s.trim()).filter(Boolean)
    await check('/health', '/health', {
      bundles: bundles && hasEndpoint(server, 'health_bundles') !== false,
      plugins: plugins && hasEndpoint(server, 'health_plugins') !== false,
      'exclude-plugin': ex.length ? ex : undefined,
    })
    if (live) {
      await check('/health/live', '/health/live')
      await check('/health/ready', '/health/ready')
    }
  }

  return (
    <div className="page">
      <div className="split">
        <Card title="Health checks" actions={<Button icon="play" variant="primary" onClick={() => void runAll()}>Check</Button>}>
          <div className="stack">
            <div className="row">
              {hasEndpoint(server, 'health_bundles') !== false && <Check label="?bundles — require all bundles activated" checked={bundles} onChange={setBundles} />}
              {hasEndpoint(server, 'health_plugins') !== false && <Check label="?plugins — require all plugins OK" checked={plugins} onChange={setPlugins} />}
            </div>
            <Field label="exclude-plugin" hint="Comma separated plugin names ignored by ?plugins (e.g. decision_logs).">
              <input value={exclude} onChange={(e) => setExclude(e.target.value)} placeholder="decision_logs, status" />
            </Field>
            <div className="row">
              <Button size="sm" onClick={() => void check('/health', '/health')}>GET /health</Button>
              {live && <Button size="sm" onClick={() => void check('/health/live', '/health/live')}>GET /health/live</Button>}
              {live && <Button size="sm" onClick={() => void check('/health/ready', '/health/ready')}>GET /health/ready</Button>}
            </div>
            {results.length > 0 && (
              <table className="table">
                <thead><tr><th>Check</th><th>Status</th><th>Time</th><th>Body</th></tr></thead>
                <tbody>
                  {results.map(({ label, r }, i) => (
                    <tr key={i}>
                      <td className="mono">{label}</td>
                      <td><StatusBadge r={r} /></td>
                      <td className="muted">{r.durationMs} ms</td>
                      <td className="mono small">{r.text.slice(0, 160) || '{}'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {results[0] && <ResponseView r={results[0].r} />}
          </div>
        </Card>
        <Card
          title="Custom health policy"
          subtitle={live ? 'package system.health — /health/live and /health/ready evaluate the live and ready rules' : 'Custom health checks were introduced in OPA v0.33.0'}
          actions={
            <Button
              icon="save"
              disabled={readOnly || !live}
              onClick={async () => {
                const r = await opa(conn, 'PUT', '/v1/policies/studio/system-health.rego', { raw: policy })
                toast(r.ok ? 'Health policy installed' : `Failed: HTTP ${r.status}`, r.ok ? 'ok' : 'err')
              }}
            >
              Install on server
            </Button>
          }
        >
          {live ? (
            <Editor value={policy} onChange={setPolicy} language="rego" height={360} />
          ) : (
            <Alert kind="info">This OPA release only offers <code>GET /health</code>{hasEndpoint(server, 'health') === false ? ' — and not even that: the Health API was introduced in v0.10.3' : ''}.</Alert>
          )}
        </Card>
      </div>
    </div>
  )
}
