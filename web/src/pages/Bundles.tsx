import { useRef, useState } from 'react'
import { api } from '../api/client'
import type { BundleSummary, CliResult } from '../api/types'
import { Alert, Badge, Button, Card, Check, CliOutput, CommandPreview, Field, JsonView, Tabs, useToast } from '../components/ui'
import { shellSplit } from '../lib/args'
import { flagChoices, hasCommand, hasFlag } from '../lib/features'
import { base64ToBytes, bytes, download, fileToBase64 } from '../lib/format'
import { useApp, useWorkspace, loadArgs } from '../state/app'

type Tab = 'build' | 'inspect' | 'sign' | 'verify'

function Summary({ s }: { s: BundleSummary }) {
  return (
    <div className="stack">
      <div className="row small">
        <Badge>{bytes(s.size)}</Badge>
        <span className="mono muted">sha256 {s.sha256.slice(0, 16)}…</span>
        {s.signatures ? <Badge kind="ok">signed</Badge> : <Badge>unsigned</Badge>}
      </div>
      <table className="table">
        <thead><tr><th>Path</th><th>Kind</th><th>Size</th></tr></thead>
        <tbody>
          {s.entries.map((e) => (
            <tr key={e.path}><td className="mono small">{e.path}</td><td><Badge>{e.kind}</Badge></td><td className="muted">{bytes(e.size)}</td></tr>
          ))}
        </tbody>
      </table>
      {s.manifest !== undefined && <div><strong className="small">.manifest</strong><JsonView value={s.manifest} open={3} /></div>}
      {s.signatures !== undefined && <div><strong className="small">.signatures.json</strong><JsonView value={s.signatures} open={3} /></div>}
    </div>
  )
}

export default function Bundles() {
  const { cli, ws, readOnly, info } = useApp()
  const { files } = useWorkspace(ws)
  const toast = useToast()
  const hasBuild = hasCommand(cli, 'build')
  const [tab, setTab] = useState<Tab>(hasBuild ? 'build' : 'inspect')
  const b = (n: string) => hasFlag(cli, 'build', n)
  const [build, setBuild] = useState({ bundleMode: true, target: '', entrypoints: '', optimize: '', revision: '', signKey: '', signAlg: '', claims: '', scope: '', v0: false, v1: false, capabilities: '', excludeVerify: '', extra: '', name: 'app' })
  const [res, setRes] = useState<CliResult | null>(null)
  const [archive, setArchive] = useState<{ name: string; b64: string } | null>(null)
  const [summary, setSummary] = useState<BundleSummary | null>(null)
  const [inspectRes, setInspectRes] = useState<CliResult | null>(null)
  const [annotations, setAnnotations] = useState(false)
  const [key, setKey] = useState('')
  const [alg, setAlg] = useState('RS256')
  const [claims, setClaims] = useState('')
  const [signTarget, setSignTarget] = useState<'workspace' | 'archive'>('workspace')
  const fileRef = useRef<HTMLInputElement>(null)

  const keyFiles = (): Record<string, string> => {
    const out: Record<string, string> = {}
    if (key.trim()) out['studio-key.pem'] = key
    if (claims.trim()) out['studio-claims.json'] = claims
    return out
  }

  // ---- build -----------------------------------------------------------------------
  const targets = flagChoices(cli, 'build', 'target')
  const buildArgs = ['build']
  if (b('output')) buildArgs.push('-o', 'bundle.tar.gz')
  if (build.bundleMode && b('bundle')) buildArgs.push('--bundle')
  if (build.target && b('target')) buildArgs.push('--target', build.target)
  build.entrypoints.split(',').map((s) => s.trim()).filter(Boolean).forEach((e) => buildArgs.push('--entrypoint', e))
  if (build.optimize && b('optimize')) buildArgs.push('--optimize', build.optimize)
  if (build.revision && b('revision')) buildArgs.push('--revision', build.revision)
  if (key.trim() && b('signing-key')) {
    buildArgs.push('--signing-key', 'studio-key.pem')
    if (alg && b('signing-alg')) buildArgs.push('--signing-alg', alg)
    if (claims.trim() && b('claims-file')) buildArgs.push('--claims-file', 'studio-claims.json')
    if (build.scope && b('scope')) buildArgs.push('--scope', build.scope)
  }
  if (build.capabilities && b('capabilities')) buildArgs.push('--capabilities', build.capabilities)
  if (build.v0 && b('v0-compatible')) buildArgs.push('--v0-compatible')
  if (build.v1 && b('v1-compatible')) buildArgs.push('--v1-compatible')
  buildArgs.push(...shellSplit(build.extra))
  if (build.bundleMode && b('bundle') && b('ignore')) buildArgs.push('--ignore', 'input*.json', '--ignore', 'studio-*', '.')
  else buildArgs.push(...loadArgs(cli, 'build', files, '', { tests: false }))

  const runBuild = async () => {
    try {
      const r = await api.cli({ args: buildArgs, workspace: ws, files: keyFiles(), collect: ['bundle.tar.gz', '*.wasm'] })
      setRes(r)
      const out = r.files?.['bundle.tar.gz']
      if (out?.base64) {
        setArchive({ name: `${build.name || 'bundle'}.tar.gz`, b64: out.base64 })
        setSummary(await api.inspectArchive(new Blob([base64ToBytes(out.base64)])))
      }
    } catch (e) {
      toast((e as Error).message, 'err')
    }
  }

  const publish = async () => {
    if (!archive) return
    try {
      const m = await api.cpPublishArchive(build.name || 'app', new Blob([base64ToBytes(archive.b64)]))
      toast(`Published bundle "${m.name}" to the control plane`, 'ok')
    } catch (e) {
      toast((e as Error).message, 'err')
    }
  }

  // ---- inspect ---------------------------------------------------------------------
  const inspectArgs = ['inspect', '--format', 'json', ...(annotations && hasFlag(cli, 'inspect', 'annotations') ? ['--annotations'] : []), 'upload.tar.gz']
  const runInspect = async () => {
    if (!archive) return toast('Choose a bundle archive first', 'err')
    setSummary(await api.inspectArchive(new Blob([base64ToBytes(archive.b64)])).catch((e) => { toast(e.message, 'err'); return null }))
    if (hasCommand(cli, 'inspect')) {
      setInspectRes(await api.cli({ args: inspectArgs, binaryFiles: { 'upload.tar.gz': archive.b64 } }))
    }
  }

  // ---- sign ------------------------------------------------------------------------
  const s = (n: string) => hasFlag(cli, 'sign', n)
  const signArgs = ['sign', '--signing-key', 'studio-key.pem']
  if (alg && s('signing-alg')) signArgs.push('--signing-alg', alg)
  if (claims.trim() && s('claims-file')) signArgs.push('--claims-file', 'studio-claims.json')
  if (signTarget === 'archive') signArgs.push('--bundle', 'upload.tar.gz')
  else signArgs.push(...(s('bundle') ? ['--bundle', '.'] : loadArgs(cli, 'sign', files, '', { tests: false })))
  const runSign = async () => {
    if (!key.trim()) return toast('Provide a signing key (PEM) or HMAC secret', 'err')
    const r = await api.cli({ args: signArgs, workspace: signTarget === 'workspace' ? ws : undefined, files: keyFiles(), binaryFiles: signTarget === 'archive' && archive ? { 'upload.tar.gz': archive.b64 } : undefined, collect: ['.signatures.json'] })
    setRes(r)
  }

  // ---- verify ----------------------------------------------------------------------
  const verifyArgs = ['build', '--bundle', 'upload.tar.gz', '--verification-key', 'studio-key.pem', '-o', 'verified.tar.gz']
  if (alg && b('verification-key-id')) verifyArgs.push('--verification-key-id', 'default')
  if (alg && b('signing-alg')) verifyArgs.push('--signing-alg', alg)
  if (build.scope && b('scope')) verifyArgs.push('--scope', build.scope)
  if (build.excludeVerify && b('exclude-files-verify')) build.excludeVerify.split(',').forEach((x) => verifyArgs.push('--exclude-files-verify', x.trim()))
  const runVerify = async () => {
    if (!archive) return toast('Choose a signed bundle archive first', 'err')
    setRes(await api.cli({ args: verifyArgs, files: keyFiles(), binaryFiles: { 'upload.tar.gz': archive.b64 } }))
  }

  const chooser = (
    <div className="row">
      <input ref={fileRef} type="file" accept=".tar.gz,.tgz,application/gzip" hidden onChange={async (e) => {
        const f = e.target.files?.[0]
        if (f) setArchive({ name: f.name, b64: await fileToBase64(f) })
        e.target.value = ''
      }} />
      <Button icon="upload" onClick={() => fileRef.current?.click()}>Choose bundle…</Button>
      <a className="btn" href={api.exportUrl(ws)} download>Download workspace as bundle</a>
      {archive && <span className="mono small">{archive.name}</span>}
    </div>
  )

  const keyFields = (
    <div className="grid cols-2">
      <Field label={tab === 'verify' ? 'Verification key' : 'Signing key'} hint="PEM encoded key (RSA/EC) or an HMAC secret. Kept only for this run.">
        <textarea rows={5} value={key} onChange={(e) => setKey(e.target.value)} placeholder="-----BEGIN PRIVATE KEY-----" />
      </Field>
      <div className="stack">
        <Field label="Algorithm"><select value={alg} onChange={(e) => setAlg(e.target.value)}>{['RS256', 'RS384', 'RS512', 'PS256', 'PS384', 'PS512', 'ES256', 'ES384', 'ES512', 'HS256', 'HS384', 'HS512'].map((a) => <option key={a}>{a}</option>)}</select></Field>
        {tab !== 'verify' && <Field label="Custom claims (JSON, optional)"><textarea rows={2} value={claims} onChange={(e) => setClaims(e.target.value)} /></Field>}
        <Field label="Scope (optional)"><input value={build.scope} onChange={(e) => setBuild({ ...build, scope: e.target.value })} /></Field>
      </div>
    </div>
  )

  return (
    <div className="page">
      <Tabs
        tabs={[
          { id: 'build', label: 'Build (opa build)', hidden: !hasBuild },
          { id: 'inspect', label: hasCommand(cli, 'inspect') ? 'Inspect (opa inspect)' : 'Inspect' },
          { id: 'sign', label: 'Sign (opa sign)', hidden: !hasCommand(cli, 'sign') },
          { id: 'verify', label: 'Verify', hidden: !b('verification-key') },
        ]}
        value={tab}
        onChange={(t) => { setTab(t); setRes(null) }}
      />
      {!hasBuild && (
        <Alert kind="info" title={`opa build is not available in OPA ${info.opa.version ?? cli?.opa.version}`}>
          Studio's native bundle builder still works: export the workspace as a bundle or publish it from the Control Plane page.
        </Alert>
      )}
      {tab === 'build' && (
        <>
          <CommandPreview args={buildArgs} />
          <Card title="Build a bundle from the active workspace" actions={<Button icon="bundle" variant="primary" onClick={() => void runBuild()}>Build</Button>}>
            <div className="stack">
              <div className="row">
                {b('bundle') && <Check label="--bundle (load the workspace as a bundle directory)" checked={build.bundleMode} onChange={(v) => setBuild({ ...build, bundleMode: v })} />}
                {b('v0-compatible') && <Check label="--v0-compatible" checked={build.v0} onChange={(v) => setBuild({ ...build, v0: v })} />}
                {b('v1-compatible') && <Check label="--v1-compatible" checked={build.v1} onChange={(v) => setBuild({ ...build, v1: v })} />}
              </div>
              <div className="form-grid">
                {targets.length > 0 && <Field label="--target"><select value={build.target} onChange={(e) => setBuild({ ...build, target: e.target.value })}><option value="">rego (default)</option>{targets.map((t) => <option key={t}>{t}</option>)}</select></Field>}
                {b('entrypoint') && <Field label="--entrypoint" hint="comma separated, e.g. app/rbac/allow (required for wasm/plan, enables optimization)"><input className="mono" value={build.entrypoints} onChange={(e) => setBuild({ ...build, entrypoints: e.target.value })} /></Field>}
                {b('optimize') && <Field label="--optimize"><select value={build.optimize} onChange={(e) => setBuild({ ...build, optimize: e.target.value })}><option value="">0 (none)</option><option>1</option><option>2</option></select></Field>}
                {b('revision') && <Field label="--revision"><input value={build.revision} onChange={(e) => setBuild({ ...build, revision: e.target.value })} /></Field>}
                {b('capabilities') && <Field label="--capabilities"><input className="mono" value={build.capabilities} onChange={(e) => setBuild({ ...build, capabilities: e.target.value })} placeholder="v0.60.0 or caps.json" /></Field>}
                <Field label="Bundle name (for publishing)"><input value={build.name} onChange={(e) => setBuild({ ...build, name: e.target.value })} /></Field>
              </div>
              {b('signing-key') && (
                <details>
                  <summary className="small" style={{ cursor: 'pointer' }}>Sign while building (--signing-key)</summary>
                  <div style={{ marginTop: 10 }}>{keyFields}</div>
                </details>
              )}
              <Field label="Additional flags"><input className="mono" value={build.extra} onChange={(e) => setBuild({ ...build, extra: e.target.value })} /></Field>
            </div>
          </Card>
          {res && (
            <Card title="Build output" actions={archive && (
              <>
                <Button icon="download" onClick={() => download(archive.name, base64ToBytes(archive.b64), 'application/gzip')}>Download</Button>
                <Button icon="cloud" variant="primary" disabled={readOnly} onClick={() => void publish()}>Publish to control plane</Button>
              </>
            )}>
              <div className="stack">
                <CliOutput result={res} />
                {summary && <Summary s={summary} />}
              </div>
            </Card>
          )}
        </>
      )}
      {tab === 'inspect' && (
        <>
          <CommandPreview args={hasCommand(cli, 'inspect') ? inspectArgs : ['(native inspection)']} />
          <Card title="Inspect a bundle" actions={<Button icon="play" variant="primary" onClick={() => void runInspect()}>Inspect</Button>}>
            <div className="stack">
              {chooser}
              {hasFlag(cli, 'inspect', 'annotations') && <Check label="--annotations (include METADATA annotations)" checked={annotations} onChange={setAnnotations} />}
            </div>
          </Card>
          <div className="grid cols-2">
            {summary && <Card title="Archive contents"><Summary s={summary} /></Card>}
            {inspectRes && (
              <Card title="opa inspect">
                {(() => {
                  try {
                    return <JsonView value={JSON.parse(inspectRes.stdout)} open={3} />
                  } catch {
                    return <CliOutput result={inspectRes} />
                  }
                })()}
              </Card>
            )}
          </div>
        </>
      )}
      {tab === 'sign' && (
        <>
          <CommandPreview args={signArgs} />
          <Card title="Generate a bundle signature (.signatures.json)" actions={<Button icon="key" variant="primary" onClick={() => void runSign()}>Sign</Button>}>
            <div className="stack">
              <div className="row">
                <Check label="Sign the active workspace" checked={signTarget === 'workspace'} onChange={(v) => setSignTarget(v ? 'workspace' : 'archive')} />
                <Check label="Sign an uploaded bundle (--bundle)" checked={signTarget === 'archive'} onChange={(v) => setSignTarget(v ? 'archive' : 'workspace')} />
              </div>
              {signTarget === 'archive' && chooser}
              {keyFields}
            </div>
          </Card>
          {res && (
            <Card title="Signature" actions={res.files?.['.signatures.json']?.text && <Button icon="download" onClick={() => download('.signatures.json', res.files!['.signatures.json'].text!, 'application/json')}>Download .signatures.json</Button>}>
              <div className="stack">
                {res.files?.['.signatures.json']?.text && <JsonView value={JSON.parse(res.files['.signatures.json'].text)} open={3} />}
                <CliOutput result={res} />
              </div>
            </Card>
          )}
        </>
      )}
      {tab === 'verify' && (
        <>
          <CommandPreview args={verifyArgs} />
          <Card title="Verify a signed bundle" subtitle="Rebuilds the bundle with --verification-key; any tampering fails the build." actions={<Button icon="shield" variant="primary" onClick={() => void runVerify()}>Verify</Button>}>
            <div className="stack">
              {chooser}
              {keyFields}
              {b('exclude-files-verify') && <Field label="--exclude-files-verify" hint="comma separated"><input className="mono" value={build.excludeVerify} onChange={(e) => setBuild({ ...build, excludeVerify: e.target.value })} /></Field>}
            </div>
          </Card>
          {res && (
            <Card title="Verification result">
              {res.exitCode === 0 ? <Alert kind="ok" title="Signature valid">The bundle matches its signature.</Alert> : <Alert kind="err" title="Verification failed" />}
              <div style={{ marginTop: 10 }}><CliOutput result={res} /></div>
            </Card>
          )}
        </>
      )}
    </div>
  )
}
