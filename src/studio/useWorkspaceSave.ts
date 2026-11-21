import { useEffect, useRef, useState } from 'react'
import { readableError } from './api.js'
import { saveState, type State } from './model.js'

const saveDelay = 250
const maximumDraftDelay = 1000

function createWorkspaceWriter(
  onSaved: (snapshot: State) => void,
  onError: (error: unknown) => void
) {
  let pending: State | null = null
  let saved: State | null = null
  let writing = false

  async function drain() {
    writing = true
    try {
      while (pending) {
        const snapshot: State = pending
        pending = null
        try {
          if (saved !== snapshot) await saveState(snapshot)
          saved = snapshot
          onSaved(snapshot)
        } catch (error) {
          onError(error)
        }
      }
    } finally {
      writing = false
    }
  }

  return (snapshot: State) => {
    pending = snapshot
    if (!writing) void drain()
  }
}

export function useWorkspaceSave(
  state: State,
  latest: Readonly<{ current: State }>,
  ready: boolean,
  running: boolean,
  setStorageError: (message: string) => void
) {
  const [saved, setSaved] = useState(true)
  const [write] = useState(() =>
    createWorkspaceWriter(
      (snapshot) => {
        if (latest.current === snapshot) {
          setSaved(true)
          setStorageError('')
        }
      },
      (error) => setStorageError(`保存失败：${readableError(error)}。请导出备份并检查可用空间。`)
    )
  )
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dirtySince = useRef<number | null>(null)
  const previous = useRef<{ state: State; running: boolean } | null>(null)

  const [flush] = useState(() => () => {
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = null
    dirtySince.current = null
    write(latest.current)
  })

  useEffect(() => {
    if (!ready) return
    const last = previous.current
    previous.current = { state, running }
    const finished = last?.running && !running
    if (last?.state === state && !finished) return
    setSaved(false)
    if (
      !last ||
      finished ||
      last.state.active !== state.active ||
      last.state.settings !== state.settings ||
      last.state.chats.length !== state.chats.length
    ) {
      flush()
      return
    }

    const now = performance.now()
    dirtySince.current ??= now
    if (running && timer.current !== null) return
    if (timer.current !== null) clearTimeout(timer.current)
    const remaining = Math.max(0, maximumDraftDelay - (now - dirtySince.current))
    timer.current = setTimeout(flush, Math.min(saveDelay, remaining))
  }, [state, ready, running, flush])

  useEffect(() => {
    if (!ready) return
    const hidden = () => {
      if (document.visibilityState === 'hidden') flush()
    }
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', hidden)
    return () => {
      window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', hidden)
      if (timer.current !== null) clearTimeout(timer.current)
      timer.current = null
      dirtySince.current = null
    }
  }, [ready, flush])

  return saved
}
