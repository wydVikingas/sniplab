import Editor from '@monaco-editor/react'
import type { Language } from '../db/schema'
import { LANGUAGE_INFO } from '../lib/languages'
import type { ColorScheme } from '../lib/useColorScheme'
import { EditorLoading } from './EditorLoading'
import './monacoSetup'

export interface CodeEditorProps {
  value: string
  language: Language
  theme: ColorScheme
  onChange: (value: string) => void
}

export default function CodeEditor({ value, language, theme, onChange }: CodeEditorProps) {
  const info = LANGUAGE_INFO[language]
  return (
    <Editor
      value={value}
      language={info.monacoId}
      theme={theme === 'dark' ? 'vs-dark' : 'vs'}
      onChange={(next) => onChange(next ?? '')}
      loading={<EditorLoading />}
      options={{
        ariaLabel: 'Code editor',
        automaticLayout: true,
        fixedOverflowWidgets: true,
        fontSize: 14,
        minimap: { enabled: false },
        padding: { top: 12, bottom: 12 },
        scrollBeyondLastLine: false,
        tabSize: info.tabSize,
      }}
    />
  )
}
