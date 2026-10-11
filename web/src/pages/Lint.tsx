import { useMemo, useState } from 'react'
import { api } from '../api/client'
import type { CliResult } from '../api/types'
import { Alert, Badge, Button, Card, Check, CliOutput, CommandPreview, Field, Tabs, useToast } from '../components/ui'
import { shellSplit } from '../lib/args'
import { hasCommand, hasFlag } from '../lib/features'
import { useApp, useWorkspace, loadArgs } from '../state/app'

interface CheckError {
  code: string
  message: string
  location?: { file: string; row: number; col: number }
  details?: { line?: string; idx?: number }
}

function Diff({ text }: { text: string }) {
  return (
    <pre className="code">
      {text.split('\n').map((l, i) => (
        <div key={i} className={l.startsWith('+') && !l.startsWith('+++') ? 'diff-add' : l.startsWith('-') && !l.startsWith('---') ? 'diff-del' : l.startsWith('@@') ? 'diff-hunk' : ''}>{l || ' '}</div>
      ))}
    </pre>
  )
}

export default function Lint() {
  const { cli, ws, readOnly } = useApp()
  const { files, reload } = useWorkspace(ws)
  const toast = useToast()
  const [tab, setTab] = useState<'check' | 'fmt'>(hasCommand(cli, 'check') ? 'check' : 'fmt')
  const c = (n: string) => hasFlag(cli, 'check', n)
  const fm = (n: string) => hasFlag(cli, 'fmt', n)
  const [copts, setCopts] = useState({ strict: false, maxErrors: '', schema: '', capabilities: '', v0: false, v1: false, regoV1: false, bundle: false, extra: '' })
  const [fopts, setFopts] = useState({ regoV1: false, v0: false, v0v1: false, v1: false, dropV0Imports: false, extra: '' })
  const [res, setRes] = useState<CliResult | null>(null)
  const [busy, setBusy] = useState(false)

  const regoFiles = files.filter((f) => f.path.endsWith('.rego')).map((f) => f.path)

  const checkArgs = useMemo(() => {
    const a = ['check']
    if (c('format')) a.push('--format', 'json')
    if (copts.strict && c('strict')) a.push('--strict')
    if (copts.maxErrors && c('max-errors')) a.push('--max-errors', copts.maxErrors)
    if (copts.schema && c('schema')) a.push('--schema', copts.schema)
    if (copts.capabilities && c('capabilities')) a.push('--capabilities', copts.capabilities)
    if (copts.v0 && c('v0-compatible')) a.push('--v0-compatible')
    if (copts.v1 && c('v1-compatible')) a.push('--v1-compatible')
    if (copts.regoV1 && c('rego-v1')) a.push('--rego-v1')
    if (copts.bundle && c('bundle')) a.push('--bundle')
    a.push(...shellSplit(copts.extra))
    a.push(...loadArgs(cli, 'check', files, ''))
    return a
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [copts, files, cli])

  const fmtArgs = (mode: 'diff' | 'list' | 'write') => {
    const a = ['fmt']
    if (mode === 'diff' && fm('diff')) a.push('--diff')
    if (mode === 'list' && fm('list')) a.push('--list')
    if (mode === 'write' && fm('write')) a.push('--write')
    if (fopts.regoV1 && fm('rego-v1')) a.push('--rego-v1')
    if (fopts.v0 && fm('v0-compatible')) a.push('--v0-compatible')
    if (fopts.v0v1 && fm('v0-v1')) a.push('--v0-v1')
    if (fopts.v1 && fm('v1-compatible')) a.push('--v1-compatible')
    if (fopts.dropV0Imports && fm('drop-v0-imports')) a.push('--drop-v0-imports')
    a.push(...shellSplit(fopts.extra))
    a.push(...regoFiles)
    return a
  }

  const run = async (args: string[], writeBack = false) => {
    setBusy(true)
    try {
      const r = await api.cli({ args, workspace: ws, writeBack })
      setRes(r)
      if (writeBack) {
        const n = Object.keys(r.changed ?? {}).length
        toast(n ? `Formatted ${n} file(s)` : 'Already formatted', 'ok')
        void reload()
      }
    } catch (e) {
      toast((e as Error).message, 'err')
    } finally {
      setBusy(false)
    }
  }

  // Releases without `opa fmt --write` print the formatted module; save it per file.
  const formatEach = async () => {
    setBusy(true)
    let changed = 0
    try {
      for (const p of regoFiles) {
        const r = await api.cli({ args: ['fmt', p], workspace: ws })
        setRes(r)
        if (r.exitCode !== 0) break
        const cur = await api.readFile(ws, p)
        if (r.stdout && r.stdout !== cur) {
          await api.writeFile(ws, p, r.stdout)
          changed++
        }
      }
      toast(changed ? `Formatted ${changed} file(s)` : 'Already formatted', 'ok')
      void reload()
    } finally {
      setBusy(false)
    }
  }

  let errors: CheckError[] | null = null
  if (res && res.command[1] === 'check') {
    try {
      const j = JSON.parse(res.stdout || res.stderr || '{}') as { errors?: CheckError[] }
      errors = j.errors ?? []
    } catch {
      errors = null
    }
  }

  return (
    <div className="page">
      <Tabs tabs={[{ id: 'check', label: 'opa check', hidden: !hasCommand(cli, 'check') }, { id: 'fmt', label: 'opa fmt', hidden: !hasCommand(cli, 'fmt') }]} value={tab} onChange={(t) => { setTab(t); setRes(null) }} />
      {tab === 'check' ? (
        <>
          <CommandPreview args={checkArgs} />
          <Card title="Compile check" subtitle="Parses and compiles every module: syntax, safety, type and conflict errors." actions={<Button icon="check" variant="primary" disabled={busy} onClick={() => void run(checkArgs)}>Check</Button>}>
            <div className="stack">
              <div className="row">
                {c('strict') && <Check label="--strict (unused imports/vars, deprecated built-ins, …)" checked={copts.strict} onChange={(v) => setCopts({ ...copts, strict: v })} />}
                {c('rego-v1') && <Check label="--rego-v1 (check Rego v1 compatibility)" checked={copts.regoV1} onChange={(v) => setCopts({ ...copts, regoV1: v })} />}
                {c('v0-compatible') && <Check label="--v0-compatible" checked={copts.v0} onChange={(v) => setCopts({ ...copts, v0: v })} />}
                {c('v1-compatible') && <Check label="--v1-compatible" checked={copts.v1} onChange={(v) => setCopts({ ...copts, v1: v })} />}
                {c('bundle') && <Check label="--bundle" checked={copts.bundle} onChange={(v) => setCopts({ ...copts, bundle: v })} />}
              </div>
              <div className="form-grid">
                {c('max-errors') && <Field label="--max-errors"><input value={copts.maxErrors} onChange={(e) => setCopts({ ...copts, maxErrors: e.target.value })} placeholder="10" /></Field>}
                {c('schema') && <Field label="--schema" hint="schema file or directory in the workspace"><input className="mono" value={copts.schema} onChange={(e) => setCopts({ ...copts, schema: e.target.value })} /></Field>}
                {c('capabilities') && <Field label="--capabilities" hint="capabilities JSON file or version, e.g. v0.60.0"><input className="mono" value={copts.capabilities} onChange={(e) => setCopts({ ...copts, capabilities: e.target.value })} /></Field>}
              </div>
              <Field label="Additional flags"><input className="mono" value={copts.extra} onChange={(e) => setCopts({ ...copts, extra: e.target.value })} /></Field>
            </div>
          </Card>
          {res && errors && (
            errors.length === 0 && res.exitCode === 0 ? (
              <Alert kind="ok" title="No errors">All modules compiled successfully.</Alert>
            ) : (
              <Card title={`${errors.length} error(s)`} flush>
                <table className="table">
                  <thead><tr><th>Code</th><th>Location</th><th>Message</th></tr></thead>
                  <tbody>
                    {errors.map((e, i) => (
                      <tr key={i}>
                        <td><Badge kind="err">{e.code}</Badge></td>
                        <td className="mono small">{e.location ? `${e.location.file}:${e.location.row}:${e.location.col}` : ''}</td>
                        <td>{e.message}{e.details?.line && <pre className="code" style={{ marginTop: 4 }}>{e.details.line}</pre>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            )
          )}
          {res && !errors && <Card title="Output"><CliOutput result={res} /></Card>}
        </>
      ) : (
        <>
          <CommandPreview args={fmtArgs('diff')} />
          <Card
            title="Format"
            subtitle={`${regoFiles.length} Rego file(s) in the workspace`}
            actions={
              <>
                {fm('list') && <Button disabled={busy} onClick={() => void run(fmtArgs('list'))}>List unformatted</Button>}
                {fm('diff') && <Button disabled={busy} onClick={() => void run(fmtArgs('diff'))}>Show diff</Button>}
                <Button icon="format" variant="primary" disabled={busy || readOnly} onClick={() => void (fm('write') ? run(fmtArgs('write'), true) : formatEach())}>Format &amp; save</Button>
              </>
            }
          >
            <div className="stack">
              <div className="row">
                {fm('rego-v1') && <Check label="--rego-v1 (rewrite to Rego v1 compatible syntax)" checked={fopts.regoV1} onChange={(v) => setFopts({ ...fopts, regoV1: v })} />}
                {fm('v0-v1') && <Check label="--v0-v1 (format v0 sources as v1)" checked={fopts.v0v1} onChange={(v) => setFopts({ ...fopts, v0v1: v })} />}
                {fm('v0-compatible') && <Check label="--v0-compatible" checked={fopts.v0} onChange={(v) => setFopts({ ...fopts, v0: v })} />}
                {fm('v1-compatible') && <Check label="--v1-compatible" checked={fopts.v1} onChange={(v) => setFopts({ ...fopts, v1: v })} />}
                {fm('drop-v0-imports') && <Check label="--drop-v0-imports" checked={fopts.dropV0Imports} onChange={(v) => setFopts({ ...fopts, dropV0Imports: v })} />}
              </div>
              <Field label="Additional flags"><input className="mono" value={fopts.extra} onChange={(e) => setFopts({ ...fopts, extra: e.target.value })} /></Field>
            </div>
          </Card>
          {res && (
            <Card title={<span className="mono">{res.command.slice(0, 3).join(' ')}</span>}>
              {res.command.includes('--diff') && res.stdout ? <Diff text={res.stdout} /> : <CliOutput result={res} />}
              {res.command.includes('--diff') && !res.stdout && res.exitCode === 0 && <Alert kind="ok">All files are formatted.</Alert>}
            </Card>
          )}
        </>
      )}
    </div>
  )
}
