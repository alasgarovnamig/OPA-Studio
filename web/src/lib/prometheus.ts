export interface Metric {
  name: string
  type: string
  help: string
  samples: { labels: Record<string, string>; value: string; name: string }[]
}

const SAMPLE = /^([a-zA-Z_:][a-zA-Z0-9_:]*)(\{(.*)\})?\s+(\S+)(\s+\d+)?$/
const LABEL = /([a-zA-Z_][a-zA-Z0-9_]*)="((?:[^"\\]|\\.)*)"/g

/** Parses the Prometheus text exposition format returned by OPA's /metrics. */
export function parsePrometheus(text: string): Metric[] {
  const byName = new Map<string, Metric>()
  const get = (name: string) => {
    let m = byName.get(name)
    if (!m) {
      m = { name, type: 'untyped', help: '', samples: [] }
      byName.set(name, m)
    }
    return m
  }
  const family = (sample: string) => {
    for (const suffix of ['_bucket', '_sum', '_count', '_total', '_created']) {
      if (sample.endsWith(suffix)) {
        const base = sample.slice(0, -suffix.length)
        if (byName.has(base)) return base
      }
    }
    return sample
  }
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    if (line.startsWith('# HELP ')) {
      const rest = line.slice(7)
      const sp = rest.indexOf(' ')
      if (sp > 0) get(rest.slice(0, sp)).help = rest.slice(sp + 1)
      else get(rest).help = ''
      continue
    }
    if (line.startsWith('# TYPE ')) {
      const parts = line.split(' ')
      get(parts[2]).type = parts[3] ?? 'untyped'
      continue
    }
    if (line.startsWith('#')) continue
    const m = line.match(SAMPLE)
    if (!m) continue
    const labels: Record<string, string> = {}
    if (m[3]) for (const l of m[3].matchAll(LABEL)) labels[l[1]] = l[2].replace(/\\"/g, '"')
    get(family(m[1])).samples.push({ name: m[1], labels, value: m[4] })
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
}
