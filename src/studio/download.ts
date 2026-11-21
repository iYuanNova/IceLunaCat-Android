import { blobToDataURL, readableError } from './api.js'
import { isAndroidApp } from './network.js'

async function saveAndroidFile(data: string | Blob, filename: string) {
  const blob = typeof data === 'string' ? await (await fetch(data)).blob() : data
  const send = (message: object) => {
    if (window.prompt('IceLunaCat:save', JSON.stringify(message)) !== 'ok')
      throw new Error('无法保存文件，请重试。')
  }
  send({ action: 'start', filename, mime: blob.type })
  try {
    const chunkSize = 64 * 1024
    for (let offset = 0; offset < blob.size; offset += chunkSize) {
      const url = await blobToDataURL(blob.slice(offset, offset + chunkSize))
      send({ action: 'data', bytes: url.slice(url.indexOf(',') + 1) })
    }
    send({ action: 'finish' })
  } catch (err) {
    window.prompt('IceLunaCat:save', '{"action":"cancel"}')
    throw err
  }
}
export function download(data: string | Blob, filename: string) {
  if (
    isAndroidApp() &&
    (data instanceof Blob || data.startsWith('data:'))
  ) {
    void saveAndroidFile(data, filename).catch((error) => window.alert(readableError(error)))
    return
  }
  const url = typeof data === 'string' ? data : URL.createObjectURL(data)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  if (typeof data === 'string' && !data.startsWith('data:')) a.target = '_blank'
  a.click()
  if (data instanceof Blob) setTimeout(() => URL.revokeObjectURL(url), 1000)
}

