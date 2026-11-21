import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import type { Settings } from './model.js'
import { effortLevels } from './models.js'
import { Icon } from './StudioControls.js'

const effortNames: Record<string, string> = {
  none: '关闭',
  minimal: '极低',
  low: '轻度',
  medium: '中',
  high: '高',
  xhigh: '极高',
  max: 'Ultra',
  ultra: 'Ultra',
}
const effortLabel = (effort: string) =>
  effort ? (Object.hasOwn(effortNames, effort) ? effortNames[effort] : effort) : '默认'

// Evenly distributed phases and independently distributed heights keep the
// particles from lining up as they move across the track.
const effortStars = Array.from({ length: 22 }, (_, i) => {
  const phase = (i * 0.618034) % 1
  const height = ((i * 17 + 11) % 23) / 23
  const duration = 2.8 + ((i * 7) % 11) / 10
  return {
    left: `${phase * 100}%`,
    top: `${12 + height * 76}%`,
    '--star-size': `${1.1 + ((i * 3) % 7) * 0.25}px`,
    '--star-opacity': 0.4 + ((i * 5) % 13) * 0.045,
    animationDuration: `${duration}s`,
    animationDelay: `${-duration * phase}s`,
  } as CSSProperties
})

export function EffortSlider({
  settings,
  onChange,
}: {
  settings: Settings
  onChange: (value: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [peakNotice, setPeakNotice] = useState(false)
  const previousPeak = useRef(false)
  const [dragPosition, setDragPosition] = useState<number | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const rangeRef = useRef<HTMLInputElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const activePointer = useRef<number | null>(null)
  const id = useId()
  const levels = effortLevels(settings)
  const apiDefault = settings.modelInfo?.defaultEffort ?? ''
  const selected = settings.reasoningEffort ?? ''
  const selectedIndex = levels.indexOf(selected)
  const lastIndex = Math.max(0, levels.length - 1)
  const index = selectedIndex >= 0 ? selectedIndex : Math.max(0, levels.indexOf(apiDefault))
  const position = dragPosition ?? (lastIndex ? index / lastIndex : 0)
  const previewIndex = Math.round(position * lastIndex)
  const current =
    dragPosition !== null ? (levels[previewIndex] ?? '') : (levels[selectedIndex] ?? apiDefault)
  const peak = current === 'max' || current === 'ultra'
  const committedPeak =
    (levels[selectedIndex] ?? apiDefault) === 'max' ||
    (levels[selectedIndex] ?? apiDefault) === 'ultra'
  const visual = { '--effort-position': position } as CSSProperties
  const modelName = settings.modelInfo?.name || settings.model
  const available = levels.length > 0

  const pointPosition = (event: ReactPointerEvent<HTMLDivElement>) => {
    const bounds = trackRef.current?.getBoundingClientRect()
    if (!bounds || bounds.width <= 30) return position
    return Math.min(1, Math.max(0, (event.clientX - bounds.left - 15) / (bounds.width - 30)))
  }
  const cancelDrag = () => {
    activePointer.current = null
    setDragPosition(null)
  }
  useEffect(() => {
    const entered = committedPeak && !previousPeak.current
    previousPeak.current = committedPeak
    setPeakNotice(open && entered)
    if (!open || !entered) return
    const timeout = setTimeout(() => setPeakNotice(false), 1800)
    return () => clearTimeout(timeout)
  }, [committedPeak, open])
  useEffect(() => {
    if (!open) return
    const close = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [open])
  return (
    <div
      className="effort-control"
      ref={ref}
      style={visual}
      data-effort={peak ? 'max' : current || 'none'}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) {
          cancelDrag()
          e.stopPropagation()
          setOpen(false)
          ref.current?.querySelector('button')?.focus()
        }
      }}
    >
      <button
        className="composer-option effort-trigger"
        aria-label={`思考等级：${effortLabel(current)}`}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen(!open)}
      >
        <span className="effort-trigger-name">{modelName || '思考等级'}</span>
        <strong>{effortLabel(current)}</strong>
        <Icon name="chevron" size={12} />
      </button>
      {open && (
        <div className={`effort-popover ${peak ? 'effort-peak' : ''}`} id={id}>
          <div className={`effort-heading ${peak && peakNotice ? 'effort-arrival' : ''}`}>
            {peak && peakNotice && (
              <span className="effort-usage-note" role="status">
                更快的消耗Token
              </span>
            )}
            <output aria-live="off">{effortLabel(current)}</output>
            <span className="effort-model-name">{modelName || '思考等级'}</span>
            {available && (
              <button
                className="icon-button effort-reset"
                aria-label="重置思考等级"
                title={apiDefault ? `恢复默认 · ${effortLabel(apiDefault)}` : '恢复 API 默认'}
                onClick={() => {
                  cancelDrag()
                  onChange('')
                }}
              >
                <Icon name="refresh" size={17} />
              </button>
            )}
          </div>
          {available ? (
            <>
              <div
                className={`effort-slider ${dragPosition !== null ? 'dragging' : ''}`}
                onPointerDown={(event) => {
                  if (!event.isPrimary || event.button !== 0 || activePointer.current !== null)
                    return
                  event.preventDefault()
                  rangeRef.current?.focus({ preventScroll: true })
                  event.currentTarget.setPointerCapture(event.pointerId)
                  activePointer.current = event.pointerId
                  setDragPosition(pointPosition(event))
                }}
                onPointerMove={(event) => {
                  if (activePointer.current === event.pointerId)
                    setDragPosition(pointPosition(event))
                }}
                onPointerUp={(event) => {
                  if (activePointer.current !== event.pointerId) return
                  const target = Math.round(pointPosition(event) * lastIndex)
                  cancelDrag()
                  onChange(levels[target])
                }}
                onPointerCancel={(event) => {
                  if (activePointer.current === event.pointerId) cancelDrag()
                }}
                onLostPointerCapture={(event) => {
                  if (activePointer.current === event.pointerId) cancelDrag()
                }}
              >
                <div className="effort-track" ref={trackRef} aria-hidden="true">
                  <span className="effort-fill">
                    {peak && (
                      <span className="effort-stars">
                        {effortStars.map((style, star) => (
                          <i key={star} style={style} />
                        ))}
                      </span>
                    )}
                  </span>
                  {levels.map((level, step) => (
                    <i
                      className={`effort-stop ${step <= previewIndex && current !== '' && current !== 'none' ? 'passed' : ''}`}
                      key={level}
                      style={{ '--effort-tick': lastIndex ? step / lastIndex : 0 } as CSSProperties}
                    />
                  ))}
                  <span className="effort-thumb" />
                </div>
                <input
                  ref={rangeRef}
                  id={`${id}-range`}
                  type="range"
                  min={0}
                  max={lastIndex}
                  step={1}
                  value={previewIndex}
                  aria-label="思考等级"
                  aria-valuetext={effortLabel(current)}
                  onChange={(event) => onChange(levels[Number(event.target.value)])}
                />
              </div>
            </>
          ) : (
            <small>
              {settings.model
                ? 'API 未提供此模型的可选档位，使用服务端默认。可在模型列表刷新。'
                : '请先选择对话模型。'}
            </small>
          )}
        </div>
      )}
    </div>
  )
}

