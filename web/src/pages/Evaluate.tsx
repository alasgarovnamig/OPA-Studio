import { useEffect, useMemo, useState } from 'react'
import { api } from '../api/client'
import type { CliResult } from '../api/types'
import { Editor } from '../components/Editor'
import { Explanation, MetricsTable } from '../components/opa'
import { Alert, Button, Card, Check, CliOutput, Code, CommandPreview, Field, JsonView, Tabs, useToast } from '../components/ui'
import { shellSplit } from '../lib/args'
import { flagChoices, hasFlag } from '../lib/features'
import { useApp, useWorkspace, loadArgs } from '../state/app'

type OutTab = 'result' | 'explanation' | 'metrics' | 'profile' | 'coverage' | 'partial' | 'raw'

function persisted<T>(key: string, def: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => {
    try {
      const s = localStorage.getItem(key)
      return s ? (JSON.parse(s) as T) : def
    } catch {
      return def
    }
  })
  return [v, (x: T) => {
    setV(x)
    try {
      localStorage.setItem(key, JSON.stringify(x))
    } catch {
      /* ignore */
    }
  }]
}

export default function Evaluate() {
  const { cli, ws } = useApp()
  const { files, content } = useWorkspace(ws)
  const toast = useToast()
  const f = (name: string) => hasFlag(cli, 'eval', name)
  const [query, setQuery] = persisted(`studio.eval.query.${ws}`, 'data.app.rbac.allow')
  const inputFiles = files.filter((x) => x.kind === 'input' || /input.*\.json$/.test(x.path)).map((x) => x.path)
  const [inputFile, setInputFile] = useState('')
  const [input, setInput] = useState('')
  const [opts, setOpts] = persisted(`studio.eval.opts`, {
    format: 'json', explain: 'off', metrics: false, instrument: false, profile: false, profileSort: '', profileLimit: '',
    coverage: false, partial: false, unknowns: 'input', strict: false, strictBuiltinErrors: false, fail: false, failDefined: false,
    showBuiltinErrors: false, v0: false, v1: false, target: '', timeout: '', extra: '', useInput: true,
  })
  const [result, setResult] = useState<CliResult | null>(null)
  const [tab, setTab] = useState<OutTab>('result')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!inputFile && inputFiles.length) setInputFile(inputFiles[0])
  }, [inputFiles, inputFile])
  useEffect(() => {
    if (inputFile) setInput(content[inputFile] ?? '')
  }, [inputFile, content])

  const formats = flagChoices(cli, 'eval', 'format')
  const explains = flagChoices(cli, 'eval', 'explain')
  const targets = flagChoices(cli, 'eval', 'target')

  const args = useMemo(() => {
    const a = ['eval', ...loadArgs(cli, 'eval', files, '-d')]
    if (opts.useInput && inputFile && f('input')) a.push('-i', inputFile)
    if (f('format') && opts.format) a.push('--format', opts.format)
    if (f('explain') && opts.explain !== 'off') a.push('--explain', opts.explain)
    if (f('metrics') && opts.metrics) a.push('--metrics')
    if (f('instrument') && opts.instrument) a.push('--instrument')
    if (f('profile') && opts.profile) {
      a.push('--profile')
      if (opts.profileSort && f('profile-sort')) a.push('--profile-sort', opts.profileSort)
      if (opts.profileLimit && f('profile-limit')) a.push('--profile-limit', opts.profileLimit)
    }
    if (f('coverage') && opts.coverage) a.push('--coverage')
    if (f('partial') && opts.partial) {
      a.push('--partial')
      opts.unknowns.split(',').map((s) => s.trim()).filter(Boolean).forEach((u) => a.push('--unknowns', u))
    }
    if (f('strict') && opts.strict) a.push('--strict')
    if (f('strict-builtin-errors') && opts.strictBuiltinErrors) a.push('--strict-builtin-errors')
    if (f('show-builtin-errors') && opts.showBuiltinErrors) a.push('--show-builtin-errors')
    if (f('fail') && opts.fail) a.push('--fail')
    if (f('fail-defined') && opts.failDefined) a.push('--fail-defined')
    if (f('v0-compatible') && opts.v0) a.push('--v0-compatible')
    if (f('v1-compatible') && opts.v1) a.push('--v1-compatible')
    if (f('target') && opts.target) a.push('--target', opts.target)
    if (f('timeout') && opts.timeout) a.push('--timeout', opts.timeout)
    a.push(...shellSplit(opts.extra))
    a.push(query)
    return a
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cli, files, opts, inputFile, query])

  const run = async () => {
    setBusy(true)
    try {
      const overrides: Record<string, string> = {}
      if (inputFile) overrides[inputFile] = input
      const r = await api.cli({ args, workspace: ws, files: overrides })
      setResult(r)
      setTab('result')
    } catch (e) {
      toast((e as Error).message, 'err')
    } finally {
      setBusy(false)
    }
  }

  let parsed: Record<string, unknown> | undefined
  if (result && opts.format === 'json') {
    try {
      parsed = JSON.parse(result.stdout) as Record<string, unknown>
    } catch {
      parsed = undefined
    }
  }
  const values = (parsed?.result as { expressions?: { value: unknown; text: string }[]; bindings?: unknown }[] | undefined) ?? []

  return (
    <div className="page">
      <CommandPreview args={args} />
      <div className="split">
        <div className="stack">
          <Card title="Query" subtitle="Evaluated against every policy and data file of the active workspace. Ctrl/⌘+Enter runs." actions={<Button icon="play" variant="primary" onClick={() => void run()} disabled={busy}>Evaluate</Button>}>
            <Editor value={query} onChange={setQuery} language="rego" height={120} onSubmit={() => void run()} />
          </Card>
          {f('input') && (
            <Card
              title="Input"
              actions={
                <>
                  <Check label="use input" checked={opts.useInput} onChange={(v) => setOpts({ ...opts, useInput: v })} />
                  <select value={inputFile} onChange={(e) => setInputFile(e.target.value)}>
                    {inputFiles.map((p) => <option key={p}>{p}</option>)}
                    {!inputFiles.length && <option value="">no input*.json file</option>}
                  </select>
                </>
              }
            >
              <Editor value={input} onChange={setInput} language="json" height={180} onSubmit={() => void run()} />
              <p className="muted small" style={{ marginTop: 6 }}>Edits are used for this evaluation only; save them in Workspace.</p>
            </Card>
          )}
          <Card title="Options" subtitle={`Flags of opa eval in OPA ${cli?.opa.version}`}>
            <div className="stack">
              <div className="form-grid">
                {formats.length > 0 && (
                  <Field label="--format"><select value={opts.format} onChange={(e) => setOpts({ ...opts, format: e.target.value })}>{formats.map((x) => <option key={x}>{x}</option>)}</select></Field>
                )}
                {explains.length > 0 && (
                  <Field label="--explain"><select value={opts.explain} onChange={(e) => setOpts({ ...opts, explain: e.target.value })}><option>off</option>{explains.filter((x) => x !== 'off').map((x) => <option key={x}>{x}</option>)}</select></Field>
                )}
                {targets.length > 0 && (
                  <Field label="--target"><select value={opts.target} onChange={(e) => setOpts({ ...opts, target: e.target.value })}><option value="">default</option>{targets.map((x) => <option key={x}>{x}</option>)}</select></Field>
                )}
                {f('timeout') && <Field label="--timeout"><input value={opts.timeout} placeholder="e.g. 10s" onChange={(e) => setOpts({ ...opts, timeout: e.target.value })} /></Field>}
                {f('partial') && opts.partial && <Field label="--unknowns" hint="comma separated"><input className="mono" value={opts.unknowns} onChange={(e) => setOpts({ ...opts, unknowns: e.target.value })} /></Field>}
                {f('profile-sort') && opts.profile && <Field label="--profile-sort"><input value={opts.profileSort} placeholder="total_time_ns" onChange={(e) => setOpts({ ...opts, profileSort: e.target.value })} /></Field>}
                {f('profile-limit') && opts.profile && <Field label="--profile-limit"><input value={opts.profileLimit} placeholder="10" onChange={(e) => setOpts({ ...opts, profileLimit: e.target.value })} /></Field>}
              </div>
              <div className="row">
                {f('metrics') && <Check label="--metrics" checked={opts.metrics} onChange={(v) => setOpts({ ...opts, metrics: v })} />}
                {f('instrument') && <Check label="--instrument" checked={opts.instrument} onChange={(v) => setOpts({ ...opts, instrument: v })} />}
                {f('profile') && <Check label="--profile" checked={opts.profile} onChange={(v) => setOpts({ ...opts, profile: v })} />}
                {f('coverage') && <Check label="--coverage" checked={opts.coverage} onChange={(v) => setOpts({ ...opts, coverage: v })} />}
                {f('partial') && <Check label="--partial" checked={opts.partial} onChange={(v) => setOpts({ ...opts, partial: v })} />}
                {f('strict') && <Check label="--strict" checked={opts.strict} onChange={(v) => setOpts({ ...opts, strict: v })} />}
                {f('strict-builtin-errors') && <Check label="--strict-builtin-errors" checked={opts.strictBuiltinErrors} onChange={(v) => setOpts({ ...opts, strictBuiltinErrors: v })} />}
                {f('show-builtin-errors') && <Check label="--show-builtin-errors" checked={opts.showBuiltinErrors} onChange={(v) => setOpts({ ...opts, showBuiltinErrors: v })} />}
                {f('fail') && <Check label="--fail" checked={opts.fail} onChange={(v) => setOpts({ ...opts, fail: v })} />}
                {f('fail-defined') && <Check label="--fail-defined" checked={opts.failDefined} onChange={(v) => setOpts({ ...opts, failDefined: v })} />}
                {f('v0-compatible') && <Check label="--v0-compatible" checked={opts.v0} onChange={(v) => setOpts({ ...opts, v0: v })} />}
                {f('v1-compatible') && <Check label="--v1-compatible" checked={opts.v1} onChange={(v) => setOpts({ ...opts, v1: v })} />}
              </div>
              <Field label="Additional flags" hint="Anything else opa eval accepts, e.g. --schema schemas --capabilities caps.json">
                <input className="mono" value={opts.extra} onChange={(e) => setOpts({ ...opts, extra: e.target.value })} />
              </Field>
            </div>
          </Card>
        </div>
        <div className="stack">
          {result ? (
            <Card title="Output" flush>
              <Tabs
                tabs={[
                  { id: 'result', label: 'Result' },
                  { id: 'explanation', label: 'Explanation', hidden: !parsed?.explanation },
                  { id: 'metrics', label: 'Metrics', hidden: !parsed?.metrics },
                  { id: 'profile', label: 'Profile', hidden: !parsed?.profile },
                  { id: 'coverage', label: 'Coverage', hidden: !parsed?.coverage },
                  { id: 'partial', label: 'Partial', hidden: !parsed?.partial },
                  { id: 'raw', label: 'Raw' },
                ]}
                value={tab}
                onChange={setTab}
              />
              <div className="card-body">
                {tab === 'result' && (
                  parsed ? (
                    <div className="stack">
                      {parsed.errors !== undefined && <Alert kind="err"><pre>{JSON.stringify(parsed.errors, null, 2)}</pre></Alert>}
                      {!parsed.errors && values.length === 0 && !parsed.partial && <Alert kind="info">undefined — the query has no result.</Alert>}
                      {values.map((r, i) => (
                        <div key={i} className="stack">
                          {r.expressions?.map((e, j) => (
                            <div key={j} className="stack" style={{ gap: 4 }}>
                              <span className="mono small muted">{e.text}</span>
                              <JsonView value={e.value} open={3} />
                            </div>
                          ))}
                          {r.bindings !== undefined && <div><span className="muted small">bindings</span><JsonView value={r.bindings} /></div>}
                        </div>
                      ))}
                      <CliOutput result={result} hideStdout />
                    </div>
                  ) : (
                    <CliOutput result={result} />
                  )
                )}
                {tab === 'explanation' && <Explanation value={parsed?.explanation} />}
                {tab === 'metrics' && <MetricsTable metrics={parsed?.metrics as Record<string, unknown>} />}
                {tab === 'profile' && <JsonView value={parsed?.profile} open={3} />}
                {tab === 'coverage' && <JsonView value={parsed?.coverage} open={2} />}
                {tab === 'partial' && <JsonView value={parsed?.partial} open={4} />}
                {tab === 'raw' && <Code>{result.stdout + (result.stderr ? `\n--- stderr ---\n${result.stderr}` : '')}</Code>}
              </div>
            </Card>
          ) : (
            <Card><div className="empty">Run a query to see results.</div></Card>
          )}
        </div>
      </div>
    </div>
  )
}
