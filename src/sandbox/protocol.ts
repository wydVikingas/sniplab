/**
 * Message protocol between the app (host) and the sandbox iframe/worker.
 *
 * Everything arriving FROM the sandbox is untrusted and is validated with these schemas
 * before use. The sandbox scripts themselves (`runtime/*.js`) are plain JS served verbatim,
 * so they mirror these shapes by hand — keep them in sync.
 */
import { z } from 'zod'

export const RESULT_EXPORT = '__sniplab_result__'
export const MAX_LOG_CALLS = 10_000
const MAX_STRING = 10_000
const MAX_ITEMS = 100

/** A JS value converted to plain data inside the sandbox so it can cross postMessage. */
export type SerializedValue =
  | { t: 'undefined' }
  | { t: 'null' }
  | { t: 'boolean'; v: boolean }
  | { t: 'number'; v: string }
  | { t: 'bigint'; v: string }
  | { t: 'string'; v: string; truncated?: boolean }
  | { t: 'symbol'; v: string }
  | { t: 'function'; name: string; isClass: boolean }
  | { t: 'date'; v: string }
  | { t: 'regexp'; v: string }
  | { t: 'error'; name: string; message: string; stack: string | null }
  | { t: 'promise' }
  | { t: 'circular' }
  | { t: 'getter' }
  | { t: 'unknown'; v: string }
  /** Nesting/size budget reached; shown as e.g. `[Object]`. */
  | { t: 'depth'; kind: 'array' | 'object' | 'map' | 'set'; ctor: string | null }
  | { t: 'array'; ctor: string | null; length: number; items: SerializedValue[] }
  | { t: 'object'; ctor: string | null; size: number; entries: [string, SerializedValue][] }
  | { t: 'map'; size: number; entries: [SerializedValue, SerializedValue][] }
  | { t: 'set'; size: number; items: SerializedValue[] }

const shortString = z.string().max(MAX_STRING)
const ctor = z.string().max(200).nullable()
const count = z.number().int().nonnegative()

export const serializedValueSchema: z.ZodType<SerializedValue> = z.lazy(() =>
  z.discriminatedUnion('t', [
    z.object({ t: z.literal('undefined') }),
    z.object({ t: z.literal('null') }),
    z.object({ t: z.literal('boolean'), v: z.boolean() }),
    z.object({ t: z.literal('number'), v: z.string().max(400) }),
    z.object({ t: z.literal('bigint'), v: shortString }),
    z.object({ t: z.literal('string'), v: shortString, truncated: z.boolean().optional() }),
    z.object({ t: z.literal('symbol'), v: shortString }),
    z.object({ t: z.literal('function'), name: z.string().max(200), isClass: z.boolean() }),
    z.object({ t: z.literal('date'), v: z.string().max(100) }),
    z.object({ t: z.literal('regexp'), v: shortString }),
    z.object({
      t: z.literal('error'),
      name: z.string().max(200),
      message: shortString,
      stack: shortString.nullable(),
    }),
    z.object({ t: z.literal('promise') }),
    z.object({ t: z.literal('circular') }),
    z.object({ t: z.literal('getter') }),
    z.object({ t: z.literal('unknown'), v: shortString }),
    z.object({ t: z.literal('depth'), kind: z.enum(['array', 'object', 'map', 'set']), ctor }),
    z.object({
      t: z.literal('array'),
      ctor,
      length: count,
      items: z.array(serializedValueSchema).max(MAX_ITEMS),
    }),
    z.object({
      t: z.literal('object'),
      ctor,
      size: count,
      entries: z.array(z.tuple([z.string().max(1_000), serializedValueSchema])).max(MAX_ITEMS),
    }),
    z.object({
      t: z.literal('map'),
      size: count,
      entries: z.array(z.tuple([serializedValueSchema, serializedValueSchema])).max(MAX_ITEMS),
    }),
    z.object({
      t: z.literal('set'),
      size: count,
      items: z.array(serializedValueSchema).max(MAX_ITEMS),
    }),
  ]),
)

export const LOG_LEVELS = ['log', 'info', 'warn', 'error', 'debug'] as const
export const logLevelSchema = z.enum(LOG_LEVELS)
export type LogLevel = z.infer<typeof logLevelSchema>

export const runErrorSchema = z.object({
  name: z.string().max(200),
  message: z.string().max(MAX_STRING),
  stack: z.string().max(20_000).nullable(),
  /** 1-based position in the user's original code, when known. */
  line: z.number().int().positive().nullable(),
  column: z.number().int().positive().nullable(),
})
export type RunError = z.infer<typeof runErrorSchema>

const runIdSchema = z.string().min(1).max(100)

/** Messages the sandbox sends to the host. */
export const sandboxMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ready') }),
  z.object({
    type: z.literal('log'),
    runId: runIdSchema,
    level: logLevelSchema,
    args: z.array(serializedValueSchema).max(MAX_ITEMS),
  }),
  z.object({ type: z.literal('result'), runId: runIdSchema, value: serializedValueSchema }),
  z.object({ type: z.literal('error'), runId: runIdSchema, error: runErrorSchema }),
  z.object({ type: z.literal('done'), runId: runIdSchema }),
])
export type SandboxMessage = z.infer<typeof sandboxMessageSchema>

/** Messages the host sends to the sandbox. */
export const hostMessageSchema = z.object({
  type: z.literal('run'),
  runId: runIdSchema,
  runtime: z.literal('javascript'),
  /** ES module source; if `hasResult`, it exports the last expression as RESULT_EXPORT. */
  source: z.string(),
  hasResult: z.boolean(),
  resultExport: z.literal(RESULT_EXPORT),
  maxLogs: z.number().int().positive(),
})
export type HostMessage = z.infer<typeof hostMessageSchema>
