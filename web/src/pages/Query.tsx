import { useEffect, useState } from 'react'
import { opa, type OpaResponse } from '../api/client'
import { Editor } from '../components/Editor'
import { ResponseView, unwrap } from '../components/opa'
import { Alert, Button, Card, Check, Field, Pills, Tabs, useToast } from '../components/ui'
import { hasEndpoint } from '../lib/features'
import { tryParseJSON } from '../lib/format'
import { useApp, useWorkspace } from '../state/app'

function Bindings({ value }: { value: unknown }) {
  const rows = Array.isArray(value) ? (value as Record<string, unknown>[]) : []
  const cols = [...new Set(rows.flatMap((r) => (r && typeof r === 'object' ? Object.keys(r) : [])))]
  if (!rows.length) return <Alert kind="info">Undefined — the query produced no results.</Alert>
  if (!cols.length) return <Alert kind="ok">Defined — {rows.length} result(s) without variable bindings (the query is true).</Alert>
  return (
    <div className="table-wrap" style={{ maxHeight: 360 }}>
      <table className="table">
        <thead><tr><th>#</th>{cols.map((c) => <th key={c}>{c}</th>)}</tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td className="muted">{i + 1}</td>
              {cols.map((c) => <td key={c} className="mono small">{JSON.stringify(r?.[c])}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

type Mode = 'adhoc' | 'default'

export default function Query() {
  const { conn, server, ws } = useApp()
  const { content } = useWorkspace(ws)
  const toast = useToast()
  const [mode, setMode] = useState<Mode>('adhoc')
  const [q, setQ] = useState('data.app.rbac.allow\nx := data.app.rbac.user_is_granted[_]')
  const [input, setInput] = useState('{}')
  const [method, setMethod] = useState<'GET' | 'POST'>('POST')
  const [opts, setOpts] = useState({ pretty: false, explain: 'off', metrics: false, instrument: false })
  const [resp, setResp] = useState<OpaResponse | null>(null)
  const [busy, setBusy] = useState(false)
  const e = (k: Parameters<typeof hasEndpoint>[1]) => hasEndpoint(server, k) !== false
  const canPost = e('query_post')

  useEffect(() => {
    if (content['input.json']) setInput(content['input.json'])
  }, [content])
  useEffect(() => {
    if (!canPost) setMethod('GET')
  }, [canPost])
  useEffect(() => {
    const d = server?.preferred_dialect ?? 'v1'
    if (d === 'legacy' || d.startsWith('datalog')) setQ('data.app.rbac.allow')
    else if (d === 'legacy-assign') setQ('data.app.rbac.allow\nx := data.app.rbac.user_is_granted[_]')
  }, [server])

  const run = async () => {
    setBusy(true)
    try {
      const query = { pretty: opts.pretty, explain: opts.explain !== 'off' ? opts.explain : undefined, metrics: opts.metrics, instrument: opts.instrument }
      const parsed = tryParseJSON(input)
      if (!parsed.ok) throw new Error(`Input is not valid JSON: ${parsed.error}`)
      if (mode === 'default') {
        setResp(await opa(conn, 'POST', '/', { body: parsed.value ?? {}, query: { pretty: opts.pretty } }))
      } else if (method === 'GET') {
        setResp(await opa(conn, 'GET', '/v1/query', { query: { q: q.split('\n').filter(Boolean).join('; '), ...query } }))
      } else {
        const body: Record<string, unknown> = { query: q }
        if (parsed.value !== undefined && e('query_post_input')) body.input = parsed.value
        setResp(await opa(conn, 'POST', '/v1/query', { body, query }))
      }
    } catch (err) {
      toast((err as Error).message, 'err')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page">
      <Tabs
        tabs={[
          { id: 'adhoc', label: 'Ad-hoc query (/v1/query)' },
          { id: 'default', label: 'Default decision (POST /)', hidden: !e('default_decision') },
        ]}
        value={mode}
        onChange={setMode}
      />
      <div className="split">
        <Card
          title={mode === 'adhoc' ? 'Query' : 'Default decision'}
          subtitle={mode === 'adhoc' ? 'One expression per line; all must be true. Ctrl/⌘+Enter runs.' : 'Evaluates the configured default decision (data.system.main unless configured otherwise) with the request body as input.'}
          actions={
            <>
              {mode === 'adhoc' && canPost && <Pills options={[{ id: 'GET', label: 'GET' }, { id: 'POST', label: 'POST' }]} value={method} onChange={setMethod} />}
              <Button icon="play" variant="primary" onClick={() => void run()} disabled={busy}>Run</Button>
            </>
          }
        >
          <div className="stack">
            {mode === 'adhoc' && <Editor value={q} onChange={setQ} language="rego" height={160} onSubmit={() => void run()} />}
            {(mode === 'default' || method === 'POST') && (
              <Field label={mode === 'default' ? 'Request body (input)' : 'Input document'}>
                <Editor value={input} onChange={setInput} language="json" height={200} onSubmit={() => void run()} />
              </Field>
            )}
            {mode === 'adhoc' && (
              <div className="row">
                <Check label="pretty" checked={opts.pretty} onChange={(v) => setOpts({ ...opts, pretty: v })} />
                <Check label="metrics" checked={opts.metrics} onChange={(v) => setOpts({ ...opts, metrics: v })} />
                <Check label="instrument" checked={opts.instrument} onChange={(v) => setOpts({ ...opts, instrument: v, metrics: v || opts.metrics })} />
                <label className="check">
                  explain
                  <select value={opts.explain} onChange={(ev) => setOpts({ ...opts, explain: ev.target.value })}>
                    {['off', 'notes', 'fails', 'full', 'debug'].map((m) => <option key={m}>{m}</option>)}
                  </select>
                </label>
              </div>
            )}
          </div>
        </Card>
        <div className="stack">
          {resp && resp.ok && mode === 'adhoc' && (
            <Card title="Bindings">
              <Bindings value={unwrap(resp.json)} />
            </Card>
          )}
          {resp && <ResponseView r={resp} />}
        </div>
      </div>
    </div>
  )
}
