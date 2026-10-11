/** Splits a shell-like command line into arguments (supports quotes and escapes). */
export function shellSplit(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let quote: '"' | "'" | null = null
  let has = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (quote) {
      if (c === quote) quote = null
      else if (c === '\\' && quote === '"' && i + 1 < line.length) cur += line[++i]
      else cur += c
      continue
    }
    if (c === '"' || c === "'") {
      quote = c
      has = true
    } else if (c === '\\' && i + 1 < line.length) {
      cur += line[++i]
      has = true
    } else if (/\s/.test(c)) {
      if (has || cur) out.push(cur)
      cur = ''
      has = false
    } else {
      cur += c
      has = true
    }
  }
  if (has || cur) out.push(cur)
  return out
}

/** Quotes an argument for display so the preview can be pasted into a shell. */
export function shellQuote(a: string): string {
  if (a === '') return "''"
  if (/^[A-Za-z0-9_./:=@%+,-]+$/.test(a)) return a
  return `'${a.replace(/'/g, `'\\''`)}'`
}

export function commandLine(args: string[]): string {
  return ['opa', ...args].map(shellQuote).join(' ')
}
