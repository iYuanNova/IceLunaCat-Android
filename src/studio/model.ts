import { openDB } from 'idb'
import {
  applyAutoLimits,
  normalizeModel,
  validEffort,
  type ModelInfo,
  type ModelPurpose,
} from './models.js'

export type WorldEntry = {
  id: string
  title: string
  keys: string
  content: string
  enabled: boolean
  always: boolean
}
export type ImageAttachment = { id: string; name: string; url: string }
export type ContextMessage = { role: 'user' | 'assistant'; content: string; images?: string[] }
export type SearchProvider = 'auto' | 'deepseek' | 'openrouter' | 'claude' | 'openai' | 'tavily'
export type SearchSource = { title: string; url: string }
export type SearchReport = { status: 'complete' | 'unused' | 'failed'; sources: SearchSource[] }
export type Message = {
  id: string
  role: 'user' | 'assistant'
  content: string
  edited?: boolean
  image?: string
  imageRemote?: boolean
  attachments?: ImageAttachment[]
  kind?: 'image'
  thinking?: string
  error?: string
  interrupted?: boolean
  usage?: { input: number; output: number }
  created: number
  model?: string
  channel?: string
  search?: SearchReport
}
export type Chat = {
  id: string
  title: string
  messages: Message[]
  created: number
  updated: number
  persona: string
  userPersona: string
  world: WorldEntry[]
  summary: string
  compressedUntil: number
  draft: string
  draftImages?: ImageAttachment[]
  chatModel?: ModelSelection
  imageModel?: ModelSelection
  branch?: { parentChatId: string; parentMessageId: string; parentTitle: string }
}
export type ModelSelection = {
  channelId: string
  model: string
  modelInfo?: ModelInfo
  reasoningEffort?: string
}
export type Settings = {
  base: string
  key: string
  model: string
  limitsMode: 'auto' | 'manual'
  modelInfo?: ModelInfo
  reasoningEffort?: string
  searchProvider?: SearchProvider
  searchKey?: string
  searchDepth?: 'basic' | 'advanced'
  protocol: 'openai' | 'anthropic'
  networkCompat?: boolean
  temperature: number
  maxTokens: number
  contextLimit: number
  imageBase: string
  imageKey: string
  imageNetworkCompat?: boolean
  imageModel: string
  imageModelSelectionVersion?: number
  imageSize: string
  imageQuality: string
  imageStream: boolean
  username: string
  avatar: string
  assistantName: string
  assistantAvatar: string
  background: string
  backgroundDim: number
  theme: 'light' | 'dark' | 'system'
}
const chatFields = [
  'base',
  'key',
  'model',
  'protocol',
  'networkCompat',
  'limitsMode',
  'modelInfo',
  'reasoningEffort',
  'temperature',
  'maxTokens',
  'contextLimit',
  'searchProvider',
] as const satisfies readonly (keyof Settings)[]
const imageFields = [
  'imageBase',
  'imageKey',
  'imageNetworkCompat',
  'imageModel',
  'imageSize',
  'imageQuality',
  'imageStream',
  'imageModelSelectionVersion',
] as const satisfies readonly (keyof Settings)[]
const workspaceFields = [
  'searchKey',
  'searchDepth',
  'username',
  'avatar',
  'assistantName',
  'assistantAvatar',
  'background',
  'backgroundDim',
  'theme',
] as const satisfies readonly (keyof Settings)[]

export type ChatConnection = Pick<Settings, (typeof chatFields)[number]>
export type ImageConnection = Pick<Settings, (typeof imageFields)[number]>
export type Channel<T> = { id: string; name: string; config: T }
export type ChannelGroup<T> = { activeId: string; channels: Channel<T>[] }
export type WorkspaceSettings = Pick<Settings, (typeof workspaceFields)[number]> & {
  chatChannels: ChannelGroup<ChatConnection>
  imageChannels: ChannelGroup<ImageConnection>
}
export type State = {
  version: 1
  chats: Chat[]
  active: string | null
  settings: WorkspaceSettings
}
export const defaults: Settings = {
  base: 'https://api.deepseek.com',
  key: '',
  model: '',
  protocol: 'openai',
  networkCompat: false,
  reasoningEffort: '',
  searchProvider: 'auto',
  searchKey: '',
  searchDepth: 'basic',
  limitsMode: 'auto',
  temperature: 0.7,
  maxTokens: 1_000_000,
  contextLimit: 1_000_000,
  imageBase: 'https://api.openai.com/v1',
  imageKey: '',
  imageNetworkCompat: false,
  imageModel: '',
  imageModelSelectionVersion: 2,
  imageSize: 'auto',
  imageQuality: 'auto',
  imageStream: false,
  username: '你',
  avatar: '',
  assistantName: 'IceLunaCat',
  assistantAvatar: '',
  background: '',
  backgroundDim: 85,
  theme: 'system',
}
export const uid = () => crypto.randomUUID()

function pick<K extends keyof Settings>(
  settings: Pick<Settings, K>,
  keys: readonly K[]
): Pick<Settings, K> {
  return Object.fromEntries(keys.map((key) => [key, settings[key]])) as Pick<Settings, K>
}
export const createChatChannel = (name: string): Channel<ChatConnection> => ({
  id: uid(),
  name,
  config: { ...pick(defaults, chatFields), base: '' },
})
export const createImageChannel = (name: string): Channel<ImageConnection> => ({
  id: uid(),
  name,
  config: { ...pick(defaults, imageFields), imageBase: '' },
})
export function activeChannel<T>(group: ChannelGroup<T>): Channel<T> {
  return group.channels.find((channel) => channel.id === group.activeId) ?? group.channels[0]
}
export function conversationChannel<T>(group: ChannelGroup<T>, selection?: ModelSelection) {
  return selection
    ? group.channels.find((channel) => channel.id === selection.channelId)
    : activeChannel(group)
}
export function activeSettings(settings: WorkspaceSettings): Settings {
  return {
    ...pick(settings, workspaceFields),
    ...activeChannel(settings.chatChannels).config,
    ...activeChannel(settings.imageChannels).config,
  }
}
export function conversationSettings(settings: WorkspaceSettings, chat?: Chat): Settings {
  const { chatModel, imageModel } = chat ?? {}
  const textChannel = conversationChannel(settings.chatChannels, chatModel)
  const imageChannel = conversationChannel(settings.imageChannels, imageModel)
  const textConfig = textChannel?.config ?? { ...pick(defaults, chatFields), base: '' }
  const imageConfig = imageChannel?.config ?? { ...pick(defaults, imageFields), imageBase: '' }
  const config = { ...pick(settings, workspaceFields), ...textConfig, ...imageConfig }
  if (imageChannel && imageModel) config.imageModel = imageModel.model
  if (!textChannel || !chatModel) return config
  const sameModel = textConfig.model === chatModel.model
  return applyAutoLimits({
    ...config,
    model: chatModel.model,
    modelInfo: (sameModel ? textConfig.modelInfo : undefined) ?? chatModel.modelInfo,
    reasoningEffort: chatModel.reasoningEffort ?? '',
    limitsMode: sameModel ? textConfig.limitsMode : 'auto',
  })
}
export function captureModelSelection(
  settings: Settings,
  channelId: string,
  purpose: ModelPurpose
): ModelSelection {
  return purpose === 'image'
    ? { channelId, model: settings.imageModel }
    : {
        channelId,
        model: settings.model,
        modelInfo: settings.modelInfo,
        reasoningEffort: settings.reasoningEffort,
      }
}
function updateActiveChannel<K extends keyof Settings>(
  group: ChannelGroup<Pick<Settings, K>>,
  next: Settings,
  fields: readonly K[]
): ChannelGroup<Pick<Settings, K>> {
  const active = activeChannel(group)
  if (fields.every((field) => active.config[field] === next[field])) return group
  return {
    ...group,
    channels: group.channels.map((channel) =>
      channel === active ? { ...active, config: pick(next, fields) } : channel
    ),
  }
}
export function updateSettings(
  settings: WorkspaceSettings,
  update: (settings: Settings) => Settings
): WorkspaceSettings {
  const current = activeSettings(settings)
  const next = update(current)
  if (next === current) return settings
  return {
    ...pick(next, workspaceFields),
    chatChannels: updateActiveChannel(settings.chatChannels, next, chatFields),
    imageChannels: updateActiveChannel(settings.imageChannels, next, imageFields),
  }
}
export function withoutApiKeys(settings: WorkspaceSettings): WorkspaceSettings {
  return {
    ...settings,
    searchKey: '',
    chatChannels: {
      ...settings.chatChannels,
      channels: settings.chatChannels.channels.map((channel) => ({
        ...channel,
        config: { ...channel.config, key: '' },
      })),
    },
    imageChannels: {
      ...settings.imageChannels,
      channels: settings.imageChannels.channels.map((channel) => ({
        ...channel,
        config: { ...channel.config, imageKey: '' },
      })),
    },
  }
}

type StoredSettings = Partial<Settings> & Partial<WorkspaceSettings>
function readChannels<T>(
  value: ChannelGroup<T> | undefined,
  fallback: Channel<T>,
  readConfig: (config: T) => T
): ChannelGroup<T> {
  if (value === undefined) return { activeId: fallback.id, channels: [fallback] }
  if (!value || !Array.isArray(value.channels) || !value.channels.length)
    throw new Error('API 渠道列表格式无效。')
  const ids = new Set<string>()
  const channels = value.channels.map((channel) => {
    if (
      !channel ||
      typeof channel.id !== 'string' ||
      !channel.id ||
      ids.has(channel.id) ||
      typeof channel.name !== 'string' ||
      !channel.name.trim() ||
      !channel.config ||
      typeof channel.config !== 'object' ||
      Array.isArray(channel.config)
    )
      throw new Error('API 渠道格式无效。')
    ids.add(channel.id)
    return { id: channel.id, name: channel.name, config: readConfig(channel.config) }
  })
  return { activeId: ids.has(value.activeId) ? value.activeId : channels[0].id, channels }
}

function restoreSettings(saved: StoredSettings): WorkspaceSettings {
  const legacy = {
    ...defaults,
    ...saved,
    // Older versions had implicit image model and size presets for unconfigured services.
    imageModel:
      saved.imageModelSelectionVersion === undefined &&
      !saved.imageKey?.trim() &&
      saved.imageModel === 'gpt-image-1'
        ? ''
        : (saved.imageModel ?? ''),
    imageSize:
      (saved.imageModelSelectionVersion ?? 0) < 2 &&
      !saved.imageKey?.trim() &&
      saved.imageSize === '1024x1024'
        ? 'auto'
        : (saved.imageSize ?? 'auto'),
    imageModelSelectionVersion: 2,
    limitsMode:
      saved.limitsMode ??
      (saved.maxTokens === undefined || (saved.maxTokens === 4096 && saved.contextLimit === 64000)
        ? 'auto'
        : 'manual'),
    assistantName:
      saved.assistantName === 'DeepSeek'
        ? 'IceLunaCat'
        : saved.assistantName || defaults.assistantName,
  } satisfies Settings
  const readChat = (config: Partial<ChatConnection>) => {
    const resolved = {
      ...defaults,
      ...pick({ ...defaults, ...config }, chatFields),
      modelInfo: normalizeModel(config.modelInfo) || undefined,
    }
    validateSettingsFields(resolved)
    return pick(applyAutoLimits(resolved), chatFields)
  }
  const readImage = (config: Partial<ImageConnection>) => {
    const resolved = { ...defaults, ...pick({ ...defaults, ...config }, imageFields) }
    validateSettingsFields(resolved)
    return pick(resolved, imageFields)
  }
  return {
    ...pick(legacy, workspaceFields),
    chatChannels: readChannels(
      saved.chatChannels,
      {
        id: 'default-chat',
        name: '默认对话渠道',
        config: readChat(saved.chatChannels === undefined ? legacy : defaults),
      },
      readChat
    ),
    imageChannels: readChannels(
      saved.imageChannels,
      {
        id: 'default-image',
        name: '默认生图渠道',
        config: readImage(saved.imageChannels === undefined ? legacy : defaults),
      },
      readImage
    ),
  }
}

export const newChat = (): Chat => ({
  id: uid(),
  title: '新的对话',
  messages: [],
  created: Date.now(),
  updated: Date.now(),
  persona: '',
  userPersona: '',
  world: [],
  summary: '',
  compressedUntil: 0,
  draft: '',
})
export function editMessageContent(chat: Chat, messageId: string, content: string): Chat {
  const index = chat.messages.findIndex((message) => message.id === messageId)
  const original = chat.messages[index]
  if (!original || original.interrupted || original.content === content) return chat
  if (!content.trim() && !original.attachments?.length) return chat
  const messages = [...chat.messages]
  messages[index] = { ...original, content, edited: true }
  return {
    ...chat,
    messages,
    updated: Date.now(),
    ...(index < chat.compressedUntil ? { summary: '', compressedUntil: 0 } : {}),
  }
}

/** Copy only the selected prefix. A summary beyond that prefix would leak later facts. */
export function createChatBranch(source: Chat, throughMessageId: string): Chat {
  const index = source.messages.findIndex((m) => m.id === throughMessageId)
  if (index < 0) throw new Error('找不到分支起点，请刷新后重试。')
  const prefix = source.messages.slice(0, index + 1)
  if (prefix.some((m) => m.interrupted)) throw new Error('请等待这条回复完成后再创建分支。')
  const canKeepSummary = !!source.summary && source.compressedUntil <= prefix.length
  return {
    ...newChat(),
    title: `${source.title.slice(0, 60)} · 分支`,
    messages: structuredClone(prefix).map((m) => ({ ...m, id: uid() })),
    persona: source.persona,
    userPersona: source.userPersona,
    chatModel: source.chatModel && structuredClone(source.chatModel),
    imageModel: source.imageModel && structuredClone(source.imageModel),
    world: structuredClone(source.world),
    summary: canKeepSummary ? source.summary : '',
    compressedUntil: canKeepSummary ? source.compressedUntil : 0,
    branch: {
      parentChatId: source.id,
      parentMessageId: throughMessageId,
      parentTitle: source.title,
    },
  }
}
export const initialState = (): State => ({
  version: 1,
  chats: [],
  active: null,
  settings: restoreSettings({}),
})
let database: ReturnType<typeof openDB> | undefined
const db = () =>
  (database ??= openDB('deepseek-studio', 1, {
    upgrade(d) {
      d.createObjectStore('workspace')
    },
  }))
export async function loadState(): Promise<State> {
  const d = await db()
  const saved = (await d.get('workspace', 'state')) as
    | (Omit<State, 'settings'> & { settings: StoredSettings })
    | undefined
  if (!saved) return initialState()
  return {
    ...saved,
    settings: restoreSettings(saved.settings),
    chats: saved.chats.map((c) => ({
      ...c,
      messages: c.messages.map((m) =>
        m.interrupted ? { ...m, error: '上次生成已中断，可重新生成。', interrupted: false } : m
      ),
    })),
  }
}
export async function saveState(state: State) {
  const d = await db()
  await d.put('workspace', state, 'state')
}
export async function readModelCache(
  key: string
): Promise<{ models: ModelInfo[]; saved: number } | undefined> {
  const d = await db()
  return d.get('workspace', key)
}
export async function writeModelCache(key: string, models: ModelInfo[]) {
  const d = await db()
  await d.put('workspace', { models, saved: Date.now() }, key)
}
export function estimateTokens(text: string): number {
  // A model-independent estimate, never represented as a provider's exact count.
  const cjk = text.match(/[\u2E80-\u9FFF\uAC00-\uD7AF\u3040-\u30FF]/gu)?.length || 0
  return Math.ceil(cjk * 1.5 + (text.length - cjk) / 4)
}
export function activeWorld(chat: Chat, draft = '') {
  const text = [...chat.messages.slice(-6).map((m) => m.content), draft]
    .join('\n')
    .toLocaleLowerCase()
  return chat.world.filter(
    (w) =>
      w.enabled &&
      (w.always ||
        w.keys
          .split(/[,，\n]/)
          .map((x) => x.trim().toLocaleLowerCase())
          .filter(Boolean)
          .some((k) => text.includes(k)))
  )
}
function buildSystemPrompt(chat: Chat, world: WorldEntry[]) {
  return [
    chat.persona && `【助手人设】\n${chat.persona}`,
    chat.userPersona && `【用户设定】\n${chat.userPersona}`,
    ...world.map((w) => `【世界书：${w.title}】\n${w.content}`),
    chat.summary && `【先前对话摘要】\n${chat.summary}`,
  ]
    .filter(Boolean)
    .join('\n\n')
}
export function systemPrompt(chat: Chat, draft = '') {
  return buildSystemPrompt(chat, activeWorld(chat, draft))
}
function appendContextMessage(result: ContextMessage[], m: Message) {
  if (m.error || m.interrupted) return
  if (m.kind === 'image' && m.image) {
    result.push({ role: 'assistant', content: `已生成图片。提示词：${m.content}` })
    // Vision endpoints accept images in user content.
    result.push({
      role: 'user',
      content: '这是助手刚才生成的图片，供后续对话参考。',
      images: [m.image],
    })
  } else if (m.content || m.attachments?.length) {
    result.push({
      role: m.role,
      content: m.content,
      ...(m.attachments?.length ? { images: m.attachments.map((a) => a.url) } : {}),
    })
  }
}
export function contextMessages(chat: Chat): ContextMessage[] {
  const result: ContextMessage[] = []
  for (const message of chat.messages.slice(chat.compressedUntil))
    appendContextMessage(result, message)
  return result
}
// Placeholder estimate; actual image tokens depend on model and resolution.
const imageTokenEstimate = 1600
export const messageTokens = (m: ContextMessage) =>
  estimateTokens(m.content) + (m.images?.length || 0) * imageTokenEstimate + 4

// Studio replaces changed messages and arrays, so unchanged history can reuse its estimates.
const messageEstimates = new WeakMap<Message, number>()
const historyEstimates = new WeakMap<Message[], { compressedUntil: number; tokens: number }>()

function historyTokens(chat: Chat) {
  const cached = historyEstimates.get(chat.messages)
  if (cached?.compressedUntil === chat.compressedUntil) return cached.tokens

  let tokens = 0
  for (const message of chat.messages.slice(chat.compressedUntil)) {
    let estimate = messageEstimates.get(message)
    if (estimate === undefined) {
      const context: ContextMessage[] = []
      appendContextMessage(context, message)
      estimate = context.reduce((total, entry) => total + messageTokens(entry), 0)
      messageEstimates.set(message, estimate)
    }
    tokens += estimate
  }
  historyEstimates.set(chat.messages, { compressedUntil: chat.compressedUntil, tokens })
  return tokens
}
export function contextUsage(chat: Chat, draft = '') {
  const world = activeWorld(chat, draft)
  const tokens =
    estimateTokens(buildSystemPrompt(chat, world)) +
    historyTokens(chat) +
    estimateTokens(draft) +
    (chat.draftImages?.length || 0) * imageTokenEstimate +
    8
  return { tokens, worldCount: world.length }
}
export function contextTokens(chat: Chat, draft = '') {
  return contextUsage(chat, draft).tokens
}
function validateSettingsFields(merged: Settings) {
  const texts = [
    'base',
    'key',
    'model',
    'imageBase',
    'imageKey',
    'imageModel',
    'imageSize',
    'searchKey',
    'imageQuality',
    'username',
    'avatar',
    'assistantName',
    'assistantAvatar',
    'background',
  ] as const
  for (const k of texts) if (typeof merged[k] !== 'string') throw new Error('设置字段格式无效。')
  for (const n of ['temperature', 'maxTokens', 'contextLimit', 'backgroundDim'] as const)
    if (!Number.isFinite(merged[n])) throw new Error('数值设置格式无效。')
  if (
    (merged.reasoningEffort !== '' && !validEffort(merged.reasoningEffort)) ||
    !['auto', 'deepseek', 'openrouter', 'claude', 'openai', 'tavily'].includes(
      merged.searchProvider ?? 'auto'
    ) ||
    !['basic', 'advanced'].includes(merged.searchDepth ?? 'basic') ||
    !['auto', 'manual'].includes(merged.limitsMode) ||
    !['openai', 'anthropic'].includes(merged.protocol) ||
    (merged.networkCompat !== undefined && typeof merged.networkCompat !== 'boolean') ||
    (merged.imageNetworkCompat !== undefined && typeof merged.imageNetworkCompat !== 'boolean') ||
    typeof merged.imageStream !== 'boolean' ||
    !['light', 'dark', 'system'].includes(merged.theme)
  )
    throw new Error('接口或主题格式无效。')
}
export function validateImport(raw: unknown): State {
  const s = raw as Omit<State, 'settings'> & { settings: StoredSettings }
  if (
    !s ||
    s.version !== 1 ||
    !Array.isArray(s.chats) ||
    !s.settings ||
    typeof s.settings !== 'object' ||
    Array.isArray(s.settings) ||
    s.chats.length > 10000
  )
    throw new Error('文件格式不正确，请选择 IceLunaCat 或旧版 DeepSeek Studio 导出的 JSON 备份。')
  validateSettingsFields({ ...defaults, ...s.settings })
  const settings = restoreSettings(s.settings)
  const merged = activeSettings(settings)
  for (const url of [merged.avatar, merged.assistantAvatar, merged.background])
    if (
      url &&
      !/^data:image\/(png|jpeg|webp|gif|avif);base64,/i.test(url) &&
      !/^https?:\/\//i.test(url)
    )
      throw new Error('图片地址格式无效。')
  const validSearch = (report: SearchReport | undefined) =>
    report === undefined ||
    (!!report &&
      ['complete', 'unused', 'failed'].includes(report.status) &&
      Array.isArray(report.sources) &&
      report.sources.length <= 30 &&
      report.sources.every(
        (source) =>
          source &&
          typeof source.title === 'string' &&
          typeof source.url === 'string' &&
          /^https?:\/\//i.test(source.url)
      ))
  const ids = new Set<string>()
  const validSelection = (selection: ModelSelection | undefined) =>
    selection === undefined ||
    (selection &&
      typeof selection.channelId === 'string' &&
      !!selection.channelId &&
      typeof selection.model === 'string' &&
      (selection.reasoningEffort === undefined ||
        selection.reasoningEffort === '' ||
        validEffort(selection.reasoningEffort)) &&
      (selection.modelInfo === undefined ||
        normalizeModel(selection.modelInfo)?.id === selection.model))
  const validAttachments = (items: ImageAttachment[] | undefined) =>
    items === undefined ||
    (Array.isArray(items) &&
      items.length <= 8 &&
      items.every(
        (a) =>
          a &&
          typeof a.id === 'string' &&
          typeof a.name === 'string' &&
          typeof a.url === 'string' &&
          /^data:image\/(png|jpeg|webp|gif);base64,[a-z\d+/]+={0,2}$/i.test(a.url)
      ))
  for (const c of s.chats) {
    if (
      !c ||
      typeof c.id !== 'string' ||
      ids.has(c.id) ||
      typeof c.title !== 'string' ||
      !Array.isArray(c.messages) ||
      !Array.isArray(c.world) ||
      typeof c.persona !== 'string' ||
      typeof c.userPersona !== 'string' ||
      typeof c.summary !== 'string' ||
      typeof c.draft !== 'string' ||
      !validSelection(c.chatModel) ||
      !validSelection(c.imageModel) ||
      !validAttachments(c.draftImages) ||
      !Number.isInteger(c.compressedUntil) ||
      c.compressedUntil < 0 ||
      c.compressedUntil > c.messages.length
    )
      throw new Error('聊天记录格式无效。')
    ids.add(c.id)
    if (
      c.branch &&
      ['parentChatId', 'parentMessageId', 'parentTitle'].some(
        (k) => typeof c.branch?.[k as keyof NonNullable<Chat['branch']>] !== 'string'
      )
    )
      throw new Error('聊天分支信息格式无效。')
    for (const m of c.messages)
      if (
        !m ||
        typeof m.id !== 'string' ||
        !['user', 'assistant'].includes(m.role) ||
        typeof m.content !== 'string' ||
        (m.edited !== undefined && typeof m.edited !== 'boolean') ||
        !validAttachments(m.attachments) ||
        !validSearch(m.search) ||
        (m.model !== undefined && typeof m.model !== 'string') ||
        (m.channel !== undefined && typeof m.channel !== 'string') ||
        (m.image &&
          !/^data:image\/(png|jpeg|webp|gif|avif);base64,/i.test(m.image) &&
          !/^https?:\/\//i.test(m.image))
      )
        throw new Error('消息格式无效。')
    for (const w of c.world)
      if (
        !w ||
        ['id', 'title', 'keys', 'content'].some(
          (k) => typeof w[k as keyof WorldEntry] !== 'string'
        ) ||
        typeof w.enabled !== 'boolean' ||
        typeof w.always !== 'boolean'
      )
        throw new Error('世界书格式无效。')
  }
  return {
    version: 1,
    chats: s.chats,
    settings,
    active: s.chats.some((c) => c.id === s.active) ? s.active : null,
  }
}
