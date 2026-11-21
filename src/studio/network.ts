export const isAndroidApp = () =>
  typeof navigator !== 'undefined' && navigator.userAgent.includes(' IceLunaCatAndroid/')

type NativeEvent =
  | { type: 'pending' }
  | { type: 'end' }
  | { type: 'error'; message: string }
  | { type: 'headers'; status: number; contentType: string }
  | { type: 'data'; bytes: string }

function androidCommand(request: object): NativeEvent {
  const result = window.prompt('IceLunaCat:api', JSON.stringify(request))
  if (!result) throw new Error('当前 Android 版本不支持原生兼容模式，请更新应用。')
  return JSON.parse(result) as NativeEvent
}

async function nativeFetch(url: URL, init: RequestInit): Promise<Response> {
  const signal = init.signal
  signal?.throwIfAborted()
  const id = crypto.randomUUID()
  const start = androidCommand({
    action: 'start',
    id,
    url: url.href,
    method: init.method ?? 'GET',
    headers: Object.fromEntries(new Headers(init.headers)),
    body: init.body ?? null,
  })
  if (start.type === 'error') throw new Error(start.message)

  let closed = false
  const close = () => {
    if (closed) return
    closed = true
    signal?.removeEventListener('abort', close)
    try {
      androidCommand({ action: 'cancel', id })
    } catch {
      // A closed bridge has no remaining web client to notify.
    }
  }
  signal?.addEventListener('abort', close, { once: true })
  const next = async (): Promise<Exclude<NativeEvent, { type: 'pending' | 'error' }>> => {
    while (true) {
      signal?.throwIfAborted()
      const event = androidCommand({ action: 'read', id })
      if (event.type === 'error') throw new Error(event.message)
      if (event.type !== 'pending') return event
      await new Promise<void>((resolve) => setTimeout(resolve, 30))
    }
  }

  try {
    const head = await next()
    if (head.type !== 'headers') throw new Error('兼容模式未收到 API 响应。')
    const responseHeaders = { 'Content-Type': head.contentType }
    if ([204, 205, 304].includes(head.status)) {
      close()
      return new Response(null, { status: head.status, headers: responseHeaders })
    }
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const event = await next()
          if (event.type === 'data') {
            controller.enqueue(Uint8Array.from(atob(event.bytes), (x) => x.charCodeAt(0)))
          } else {
            close()
            controller.close()
          }
        } catch (error) {
          close()
          controller.error(error)
        }
      },
      cancel: close,
    })
    return new Response(body, { status: head.status, headers: responseHeaders })
  } catch (error) {
    close()
    throw error
  }
}

export async function providerFetch(address: string, init: RequestInit, compatibility?: boolean) {
  if (!compatibility || !isAndroidApp()) return fetch(address, init)
  const url = new URL(address)
  if (url.protocol !== 'https:') throw new Error('网络兼容模式需要 HTTPS API 地址。')
  return nativeFetch(url, init)
}
