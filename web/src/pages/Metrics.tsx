import { useCallback, useEffect, useMemo, useState } from 'react'
import { opa, opaError } from '../api/client'
import { Alert, Badge, Button, Card, Check, Code, Tabs } from '../components/ui'
import { parsePrometheus, type Metric } from '../lib/prometheus'
import { useApp } from '../state/app'

export default function Metrics() {
  const { conn } = useApp()
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const [auto, setAuto] = useState(false)
  const [tab, setTab] = useState<'table' | 'raw'>('table')
  const [selected, setSelected] = useState<Metric | null>(null)

  const load = useCallback(async () => {
    const r = await opa(conn, 'GET', '/metrics', { headers: { Accept: 'text/plain' } })
    if (r.ok) {
      setText(r.text)
      setError(null)
    } else setError(opaError(r))
  }, [conn])

  useEffect(() => {
    void load()
  }, [load])
  useEffect(() => {
    if (!auto) return
    const t = setInterval(() => void load(), 5000)
    return () => clearInterval(t)
  }, [auto, load])

  const metrics = useMemo(() => parsePrometheus(text), [text])
  const shown = metrics.filter((m) => m.name.includes(filter) || m.help.toLowerCase().includes(filter.toLowerCase()))
  const sel = selected ? metrics.find((m) => m.name === selected.name) ?? null : null

  return (
    <div className="page">
      <div className="row">
        <input placeholder="Filter metrics…" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ width: 320 }} />
        <Check label="auto-refresh (5s)" checked={auto} onChange={setAuto} />
        <Button icon="refresh" onClick={() => void load()}>Reload</Button>
        <span className="muted small right">{metrics.length} metric families</span>
      </div>
      {error && <Alert kind="err"><pre>{error}</pre></Alert>}
      <Tabs tabs={[{ id: 'table', label: 'Metrics' }, { id: 'raw', label: 'Raw exposition' }]} value={tab} onChange={setTab} />
      {tab === 'table' ? (
        <div className="split">
          <Card flush>
            <div className="table-wrap" style={{ maxHeight: 'calc(100vh - 260px)' }}>
              <table className="table">
                <thead><tr><th>Name</th><th>Type</th><th>Samples</th></tr></thead>
                <tbody>
                  {shown.map((m) => (
                    <tr key={m.name} className={`clickable ${sel?.name === m.name ? 'selected' : ''}`} onClick={() => setSelected(m)}>
                      <td><div className="mono small">{m.name}</div><div className="muted small">{m.help}</div></td>
                      <td><Badge>{m.type}</Badge></td>
                      <td>{m.samples.length}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
          <Card title={sel ? <span className="mono">{sel.name}</span> : 'Samples'} subtitle={sel?.help}>
            {sel ? (
              <div className="table-wrap" style={{ maxHeight: 'calc(100vh - 300px)' }}>
                <table className="table">
                  <thead><tr><th>Sample</th><th>Labels</th><th>Value</th></tr></thead>
                  <tbody>
                    {sel.samples.map((s, i) => (
                      <tr key={i}>
                        <td className="mono small">{s.name}</td>
                        <td className="mono small">{Object.entries(s.labels).map(([k, v]) => `${k}="${v}"`).join(', ')}</td>
                        <td className="mono">{s.value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <span className="muted">Select a metric family.</span>
            )}
          </Card>
        </div>
      ) : (
        <Code>{text}</Code>
      )}
    </div>
  )
}
