import { providerFetch } from './network.js'
import { readServerSentEvents } from '../services/api/sse.js'
import {
  estimateTokens,
  messageTokens,
  readModelCache,
  writeModelCache,
  type ContextMessage,
  type Settings,
} from './model.js'
import { apiHost, effortParameters, normalizeModel, type ModelInfo } from './models.js'
import {
  collectSearchProgress,
  nativeSearchParameters,
  resolveSearch,
  searchTavily,
  type SearchStage,
} from './search.js'
export type ApiMessage = ContextMessage
export function wireMessages(messages: ApiMessage[], anthropic: boolean) {
  const converted: { role: 'user' | 'assistant'; content: any }[] = []
  for (const m of messages) {
    if (m.images?.length && m.role !== 'user') throw new Error('图片必须通过用户消息发送。')
    const content = m.images?.length
      ? [
          ...(m.content ? [{ type: 'text', text: m.content }] : []),
          ...m.images.map((url) => {
            if (!anthropic) return { type: 'image_url', image_url: { url } }
            const data = /^data:(image\/(?:png|jpeg|gif|webp));base64,([a-z\d+/]+={0,2})$/i.exec(
              url
            )
            if (url.startsWith('data:') && !data)
              throw new Error('此图片格式不受视觉接口支持，请使用 PNG、JPG、WebP 或 GIF。')
            return {
              type: 'image',
              source: data
                ? { type: 'base64', media_type: data[1].toLowerCase(), data: data[2] }
                : { type: 'url', url },
            }
          }),
        ]
      : m.content
    const previous = converted.at(-1)
    // A generated-image reference and the following user turn form one user message.
    if (previous?.role === m.role && (anthropic || m.role === 'user')) {
      const blocks = (c: any) => (typeof c === 'string' ? [{ type: 'text', text: c }] : c)
      previous.content =
        typeof previous.content === 'string' && typeof content === 'string'
          ? previous.content + '\n\n' + content
          : [...blocks(previous.content), ...blocks(content)]
    } else converted.push({ role: m.role, content })
  }
  return converted
}
export function endpoint(
  base: string,
  path: 'chat/completions' | 'messages' | 'images/generations' | 'models'
) {
  const url = new URL(base.trim())
  if (
    !['https:', 'http:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error('API 地址须为不含密钥、查询参数的 HTTP(S) 地址。')
  const root = url.href
    .replace(/\/+$/, '')
    .replace(/\/(chat\/completions|messages|images\/generations|models)$/, '')
  return `${root}${/\/v\d+(?:beta)?$/.test(root) ? '' : '/v1'}/${path}`
}
function headers(key: string, anthropic = false): Record<string, string> {
  return anthropic
    ? {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      }
    : { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }
}
async function check(r: Response) {
  if (r.ok) return
  let detail = ''
  try {
    const data = await r.json()
    detail = data.error?.message || data.message || ''
  } catch {
    /* Non-JSON gateway errors. */
  }
  throw new Error(`API 请求失败 (${r.status})${detail ? `：${String(detail).slice(0, 400)}` : ''}`)
}
export function readableError(error: unknown) {
  if (error instanceof DOMException && error.name === 'AbortError') return '已停止生成'
  if (error instanceof TypeError && /fetch|network/i.test(error.message))
    return '无法连接 API。请检查地址和网络，也可以在渠道设置里试用「改善网络兼容性」。'
  return error instanceof Error ? error.message : '发生未知错误'
}
export async function chatRequest(
  settings: Settings,
  messages: ApiMessage[],
  system: string,
  signal: AbortSignal,
  onUpdate: (text: string, thinking: string) => void,
  options: {
    webSearch?: boolean
    query?: string
    onSearchStage?: (stage: SearchStage) => void
  } = {}
) {
  if (!settings.key.trim()) throw new Error('请先在设置 → 对话 API 中填写 API Key。')
  if (!settings.model.trim()) throw new Error('请先选择一个对话模型。')
  const provider = options.webSearch ? resolveSearch(settings) : undefined
  if (options.webSearch && !provider)
    throw new Error('当前 API 未配置搜索。请在设置 → 联网搜索中选择服务，或填写 Tavily API Key。')
  const searchParams = nativeSearchParameters(provider, settings)
  const reasoningParams = effortParameters(settings)
  const officialOpenAI = apiHost(settings) === 'api.openai.com'
  const searchProgress = collectSearchProgress(options.onSearchStage)
  let tavily: Awaited<ReturnType<typeof searchTavily>> | undefined
  if (provider === 'tavily') {
    options.onSearchStage?.('searching')
    try {
      tavily = await searchTavily(
        options.query?.trim() ||
          messages.filter((message) => message.role === 'user').at(-1)?.content ||
          '',
        settings,
        signal
      )
    } catch (error) {
      if (error instanceof TypeError) throw new Error('无法连接 Tavily 搜索，请检查网络后重试。')
      throw error
    }
    system = [system, tavily.context].filter(Boolean).join('\n\n')
    options.onSearchStage?.('answering')
  } else if (provider) options.onSearchStage?.('checking')
  const inputTokens =
    estimateTokens(system) + messages.reduce((n, m) => n + messageTokens(m), 0) + 8
  const available = settings.contextLimit - inputTokens - 256
  if (available < 1) throw new Error('预计输入已接近上下文上限，请先压缩上下文。')
  const outputBudget = Math.min(settings.maxTokens, available)
  const a = settings.protocol === 'anthropic'
  const wire = wireMessages(messages, a)
  const body = a
    ? {
        model: settings.model,
        max_tokens: outputBudget,
        ...('output_config' in reasoningParams && apiHost(settings) === 'api.anthropic.com'
          ? {}
          : { temperature: settings.temperature }),
        stream: true,
        ...reasoningParams,
        ...searchParams,
        ...(system ? { system } : {}),
        messages: wire,
      }
    : {
        model: settings.model,
        ...(officialOpenAI &&
        (provider === 'openai' ||
          /^gpt-5-search-api(?:-|$)/.test(settings.model) ||
          'reasoning_effort' in reasoningParams)
          ? { max_completion_tokens: outputBudget }
          : { max_tokens: outputBudget, temperature: settings.temperature }),
        stream: true,
        ...reasoningParams,
        ...searchParams,
        messages: [...(system ? [{ role: 'system', content: system }] : []), ...wire],
      }
  const payload = JSON.stringify(body)
  const r = await providerFetch(
    endpoint(settings.base, a ? 'messages' : 'chat/completions'),
    {
      method: 'POST',
      headers: headers(settings.key, a),
      body: payload,
      signal,
    },
    settings.networkCompat
  )
  await check(r)
  let text = '',
    thinking = '',
    input = 0,
    output = 0,
    model = settings.model
  const collect = (data: any) => {
    if (data.error || data.type === 'error')
      throw new Error(data.error?.message || data.message || 'API 返回错误')
    searchProgress.collect(data)
    const previousText = text
    const previousThinking = thinking
    const returnedModel = data.model || data.message?.model
    if (typeof returnedModel === 'string' && returnedModel.trim()) model = returnedModel
    if (a) {
      if (Array.isArray(data.content)) {
        text += data.content
          .filter((b: any) => b.type === 'text')
          .map((b: any) => b.text)
          .join('')
        thinking += data.content
          .filter((b: any) => b.type === 'thinking')
          .map((b: any) => b.thinking)
          .join('')
      }
      if (data.type === 'content_block_delta') {
        text += data.delta?.text || ''
        thinking += data.delta?.thinking || ''
      }
      if (data.type === 'content_block_start') {
        text += data.content_block?.text || ''
        thinking += data.content_block?.thinking || ''
      }
      input = data.message?.usage?.input_tokens ?? data.usage?.input_tokens ?? input
      output = data.usage?.output_tokens ?? output
    } else {
      text += data.choices?.[0]?.delta?.content || data.choices?.[0]?.message?.content || ''
      thinking +=
        data.choices?.[0]?.delta?.reasoning_content ||
        data.choices?.[0]?.message?.reasoning_content ||
        data.choices?.[0]?.delta?.reasoning ||
        data.choices?.[0]?.message?.reasoning ||
        ''
      input = data.usage?.prompt_tokens ?? input
      output = data.usage?.completion_tokens ?? output
    }
    if (text !== previousText || thinking !== previousThinking) onUpdate(text, thinking)
  }
  if (r.headers.get('content-type')?.includes('text/event-stream')) {
    if (!r.body) throw new Error('API 没有返回响应流。')
    for await (const event of readServerSentEvents(r.body, signal)) {
      if (event.data === '[DONE]') break
      collect(JSON.parse(event.data))
    }
  } else collect(await r.json())
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
  if (!text.trim() && !thinking.trim()) throw new Error('接口返回空内容，请检查模型和接口协议。')
  const search = tavily
    ? { status: 'complete' as const, sources: tavily.sources }
    : searchProgress.report(!!provider)
  return { content: text, thinking, model, usage: { input, output }, ...(search ? { search } : {}) }
}
const modelMemoryCache = new Map<string, { models: ModelInfo[]; saved: number }>()
const modelInflight = new Map<string, Promise<ModelInfo[]>>()
const modelCacheTTL = 5 * 60 * 1000
export type ModelConnection = Pick<Settings, 'base' | 'key' | 'protocol' | 'networkCompat'>
async function modelCacheKey(settings: ModelConnection) {
  // Only a fingerprint is persisted; the API key itself is never stored in the cache key.
  const input = [
    endpoint(settings.base, 'models'),
    settings.protocol,
    settings.key.trim(),
    !!settings.networkCompat,
  ].join('\n')
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return (
    'models:' + Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join('')
  )
}
export async function getCachedModels(settings: ModelConnection): Promise<ModelInfo[]> {
  if (!settings.key.trim()) return []
  try {
    const key = await modelCacheKey(settings)
    const cached = modelMemoryCache.get(key) || (await readModelCache(key))
    if (!cached || Date.now() - cached.saved > 30 * 24 * 60 * 60 * 1000) return []
    const models = cached.models.map(normalizeModel).filter((m): m is ModelInfo => !!m)
    modelMemoryCache.set(key, { ...cached, models })
    return models
  } catch {
    return []
  }
}
function withSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'))
  return new Promise((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener('abort', abort)
      reject(new DOMException('Aborted', 'AbortError'))
    }
    signal.addEventListener('abort', abort, { once: true })
    promise.then(
      (value) => {
        signal.removeEventListener('abort', abort)
        resolve(value)
      },
      (error) => {
        signal.removeEventListener('abort', abort)
        reject(error)
      }
    )
  })
}
export async function getModels(
  settings: ModelConnection,
  signal: AbortSignal,
  force = false
): Promise<ModelInfo[]> {
  if (!settings.key.trim()) throw new Error('填写 API 地址与密钥后，会自动获取模型。')
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
  const key = await modelCacheKey(settings)
  const cached = modelMemoryCache.get(key)
  if (!force && cached && Date.now() - cached.saved < modelCacheTTL) return cached.models
  let request = modelInflight.get(key)
  if (!request) {
    request = (async () => {
      const all = new Map<string, ModelInfo>(),
        cursors = new Set<string>()
      const url = new URL(endpoint(settings.base, 'models'))
      // DeepSeek's discovery endpoint is shared by its OpenAI and Anthropic routes.
      if (url.hostname === 'api.deepseek.com') url.pathname = '/models'
      const timeout = AbortSignal.timeout(20000)
      for (let page = 0; page < 100; page++) {
        const r = await providerFetch(
          url.href,
          {
            headers: headers(
              settings.key,
              settings.protocol === 'anthropic' && url.hostname !== 'api.deepseek.com'
            ),
            signal: timeout,
          },
          settings.networkCompat
        )
        await check(r)
        const data = await r.json()
        const raw = Array.isArray(data) ? data : data.data || data.models || []
        if (!Array.isArray(raw)) throw new Error('接口返回的模型列表格式不正确。')
        for (const item of raw) {
          const m = normalizeModel(item)
          if (m) all.set(m.id, m)
        }
        if (!data.has_more) break
        const cursor = data.last_id || raw.at(-1)?.id
        if (typeof cursor !== 'string' || !cursor || cursors.has(cursor) || page === 99)
          throw new Error('模型列表分页不完整，请重试或手动填写模型。')
        cursors.add(cursor)
        url.searchParams.set(settings.protocol === 'anthropic' ? 'after_id' : 'after', cursor)
      }
      const models = [...all.values()].sort((a, b) => a.id.localeCompare(b.id))
      if (!models.length) throw new Error('接口未返回可用模型；可刷新重试或手动添加模型。')
      modelMemoryCache.set(key, { models, saved: Date.now() })
      // Caching must never block discovery when storage is unavailable.
      void writeModelCache(key, models).catch(() => {})
      return models
    })()
    modelInflight.set(key, request)
    void request.finally(() => modelInflight.delete(key)).catch(() => {})
  }
  return withSignal(request, signal)
}
export async function imageRequest(
  settings: Settings,
  prompt: string,
  signal: AbortSignal,
  onPartial: (image: string) => void
) {
  if (!settings.imageKey.trim()) throw new Error('请先在设置 → 生图 API 中填写独立的 API Key。')
  if (!settings.imageModel.trim()) throw new Error('请先选择一个生图模型。')
  const r = await providerFetch(
    endpoint(settings.imageBase, 'images/generations'),
    {
      method: 'POST',
      headers: headers(settings.imageKey),
      signal,
      body: JSON.stringify({
        model: settings.imageModel,
        prompt,
        n: 1,
        size: settings.imageSize,
        quality: settings.imageQuality,
        ...(settings.imageStream ? { stream: true, partial_images: 3 } : {}),
      }),
    },
    settings.imageNetworkCompat
  )
  await check(r)
  let image = '',
    completed = false,
    model = settings.imageModel
  const collect = (d: any) => {
    if (d.error || d.type === 'error')
      throw new Error(d.error?.message || d.message || '生图 API 返回错误')
    if (typeof d.model === 'string' && d.model.trim()) model = d.model
    const item = d.data?.[0] || d
    const b64 = item.b64_json || item.partial_image_b64
    const partial = d.type?.includes('partial') || !!item.partial_image_b64
    if (b64 && !partial) completed = true
    if (item.url) completed = true
    if (b64) {
      image = `data:${item.output_format === 'jpeg' ? 'image/jpeg' : item.output_format === 'webp' ? 'image/webp' : 'image/png'};base64,${b64}`
      if (d.type?.includes('partial') || item.partial_image_b64) onPartial(image)
    } else if (item.url) image = item.url
  }
  if (r.headers.get('content-type')?.includes('text/event-stream')) {
    if (!r.body) throw new Error('生图接口没有返回数据流。')
    for await (const event of readServerSentEvents(r.body, signal)) {
      if (event.data === '[DONE]') break
      collect(JSON.parse(event.data))
    }
  } else collect(await r.json())
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
  if (!image || !completed)
    throw new Error(
      '没有收到完整图片。请确认接口支持 OpenAI Images API，返回 data[0].b64_json 或 url。'
    )
  if (image.startsWith('data:')) return { image, remote: false, model }
  // Copy expiring provider URLs into IndexedDB whenever the provider permits CORS.
  try {
    const downloaded = await fetch(image, { signal, credentials: 'omit' })
    if (!downloaded.ok) throw new Error('Image download failed')
    const blob = await downloaded.blob()
    if (!blob.type.startsWith('image/')) throw new Error('Not an image')
    const data = await blobToDataURL(blob)
    return { image: data, remote: false, model }
  } catch (e) {
    if (signal.aborted) throw e
    return { image, remote: true, model }
  }
}
export function blobToDataURL(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('读取文件失败'))
    reader.readAsDataURL(file)
  })
}
