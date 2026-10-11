import { api } from '../api/client'
import { Badge, Button, Card, KV } from '../components/ui'
import { DIALECT_LABELS } from '../lib/features'
import { useApp } from '../state/app'

export default function About() {
  const { info, cli, theme, setTheme } = useApp()
  return (
    <div className="page">
      <div className="grid cols-2">
        <Card title="OPA Studio">
          <KV items={[
            ['Release', <code>{info.studio.version}</code>],
            ['Targets OPA', <code>{info.studio.targetOpaVersion}</code>],
            ['Commit', <code>{info.studio.commit}</code>],
            ['Built', info.studio.date],
            ['Started', new Date(info.studio.startedAt).toLocaleString()],
            ['Source', <a href="https://github.com/alasgarovnamig/OPA-Studio" target="_blank" rel="noreferrer">github.com/alasgarovnamig/OPA-Studio</a>],
            ['Release for this OPA', <a href={`https://github.com/alasgarovnamig/OPA-Studio/tree/${info.studio.targetOpaVersion}`} target="_blank" rel="noreferrer">tag {info.studio.targetOpaVersion}</a>],
          ]} />
        </Card>
        <Card title="OPA binary">
          <KV items={[
            ['Available', info.opa.available ? <Badge kind="ok">yes</Badge> : <Badge kind="err">no</Badge>],
            ['Path', <code>{info.opa.path ?? '—'}</code>],
            ['Version', <code>{info.opa.version ?? '—'}</code>],
            ['Manifest', info.opa.manifestLive ? 'introspected at startup (unknown build)' : `measured manifest of ${info.opa.manifestVersion}`],
            ['Rego dialect', DIALECT_LABELS[cli?.preferred_dialect ?? ''] ?? '—'],
            ['Commit', <code>{cli?.version_output?.['Build Commit'] ?? '—'}</code>],
            ['Go version', cli?.version_output?.['Go Version'] ?? '—'],
            ['WebAssembly', cli?.version_output?.WebAssembly ?? '—'],
          ]} />
        </Card>
        <Card title="Security & runtime settings">
          <KV items={[
            ['Authentication', <Badge>{info.settings.authMode}</Badge>],
            ['Read-only', info.settings.readOnly ? <Badge kind="warn">on</Badge> : 'off'],
            ['CLI sandbox', info.settings.cliSandbox ? <Badge kind="ok">on</Badge> : <Badge kind="warn">off</Badge>],
            ['Local OPA', info.settings.localOpa ? 'enabled' : 'disabled'],
            ['Public URL', info.settings.publicUrl || window.location.origin],
            ['Control plane token', info.settings.controlPlaneTokenRequired ? 'required' : 'not required'],
          ]} />
          {info.settings.authMode === 'token' && <div style={{ marginTop: 12 }}><Button icon="logout" onClick={async () => { await api.logout(); window.location.reload() }}>Sign out</Button></div>}
        </Card>
        <Card title="Appearance">
          <div className="row">
            <Button variant={theme === 'light' ? 'primary' : undefined} icon="sun" onClick={() => setTheme('light')}>Light</Button>
            <Button variant={theme === 'dark' ? 'primary' : undefined} icon="moon" onClick={() => setTheme('dark')}>Dark</Button>
          </div>
        </Card>
      </div>
    </div>
  )
}
