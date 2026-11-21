import { useEffect, useId, useRef, useState } from 'react'
import type { Settings } from './model.js'
import { getCachedModels, getModels, readableError, type ModelConnection } from './api.js'
import {
  formatTokenLimit,
  modelDiscoverySettings,
  modelSearchRank,
  normalizeModel,
  resolveModelLimits,
  type ModelInfo,
  type ModelPurpose,
} from './models.js'

export type ModelSource = ModelConnection & {
  id: string
  name: string
  model: string
  modelInfo?: ModelInfo
}
type Catalog = { scope: string; models: ModelInfo[]; loading: boolean; error: string }
type ModelRow = { source: ModelSource; model: ModelInfo; saved: boolean; key: string }

const configured = (source: ModelConnection) => !!(source.base.trim() && source.key.trim())
const scopeOf = (source: ModelConnection) =>
  JSON.stringify([source.base, source.protocol, source.key, !!source.networkCompat])
const rowKey = (source: string, model: string) => JSON.stringify([source, model])
const emptyCatalog = (scope: string, loading: boolean): Catalog => ({
  scope,
  loading,
  models: [],
  error: '',
})

function CatalogLoader({
  source,
  revision,
  delay,
  onUpdate,
}: {
  source: ModelSource
  revision: number
  delay: number
  onUpdate: (id: string, scope: string, update: (catalog: Catalog) => Catalog) => void
}) {
  const scope = scopeOf(source)
  const lastRevision = useRef(revision)
  const updateRef = useRef(onUpdate)
  updateRef.current = onUpdate
  const { id, base, key, protocol, networkCompat } = source
  useEffect(() => {
    const connection = { base, key, protocol, networkCompat }
    if (!configured(connection)) return
    const abort = new AbortController()
    const force = lastRevision.current !== revision
    lastRevision.current = revision
    const publish = (update: (catalog: Catalog) => Catalog) => {
      if (!abort.signal.aborted) updateRef.current(id, scope, update)
    }
    publish((old) => ({ ...old, loading: true, error: '' }))
    void getCachedModels(connection).then((models) => {
      if (models.length) publish((old) => (old.loading ? { ...old, models } : old))
    })
    const timer = setTimeout(async () => {
      try {
        const models = await getModels(connection, abort.signal, force)
        publish((old) => ({ ...old, models, loading: false, error: '' }))
      } catch (error) {
        publish((old) => ({ ...old, loading: false, error: readableError(error) }))
      }
    }, delay)
    return () => {
      clearTimeout(timer)
      abort.abort()
    }
  }, [id, base, key, protocol, networkCompat, scope, revision, delay])
  return null
}

export function ModelPicker({
  settings,
  onSelect,
  onResolve,
  compact = false,
  settingsCatalog = false,
  purpose = 'chat',
  directory,
}: {
  settings: Settings
  onSelect: (id: string, model?: ModelInfo, channelId?: string) => void
  onResolve?: (model?: ModelInfo) => void
  compact?: boolean
  settingsCatalog?: boolean
  purpose?: ModelPurpose
  directory?: { activeId: string; sources: ModelSource[]; onManage: () => void }
}) {
  const config = modelDiscoverySettings(settings, purpose)
  const imageMode = purpose === 'image'
  const activeId = directory?.activeId ?? 'form'
  const sources = directory?.sources ?? [{ ...config, id: 'form', name: '' }]
  const activeSource = sources.find((source) => source.id === activeId)
  const [catalogs, setCatalogs] = useState<Record<string, Catalog>>({})
  const [open, setOpen] = useState(false)
  const [browsed, setBrowsed] = useState(false)
  const [search, setSearch] = useState('')
  const [highlight, setHighlight] = useState('')
  const [revision, setRevision] = useState(0)
  const [custom, setCustom] = useState(false)
  const [manual, setManual] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const resolveRef = useRef(onResolve)
  resolveRef.current = onResolve
  const listId = useId()
  const connectionReady = configured(config)
  const catalogFor = (source: ModelSource) => {
    const scope = scopeOf(source)
    const current = catalogs[source.id]
    return current?.scope === scope ? current : emptyCatalog(scope, configured(source))
  }
  const groups = sources.map((source) => ({
    source,
    catalog: catalogFor(source),
  }))
  const activeCatalog = activeSource ? catalogFor(activeSource) : undefined
  const selected =
    activeCatalog?.models.find((model) => model.id === config.model) ??
    (config.modelInfo?.id === config.model ? config.modelInfo : undefined)
  const selectedKey = config.model ? rowKey(activeId, config.model) : ''
  const query = search.trim().toLocaleLowerCase()
  const rowsOf = (source: ModelSource, catalog: Catalog): ModelRow[] => {
    if (directory && !configured(source)) return []
    const saved = source.model && !catalog.models.some((model) => model.id === source.model)
    const models = saved
      ? [...catalog.models, source.modelInfo ?? { id: source.model }]
      : catalog.models
    const channelMatch = !!query && source.name.toLocaleLowerCase().includes(query)
    return models
      .map((model) => ({
        model,
        rank: modelSearchRank(query, model),
      }))
      .filter(({ rank }) => rank !== Infinity || channelMatch)
      .sort((a, b) => a.rank - b.rank)
      .map(({ model }) => ({
        source,
        model,
        saved: !!saved && source.model === model.id,
        key: rowKey(source.id, model.id),
      }))
  }
  const available = groups.map((group) => ({
    ...group,
    rows: open ? rowsOf(group.source, group.catalog) : [],
  }))
  const rows = available.flatMap((group) => group.rows)
  const loading = available.some((group) => group.catalog.loading)
  const activeRow =
    rows.find((row) => row.key === highlight) ??
    (!query ? rows.find((row) => row.key === selectedKey) : undefined) ??
    rows[0]
  const optionId = (row: ModelRow) => `${listId}-${rows.indexOf(row)}`

  useEffect(() => {
    if (!imageMode) resolveRef.current?.(selected)
  }, [selected, config.model, imageMode, activeId, config.base, config.key, config.protocol])
  useEffect(() => {
    if (!open) return
    if (!directory || matchMedia('(pointer: fine)').matches) searchRef.current?.focus()
    const close = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [open, !!directory])

  const dismiss = () => {
    setOpen(false)
    triggerRef.current?.focus()
  }
  const choose = (id: string, model?: ModelInfo, sourceId = activeId) => {
    onSelect(id, model, directory ? sourceId : undefined)
    dismiss()
  }
  const clear = () => choose('', undefined, activeId)
  const renderOption = (row: ModelRow) => {
    const { model, source, saved } = row
    const limits = resolveModelLimits(model.id, model)
    const selected = row.key === selectedKey
    return (
      <button
        type="button"
        role="option"
        aria-selected={selected}
        id={optionId(row)}
        tabIndex={-1}
        key={row.key}
        className={`model-option ${selected ? 'selected' : ''} ${activeRow?.key === row.key ? 'highlighted' : ''}`}
        onClick={() => choose(model.id, model, source.id)}
      >
        <span className="model-option-text">
          <strong>{model.name || model.id}</strong>
          {model.name && <small className="model-option-id">{model.id}</small>}
          {saved && <small>已保存的模型</small>}
          {!saved && !imageMode && (
            <small>
              上下文 {formatTokenLimit(limits.contextLimit)} · 输出{' '}
              {formatTokenLimit(limits.maxTokens)}
            </small>
          )}
        </span>
        {selected && <span aria-hidden="true">✓</span>}
      </button>
    )
  }
  return (
    <div
      className={`model-control ${compact ? 'compact-model' : ''} ${settingsCatalog ? 'settings-model-catalog' : ''}`}
      ref={ref}
    >
      {sources
        .filter((source) => browsed || source.id === activeId)
        .map((source) => (
          <CatalogLoader
            key={source.id}
            source={source}
            revision={revision}
            delay={directory ? 0 : 500}
            onUpdate={(id, scope, update) =>
              setCatalogs((old) => {
                const snapshot = old[id]
                return {
                  ...old,
                  [id]: update(snapshot?.scope === scope ? snapshot : emptyCatalog(scope, true)),
                }
              })
            }
          />
        ))}
      <button
        ref={triggerRef}
        type="button"
        className={compact ? 'model-picker model-picker-live' : 'model-select-trigger'}
        aria-label={imageMode ? '选择生图模型' : '选择对话模型'}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          if (!open) {
            setSearch('')
            setHighlight('')
            setCustom(false)
            setManual('')
            setBrowsed(true)
          }
          setOpen(!open)
        }}
      >
        {compact ? (
          <>
            <span>{config.assistantName}</span>
            <span className="model-id" title={config.model || undefined}>
              {selected?.name || config.model || (imageMode ? '选择生图模型' : '选择模型')}
            </span>
            {activeSource?.name && (
              <span className="model-channel-name" title={activeSource.name}>
                {activeSource.name}
              </span>
            )}
          </>
        ) : (
          <span>
            <strong>
              {selected?.name || config.model || (imageMode ? '选择一个生图模型' : '选择一个模型')}
            </strong>
            {selected?.name && <small>{config.model}</small>}
          </span>
        )}
        {settingsCatalog && (
          <span className="model-browse-label">{open ? '收起列表' : '浏览模型'}</span>
        )}
        <span
          className={`model-connection-dot ${activeCatalog?.loading ? 'loading' : activeCatalog?.models.length ? 'connected' : ''}`}
          aria-hidden="true"
        />
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          aria-hidden="true"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {!compact && (
        <div className="model-discovery-status" role="status">
          {!connectionReady
            ? '填写地址和密钥，自动获取可用模型'
            : activeCatalog?.loading
              ? '正在获取模型…'
              : activeCatalog?.error
                ? '获取失败，可展开列表重试或手动添加'
                : `已获取 ${activeCatalog?.models.length ?? 0} 个模型 · 点击选择`}
        </div>
      )}
      {open && (
        <div
          className="model-popover"
          role="dialog"
          aria-label={imageMode ? '生图模型选择器' : '模型选择器'}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.stopPropagation()
              dismiss()
            }
          }}
        >
          <div className="model-popover-head">
            <strong>{imageMode ? '选择生图模型' : '选择模型'}</strong>
            <span>{query ? `${rows.length} 个匹配` : `${rows.length} 个模型`}</span>
            <button
              type="button"
              className="model-refresh"
              aria-label={imageMode ? '刷新生图模型列表' : '刷新模型列表'}
              disabled={loading || !sources.some(configured)}
              onClick={() => setRevision((revision) => revision + 1)}
            >
              {loading ? '获取中…' : '刷新'}
            </button>
          </div>
          <div className="model-search">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              aria-hidden="true"
            >
              <circle cx="10" cy="10" r="6" />
              <path d="m15 15 5 5" />
            </svg>
            <input
              ref={searchRef}
              role="combobox"
              autoComplete="off"
              aria-label={imageMode ? '搜索生图模型' : '搜索模型'}
              aria-autocomplete="list"
              aria-expanded="true"
              aria-controls={listId}
              aria-activedescendant={activeRow ? optionId(activeRow) : undefined}
              value={search}
              onChange={(event) => {
                setSearch(event.target.value)
                setHighlight('')
              }}
              placeholder={directory ? '搜索模型名称、ID 或渠道…' : '搜索模型名称或 ID…'}
              onKeyDown={(event) => {
                if (!activeRow || event.nativeEvent.isComposing) return
                if (event.key === 'Enter') {
                  event.preventDefault()
                  choose(activeRow.model.id, activeRow.model, activeRow.source.id)
                } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                  event.preventDefault()
                  const step = event.key === 'ArrowDown' ? 1 : -1
                  const next = rows[(rows.indexOf(activeRow) + step + rows.length) % rows.length]
                  setHighlight(next.key)
                  document.getElementById(optionId(next))?.scrollIntoView({ block: 'nearest' })
                }
              }}
            />
          </div>
          <div
            id={listId}
            className="model-options"
            role="listbox"
            aria-label={imageMode ? '可用生图模型' : '可用模型'}
          >
            {available.map(({ source, catalog, rows }) => {
              if (query && !rows.length && !source.name.toLocaleLowerCase().includes(query))
                return null
              const notice = catalog.error
                ? rows.length
                  ? '刷新失败，仍可使用已有模型'
                  : '获取失败'
                : catalog.loading
                  ? '正在获取模型…'
                  : ''
              if (!rows.length && !notice && (query || !configured(source))) return null
              return (
                <div
                  key={source.id}
                  role="group"
                  aria-label={source.name || undefined}
                  className="model-group"
                >
                  {directory && <div className="model-group-label">{source.name}</div>}
                  {rows.map(renderOption)}
                  {!!notice && (
                    <p
                      className="model-group-status"
                      role="status"
                      title={catalog.error || undefined}
                    >
                      {notice}
                      {catalog.error && ` · ${catalog.error}`}
                    </p>
                  )}
                </div>
              )
            })}
            {!rows.length && !loading && (
              <div className="model-list-empty" role="status">
                {query
                  ? '没有匹配的模型'
                  : !sources.some(configured)
                    ? '请先配置 API 地址与密钥'
                    : '暂无可选模型'}
              </div>
            )}
          </div>
          <div className="model-popover-footer">
            {directory ? (
              <button
                type="button"
                onClick={() => {
                  setOpen(false)
                  directory.onManage()
                }}
              >
                管理渠道
              </button>
            ) : (
              <button type="button" onClick={() => setCustom(!custom)}>
                {custom ? '收起手动添加' : '手动添加模型 ID'}
              </button>
            )}
            <button type="button" onClick={clear} disabled={!config.model}>
              清除选择
            </button>
          </div>
          {custom && (
            <form
              className="model-custom"
              onSubmit={(event) => {
                event.preventDefault()
                const id = manual.trim()
                if (id) choose(id, normalizeModel(id) || undefined)
              }}
            >
              <input
                aria-label={imageMode ? '自定义生图模型 ID' : '自定义模型 ID'}
                placeholder="输入完整模型 ID"
                value={manual}
                onChange={(event) => setManual(event.target.value)}
              />
              <button type="submit" disabled={!manual.trim()}>
                使用
              </button>
            </form>
          )}
        </div>
      )}
    </div>
  )
}
