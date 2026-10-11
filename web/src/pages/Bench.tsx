import { useState } from 'react'
import { api } from '../api/client'
import type { CliResult } from '../api/types'
import { Editor } from '../components/Editor'
import { Button, Card, Check, CliOutput, CommandPreview, Field, JsonView, useToast } from '../components/ui'
import { shellSplit } from '../lib/args'
import { flagChoices, hasFlag } from '../lib/features'
import { useApp, useWorkspace, loadArgs } from '../state/app'

export default function Bench() {
  const { cli, ws } = useApp()
  const { files } = useWorkspace(ws)
  const toast = useToast()
  const f = (n: string) => hasFlag(cli, 'bench', n)
  const [query, setQuery] = useState('data.app.rbac.allow')
  const inputFile = files.find((x) => /(^|\/)input.*\.json$/.test(x.path))?.path
  const [opts, setOpts] = useState({ count: '1', benchmem: true, metrics: true, format: 'json', partial: false, unknowns: 'input', e2e: false, useInput: true, extra: '' })
  const [res, setRes] = useState<CliResult | null>(null)
  const [busy, setBusy] = useState(false)

  const args = ['bench', ...loadArgs(cli, 'bench', files, '-d', { tests: false })]
  if (inputFile && opts.useInput && f('input')) args.push('-i', inputFile)
  if (f('count') && opts.count) args.push('--count', opts.count)
  if (f('benchmem') && opts.benchmem) args.push('--benchmem')
  if (f('metrics') && opts.metrics) args.push('--metrics')
  if (f('format') && opts.format) args.push('--format', opts.format)
  if (f('partial') && opts.partial) {
    args.push('--partial')
    opts.unknowns.split(',').map((s) => s.trim()).filter(Boolean).forEach((u) => args.push('--unknowns', u))
  }
  if (f('e2e') && opts.e2e) args.push('--e2e')
  args.push(...shellSplit(opts.extra), query)

  const run = async () => {
    setBusy(true)
    try {
      setRes(await api.cli({ args, workspace: ws, timeoutSeconds: 300 }))
    } catch (e) {
      toast((e as Error).message, 'err')
    } finally {
      setBusy(false)
    }
  }
  let json: unknown
  if (res && opts.format === 'json') {
    try {
      json = JSON.parse(res.stdout)
    } catch {
      json = undefined
    }
  }
  const formats = flagChoices(cli, 'bench', 'format')
  return (
    <div className="page">
      <CommandPreview args={args} />
      <Card title="Benchmark" subtitle="Runs the query repeatedly (Go testing.B) and reports ns/op, allocations and evaluation metrics." actions={<Button icon="play" variant="primary" disabled={busy} onClick={() => void run()}>{busy ? 'Running…' : 'Run benchmark'}</Button>}>
        <div className="stack">
          <Editor value={query} onChange={setQuery} language="rego" height={90} onSubmit={() => void run()} />
          <div className="row">
            {f('benchmem') && <Check label="--benchmem" checked={opts.benchmem} onChange={(v) => setOpts({ ...opts, benchmem: v })} />}
            {f('metrics') && <Check label="--metrics" checked={opts.metrics} onChange={(v) => setOpts({ ...opts, metrics: v })} />}
            {f('partial') && <Check label="--partial" checked={opts.partial} onChange={(v) => setOpts({ ...opts, partial: v })} />}
            {f('e2e') && <Check label="--e2e (through the HTTP server)" checked={opts.e2e} onChange={(v) => setOpts({ ...opts, e2e: v })} />}
            {inputFile && f('input') && <Check label={`-i ${inputFile}`} checked={opts.useInput} onChange={(v) => setOpts({ ...opts, useInput: v })} />}
          </div>
          <div className="form-grid">
            {f('count') && <Field label="--count"><input value={opts.count} onChange={(e) => setOpts({ ...opts, count: e.target.value })} /></Field>}
            {formats.length > 0 && <Field label="--format"><select value={opts.format} onChange={(e) => setOpts({ ...opts, format: e.target.value })}>{formats.map((x) => <option key={x}>{x}</option>)}</select></Field>}
            {opts.partial && <Field label="--unknowns"><input className="mono" value={opts.unknowns} onChange={(e) => setOpts({ ...opts, unknowns: e.target.value })} /></Field>}
            <Field label="Additional flags"><input className="mono" value={opts.extra} onChange={(e) => setOpts({ ...opts, extra: e.target.value })} /></Field>
          </div>
        </div>
      </Card>
      {res && <Card title="Results">{json !== undefined ? <><JsonView value={json} open={3} /><div style={{ marginTop: 10 }}><CliOutput result={res} hideStdout /></div></> : <CliOutput result={res} />}</Card>}
    </div>
  )
}
