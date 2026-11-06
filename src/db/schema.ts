import { z } from 'zod'

export const LANGUAGES = ['javascript', 'typescript', 'python'] as const
export const languageSchema = z.enum(LANGUAGES)
export type Language = z.infer<typeof languageSchema>

export const DEFAULT_TIMEOUT_MS = 5_000
export const MAX_TIMEOUT_MS = 30_000

export const runSettingsSchema = z.object({
  timeoutMs: z.number().int().min(100).max(MAX_TIMEOUT_MS),
  allowNetwork: z.boolean(),
  /** Text fed to the snippet's standard input (Python `input()`, JS `readInput()`). */
  stdin: z.string().max(100_000),
})
export type RunSettings = z.infer<typeof runSettingsSchema>

export const tagSchema = z.string().trim().min(1).max(50)

export const snippetSchema = z.object({
  id: z.string().min(1),
  title: z.string().max(200),
  description: z.string().max(20_000),
  language: languageSchema,
  code: z.string().max(500_000),
  tags: z.array(tagSchema).max(30),
  folderId: z.string().nullable(),
  favorite: z.boolean(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
  /** Soft-delete marker: non-null means the snippet is in the Trash. */
  deletedAt: z.number().int().nullable(),
  /** When the snippet was last opened in the editor (drives the "Recent" view). */
  lastOpenedAt: z.number().int().nullable(),
  runSettings: runSettingsSchema,
})
export type Snippet = z.infer<typeof snippetSchema>

/** Fields a user may edit directly. Identity and timestamps are managed by the repository. */
export const snippetPatchSchema = snippetSchema
  .pick({
    title: true,
    description: true,
    language: true,
    code: true,
    tags: true,
    folderId: true,
    favorite: true,
    runSettings: true,
  })
  .partial()
  .strict()
export type SnippetPatch = z.infer<typeof snippetPatchSchema>

export const folderSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(100),
  parentId: z.string().nullable(),
  order: z.number(),
  createdAt: z.number().int(),
})
export type Folder = z.infer<typeof folderSchema>

export const snippetVersionSchema = z.object({
  id: z.string().min(1),
  snippetId: z.string().min(1),
  title: z.string(),
  language: languageSchema,
  code: z.string(),
  createdAt: z.number().int(),
})
export type SnippetVersion = z.infer<typeof snippetVersionSchema>
