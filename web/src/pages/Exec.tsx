import { useEffect, useState } from 'react'
import { api } from '../api/client'
import type { CliResult } from '../api/types'
import { Editor } from '../components/Editor'
import { Button, Card, Check, CliOutput, CommandPreview, Field, JsonView, useToast } from '../components/ui'
import { shellSplit } from '../lib/args'
import { hasFlag } from '../lib/features'
import { useApp, useWorkspace } from '../state/app'

/**
 * opa exec evaluates a decision against input files using the full OPA
 * runtime (bundles, config, plugins) without starting a server.
 */
export default function Exec() {
  const { cli, ws } = useApp()
  const { files } = useWorkspace(ws)
  const toast = useToast()
  const f = (n: string) => hasFlag(cli, 'exec', n)
  const inputs = files.filter((x) => /(^|\/)input.*\.json$/.test(x.path) || x.path.startsWith('inputs/')).map((x) => x.path)
  const [decision, setDecision] = useState('app/rbac/allow')
  const [selected, setSelected] = useState<string[]>([])
  const [config, setConfig] = useState('')
  const [opts, setOpts] = useState({ fail: false, failDefined: false, failNonEmpty: false, timeout: '', logLevel: '', v0: false, set: '', extra: '' })
  const [res, setRes] = useState<CliResult | null>(null)

  useEffect(() => {
    if (!selected.length && inputs.length) setSelected(inputs)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputs.join(',')])

  const args = ['exec', '--decision', decision, '--bundle', '.']
  if (config.trim() && f('config-file')) args.push('--config-file', 'studio-exec-config.conf')
  if (opts.fail && f('fail')) args.push('--fail')
  if (opts.failDefined && f('fail-defined')) args.push('--fail-defined')
  if (opts.failNonEmpty && f('fail-non-empty')) args.push('--fail-non-empty')
  if (opts.timeout && f('timeout')) args.push('--timeout', opts.timeout)
  if (opts.logLevel && f('log-level')) args.push('--log-level', opts.logLevel)
  if (opts.v0 && f('v0-compatible')) args.push('--v0-compatible')
  opts.set.split(',').map((s) => s.trim()).filter(Boolean).forEach((s) => args.push('--set', s))
  args.push(...shellSplit(opts.extra), ...selected)

  const run = async () => {
    try {
      const extraFiles: Record<string, string> = {}
      if (config.trim()) extraFiles['studio-exec-config.conf'] = config
      setRes(await api.cli({ args, workspace: ws, files: extraFiles }))
    } catch (e) {
      toast((e as Error).message, 'err')
    }
  }
  let json: unknown
  if (res) {
    try {
      json = JSON.parse(res.stdout)
    } catch {
      json = undefined
    }
  }
  return (
    <div className="page">
      <CommandPreview args={args} />
      <div className="split">
        <Card title="Decision" subtitle="The workspace is loaded as a bundle; each selected input file is evaluated." actions={<Button icon="play" variant="primary" onClick={() => void run()}>Execute</Button>}>
          <div className="stack">
            <Field label="--decision" hint="Slash separated path below data, e.g. app/rbac/allow"><input className="mono" value={decision} onChange={(e) => setDecision(e.target.value)} /></Field>
            <Field label="Input files">
              <div className="stack" style={{ gap: 4 }}>
                {inputs.map((p) => (
                  <Check key={p} label={<span className="mono small">{p}</span>} checked={selected.includes(p)} onChange={(v) => setSelected(v ? [...selected, p] : selected.filter((x) => x !== p))} />
                ))}
                {!inputs.length && <span className="muted small">Add input*.json files (or an inputs/ folder) to the workspace.</span>}
              </div>
            </Field>
            <div className="row">
              {f('fail') && <Check label="--fail" checked={opts.fail} onChange={(v) => setOpts({ ...opts, fail: v })} />}
              {f('fail-defined') && <Check label="--fail-defined" checked={opts.failDefined} onChange={(v) => setOpts({ ...opts, failDefined: v })} />}
              {f('fail-non-empty') && <Check label="--fail-non-empty" checked={opts.failNonEmpty} onChange={(v) => setOpts({ ...opts, failNonEmpty: v })} />}
              {f('v0-compatible') && <Check label="--v0-compatible" checked={opts.v0} onChange={(v) => setOpts({ ...opts, v0: v })} />}
            </div>
            <div className="form-grid">
              {f('timeout') && <Field label="--timeout"><input value={opts.timeout} onChange={(e) => setOpts({ ...opts, timeout: e.target.value })} placeholder="0s" /></Field>}
              {f('log-level') && <Field label="--log-level"><select value={opts.logLevel} onChange={(e) => setOpts({ ...opts, logLevel: e.target.value })}><option value="">default</option>{['debug', 'info', 'warn', 'error'].map((x) => <option key={x}>{x}</option>)}</select></Field>}
              {f('set') && <Field label="--set" hint="comma separated key=value config overrides"><input className="mono" value={opts.set} onChange={(e) => setOpts({ ...opts, set: e.target.value })} /></Field>}
              <Field label="Additional flags"><input className="mono" value={opts.extra} onChange={(e) => setOpts({ ...opts, extra: e.target.value })} /></Field>
            </div>
          </div>
        </Card>
        <div className="stack">
          {f('config-file') && (
            <Card title="Runtime configuration (optional)" subtitle="Passed with --config-file: services, bundles, decision_logs, …">
              <Editor value={config} onChange={setConfig} language="yaml" height={200} placeholder="decision_logs:\n  console: true" />
            </Card>
          )}
          {res && <Card title="Results">{json !== undefined ? <><JsonView value={json} open={4} /><div style={{ marginTop: 10 }}><CliOutput result={res} hideStdout /></div></> : <CliOutput result={res} />}</Card>}
        </div>
      </div>
    </div>
  )
}
