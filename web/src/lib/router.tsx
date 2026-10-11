import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

interface RouterState {
  path: string
  query: URLSearchParams
  navigate: (to: string, replace?: boolean) => void
}

const Ctx = createContext<RouterState>({ path: '/', query: new URLSearchParams(), navigate: () => {} })

/** Minimal history-API router (Studio has a flat set of pages). */
export function Router({ children }: { children: ReactNode }) {
  const [loc, setLoc] = useState(() => ({ path: window.location.pathname, search: window.location.search }))
  useEffect(() => {
    const on = () => setLoc({ path: window.location.pathname, search: window.location.search })
    window.addEventListener('popstate', on)
    return () => window.removeEventListener('popstate', on)
  }, [])
  const navigate = (to: string, replace = false) => {
    if (replace) window.history.replaceState(null, '', to)
    else window.history.pushState(null, '', to)
    setLoc({ path: window.location.pathname, search: window.location.search })
  }
  return <Ctx.Provider value={{ path: loc.path, query: new URLSearchParams(loc.search), navigate }}>{children}</Ctx.Provider>
}

export const useRouter = () => useContext(Ctx)

export function Link({ to, children, className, title }: { to: string; children: ReactNode; className?: string; title?: string }) {
  const { navigate } = useRouter()
  return (
    <a
      href={to}
      className={className}
      title={title}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
        e.preventDefault()
        navigate(to)
      }}
    >
      {children}
    </a>
  )
}
