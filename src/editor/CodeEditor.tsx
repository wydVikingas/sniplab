import Editor from '@monaco-editor/react'
import type { Language } from '../db/schema'
import { LANGUAGE_INFO } from '../lib/languages'
import type { ColorScheme } from '../lib/useColorScheme'
import { EditorLoading } from './EditorLoading'
import './monacoSetup'

/** Imperative controls the page uses without importing Monaco itself. */
export interface EditorApi {
  revealPosition(line: number, column: number): void
  setErrorMarker(marker: { line: number; column: number; message: string } | null): void
}

export interface CodeEditorProps {
  value: string
  language: Language
  theme: ColorScheme
  onChange: (value: string) => void
  onReady?: (api: EditorApi) => void
  readOnly?: boolean
}

const MARKER_OWNER = 'sniplab-run'

export default function CodeEditor({
  value,
  language,
  theme,
  onChange,
  onReady,
  readOnly = false,
}: CodeEditorProps) {
  const info = LANGUAGE_INFO[language]
  return (
    <Editor
      value={value}
      language={info.monacoId}
      theme={theme === 'dark' ? 'vs-dark' : 'vs'}
      onChange={(next) => onChange(next ?? '')}
      loading={<EditorLoading />}
      onMount={(editor, monaco) => {
        onReady?.({
          revealPosition(line, column) {
            const position = { lineNumber: line, column }
            editor.revealPositionInCenter(position)
            editor.setPosition(position)
            editor.focus()
          },
          setErrorMarker(marker) {
            const model = editor.getModel()
            if (!model) return
            if (!marker) {
              monaco.editor.setModelMarkers(model, MARKER_OWNER, [])
              return
            }
            const line = Math.min(Math.max(marker.line, 1), model.getLineCount())
            monaco.editor.setModelMarkers(model, MARKER_OWNER, [
              {
                severity: monaco.MarkerSeverity.Error,
                message: marker.message,
                startLineNumber: line,
                startColumn: Math.max(marker.column, 1),
                endLineNumber: line,
                endColumn: model.getLineMaxColumn(line),
              },
            ])
          },
        })
      }}
      options={{
        ariaLabel: 'Code editor',
        automaticLayout: true,
        fixedOverflowWidgets: true,
        fontSize: 14,
        minimap: { enabled: false },
        padding: { top: 12, bottom: 12 },
        readOnly,
        scrollBeyondLastLine: false,
        tabSize: info.tabSize,
      }}
    />
  )
}
