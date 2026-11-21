import { useEffect, useId, useRef, type CSSProperties, type ReactNode } from 'react'
import logoUrl from './assets/icelunacat-logo.png'

export type IconName =
  | 'plus'
  | 'search'
  | 'chat'
  | 'image'
  | 'settings'
  | 'book'
  | 'arrow'
  | 'chevron'
  | 'close'
  | 'download'
  | 'upload'
  | 'compress'
  | 'spark'
  | 'check'
  | 'trash'
  | 'edit'
  | 'copy'
  | 'refresh'
  | 'menu'
  | 'sun'
  | 'moon'
  | 'globe'
  | 'user'
  | 'code'
  | 'stop'
  | 'external'
  | 'eye'
  | 'branch'
const paths: Record<IconName, ReactNode> = {
  branch: (
    <>
      <circle cx="6" cy="5" r="2" />
      <circle cx="6" cy="19" r="2" />
      <circle cx="18" cy="5" r="2" />
      <path d="M6 7v10m0-4c0-4 12 0 12-6" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m16 16 4 4" />
    </>
  ),
  chat: <path d="M20 11.5a8 8 0 0 1-8 8H5l-3 2v-10a9 9 0 0 1 18 0Z" />,
  image: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="4" />
      <circle cx="8" cy="8" r="1.5" />
      <path d="m4 17 5-5 4 4 3-3 5 5" />
    </>
  ),
  settings: (
    <>
      <path d="m9 3-1 3-3 1-2 4 2 2 1 4 4 2 2-1 4 1 3-3v-4l2-3-2-4-4-1-3-2Z" />
      <circle cx="12" cy="11" r="3" />
    </>
  ),
  book: (
    <>
      <path d="M12 5v15M12 5C8 2 5 3 3 4v15c3-2 6-1 9 1 3-2 6-3 9-1V4c-2-1-5-2-9 1Z" />
    </>
  ),
  arrow: <path d="M12 19V5m-6 6 6-6 6 6" />,
  chevron: <path d="m9 5 7 7-7 7" />,
  close: <path d="m6 6 12 12M6 18 18 6" />,
  download: (
    <>
      <path d="M12 3v12m-5-5 5 5 5-5M4 15v5h16v-5" />
    </>
  ),
  upload: (
    <>
      <path d="M12 16V4m-5 5 5-5 5 5M4 15v5h16v-5" />
    </>
  ),
  compress: (
    <>
      <path d="M4 3v5h5m11-5v5h-5M4 21v-5h5m11 5v-5h-5M3 8l5-5m8 0 5 5M3 16l5 5m8 0 5-5" />
    </>
  ),
  spark: (
    <>
      <path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z" />
      <path d="M20 2v4m-2-2h4" />
    </>
  ),
  check: <path d="m5 12 4 4L19 6" />,
  trash: (
    <>
      <path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7" />
    </>
  ),
  edit: (
    <>
      <path d="m14 5 5 5M4 20l5-1L21 7l-5-5L4 14v6Z" />
    </>
  ),
  copy: (
    <>
      <rect x="8" y="8" width="12" height="13" rx="2" />
      <path d="M15 8V3H3v12h5" />
    </>
  ),
  refresh: (
    <>
      <path d="M20 10a8 8 0 1 0-1 7M20 4v6h-6" />
    </>
  ),
  menu: <path d="M4 6h16M4 12h16M4 18h16" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1 1m12 12 1 1M5 19l1-1M18 6l1-1" />
    </>
  ),
  moon: <path d="M20 14a8 8 0 0 1-10-10 8.5 8.5 0 1 0 10 10Z" />,
  globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <ellipse cx="12" cy="12" rx="4" ry="9" />
      <path d="M3 12h18" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21v-2a8 8 0 0 1 16 0v2" />
    </>
  ),
  code: <path d="m8 5-6 7 6 7m8-14 6 7-6 7m-3-16-2 18" />,
  stop: <rect x="6" y="6" width="12" height="12" rx="2" />,
  external: (
    <>
      <path d="M14 3h7v7M21 3 10 14M10 3H3v18h18v-7" />
    </>
  ),
  eye: (
    <>
      <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
}
export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  )
}
export function BrandLogo({ size = 40 }: { size?: number }) {
  const filterId = `icelunacat-tone-${useId().replaceAll(':', '')}`
  return (
    <svg
      className="brand-logo"
      width={size}
      height={size}
      viewBox="532 527 984 984"
      role="img"
      aria-label="IceLunaCat Logo"
      style={{ '--logo-dark-filter': `url(#${filterId})` } as CSSProperties}
    >
      <defs>
        <filter id={filterId} colorInterpolationFilters="sRGB">
          <feColorMatrix
            type="matrix"
            values=".65 0 0 0 .35 0 .65 0 0 .35 0 0 .65 0 .35 0 0 0 1 0"
          />
        </filter>
      </defs>
      <image className="logo-art" href={logoUrl} width="2048" height="2048" />
    </svg>
  )
}
export function Avatar({
  src,
  name,
  assistant = false,
}: {
  src: string
  name: string
  assistant?: boolean
}) {
  return (
    <span className={`avatar ${assistant ? 'assistant-avatar' : ''}`}>
      {src ? (
        <img src={src} alt={`${name}的头像`} />
      ) : assistant ? (
        <BrandLogo size={27} />
      ) : (
        name.slice(0, 1).toUpperCase()
      )}
    </span>
  )
}
export function Modal({
  title,
  subtitle,
  children,
  onClose,
  wide = false,
}: {
  title: string
  subtitle?: string
  children: ReactNode
  onClose: () => void
  wide?: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    ref.current?.focus()
    return () => previous?.focus()
  }, [])
  return (
    <div
      className="overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className={`modal ${wide ? 'wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        ref={ref}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation()
            onClose()
          }
          if (e.key === 'Tab') {
            const nodes = ref.current?.querySelectorAll<HTMLElement>(
              'button:not(:disabled),input,select,textarea,a[href]'
            )
            if (!nodes?.length) return
            const first = nodes[0],
              last = nodes[nodes.length - 1]
            if (e.shiftKey && document.activeElement === first) {
              e.preventDefault()
              last.focus()
            } else if (!e.shiftKey && document.activeElement === last) {
              e.preventDefault()
              first.focus()
            }
          }
        }}
      >
        <header className="modal-head">
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button className="icon-button" onClick={onClose} aria-label="关闭">
            <Icon name="close" />
          </button>
        </header>
        {children}
      </div>
    </div>
  )
}
export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  )
}
