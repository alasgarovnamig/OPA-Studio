import { useEffect, useRef } from 'react'
import { EditorState, Compartment, type Extension } from '@codemirror/state'
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection, placeholder as ph } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { bracketMatching, foldGutter, indentOnInput, syntaxHighlighting, HighlightStyle, indentUnit } from '@codemirror/language'
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search'
import { json } from '@codemirror/lang-json'
import { yaml } from '@codemirror/lang-yaml'
import { tags as t } from '@lezer/highlight'
import { rego } from '../lib/rego'

export type Language = 'rego' | 'json' | 'yaml' | 'text'

export function languageFor(path: string): Language {
  if (path.endsWith('.rego')) return 'rego'
  if (path.endsWith('.json') || path.endsWith('.manifest')) return 'json'
  if (path.endsWith('.yaml') || path.endsWith('.yml')) return 'yaml'
  return 'text'
}

const highlight = HighlightStyle.define([
  { tag: t.keyword, color: 'var(--hl-keyword, #7c3aed)', fontWeight: '600' },
  { tag: t.comment, color: 'var(--hl-comment, #94a3b8)', fontStyle: 'italic' },
  { tag: t.string, color: 'var(--hl-string, #0f766e)' },
  { tag: t.number, color: 'var(--hl-number, #c2410c)' },
  { tag: [t.atom, t.bool, t.null], color: 'var(--hl-atom, #2563eb)' },
  { tag: t.operator, color: 'var(--hl-operator, #64748b)' },
  { tag: t.special(t.variableName), color: 'var(--hl-special, #db2777)', fontWeight: '600' },
  { tag: t.function(t.variableName), color: 'var(--hl-function, #0369a1)' },
  { tag: t.propertyName, color: 'var(--hl-property, #7c3aed)' },
])

const theme = EditorView.theme({
  '&': { backgroundColor: 'var(--code-bg)', color: 'var(--text)' },
  '.cm-content': { caretColor: 'var(--accent)', padding: '8px 0' },
  '.cm-activeLine': { backgroundColor: 'rgba(20, 184, 166, 0.06)' },
  '.cm-activeLineGutter': { backgroundColor: 'rgba(20, 184, 166, 0.08)' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': { backgroundColor: 'rgba(20, 184, 166, 0.25) !important' },
  '.cm-cursor': { borderLeftColor: 'var(--accent)' },
})

function lang(l: Language): Extension {
  switch (l) {
    case 'rego':
      return rego
    case 'json':
      return json()
    case 'yaml':
      return yaml()
    default:
      return []
  }
}

interface Props {
  value: string
  onChange?: (v: string) => void
  language?: Language
  height?: number | string
  readOnly?: boolean
  placeholder?: string
  onSubmit?: () => void
  minimal?: boolean
}

/** CodeMirror 6 editor with Rego, JSON and YAML support. */
export function Editor({ value, onChange, language = 'text', height = 320, readOnly, placeholder, onSubmit, minimal }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const langComp = useRef(new Compartment())
  const roComp = useRef(new Compartment())
  const onChangeRef = useRef(onChange)
  const onSubmitRef = useRef(onSubmit)
  onChangeRef.current = onChange
  onSubmitRef.current = onSubmit

  useEffect(() => {
    if (!host.current) return
    const submit = keymap.of([
      {
        key: 'Mod-Enter',
        run: () => {
          onSubmitRef.current?.()
          return true
        },
      },
    ])
    const state = EditorState.create({
      doc: value,
      extensions: [
        submit,
        minimal ? [] : [lineNumbers(), foldGutter(), highlightActiveLineGutter()],
        history(),
        drawSelection(),
        indentOnInput(),
        bracketMatching(),
        closeBrackets(),
        highlightActiveLine(),
        highlightSelectionMatches(),
        indentUnit.of('\t'),
        EditorState.tabSize.of(4),
        keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap, indentWithTab]),
        syntaxHighlighting(highlight),
        theme,
        langComp.current.of(lang(language)),
        roComp.current.of([EditorState.readOnly.of(!!readOnly), EditorView.editable.of(!readOnly)]),
        placeholder ? ph(placeholder) : [],
        EditorView.updateListener.of((u) => {
          if (u.docChanged) onChangeRef.current?.(u.state.doc.toString())
        }),
      ],
    })
    view.current = new EditorView({ state, parent: host.current })
    return () => {
      view.current?.destroy()
      view.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const v = view.current
    if (v && v.state.doc.toString() !== value) {
      v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } })
    }
  }, [value])

  useEffect(() => {
    view.current?.dispatch({ effects: langComp.current.reconfigure(lang(language)) })
  }, [language])

  useEffect(() => {
    view.current?.dispatch({ effects: roComp.current.reconfigure([EditorState.readOnly.of(!!readOnly), EditorView.editable.of(!readOnly)]) })
  }, [readOnly])

  return <div className="editor" style={{ height }} ref={host} />
}
