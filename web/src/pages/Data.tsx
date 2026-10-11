import { useCallback, useEffect, useState } from 'react'
import { opa, type OpaResponse } from '../api/client'
import { Editor } from '../components/Editor'
import { ResponseView, unwrap } from '../components/opa'
import { Alert, Button, Card, Check, Field, JsonView, Pills, useToast } from '../components/ui'
import { hasEndpoint } from '../lib/features'
import { tryParseJSON } from '../lib/format'
import { useApp, useWorkspace } from '../state/app'

type Op = 'get' | 'post' | 'put' | 'patch' | 'delete' | 'webhook'

const PATCH_TEMPLATE = `[
  { "op": "add", "path": "/new_key", "value": {"enabled": true} }
]`

export default function DataPage() {
  const { conn, server, readOnly, ws } = useApp()
  const { content } = useWorkspace(ws)
  const toast = useToast()
  const [root, setRoot] = useState<unknown>(undefined)
  const [path, setPath] = useState('')
  const [op, setOp] = useState<Op>('get')
  const [input, setInput] = useState('{\n  "user": "bob",\n  "action": "update",\n  "type": "dog"\n}')
  const [body, setBody] = useState('{\n  "example": true\n}')
  const [patch, setPatch] = useState(PATCH_TEMPLATE)
  const [ifNoneMatch, setIfNoneMatch] = useState(false)
  const [opts, setOpts] = useState({ pretty: false, explain: 'off', metrics: false, instrument: false, provenance: false, strict: false, useInput: true })
  const [resp, setResp] = useState<OpaResponse | null>(null)
  const [busy, setBusy] = useState(false)

  const e = (k: Parameters<typeof hasEndpoint>[1]) => hasEndpoint(server, k) !== false

  const loadRoot = useCallback(async () => {
    const r = await opa(conn, 'GET', '/v1/data')
    setRoot(r.ok ? unwrap(r.json) : undefined)
  }, [conn])

  useEffect(() => {
    void loadRoot()
  }, [loadRoot])

  useEffect(() => {
    if (content['input.json']) setInput(content['input.json'])
  }, [content])

  const url = `/v1/data${path ? '/' + path.replace(/^\/+|\/+$/g, '').split('/').map(encodeURIComponent).join('/') : ''}`

  const run = async () => {
    setBusy(true)
    try {
      const query = {
        pretty: opts.pretty,
        explain: opts.explain !== 'off' ? opts.explain : undefined,
        metrics: opts.metrics,
        instrument: opts.instrument,
        provenance: opts.provenance,
        'strict-builtin-errors': opts.strict,
      }
      let r: OpaResponse
      if (op === 'get') {
        r = await opa(conn, 'GET', url, { query })
      } else if (op === 'post') {
        const parsed = tryParseJSON(input)
        if (!parsed.ok) throw new Error(`Input is not valid JSON: ${parsed.error}`)
        r = await opa(conn, 'POST', url, { body: opts.useInput ? { input: parsed.value } : {}, query })
      } else if (op === 'put') {
        const parsed = tryParseJSON(body)
        if (!parsed.ok) throw new Error(`Document is not valid JSON: ${parsed.error}`)
        r = await opa(conn, 'PUT', url, { body: parsed.value ?? null, headers: ifNoneMatch ? { 'If-None-Match': '*' } : {}, query: { metrics: opts.metrics } })
      } else if (op === 'patch') {
        const parsed = tryParseJSON(patch)
        if (!parsed.ok) throw new Error(`Patch is not valid JSON: ${parsed.error}`)
        r = await opa(conn, 'PATCH', url, { body: parsed.value, contentType: 'application/json-patch+json' })
      } else if (op === 'delete') {
        if (!window.confirm(`Delete ${url}?`)) return
        r = await opa(conn, 'DELETE', url, { query: { metrics: opts.metrics } })
      } else {
        const parsed = tryParseJSON(input)
        if (!parsed.ok) throw new Error(`Input is not valid JSON: ${parsed.error}`)
        r = await opa(conn, 'POST', url.replace('/v1/data', '/v0/data'), { body: parsed.value, query: { pretty: opts.pretty } })
      }
      setResp(r)
      if (['put', 'patch', 'delete'].includes(op) && r.ok) {
        toast('Data updated', 'ok')
        void loadRoot()
      }
    } catch (err) {
      toast((err as Error).message, 'err')
    } finally {
      setBusy(false)
    }
  }

  const writeOps: { id: Op; label: string }[] = [
    { id: 'get', label: 'GET' },
    ...(e('data_get_input') ? [{ id: 'post' as Op, label: 'POST (input)' }] : []),
    ...(e('data_put') && !readOnly ? [{ id: 'put' as Op, label: 'PUT' }] : []),
    ...(e('data_patch') && !readOnly ? [{ id: 'patch' as Op, label: 'PATCH' }] : []),
    ...(e('data_delete') && !readOnly ? [{ id: 'delete' as Op, label: 'DELETE' }] : []),
    ...(e('data_webhook_v0') ? [{ id: 'webhook' as Op, label: 'v0 webhook' }] : []),
  ]
  const explainModes = ['off', ...(['notes', 'fails', 'full', 'debug'] as const).filter((m) => e(`data_explain_${m}` as never))]

  return (
    <div className="page">
      <div className="split sidebar-left" style={{ gridTemplateColumns: '360px minmax(0,1fr)' }}>
        <Card title="Document tree" subtitle="GET /v1/data — click a node to target its path" actions={<Button size="sm" icon="refresh" onClick={() => void loadRoot()} />}>
          <div style={{ maxHeight: 'calc(100vh - 230px)', overflow: 'auto' }}>
            {root === undefined && hasEndpoint(server, 'data_get') === false ? (
              <span className="muted small">OPA {server?.opa.version} cannot return the root document (GET /v1/data arrived in v0.2.0). Enter a document path on the right.</span>
            ) : (
              <JsonView value={root} open={1} onSelect={(p) => setPath(p.join('/'))} />
            )}
          </div>
        </Card>
        <div className="stack">
          <Card
            title="Request"
            actions={<Button icon="play" variant="primary" onClick={() => void run()} disabled={busy}>Send</Button>}
          >
            <div className="stack">
              <div className="row nowrap">
                <Pills options={writeOps} value={op} onChange={setOp} />
                <div className="row grow nowrap">
                  <span className="mono muted">{op === 'webhook' ? '/v0/data/' : '/v1/data/'}</span>
                  <input className="grow mono" value={path} onChange={(ev) => setPath(ev.target.value)} placeholder="app/rbac/allow" onKeyDown={(ev) => ev.key === 'Enter' && void run()} />
                </div>
              </div>
              {(op === 'get' || op === 'post') && (
                <div className="row">
                  {e('data_pretty') && <Check label="pretty" checked={opts.pretty} onChange={(v) => setOpts({ ...opts, pretty: v })} />}
                  {e('data_metrics') && <Check label="metrics" checked={opts.metrics} onChange={(v) => setOpts({ ...opts, metrics: v })} />}
                  {e('data_instrument') && <Check label="instrument" checked={opts.instrument} onChange={(v) => setOpts({ ...opts, instrument: v, metrics: v || opts.metrics })} />}
                  {e('data_provenance') && <Check label="provenance" checked={opts.provenance} onChange={(v) => setOpts({ ...opts, provenance: v })} />}
                  {e('data_strict_builtin_errors') && <Check label="strict-builtin-errors" checked={opts.strict} onChange={(v) => setOpts({ ...opts, strict: v })} />}
                  {explainModes.length > 1 && (
                    <label className="check">
                      explain
                      <select value={opts.explain} onChange={(ev) => setOpts({ ...opts, explain: ev.target.value })}>
                        {explainModes.map((m) => <option key={m}>{m}</option>)}
                      </select>
                    </label>
                  )}
                  {op === 'post' && <Check label='wrap as {"input": …}' checked={opts.useInput} onChange={(v) => setOpts({ ...opts, useInput: v })} />}
                </div>
              )}
              {(op === 'post' || op === 'webhook') && (
                <Field label={op === 'webhook' ? 'Request body (the v0 API takes the input document directly)' : 'Input document'}>
                  <Editor value={input} onChange={setInput} language="json" height={200} onSubmit={() => void run()} />
                </Field>
              )}
              {op === 'put' && (
                <>
                  <Field label="Document (replaces the value at the path)">
                    <Editor value={body} onChange={setBody} language="json" height={220} />
                  </Field>
                  {e('data_put_if_none_match') && <Check label="If-None-Match: * (only create, never overwrite)" checked={ifNoneMatch} onChange={setIfNoneMatch} />}
                </>
              )}
              {op === 'patch' && (
                <Field label="JSON Patch (RFC 6902): add, remove, replace" hint="Paths are relative to the document at the request path.">
                  <Editor value={patch} onChange={setPatch} language="json" height={220} />
                </Field>
              )}
              {op === 'delete' && <Alert kind="warn">Deletes the document at the path. Documents defined by policies cannot be deleted.</Alert>}
            </div>
          </Card>
          {resp && <ResponseView r={resp} />}
        </div>
      </div>
    </div>
  )
}
