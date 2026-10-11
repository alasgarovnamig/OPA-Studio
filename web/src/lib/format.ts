export function bytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`
  return `${(n / 1024 / 1024).toFixed(1)} MiB`
}

export function ago(iso?: string): string {
  if (!iso) return '—'
  const d = new Date(iso).getTime()
  if (!d) return '—'
  const s = Math.round((Date.now() - d) / 1000)
  if (s < 5) return 'just now'
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.round(s / 60)}m ago`
  if (s < 86400) return `${Math.round(s / 3600)}h ago`
  return `${Math.round(s / 86400)}d ago`
}

export function date(iso?: string): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toISOString().slice(0, 10)
}

export function pretty(v: unknown): string {
  if (v === undefined) return ''
  if (typeof v === 'string') return v
  return JSON.stringify(v, null, 2)
}

export function tryParseJSON(s: string): { ok: true; value: unknown } | { ok: false; error: string } {
  if (!s.trim()) return { ok: true, value: undefined }
  try {
    return { ok: true, value: JSON.parse(s) }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

export function nanos(n: number): string {
  if (n < 1e3) return `${n} ns`
  if (n < 1e6) return `${(n / 1e3).toFixed(1)} µs`
  if (n < 1e9) return `${(n / 1e6).toFixed(2)} ms`
  return `${(n / 1e9).toFixed(2)} s`
}

export function download(name: string, data: BlobPart, type = 'application/octet-stream') {
  const url = URL.createObjectURL(new Blob([data], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export async function fileToBase64(f: Blob): Promise<string> {
  const buf = new Uint8Array(await f.arrayBuffer())
  let s = ''
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000))
  return btoa(s)
}
