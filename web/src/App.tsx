import { useEffect, useState } from 'react'
import { api, onUnauthorized } from './api/client'
import type { Info } from './api/types'
import { Icon } from './components/icons'
import { Alert, Button, ToastProvider } from './components/ui'
import { Link, Router, useRouter } from './lib/router'
import { AppProvider, useApp } from './state/app'
import { groups, pages } from './pages/registry'

function Sidebar() {
  const { path } = useRouter()
  const { cli, server, info } = useApp()
  return (
    <nav className="sidebar">
      <div className="brand">
        <img src="/favicon.svg" alt="" />
        <div>
          <div className="name">OPA Studio</div>
          <div className="sub">for Open Policy Agent {info.studio.targetOpaVersion}</div>
        </div>
      </div>
      {groups.map((g) => (
        <div className="nav-group" key={g}>
          <div className="nav-group-title">{g}</div>
          {pages
            .filter((p) => p.group === g)
            .map((p) => {
              const gate = p.gate?.({ cli, server, info }) ?? { ok: true }
              const active = p.path === '/' ? path === '/' : path.startsWith(p.path)
              return (
                <Link key={p.id} to={p.path} className={`nav-item ${active ? 'active' : ''} ${gate.ok ? '' : 'disabled'}`} title={gate.ok ? p.description : `${p.title}: ${gate.reason}`}>
                  <Icon name={p.icon} />
                  {p.title}
                  {!gate.ok && <span className="tag">n/a</span>}
                </Link>
              )
            })}
        </div>
      ))}
      <div className="sidebar-footer">
        Studio {info.studio.version} · OPA {info.opa.version ?? info.studio.targetOpaVersion}
      </div>
    </nav>
  )
}

function Topbar({ title, description }: { title: string; description: string }) {
  const { connections, conn, setConn, probe, workspaces, ws, setWs, theme, setTheme, info, serverVersion } = useApp()
  const dot = probe ? (probe.reachable ? (probe.healthy === false ? 'warn' : 'ok') : 'err') : ''
  return (
    <header className="topbar">
      <div className="title">
        <h1>{title}</h1>
        <div className="desc">{description}</div>
      </div>
      <div className="spacer" />
      <label className="version-chip" title="Active workspace (used by Develop pages)">
        <Icon name="workspace" width={14} height={14} />
        <select value={ws} onChange={(e) => setWs(e.target.value)} style={{ border: 'none', padding: '0 2px 0 0', background: 'transparent' }} aria-label="Workspace">
          {workspaces.map((w) => (
            <option key={w.id} value={w.id}>{w.name}</option>
          ))}
        </select>
      </label>
      <label className="version-chip" title={probe?.error ?? probe?.url ?? 'OPA server'}>
        <span className={`dot ${dot}`} />
        <select value={conn} onChange={(e) => setConn(e.target.value)} style={{ border: 'none', padding: '0 2px 0 0', background: 'transparent' }} aria-label="OPA connection">
          {connections.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        {serverVersion && <span className="badge accent">OPA {serverVersion}</span>}
      </label>
      {info.settings.readOnly && <span className="badge warn">read-only</span>}
      <Button variant="ghost" icon={theme === 'dark' ? 'sun' : 'moon'} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label="Toggle theme" />
    </header>
  )
}

function Shell() {
  const { path } = useRouter()
  const { cli, server, info } = useApp()
  const page = pages.find((p) => (p.path === '/' ? path === '/' : path.startsWith(p.path))) ?? pages[0]
  const gate = page.gate?.({ cli, server, info }) ?? { ok: true }
  const Page = page.component
  useEffect(() => {
    document.title = `${page.title} · OPA Studio`
  }, [page])
  return (
    <div className="app">
      <Sidebar />
      <div className="main">
        <Topbar title={page.title} description={page.description} />
        <main className="content">
          {!gate.ok && (
            <div className="page" style={{ marginBottom: 16 }}>
              <Alert kind="warn" title={`${page.title} is ${gate.reason}`}>
                This capability was measured as unavailable for this OPA version. The page is shown for reference; requests
                will most likely fail. See <Link to="/compatibility">Compatibility</Link> for the release that introduced it.
              </Alert>
            </div>
          )}
          <Page key={page.id} />
        </main>
      </div>
    </div>
  )
}

function Login({ onDone }: { onDone: () => void }) {
  const [token, setToken] = useState('')
  const [err, setErr] = useState<string | null>(null)
  return (
    <div className="login">
      <div className="card">
        <div className="card-header">
          <img src="/favicon.svg" alt="" width={26} />
          <h2>OPA Studio</h2>
        </div>
        <form
          className="card-body stack"
          onSubmit={async (e) => {
            e.preventDefault()
            try {
              await api.login(token)
              onDone()
            } catch {
              setErr('Invalid token')
            }
          }}
        >
          <label className="field">
            Access token
            <input type="password" value={token} onChange={(e) => setToken(e.target.value)} autoFocus />
          </label>
          {err && <Alert kind="err">{err}</Alert>}
          <button className="btn primary" type="submit">Sign in</button>
        </form>
      </div>
    </div>
  )
}

export default function App() {
  const [info, setInfo] = useState<Info | null>(null)
  const [needLogin, setNeedLogin] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadInfo = () =>
    api
      .info()
      .then((i) => {
        setInfo(i)
        setNeedLogin(false)
      })
      .catch((e: { status?: number; message: string }) => {
        if (e.status === 401) setNeedLogin(true)
        else setError(e.message)
      })

  useEffect(() => {
    onUnauthorized(() => setNeedLogin(true))
    void loadInfo()
  }, [])

  if (needLogin) return <Login onDone={() => void loadInfo()} />
  if (error) return <div className="content"><Alert kind="err" title="OPA Studio backend unreachable">{error}</Alert></div>
  if (!info) return <div className="content muted">Loading…</div>
  return (
    <ToastProvider>
      <Router>
        <AppProvider info={info}>
          <Shell />
        </AppProvider>
      </Router>
    </ToastProvider>
  )
}
