import { StreamLanguage, type StreamParser } from '@codemirror/language'

const KEYWORDS = new Set([
  'package', 'import', 'default', 'not', 'with', 'as', 'some', 'every', 'in', 'if', 'contains', 'else',
])
const ATOMS = new Set(['true', 'false', 'null'])

interface State {
  inRaw: boolean
}

/** Rego syntax highlighting for every dialect from `:-` rules to Rego v1. */
const parser: StreamParser<State> = {
  name: 'rego',
  startState: () => ({ inRaw: false }),
  token(stream, state) {
    if (state.inRaw) {
      while (!stream.eol()) {
        if (stream.next() === '`') {
          state.inRaw = false
          return 'string'
        }
      }
      return 'string'
    }
    if (stream.eatSpace()) return null
    const ch = stream.peek()
    if (ch === '#') {
      stream.skipToEnd()
      return 'comment'
    }
    if (ch === '"') {
      stream.next()
      let escaped = false
      while (!stream.eol()) {
        const c = stream.next()
        if (c === '"' && !escaped) break
        escaped = !escaped && c === '\\'
      }
      return 'string'
    }
    if (ch === '`') {
      stream.next()
      state.inRaw = true
      while (!stream.eol()) {
        if (stream.next() === '`') {
          state.inRaw = false
          break
        }
      }
      return 'string'
    }
    if (stream.match(/^-?\d+(\.\d+)?([eE][-+]?\d+)?/)) return 'number'
    if (stream.match(/^(:=|==|!=|<=|>=|:-|\||&)/)) return 'operator'
    if (stream.match(/^[a-zA-Z_][a-zA-Z0-9_]*/)) {
      const w = stream.current()
      if (KEYWORDS.has(w)) return 'keyword'
      if (ATOMS.has(w)) return 'atom'
      if (w === 'input' || w === 'data') return 'variableName.special'
      if (stream.peek() === '(') return 'function'
      return 'variableName'
    }
    if (stream.match(/^[=<>+\-*/%]/)) return 'operator'
    stream.next()
    return null
  },
  languageData: { commentTokens: { line: '#' } },
}

export const rego = StreamLanguage.define(parser)
