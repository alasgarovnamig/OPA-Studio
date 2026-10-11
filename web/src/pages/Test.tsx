import { useMemo, useState } from 'react'
import { api } from '../api/client'
import type { CliResult } from '../api/types'
import { Alert, Badge, Button, Card, Check, CliOutput, CommandPreview, Field, Stat, Tabs, useToast } from '../components/ui'
import { shellSplit } from '../lib/args'
import { flagChoices, hasFlag } from '../lib/features'
import { nanos } from '../lib/format'
import { useApp, useWorkspace, loadArgs } from '../state/app'

interface TestResult {
  location?: { file: string; row: number }
  package?: string
  name: string
  fail?: boolean
  skip?: boolean
  error?: { code?: string; message?: string } | string
  duration?: number
  output?: string
  trace?: unknown
}

interface Coverage {
  files?: Record<string, { covered?: { start: { row: number }; end: { row: number } }[]; not_covered?: { start: { row: number }; end: { row: number } }[]; coverage?: number }>
  coverage?: number
}

export default function TestPage() {
  const { cli, ws } = useApp()
  const { files } = useWorkspace(ws)
  const toast = useToast()
  const f = (n: string) => hasFlag(cli, 'test', n)
  const [opts, setOpts] = useState({ verbose: true, coverage: false, threshold: '', run: '', explain: '', bench: false, count: '', timeout: '', parallel: '', failOnEmpty: false, varValues: false, v0: false, v1: false, extra: '' })
  const [res, setRes] = useState<CliResult | null>(null)
  const [tab, setTab] = useState<'results' | 'coverage' | 'output'>('results')
  const [busy, setBusy] = useState(false)
  const json = f('format') && !opts.bench

  const args = useMemo(() => {
    const a = ['test']
    if (json) a.push('--format', 'json')
    else if (opts.verbose && f('verbose')) a.push('-v')
    if (opts.coverage && f('coverage')) {
      a.push('--coverage')
      if (opts.threshold && f('threshold')) a.push('--threshold', opts.threshold)
    }
    if (opts.run && f('run')) a.push('--run', opts.run)
    if (opts.explain && f('explain')) a.push('--explain', opts.explain)
    if (opts.bench && f('bench')) a.push('--bench')
    if (opts.count && f('count')) a.push('--count', opts.count)
    if (opts.timeout && f('timeout')) a.push('--timeout', opts.timeout)
    if (opts.parallel && f('parallel')) a.push('--parallel', opts.parallel)
    if (opts.failOnEmpty && f('fail-on-empty')) a.push('--fail-on-empty')
    if (opts.varValues && f('var-values')) a.push('--var-values')
    if (opts.v0 && f('v0-compatible')) a.push('--v0-compatible')
    if (opts.v1 && f('v1-compatible')) a.push('--v1-compatible')
    a.push(...shellSplit(opts.extra))
    a.push(...loadArgs(cli, 'test', files, ''))
    return a
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts, files, cli, json])

  const run = async () => {
    setBusy(true)
    try {
      setRes(await api.cli({ args, workspace: ws }))
      setTab(opts.coverage ? 'coverage' : 'results')
    } catch (e) {
      toast((e as Error).message, 'err')
    } finally {
      setBusy(false)
    }
  }

  let results: TestResult[] = []
  let coverage: Coverage | null = null
  if (res && json) {
    try {
      const j = JSON.parse(res.stdout) as unknown
      if (Array.isArray(j)) results = j as TestResult[]
      else if (j && typeof j === 'object' && 'files' in (j as object)) coverage = j as Coverage
    } catch {
      /* not json */
    }
  }
  const passed = results.filter((r) => !r.fail && !r.error && !r.skip).length
  const failed = results.filter((r) => r.fail || r.error).length
  const skipped = results.filter((r) => r.skip).length
  const explains = flagChoices(cli, 'test', 'explain')

  return (
    <div className="page">
      <CommandPreview args={args} />
      <Card title="Run tests" subtitle="Rules starting with test_ in every loaded module; todo_ rules are skipped." actions={<Button icon="play" variant="primary" disabled={busy} onClick={() => void run()}>Run tests</Button>}>
        <div className="stack">
          <div className="row">
            {f('verbose') && <Check label="--verbose" checked={opts.verbose} onChange={(v) => setOpts({ ...opts, verbose: v })} />}
            {f('coverage') && <Check label="--coverage" checked={opts.coverage} onChange={(v) => setOpts({ ...opts, coverage: v })} />}
            {f('bench') && <Check label="--bench" checked={opts.bench} onChange={(v) => setOpts({ ...opts, bench: v })} />}
            {f('fail-on-empty') && <Check label="--fail-on-empty" checked={opts.failOnEmpty} onChange={(v) => setOpts({ ...opts, failOnEmpty: v })} />}
            {f('var-values') && <Check label="--var-values" checked={opts.varValues} onChange={(v) => setOpts({ ...opts, varValues: v })} />}
            {f('v0-compatible') && <Check label="--v0-compatible" checked={opts.v0} onChange={(v) => setOpts({ ...opts, v0: v })} />}
            {f('v1-compatible') && <Check label="--v1-compatible" checked={opts.v1} onChange={(v) => setOpts({ ...opts, v1: v })} />}
          </div>
          <div className="form-grid">
            {f('run') && <Field label="--run (regex)"><input className="mono" value={opts.run} onChange={(e) => setOpts({ ...opts, run: e.target.value })} placeholder="test_admin.*" /></Field>}
            {f('threshold') && opts.coverage && <Field label="--threshold (%)"><input value={opts.threshold} onChange={(e) => setOpts({ ...opts, threshold: e.target.value })} /></Field>}
            {explains.length > 0 && <Field label="--explain"><select value={opts.explain} onChange={(e) => setOpts({ ...opts, explain: e.target.value })}><option value="">default</option>{explains.map((x) => <option key={x}>{x}</option>)}</select></Field>}
            {f('count') && <Field label="--count"><input value={opts.count} onChange={(e) => setOpts({ ...opts, count: e.target.value })} placeholder="1" /></Field>}
            {f('timeout') && <Field label="--timeout"><input value={opts.timeout} onChange={(e) => setOpts({ ...opts, timeout: e.target.value })} placeholder="5s" /></Field>}
            {f('parallel') && <Field label="--parallel"><input value={opts.parallel} onChange={(e) => setOpts({ ...opts, parallel: e.target.value })} placeholder="CPU count" /></Field>}
          </div>
          <Field label="Additional flags"><input className="mono" value={opts.extra} onChange={(e) => setOpts({ ...opts, extra: e.target.value })} /></Field>
        </div>
      </Card>

      {res && (
        <>
          {results.length > 0 && (
            <div className="grid cols-4">
              <Stat label="Tests" value={results.length} />
              <Stat label="Passed" value={<span style={{ color: 'var(--ok)' }}>{passed}</span>} />
              <Stat label="Failed / errors" value={<span style={{ color: failed ? 'var(--err)' : undefined }}>{failed}</span>} />
              <Stat label="Skipped" value={skipped} />
            </div>
          )}
          <Card flush>
            <Tabs
              tabs={[
                { id: 'results', label: 'Results', hidden: !results.length },
                { id: 'coverage', label: `Coverage${coverage?.coverage !== undefined ? ` ${coverage.coverage.toFixed(1)}%` : ''}`, hidden: !coverage },
                { id: 'output', label: 'Output' },
              ]}
              value={results.length || coverage ? tab : 'output'}
              onChange={setTab}
            />
            <div className="card-body">
              {(tab === 'results' && results.length > 0) && (
                <table className="table">
                  <thead><tr><th>Result</th><th>Test</th><th>Location</th><th>Duration</th></tr></thead>
                  <tbody>
                    {results.map((r, i) => (
                      <tr key={i}>
                        <td>{r.skip ? <Badge>SKIP</Badge> : r.error ? <Badge kind="err">ERROR</Badge> : r.fail ? <Badge kind="err">FAIL</Badge> : <Badge kind="ok">PASS</Badge>}</td>
                        <td className="mono small">{r.package}.{r.name}{r.error && <div style={{ color: 'var(--err)' }}>{typeof r.error === 'string' ? r.error : r.error.message}</div>}{r.output && <pre className="code" style={{ marginTop: 4 }}>{r.output}</pre>}</td>
                        <td className="mono small">{r.location ? `${r.location.file}:${r.location.row}` : ''}</td>
                        <td className="muted">{r.duration !== undefined ? nanos(r.duration) : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {tab === 'coverage' && coverage && (
                <table className="table">
                  <thead><tr><th>File</th><th>Coverage</th><th>Not covered lines</th></tr></thead>
                  <tbody>
                    {Object.entries(coverage.files ?? {}).map(([file, c]) => (
                      <tr key={file}>
                        <td className="mono small">{file}</td>
                        <td><Badge kind={(c.coverage ?? 0) >= 80 ? 'ok' : (c.coverage ?? 0) >= 50 ? 'warn' : 'err'}>{(c.coverage ?? 0).toFixed(1)}%</Badge></td>
                        <td className="mono small">{(c.not_covered ?? []).map((r) => (r.start.row === r.end.row ? r.start.row : `${r.start.row}-${r.end.row}`)).join(', ') || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {(tab === 'output' || (!results.length && !coverage)) && <CliOutput result={res} />}
              {res.exitCode !== 0 && !results.length && !coverage && <Alert kind="err">Tests failed or could not run (exit {res.exitCode}).</Alert>}
            </div>
          </Card>
        </>
      )}
    </div>
  )
}
