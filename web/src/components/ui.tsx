import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import { Icon, type IconName } from './icons'
import { commandLine } from '../lib/args'
import type { CliResult } from '../api/types'

export function Card({ title, actions, children, flush, className, subtitle }: {
  title?: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
  children?: ReactNode
  flush?: boolean
  className?: string
}) {
  return (
    <div className={`card ${className ?? ''}`}>
      {(title || actions) && (
        <div className="card-header">
          <div className="stack" style={{ gap: 2 }}>
            {typeof title === 'string' ? <h2>{title}</h2> : title}
            {subtitle && <span className="muted small">{subtitle}</span>}
          </div>
          {actions && <div className="actions">{actions}</div>}
        </div>
      )}
      <div className={`card-body ${flush ? 'flush' : ''}`}>{children}</div>
    </div>
  )
}

export function Button({ icon, children, variant, size, className, ...rest }: {
  icon?: IconName
  variant?: 'primary' | 'danger' | 'ghost'
  size?: 'sm'
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" className={`btn ${variant ?? ''} ${size ?? ''} ${className ?? ''}`} {...rest}>
      {icon && <Icon name={icon} />}
      {children}
    </button>
  )
}

export function Badge({ kind, children, title }: { kind?: 'ok' | 'warn' | 'err' | 'info' | 'accent'; children: ReactNode; title?: string }) {
  return <span className={`badge ${kind ?? ''}`} title={title}>{children}</span>
}

export function Alert({ kind = 'info', children, title }: { kind?: 'ok' | 'warn' | 'err' | 'info'; children?: ReactNode; title?: ReactNode }) {
  return (
    <div className={`alert ${kind}`}>
      <div className="grow">
        {title && <strong>{title}</strong>}
        {children && <div>{children}</div>}
      </div>
    </div>
  )
}

export function Tabs<T extends string>({ tabs, value, onChange }: {
  tabs: { id: T; label: ReactNode; count?: number; hidden?: boolean }[]
  value: T
  onChange: (t: T) => void
}) {
  return (
    <div className="tabs" role="tablist">
      {tabs.filter((t) => !t.hidden).map((t) => (
        <div key={t.id} role="tab" aria-selected={t.id === value} className={`tab ${t.id === value ? 'active' : ''}`} onClick={() => onChange(t.id)}>
          {t.label}
          {t.count !== undefined && <span className="count">{t.count}</span>}
        </div>
      ))}
    </div>
  )
}

export function Pills<T extends string>({ options, value, onChange }: { options: { id: T; label: ReactNode }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="pill-select">
      {options.map((o) => (
        <button key={o.id} type="button" className={o.id === value ? 'active' : ''} onClick={() => onChange(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Field({ label, hint, children, style }: { label: ReactNode; hint?: ReactNode; children: ReactNode; style?: React.CSSProperties }) {
  return (
    <label className="field" style={style}>
      {label}
      {children}
      {hint && <span className="hint">{hint}</span>}
    </label>
  )
}

export function Check({ label, checked, onChange, title, disabled }: { label: ReactNode; checked: boolean; onChange: (v: boolean) => void; title?: string; disabled?: boolean }) {
  return (
    <label className="check" title={title} style={disabled ? { opacity: 0.5 } : undefined}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  )
}

export function Empty({ title, children, icon }: { title: ReactNode; children?: ReactNode; icon?: IconName }) {
  return (
    <div className="empty">
      {icon && <Icon name={icon} width={28} height={28} style={{ color: 'var(--faint)', marginBottom: 8 }} />}
      <h3>{title}</h3>
      {children && <div className="small">{children}</div>}
    </div>
  )
}

export function KV({ items }: { items: [ReactNode, ReactNode][] }) {
  return (
    <dl className="kv">
      {items.map(([k, v], i) => (
        <div key={i} style={{ display: 'contents' }}>
          <dt>{k}</dt>
          <dd>{v ?? '—'}</dd>
        </div>
      ))}
    </dl>
  )
}

export function Stat({ label, value, foot }: { label: ReactNode; value: ReactNode; foot?: ReactNode }) {
  return (
    <div className="card stat">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {foot && <div className="foot">{foot}</div>}
    </div>
  )
}

export function Code({ children, wrap, maxHeight }: { children: ReactNode; wrap?: boolean; maxHeight?: number }) {
  return (
    <pre className={`code ${wrap ? 'wrap' : ''}`} style={maxHeight ? { maxHeight } : undefined}>
      {children}
    </pre>
  )
}

export function Modal({ title, children, footer, onClose, width }: { title: ReactNode; children: ReactNode; footer?: ReactNode; onClose: () => void; width?: number }) {
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={width ? { width: `min(${width}px, 100%)` } : undefined} role="dialog">
        <div className="card-header">
          <h2>{title}</h2>
          <div className="actions">
            <Button variant="ghost" size="sm" icon="x" onClick={onClose} aria-label="Close" />
          </div>
        </div>
        <div className="card-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  )
}

export function CommandPreview({ args }: { args: string[] }) {
  const toast = useToast()
  const line = commandLine(args)
  return (
    <div className="cmd-preview" title="Equivalent OPA command">
      <span className="prompt">$</span>
      <span className="grow">{line}</span>
      <Button
        variant="ghost"
        size="sm"
        icon="copy"
        onClick={() => {
          void navigator.clipboard?.writeText(line)
          toast('Command copied', 'ok')
        }}
      />
    </div>
  )
}

export function Spinner() {
  return <span className="muted small">Working…</span>
}

// ---- JSON tree -------------------------------------------------------------------

function Leaf({ v }: { v: unknown }) {
  if (v === null) return <span className="z">null</span>
  if (typeof v === 'string') return <span className="s">{JSON.stringify(v)}</span>
  if (typeof v === 'number') return <span className="n">{String(v)}</span>
  if (typeof v === 'boolean') return <span className="b">{String(v)}</span>
  return <span>{String(v)}</span>
}

function Node({ k, v, depth, path, onSelect, open: initialOpen }: { k?: string; v: unknown; depth: number; path: string[]; onSelect?: (p: string[], v: unknown) => void; open: number }) {
  const [open, setOpen] = useState(depth < initialOpen)
  const isObj = v !== null && typeof v === 'object'
  const entries = isObj ? (Array.isArray(v) ? v.map((x, i) => [String(i), x] as [string, unknown]) : Object.entries(v as object)) : []
  const label = k !== undefined ? <><span className="k">{Array.isArray(v) || !/^\d+$/.test(k) ? JSON.stringify(k) : k}</span>: </> : null
  if (!isObj) {
    return (
      <div className={onSelect ? 'row-select' : ''} onClick={() => onSelect?.(path, v)}>
        <span className="toggle" />
        {label}
        <Leaf v={v} />
      </div>
    )
  }
  const [o, c] = Array.isArray(v) ? ['[', ']'] : ['{', '}']
  return (
    <div>
      <div className={onSelect ? 'row-select' : ''} onClick={() => onSelect?.(path, v)}>
        <span className="toggle" onClick={(e) => { e.stopPropagation(); setOpen(!open) }}>{entries.length ? (open ? '▾' : '▸') : ''}</span>
        {label}
        {o}
        {!open && <span className="z"> {entries.length} {Array.isArray(v) ? 'items' : 'keys'} </span>}
        {(!open || !entries.length) && c}
      </div>
      {open && entries.length > 0 && (
        <>
          <div className="node">
            {entries.map(([ek, ev]) => (
              <Node key={ek} k={ek} v={ev} depth={depth + 1} path={[...path, ek]} onSelect={onSelect} open={initialOpen} />
            ))}
          </div>
          <div><span className="toggle" />{c}</div>
        </>
      )}
    </div>
  )
}

export function JsonView({ value, onSelect, open = 2, maxHeight }: { value: unknown; onSelect?: (path: string[], v: unknown) => void; open?: number; maxHeight?: number }) {
  if (value === undefined) return <span className="muted small">undefined (no result)</span>
  return (
    <div className="json-tree" style={{ maxHeight, overflow: maxHeight ? 'auto' : undefined }}>
      <Node v={value} depth={0} path={[]} onSelect={onSelect} open={open} />
    </div>
  )
}

// ---- toasts ---------------------------------------------------------------------

type ToastKind = 'ok' | 'err' | 'info'
const ToastCtx = createContext<(msg: string, kind?: ToastKind) => void>(() => {})

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<{ id: number; msg: string; kind: ToastKind }[]>([])
  const push = useCallback((msg: string, kind: ToastKind = 'info') => {
    const id = Date.now() + Math.random()
    setItems((x) => [...x, { id, msg, kind }])
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), kind === 'err' ? 7000 : 3500)
  }, [])
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toast-stack">
        {items.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>{t.msg}</div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}

export const useToast = () => useContext(ToastCtx)

// ---- CLI output -------------------------------------------------------------------


export function CliOutput({ result, hideStdout }: { result: CliResult; hideStdout?: boolean }) {
  return (
    <div className="stack">
      <div className="row small">
        <Badge kind={result.exitCode === 0 ? 'ok' : 'err'}>exit {result.exitCode}</Badge>
        <span className="muted">{result.durationMs} ms</span>
        {result.timedOut && <Badge kind="err">timed out</Badge>}
        {result.truncated && <Badge kind="warn">output truncated</Badge>}
      </div>
      {!hideStdout && result.stdout && <Code>{result.stdout}</Code>}
      {result.stderr && (
        <div className="stack" style={{ gap: 4 }}>
          <span className="muted small">stderr</span>
          <Code wrap>{result.stderr}</Code>
        </div>
      )}
      {!result.stdout && !result.stderr && <span className="muted small">(no output)</span>}
    </div>
  )
}
