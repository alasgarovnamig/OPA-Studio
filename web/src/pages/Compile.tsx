import { useState } from 'react'
import { opa, type OpaResponse } from '../api/client'
import { Editor } from '../components/Editor'
import { ResponseView, unwrap } from '../components/opa'
import { Alert, Button, Card, Check, Field, Tabs, useToast } from '../components/ui'
import { hasEndpoint } from '../lib/features'
import { tryParseJSON } from '../lib/format'
import { useApp } from '../state/app'

const TARGETS = [
  { accept: 'application/json', label: 'Rego AST (application/json)' },
  { accept: 'application/vnd.opa.ucast.all+json', label: 'UCAST — all operators' },
  { accept: 'application/vnd.opa.ucast.minimal+json', label: 'UCAST — minimal' },
  { accept: 'application/vnd.opa.ucast.prisma+json', label: 'UCAST — Prisma' },
  { accept: 'application/vnd.opa.ucast.linq+json', label: 'UCAST — LINQ' },
  { accept: 'application/vnd.opa.sql.postgresql+json', label: 'SQL — PostgreSQL' },
  { accept: 'application/vnd.opa.sql.mysql+json', label: 'SQL — MySQL' },
  { accept: 'application/vnd.opa.sql.sqlserver+json', label: 'SQL — SQL Server' },
  { accept: 'application/vnd.opa.sql.sqlite+json', label: 'SQL — SQLite' },
]

type Mode = 'partial' | 'filter'

/** Renders partially evaluated queries back as Rego-like text for readability. */
function termText(t: unknown): string {
  if (!t || typeof t !== 'object') return JSON.stringify(t)
  const { type, value } = t as { type: string; value: unknown }
  switch (type) {
    case 'ref':
      return (value as unknown[]).map((x, i) => {
        const s = x as { type: string; value: unknown }
        if (i === 0) return termText(s)
        if (s.type === 'string' && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(String(s.value))) return `.${s.value}`
        return `[${termText(s)}]`
      }).join('')
    case 'var':
      return String(value)
    case 'string':
      return JSON.stringify(value)
    case 'number': case 'boolean': case 'null':
      return JSON.stringify(value)
    case 'array':
      return `[${(value as unknown[]).map(termText).join(', ')}]`
    case 'set':
      return `{${(value as unknown[]).map(termText).join(', ')}}`
    case 'object':
      return `{${(value as [unknown, unknown][]).map(([k, v]) => `${termText(k)}: ${termText(v)}`).join(', ')}}`
    case 'call': {
      const [op, ...args] = value as unknown[]
      return `${termText(op)}(${args.map(termText).join(', ')})`
    }
    default:
      return JSON.stringify(value)
  }
}

const INFIX: Record<string, string> = { eq: '==', equal: '==', neq: '!=', lt: '<', lte: '<=', gt: '>', gte: '>=', assign: ':=' }

function exprText(e: { terms: unknown; negated?: boolean }): string {
  let s: string
  if (Array.isArray(e.terms)) {
    const [op, ...args] = e.terms as unknown[]
    const name = termText(op)
    s = INFIX[name] && args.length === 2 ? `${termText(args[0])} ${INFIX[name]} ${termText(args[1])}` : `${name}(${args.map(termText).join(', ')})`
  } else s = termText(e.terms)
  return (e.negated ? 'not ' : '') + s
}

function PartialQueries({ result }: { result: unknown }) {
  const r = result as { queries?: { terms: unknown; negated?: boolean }[][]; support?: unknown[] } | undefined
  if (!r || !('queries' in (r ?? {}))) return null
  if (!r.queries) return <Alert kind="err">Never true: the query is undefined for every value of the unknowns.</Alert>
  if (r.queries.some((q) => q.length === 0)) return <Alert kind="ok">Always true: the query is true for every value of the unknowns.</Alert>
  return (
    <pre className="code">
      {r.queries.map((q, i) => `# query ${i + 1}\n` + q.map(exprText).join('\n')).join('\n\n')}
      {r.support?.length ? `\n\n# ${r.support.length} support module(s) — see raw result` : ''}
    </pre>
  )
}

export default function Compile() {
  const { conn, server } = useApp()
  const toast = useToast()
  const hasFilter = hasEndpoint(server, 'compile_path') === true
  const [mode, setMode] = useState<Mode>('partial')
  const [query, setQuery] = useState('data.app.rbac.allow == true')
  const [input, setInput] = useState('{\n  "user": "bob"\n}')
  const [unknowns, setUnknowns] = useState('input.action, input.type')
  const [opts, setOpts] = useState({ explain: 'off', metrics: false, instrument: false, pretty: false })
  const [path, setPath] = useState('app/rbac/allow')
  const [accept, setAccept] = useState(TARGETS[1].accept)
  const [options, setOptions] = useState('{\n  "targetSQLTableMappings": {}\n}')
  const [resp, setResp] = useState<OpaResponse | null>(null)

  const run = async () => {
    const parsed = tryParseJSON(input)
    if (!parsed.ok) return toast(`Input: ${parsed.error}`, 'err')
    const unk = unknowns.split(',').map((s) => s.trim()).filter(Boolean)
    const q = { explain: opts.explain !== 'off' ? opts.explain : undefined, metrics: opts.metrics, instrument: opts.instrument, pretty: opts.pretty }
    if (mode === 'partial') {
      const body: Record<string, unknown> = { query, unknowns: unk }
      if (parsed.value !== undefined) body.input = parsed.value
      setResp(await opa(conn, 'POST', '/v1/compile', { body, query: q }))
    } else {
      const o = tryParseJSON(options)
      if (!o.ok) return toast(`Options: ${o.error}`, 'err')
      const body: Record<string, unknown> = { input: parsed.value ?? {}, unknowns: unk }
      if (o.value && Object.keys(o.value as object).length) body.options = o.value
      setResp(await opa(conn, 'POST', `/v1/compile/${path.replace(/^\/+/, '')}`, { body, headers: { Accept: accept }, query: q }))
    }
  }

  return (
    <div className="page">
      <Tabs
        tabs={[
          { id: 'partial', label: 'Partial evaluation (POST /v1/compile)' },
          { id: 'filter', label: 'Data filtering (POST /v1/compile/{path})', hidden: !hasFilter },
        ]}
        value={mode}
        onChange={setMode}
      />
      <div className="split">
        <Card title="Request" actions={<Button icon="play" variant="primary" onClick={() => void run()}>Compile</Button>}>
          <div className="stack">
            {mode === 'partial' ? (
              <Field label="Query" hint="Expressions referencing unknowns are kept; everything else is evaluated.">
                <Editor value={query} onChange={setQuery} language="rego" height={110} onSubmit={() => void run()} />
              </Field>
            ) : (
              <>
                <Field label="Rule path" hint="The filter rule, e.g. app/rbac/allow → data.app.rbac.allow">
                  <input className="mono" value={path} onChange={(e) => setPath(e.target.value)} />
                </Field>
                <Field label="Target (Accept header)">
                  <select value={accept} onChange={(e) => setAccept(e.target.value)}>
                    {TARGETS.map((t) => <option key={t.accept} value={t.accept}>{t.label}</option>)}
                  </select>
                </Field>
                <Field label="Options" hint="targetDialects, targetSQLTableMappings, maskRule …">
                  <Editor value={options} onChange={setOptions} language="json" height={110} />
                </Field>
              </>
            )}
            <Field label="Unknowns" hint="Comma separated references treated as unknown.">
              <input className="mono" value={unknowns} onChange={(e) => setUnknowns(e.target.value)} />
            </Field>
            <Field label="Input (known values)">
              <Editor value={input} onChange={setInput} language="json" height={150} />
            </Field>
            <div className="row">
              <Check label="metrics" checked={opts.metrics} onChange={(v) => setOpts({ ...opts, metrics: v })} />
              <Check label="instrument" checked={opts.instrument} onChange={(v) => setOpts({ ...opts, instrument: v })} />
              <Check label="pretty" checked={opts.pretty} onChange={(v) => setOpts({ ...opts, pretty: v })} />
              <label className="check">explain
                <select value={opts.explain} onChange={(e) => setOpts({ ...opts, explain: e.target.value })}>
                  {['off', 'notes', 'fails', 'full', 'debug'].map((m) => <option key={m}>{m}</option>)}
                </select>
              </label>
            </div>
          </div>
        </Card>
        <div className="stack">
          {resp?.ok && mode === 'partial' && (
            <Card title="Residual queries">
              <PartialQueries result={unwrap(resp.json)} />
            </Card>
          )}
          {resp && <ResponseView r={resp} />}
        </div>
      </div>
    </div>
  )
}
