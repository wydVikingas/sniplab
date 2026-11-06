import { loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import EditorWorker from 'monaco-editor/editor/editor.worker?worker'
import TsWorker from 'monaco-editor/language/typescript/ts.worker?worker'

// Bundle Monaco locally instead of letting @monaco-editor/react fetch it from a CDN,
// so the editor works offline and no third-party script runs on the app's origin.
self.MonacoEnvironment = {
  getWorker(_workerId, label) {
    if (label === 'typescript' || label === 'javascript') return new TsWorker()
    return new EditorWorker()
  },
}

// Treat every snippet as an ES module: allows top-level await and stops snippets that
// declare the same top-level names from clashing in the shared TS language service.
const compilerOptions: monaco.typescript.CompilerOptions = {
  target: monaco.typescript.ScriptTarget.ESNext,
  module: monaco.typescript.ModuleKind.ESNext,
  moduleDetection: 3, // ts.ModuleDetectionKind.Force
  allowNonTsExtensions: true,
  strict: true,
}
monaco.typescript.typescriptDefaults.setCompilerOptions(compilerOptions)
monaco.typescript.javascriptDefaults.setCompilerOptions({ ...compilerOptions, allowJs: true })

loader.config({ monaco })
