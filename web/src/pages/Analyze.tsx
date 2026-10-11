import { useEffect, useState } from 'react'
import { api } from '../api/client'
import type { CliResult } from '../api/types'
import { Button, Card, Check, CliOutput, CommandPreview, Field, JsonView, Tabs, useToast } from '../components/ui'
import { shellSplit } from '../lib/args'
import { flagChoices, hasCommand, hasFlag } from '../lib/features'
import { useApp, useWorkspace, loadArgs } from '../state/app'

export default function Analyze() {
  const { cli, ws } = useApp()
  const { files } = useWorkspace(ws)
  const toast = useToast()
  const [tab, setTab] = useState<'parse' | 'deps'>(hasCommand(cli, 'parse') ? 'parse' : 'deps')
  const regoFiles = files.filter((f) => f.path.endsWith('.rego')).map((f) => f.path)
  const [file, setFile] = useState('')
  const [format, setFormat] = useState('json')
  const [include, setInclude] = useState('')
  const [v0, setV0] = useState(false)
  const [query, setQuery] = useState('data.app.rbac.allow')
  const [depsFormat, setDepsFormat] = useState('json')
  const [extra, setExtra] = useState('')
  const [res, setRes] = useState<CliResult | null>(null)

  useEffect(() => {
    if (!file && regoFiles.length) setFile(regoFiles.find((p) => !p.endsWith('_test.rego')) ?? regoFiles[0])
  }, [regoFiles, file])

  const parseArgs = ['parse']
  if (hasFlag(cli, 'parse', 'format')) parseArgs.push('--format', format)
  if (include && hasFlag(cli, 'parse', 'json-include')) parseArgs.push('--json-include', include)
  if (v0 && hasFlag(cli, 'parse', 'v0-compatible')) parseArgs.push('--v0-compatible')
  parseArgs.push(...shellSplit(extra), file)

  const depsArgs = ['deps']
  if (hasFlag(cli, 'deps', 'format')) depsArgs.push('--format', depsFormat)
  depsArgs.push(...loadArgs(cli, 'deps', files, '-d', { tests: false }), ...shellSplit(extra), query)

  const args = tab === 'parse' ? parseArgs : depsArgs
  const run = async () => {
    try {
      setRes(await api.cli({ args, workspace: ws }))
    } catch (e) {
      toast((e as Error).message, 'err')
    }
  }
  let json: unknown
  if (res && ((tab === 'parse' && format === 'json') || (tab === 'deps' && depsFormat === 'json'))) {
    try {
      json = JSON.parse(res.stdout)
    } catch {
      json = undefined
    }
  }

  return (
    <div className="page">
      <Tabs tabs={[{ id: 'parse', label: 'opa parse — AST', hidden: !hasCommand(cli, 'parse') }, { id: 'deps', label: 'opa deps — dependencies', hidden: !hasCommand(cli, 'deps') }]} value={tab} onChange={(t) => { setTab(t); setRes(null) }} />
      <CommandPreview args={args} />
      <Card title={tab === 'parse' ? 'Parse a module' : 'Analyze query dependencies'} actions={<Button icon="play" variant="primary" onClick={() => void run()}>Run</Button>}>
        <div className="form-grid">
          {tab === 'parse' ? (
            <>
              <Field label="Module"><select value={file} onChange={(e) => setFile(e.target.value)}>{regoFiles.map((p) => <option key={p}>{p}</option>)}</select></Field>
              {hasFlag(cli, 'parse', 'format') && <Field label="--format"><select value={format} onChange={(e) => setFormat(e.target.value)}>{(flagChoices(cli, 'parse', 'format').length ? flagChoices(cli, 'parse', 'format') : ['json', 'pretty']).map((x) => <option key={x}>{x}</option>)}</select></Field>}
              {hasFlag(cli, 'parse', 'json-include') && <Field label="--json-include" hint="e.g. locations,comments or -locations"><input className="mono" value={include} onChange={(e) => setInclude(e.target.value)} /></Field>}
              {hasFlag(cli, 'parse', 'v0-compatible') && <Check label="--v0-compatible" checked={v0} onChange={setV0} />}
            </>
          ) : (
            <>
              <Field label="Query" style={{ gridColumn: 'span 2' }}><input className="mono" value={query} onChange={(e) => setQuery(e.target.value)} /></Field>
              {hasFlag(cli, 'deps', 'format') && <Field label="--format"><select value={depsFormat} onChange={(e) => setDepsFormat(e.target.value)}>{['json', 'pretty'].map((x) => <option key={x}>{x}</option>)}</select></Field>}
            </>
          )}
          <Field label="Additional flags"><input className="mono" value={extra} onChange={(e) => setExtra(e.target.value)} /></Field>
        </div>
      </Card>
      {res && (
        <Card title="Output">
          {json !== undefined ? <><JsonView value={json} open={tab === 'deps' ? 3 : 2} maxHeight={640} /><div style={{ marginTop: 10 }}><CliOutput result={res} hideStdout /></div></> : <CliOutput result={res} />}
        </Card>
      )}
    </div>
  )
}
