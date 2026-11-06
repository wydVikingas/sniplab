import { DiffEditor, type DiffOnMount } from '@monaco-editor/react'
import { useEffect, useRef } from 'react'
import type { Language } from '../db/schema'
import { LANGUAGE_INFO } from '../lib/languages'
import type { ColorScheme } from '../lib/useColorScheme'
import { EditorLoading } from './EditorLoading'
import './monacoSetup'

export interface CodeDiffEditorProps {
  original: string
  modified: string
  language: Language
  theme: ColorScheme
}

type DiffEditorInstance = Parameters<DiffOnMount>[0]

/** Read-only side-by-side diff (inline on narrow screens). */
export default function CodeDiffEditor({
  original,
  modified,
  language,
  theme,
}: CodeDiffEditorProps) {
  const editorRef = useRef<DiffEditorInstance | null>(null)

  // We keep the models alive past @monaco-editor/react's own cleanup (which disposes them
  // before detaching, causing an error), so detach and dispose them ourselves.
  useEffect(
    () => () => {
      const editor = editorRef.current
      const model = editor?.getModel()
      editor?.setModel(null)
      model?.original.dispose()
      model?.modified.dispose()
    },
    [],
  )

  return (
    <DiffEditor
      original={original}
      modified={modified}
      language={LANGUAGE_INFO[language].monacoId}
      theme={theme === 'dark' ? 'vs-dark' : 'vs'}
      loading={<EditorLoading />}
      keepCurrentOriginalModel
      keepCurrentModifiedModel
      onMount={(editor) => (editorRef.current = editor)}
      options={{
        readOnly: true,
        originalEditable: false,
        automaticLayout: true,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        renderSideBySideInlineBreakpoint: 700,
        fontSize: 13,
      }}
    />
  )
}
