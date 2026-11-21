import { memo, useEffect, useState } from 'react'
import { Markdown } from '../components/markdown/Markdown.js'
import { download } from './download.js'
import type { Message, Settings } from './model.js'
import { searchURL, type SearchStage } from './search.js'
import { Avatar, Icon } from './StudioControls.js'

const searchStageLabels: Record<SearchStage, string> = {
  checking: '等待模型调用联网工具…',
  searching: '正在搜索网页…',
  reading: '正在读取网页…',
  answering: '正在根据搜索资料回答…',
}
function SearchSources({ report }: { report: NonNullable<Message['search']> }) {
  const label =
    report.status === 'unused'
      ? '本轮没有返回联网结果'
      : report.status === 'failed'
        ? '联网搜索失败，以下回答可能未使用实时资料。'
        : report.sources.length
          ? `网页来源 · ${report.sources.length}`
          : '搜索已完成，接口未返回引用。'
  if (!report.sources.length) return <p className="search-result-note">{label}</p>
  return (
    <details className="search-sources">
      <summary>{label}</summary>
      <ol>
        {report.sources.map((source) => {
          const url = searchURL(source.url)
          if (!url) return null
          return (
            <li key={url}>
              <a href={url} target="_blank" rel="noopener noreferrer">
                {source.title}
              </a>
            </li>
          )
        })}
      </ol>
    </details>
  )
}

function GenerationCanvas({
  partial,
  started,
  size,
}: {
  partial?: string
  started: number
  size: string
}) {
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000)
    return () => clearInterval(t)
  }, [started])
  return (
    <div
      className={`generation-canvas ${partial ? 'has-partial' : ''}`}
      style={{ aspectRatio: size === 'auto' ? '1 / 1' : size.replace('x', ' / ') }}
      aria-live="polite"
    >
      {partial && <img src={partial} alt="接口返回的图片生成预览" />}
      <div className="generation-mesh" />
      <div className="generation-caption">
        <span className="generation-orbit">
          <Icon name="spark" size={25} />
        </span>
        <strong>{partial ? '正在细化画面' : '正在创作图片'}</strong>
        <span>
          {elapsed} 秒 · {partial ? '已收到预览，等待完成' : '等待生图服务返回'}
          <span className="dots" />
        </span>
      </div>
      <div className="generation-bottom">
        <span className="pulse-dot" />
        灵感正在成为画面
      </div>
    </div>
  )
}
export type Job = {
  chatId: string
  messageId: string
  kind: 'chat' | 'image' | 'compress'
  started: number
  size: string
}

type MessageAppearance = Pick<Settings, 'avatar' | 'assistantAvatar' | 'username' | 'assistantName'>

type MessageActions = {
  onPreview: (url: string) => void
  onImageLoad: () => void
  onEdit: (chatId: string, message: Message) => void
  onCopy: (text: string) => void
  onFork: (chatId: string, messageId: string) => void
}

type MessageRowProps = MessageAppearance & MessageActions & {
  chatId: string
  m: Message
  running?: Job
  busy: boolean
  searchStage: SearchStage | null
  onRegenerate?: () => void
}

const MessageRow = memo(function MessageRow({
  chatId,
  m,
  running,
  busy,
  searchStage,
  avatar,
  assistantAvatar,
  username,
  assistantName,
  onPreview,
  onImageLoad,
  onEdit,
  onCopy,
  onFork,
  onRegenerate,
}: MessageRowProps) {
  const user = m.role === 'user'
  return (
    <article className={`message ${user ? 'user-message' : 'assistant-message'}`}>
      <Avatar
        src={user ? avatar : assistantAvatar}
        name={user ? username : assistantName}
        assistant={!user}
      />
      <div className="message-body">
        <div className="message-author">
          {user ? username : assistantName}
          <time>
            {new Date(m.created).toLocaleTimeString('zh-CN', {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </time>
          {m.edited && <span className="message-edited">已编辑</span>}
          {!user && m.kind === 'image' && (
            <span className="tiny-badge">图像创作</span>
          )}
        </div>
        {!!m.attachments?.length && (
          <div className="message-attachments">
            {m.attachments.map((a) => (
              <button
                key={a.id}
                onClick={() => onPreview(a.url)}
                aria-label={`查看图片：${a.name}`}
              >
                <img src={a.url} alt={a.name} loading="lazy" decoding="async" />
              </button>
            ))}
          </div>
        )}
        {m.thinking && (
          <details className="thinking" open={!!running}>
            <summary>
              <Icon name="spark" size={14} />
              思考过程
            </summary>
            <p>{m.thinking}</p>
          </details>
        )}
        {m.kind === 'image' ? (
          running ? (
            <GenerationCanvas partial={m.image} started={running.started} size={running.size} />
          ) : m.image ? (
            <div className="generated-image">
              <button onClick={() => onPreview(m.image!)} aria-label="查看生成图片">
                <img
                  src={m.image}
                  loading="lazy"
                  decoding="async"
                  alt={m.content}
                  onLoad={onImageLoad}
                  onError={(e) => {
                    e.currentTarget.alt =
                      '图片链接已失效。可重新生成，或使用支持本地缓存的接口。'
                  }}
                />
              </button>
              <div>
                <span>
                  <Icon name="check" size={14} />
                  {m.error ? '生成已停止 · 保留预览' : '创作完成'}
                </span>
                <button
                  className="icon-button"
                  aria-label="下载图片"
                  onClick={() =>
                    download(
                      m.image!,
                      `icelunacat-${m.id}.${m.image?.startsWith('data:image/webp') ? 'webp' : m.image?.startsWith('data:image/jpeg') ? 'jpg' : 'png'}`
                    )
                  }
                >
                  <Icon name="download" />
                </button>
              </div>
              {m.imageRemote && (
                <small className="image-warning">
                  远程图片未能缓存，请及时下载保存。
                </small>
              )}
            </div>
          ) : null
        ) : (
          <Markdown
            content={m.content}
            loading={!!running}
            cacheKey={m.id}
            disableLink={false}
            className="ds-markdown"
          />
        )}
        {m.kind === 'image' && !running && m.edited && m.content && (
          <p className="edited-image-caption">{m.content}</p>
        )}
        {running &&
          m.kind !== 'image' &&
          !m.content &&
          !m.thinking &&
          !searchStage && (
            <div className="assistant-wait">
              <span />
              <span />
              <span />
            </div>
          )}
        {running && searchStage && (
          <div className="search-result-note" role="status">
            <Icon name="globe" size={14} /> {searchStageLabels[searchStage]}
          </div>
        )}
        {!running && m.search && <SearchSources report={m.search} />}
        {m.error && (
          <div className="message-error" role="alert">
            {m.error}
          </div>
        )}
        {user && (
          <footer className="message-actions user-message-actions">
            <button
              className="edit-message"
              aria-label="编辑消息"
              disabled={busy}
              onClick={() => onEdit(chatId, m)}
            >
              <Icon name="edit" size={15} />
              <span>编辑</span>
            </button>
          </footer>
        )}
        {!user && (
          <footer className="reply-footer">
            {!running && (
              <div className="message-actions">
                <button aria-label="复制回复" onClick={() => onCopy(m.content)}>
                  <Icon name="copy" size={15} />
                </button>
                <button
                  className="edit-message"
                  aria-label={m.kind === 'image' ? '编辑图片描述' : '编辑 AI 回复'}
                  disabled={busy || m.interrupted}
                  onClick={() => onEdit(chatId, m)}
                >
                  <Icon name="edit" size={15} />
                  <span>编辑</span>
                </button>
                {onRegenerate && (
                  <button
                    disabled={busy}
                    aria-label="重新生成"
                    onClick={onRegenerate}
                  >
                    <Icon name="refresh" size={15} />
                  </button>
                )}
                <button
                  className="branch-reply"
                  aria-label="创建聊天分支"
                  title="复制到这条回复为止的消息，在新对话中继续"
                  onClick={() => onFork(chatId, m.id)}
                >
                  <Icon name="branch" size={15} />
                  <span>创建分支</span>
                </button>
              </div>
            )}
            <span
              className="reply-model"
              title={
                m.model
                  ? `本条回复使用的模型：${m.model}${m.channel ? `（${m.channel}）` : ''}`
                  : '旧版记录没有保存实际模型，无法追溯'
              }
            >
              {m.model || '历史模型未记录'}
              {m.channel && ` · ${m.channel}`}
            </span>
            {m.usage && m.usage.input + m.usage.output > 0 && (
              <small className="reply-usage">
                API 实际用量 · 输入 {m.usage.input} / 输出 {m.usage.output} tokens
              </small>
            )}
          </footer>
        )}
      </div>
    </article>
  )
})

type MessageListProps = MessageAppearance & MessageActions & {
  chatId: string
  messages: Message[]
  job: Job | null
  searchStage: SearchStage | null
  onRegenerate: () => void
}

export const MessageList = memo(function MessageList({
  chatId,
  messages,
  job,
  searchStage,
  onPreview,
  onImageLoad,
  onEdit,
  onCopy,
  onFork,
  onRegenerate,
  ...appearance
}: MessageListProps) {
  return (
    <div className="messages">
      {messages.map((message, index) => {
        const running = job?.chatId === chatId && job.messageId === message.id ? job : undefined
        return (
          <MessageRow
            key={message.id}
            {...appearance}
            chatId={chatId}
            m={message}
            running={running}
            busy={!!job}
            searchStage={running ? searchStage : null}
            onPreview={onPreview}
            onImageLoad={onImageLoad}
            onEdit={onEdit}
            onCopy={onCopy}
            onFork={onFork}
            onRegenerate={index === messages.length - 1 ? onRegenerate : undefined}
          />
        )
      })}
      {job?.kind === 'compress' && job.chatId === chatId && (
        <div className="compression-status">
          <Icon name="compress" />
          正在压缩较早的对话，原始记录将保留…
        </div>
      )}
      <div className="message-end" />
    </div>
  )
})
