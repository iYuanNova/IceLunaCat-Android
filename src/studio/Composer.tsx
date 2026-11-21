import { useEffect, useRef, type RefObject } from 'react'
import { EffortSlider } from './EffortSlider.js'
import type { ImageAttachment, SearchProvider, Settings } from './model.js'
import { searchProviderNames } from './search.js'
import { Icon } from './StudioControls.js'

type ComposerProps = {
  inputRef: RefObject<HTMLTextAreaElement>
  isEmpty: boolean
  draft: string
  draftImages: ImageAttachment[]
  mode: 'chat' | 'image'
  busy: boolean
  uploading: boolean
  webSearch: boolean
  searchProvider?: SearchProvider
  chatId?: string
  chatChannelId?: string
  settings: Settings
  tokens: number
  worldCount: number
  hasSummary: boolean
  onDraftChange: (value: string) => void
  onAttachImages: (files: File[]) => Promise<void>
  onRemoveAttachment: (id: string) => void
  onPreview: (url: string) => void
  onModeChange: (mode: 'chat' | 'image') => void
  onToggleSearch: () => void
  onEffortChange: (value: string) => void
  onCompress: () => void
  onStop: () => void
  onSend: () => void
  onSummary: () => void
}

export function Composer({
  inputRef,
  isEmpty,
  draft,
  draftImages,
  mode,
  busy,
  uploading,
  webSearch,
  searchProvider,
  chatId,
  chatChannelId,
  settings,
  tokens,
  worldCount,
  hasSummary,
  onDraftChange,
  onAttachImages,
  onRemoveAttachment,
  onPreview,
  onModeChange,
  onToggleSearch,
  onEffortChange,
  onCompress,
  onStop,
  onSend,
  onSummary,
}: ComposerProps) {
  const uploadRef = useRef<HTMLInputElement>(null)
  const contextPercent = Math.min(100, (tokens / settings.contextLimit) * 100)

  useEffect(() => {
    const input = inputRef.current
    if (!input) return
    input.style.height = 'auto'
    input.style.height = Math.min(180, input.scrollHeight) + 'px'
  }, [draft, inputRef])

  return (
    <div className={`composer-wrap ${isEmpty ? 'welcome-composer' : ''}`}>
      <div
        className="composer"
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes('Files')) e.preventDefault()
        }}
        onDrop={(e) => {
          if (!e.dataTransfer.files.length) return
          e.preventDefault()
          void onAttachImages(Array.from(e.dataTransfer.files))
        }}
      >
        <input
          ref={uploadRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          multiple
          hidden
          onChange={(e) => {
            void onAttachImages(Array.from(e.target.files || []))
            e.target.value = ''
          }}
        />
        {!!draftImages.length && (
          <div className="draft-attachments" aria-label="待发送图片">
            {draftImages.map((a) => (
              <div key={a.id}>
                <button
                  className="attachment-preview"
                  onClick={() => onPreview(a.url)}
                  aria-label={`预览图片：${a.name}`}
                >
                  <img src={a.url} alt={a.name} />
                </button>
                <button
                  className="attachment-remove"
                  aria-label={`移除图片：${a.name}`}
                  onClick={() => onRemoveAttachment(a.id)}
                >
                  <Icon name="close" size={13} />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="composer-input-row">
          <textarea
            ref={inputRef}
            aria-label={mode === 'image' ? '描述你想生成的图片' : '发送消息'}
            rows={2}
            placeholder={
              mode === 'image'
                ? '描述你脑海中的画面，让想象发生…'
                : '发消息，或从一个新想法开始…'
            }
            value={draft}
            onChange={(e) => onDraftChange(e.target.value)}
            onPaste={(e) => {
              const files = Array.from(e.clipboardData.files).filter((f) =>
                f.type.startsWith('image/')
              )
              if (files.length) {
                e.preventDefault()
                void onAttachImages(files)
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                onSend()
              }
            }}
          />
        </div>
        {mode === 'chat' && (
          <div className="composer-options">
            <button
              className={`composer-option ${webSearch ? 'enabled' : ''}`}
              aria-pressed={webSearch}
              disabled={busy}
              title={searchProvider ? searchProviderNames[searchProvider] : '配置联网搜索服务'}
              onClick={onToggleSearch}
            >
              <Icon name="globe" size={15} /> 联网搜索
            </button>
            <EffortSlider
              key={JSON.stringify([
                chatId,
                chatChannelId,
                settings.base,
                settings.protocol,
                settings.model,
              ])}
              settings={settings}
              onChange={onEffortChange}
            />
          </div>
        )}
        <div className="composer-toolbar">
          <div className="mode-switch">
            <button className={mode === 'chat' ? 'active' : ''} onClick={() => onModeChange('chat')}>
              <Icon name="chat" size={16} />
              对话
            </button>
            <button
              className={mode === 'image' ? 'active' : ''}
              onClick={() => onModeChange('image')}
            >
              <Icon name="image" size={16} />
              生成图片
            </button>
          </div>
          <div className="composer-tools">
            <button
              className="icon-button attachment-button"
              title="上传图片（需要支持视觉的对话模型）"
              aria-label={uploading ? '正在读取图片' : '上传图片'}
              disabled={busy || uploading}
              onClick={() => uploadRef.current?.click()}
            >
              <Icon name="plus" size={20} />
            </button>
            <button
              className="compress-button"
              title="用当前 API 总结较早消息，保留原始聊天"
              disabled={busy}
              onClick={onCompress}
            >
              <Icon name="compress" size={16} />
              <span>压缩上下文</span>
            </button>
            {busy ? (
              <button
                className="send-button stopping"
                aria-label="停止生成"
                onClick={onStop}
              >
                <Icon name="stop" size={18} />
              </button>
            ) : (
              <button
                className="send-button"
                disabled={uploading || (!draft.trim() && !draftImages.length)}
                aria-label="发送"
                onClick={onSend}
              >
                <Icon name="arrow" size={21} />
              </button>
            )}
          </div>
        </div>
        <div className="context-bar">
          <div
            className="token-stats"
            title="包含人设、世界书、摘要和历史；文字按长度估算，图片暂按每张约 1600 tokens 预留，实际取决于模型和分辨率，以接口 usage 为准。"
          >
            <span className="context-gauge">
              <i
                style={{
                  width: `${contextPercent}%`,
                  background: contextPercent > 85 ? '#e58a37' : undefined,
                }}
              />
            </span>
            <span>
              上下文 <b>≈ {tokens.toLocaleString()}</b>
              <span className="token-limit">
                {' '}
                / {settings.contextLimit.toLocaleString()}
              </span>{' '}
              tokens
            </span>
          </div>
          <span className="context-extra">
            {hasSummary && <button onClick={onSummary}>已压缩</button>}
            {worldCount > 0 && <span>世界书 {worldCount} 条生效</span>}
            <span className="desktop-only">Enter 发送 · Shift Enter 换行</span>
          </span>
        </div>
      </div>
      <div className="composer-footnote">
        <span>AI 的回答可能不准确，请核实重要信息。</span>
        <span className="local-chip">
          <span className="status-dot" />
          本地保存
        </span>
      </div>
    </div>
  )
}
