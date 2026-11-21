import type { Settings } from './model.js'

export type ModelPurpose = 'chat' | 'image'
/** Image discovery must never use the chat service's credentials or protocol. */
export function modelDiscoverySettings(settings: Settings, purpose: ModelPurpose): Settings {
  return purpose === 'image'
    ? {
        ...settings,
        base: settings.imageBase,
        key: settings.imageKey,
        networkCompat: settings.imageNetworkCompat,
        model: settings.imageModel,
        modelInfo: undefined,
        protocol: 'openai',
      }
    : settings
}

export const FALLBACK_TOKEN_LIMIT = 1_000_000
export type ModelInfo = {
  id: string
  name?: string
  contextLimit?: number
  maxOutputTokens?: number
  effortLevels?: string[]
  defaultEffort?: string
  effortMandatory?: boolean
}
export function modelSearchRank(query: string, model: Pick<ModelInfo, 'id' | 'name'>): number {
  if (!query) return 0
  return Math.min(
    ...[model.name ?? '', model.id].map((value) => {
      const text = value.toLocaleLowerCase()
      if (text.startsWith(query)) return 0
      const contiguous = text.indexOf(query)
      if (contiguous >= 0) return 1 + contiguous / (text.length + 1)
      let index = -1
      let first = -1
      for (const char of query) {
        index = text.indexOf(char, index + 1)
        if (index < 0) return Infinity
        if (first < 0) first = index
      }
      return 2 + (index - first) / (text.length + 1)
    })
  )
}
export type ResolvedLimits = {
  contextLimit: number
  maxTokens: number
  contextSource: 'api' | 'official' | 'fallback'
  outputSource: 'api' | 'official' | 'fallback'
}

// Verified official API model pages on 2026-11-18. Exact IDs only; an API's own
// limits always win, including when a gateway imposes lower limits.
const officialLimits: Record<string, { context: number; output: number; source: string }> = {
  'gpt-6.1-sol': {
    context: 1_050_000,
    output: 128_000,
    source: 'https://developers.openai.com/api/docs/models/gpt-6.1-sol',
  },
  'gpt-5': {
    context: 400_000,
    output: 128_000,
    source: 'https://developers.openai.com/api/docs/models/gpt-5',
  },
  'gpt-5.6-sol': {
    context: 1_050_000,
    output: 128_000,
    source: 'https://developers.openai.com/api/docs/models/gpt-5.6-sol',
  },
  'gpt-5.6-terra': {
    context: 1_050_000,
    output: 128_000,
    source: 'https://developers.openai.com/api/docs/models/gpt-5.6-terra',
  },
}
function positive(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value !== 'number' && typeof value !== 'string') continue
    if (typeof value === 'string' && !/^\d+$/.test(value.trim())) continue
    const n = Number(value)
    if (Number.isSafeInteger(n) && n > 0 && n <= 1_000_000_000) return n
  }
  return undefined
}
const effortOrder = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']
export const validEffort = (v: unknown): v is string =>
  typeof v === 'string' && /^[a-z][a-z0-9_-]{0,23}$/.test(v)

function normalizeEffort(m: Record<string, any>) {
  const effort = m.capabilities?.effort
  const claudeLevels =
    effort && effort.supported !== false
      ? effortOrder.filter((value) => effort[value]?.supported === true || effort[value] === true)
      : undefined
  const raw =
    m.effort?.supported_levels ??
    m.reasoning?.supported_efforts ??
    m.effortLevels ??
    m.supported_reasoning_efforts ??
    m.supported_reasoning_levels ??
    m.reasoning_effort?.enum ??
    claudeLevels
  const unrestricted = m.reasoning?.supported_efforts === null
  const levels = [
    ...new Set(
      (Array.isArray(raw) ? raw : unrestricted ? effortOrder.slice(0, 7) : []).filter(validEffort)
    ),
  ].slice(0, 12)
  const mandatory = m.reasoning?.mandatory === true || m.effortMandatory === true
  const ordered = mandatory ? levels.filter((level) => level !== 'none') : levels
  if (ordered.every((level) => effortOrder.includes(level)))
    ordered.sort((a, b) => effortOrder.indexOf(a) - effortOrder.indexOf(b))
  const preferred = m.effort?.default_level ?? m.reasoning?.default_effort ?? m.defaultEffort
  return {
    ...(ordered.length ? { effortLevels: ordered } : {}),
    ...(ordered.includes(preferred) ? { defaultEffort: preferred as string } : {}),
    ...(mandatory ? { effortMandatory: true } : {}),
  }
}

export function apiHost(settings: Settings) {
  try {
    return new URL(settings.base).hostname
  } catch {
    return ''
  }
}

export function effortLevels(settings: Settings) {
  if (settings.modelInfo?.id !== settings.model) return []
  const levels = settings.modelInfo?.effortLevels ?? []
  const deepseekMode = apiHost(settings) === 'api.deepseek.com'
  return deepseekMode &&
    levels.length &&
    !levels.includes('none') &&
    !settings.modelInfo?.effortMandatory
    ? ['none', ...levels]
    : levels
}

export function effortParameters(settings: Settings) {
  const effort = settings.reasoningEffort
  if (!effort || !effortLevels(settings).includes(effort)) return {}
  const host = apiHost(settings)
  const deepseek = host === 'api.deepseek.com'
  if (host === 'openrouter.ai' && settings.protocol === 'openai') return { reasoning: { effort } }
  if (settings.protocol === 'anthropic') {
    if (deepseek)
      return effort === 'none'
        ? { thinking: { type: 'disabled' } }
        : { thinking: { type: 'enabled' }, output_config: { effort } }
    return effort === 'none' ? { thinking: { type: 'disabled' } } : { output_config: { effort } }
  }
  if (deepseek)
    return effort === 'none'
      ? { thinking: { type: 'disabled' } }
      : { thinking: { type: 'enabled' }, reasoning_effort: effort }
  return { reasoning_effort: effort }
}

export function normalizeModel(raw: unknown): ModelInfo | null {
  if (typeof raw === 'string') return raw.trim() ? { id: raw.trim() } : null
  if (!raw || typeof raw !== 'object') return null
  const m = raw as Record<string, any>
  if (m.lifecycle === 'retired') return null
  const id = m.id || m.model || m.name
  if (typeof id !== 'string' || !id.trim()) return null
  const name = m.display_name || m.name
  return {
    id: id.trim(),
    ...normalizeEffort(m),
    ...(typeof name === 'string' && name !== id ? { name } : {}),
    contextLimit: positive(
      m.context_window,
      m.context_length,
      m.max_context_length,
      m.max_context_tokens,
      m.max_input_tokens,
      m.input_token_limit,
      m.contextLimit,
      m.limits?.context_window,
      m.limits?.context,
      m.limits?.max_input_tokens,
      m.top_provider?.context_length,
      m.architecture?.context_length
    ),
    maxOutputTokens: positive(
      m.max_output_tokens,
      m.max_completion_tokens,
      m.max_tokens,
      m.output_token_limit,
      m.maxOutputTokens,
      m.limits?.max_output_tokens,
      m.limits?.output,
      m.top_provider?.max_completion_tokens
    ),
  }
}
export function resolveModelLimits(id: string, info?: ModelInfo): ResolvedLimits {
  const metadata = info?.id === id ? info : undefined
  const known = Object.hasOwn(officialLimits, id) ? officialLimits[id] : undefined
  return {
    contextLimit: positive(metadata?.contextLimit) ?? known?.context ?? FALLBACK_TOKEN_LIMIT,
    maxTokens: positive(metadata?.maxOutputTokens) ?? known?.output ?? FALLBACK_TOKEN_LIMIT,
    contextSource: positive(metadata?.contextLimit) ? 'api' : known ? 'official' : 'fallback',
    outputSource: positive(metadata?.maxOutputTokens) ? 'api' : known ? 'official' : 'fallback',
  }
}
export function applyAutoLimits(settings: Settings, info?: ModelInfo): Settings {
  const metadata =
    info?.id === settings.model
      ? info
      : settings.modelInfo?.id === settings.model
        ? settings.modelInfo
        : undefined
  const limits = resolveModelLimits(settings.model, metadata)
  const automatic = settings.limitsMode !== 'manual' || !settings.model
  const maxTokens = automatic ? limits.maxTokens : settings.maxTokens
  const contextLimit = automatic ? limits.contextLimit : settings.contextLimit
  if (
    settings.maxTokens === maxTokens &&
    settings.contextLimit === contextLimit &&
    JSON.stringify(settings.modelInfo) === JSON.stringify(metadata)
  )
    return settings
  return { ...settings, maxTokens, contextLimit, modelInfo: metadata }
}
export function selectModel(settings: Settings, id: string, info?: ModelInfo): Settings {
  return applyAutoLimits(
    {
      ...settings,
      model: id,
      modelInfo: info,
      limitsMode: 'auto',
      reasoningEffort: settings.model === id ? settings.reasoningEffort : '',
    },
    info
  )
}
export function formatTokenLimit(n: number) {
  return n >= 1_000_000
    ? `${Number((n / 1_000_000).toFixed(3))}M`
    : n >= 1000
      ? `${Number((n / 1000).toFixed(3))}K`
      : String(n)
}
