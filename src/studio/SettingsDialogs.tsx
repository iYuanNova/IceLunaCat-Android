import { useId, useState, type ReactNode } from 'react'
import { blobToDataURL, endpoint, readableError } from './api.js'
import {
  activeChannel,
  activeSettings,
  createChatChannel,
  createImageChannel,
  estimateTokens,
  uid,
  updateSettings,
  type Channel,
  type ChannelGroup,
  type Chat,
  type SearchProvider,
  type Settings,
  type WorkspaceSettings,
} from './model.js'
import { ModelPicker } from './ModelPicker.js'
import { applyAutoLimits, resolveModelLimits, selectModel } from './models.js'
import { searchProviderNames } from './search.js'
import { Field, Icon, Modal, type IconName } from './StudioControls.js'
import { isAndroidApp } from './network.js'

function ImageUpload({
  value,
  onChange,
  title,
}: {
  value: string
  onChange: (v: string) => void
  title: string
}) {
  const [error, setError] = useState('')
  return (
    <div className="upload-row">
      {value ? (
        <img className="upload-preview" src={value} alt={title} />
      ) : (
        <span className="upload-preview placeholder">
          <Icon name={title === '背景' ? 'image' : 'user'} size={25} />
        </span>
      )}
      <div>
        <label className="button secondary file-button">
          <Icon name="upload" />
          上传{title}
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
            onChange={async (e) => {
              const f = e.target.files?.[0]
              if (!f) return
              if (!/^image\/(png|jpeg|webp|gif|avif)$/.test(f.type)) {
                setError('请选择 PNG、JPEG、WebP、GIF 或 AVIF 图片')
                return
              }
              try {
                onChange(await blobToDataURL(f))
                setError('')
              } catch (err) {
                setError(readableError(err))
              }
              e.target.value = ''
            }}
          />
        </label>
        <small className="block muted">PNG、JPG、WebP、GIF、AVIF</small>
      </div>
      {value && (
        <button className="icon-button" onClick={() => onChange('')} aria-label={`移除${title}`}>
          <Icon name="trash" />
        </button>
      )}
      {error && <small className="error">{error}</small>}
    </div>
  )
}
function Secret({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [show, setShow] = useState(false)
  return (
    <span className="secret">
      <input
        type={show ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="sk-…"
        autoComplete="off"
      />
      <button
        type="button"
        className="icon-button"
        aria-label={show ? '隐藏密钥' : '显示密钥'}
        onClick={() => setShow(!show)}
      >
        <Icon name="eye" />
      </button>
    </span>
  )
}

export type SettingsTab = 'api' | 'search' | 'images' | 'profile' | 'appearance' | 'data'
function ChannelEditor<T>({
  group,
  kind,
  create,
  describe,
  onChange,
  children,
  simple = false,
  hasError = false,
}: {
  group: ChannelGroup<T>
  kind: '对话' | '生图'
  create: (name: string) => Channel<T>
  describe: (config: T) => { protocol: string; model: string; hasKey: boolean }
  onChange: (group: ChannelGroup<T>) => void
  children: ReactNode
  simple?: boolean
  hasError?: boolean
}) {
  const editorId = useId()
  const [collapsed, setCollapsed] = useState<string | null>(null)
  const selected = activeChannel(group)
  if (simple) return <>{children}</>
  return (
    <section className="provider-settings" aria-label={kind + '渠道'}>
      <header className="provider-settings-head">
        <h3>{kind}渠道</h3>
      </header>
      <div className="provider-list">
        {group.channels.map((channel) => {
          const { protocol, model, hasKey } = describe(channel.config)
          const name = channel.name.trim() || '未命名渠道'
          const open = channel.id === selected.id && (hasError || collapsed !== channel.id)
          const bodyId = `${editorId}-${channel.id}`
          return (
            <div key={channel.id} className={`provider-card ${open ? 'editing' : ''}`}>
              <button
                type="button"
                className="provider-row"
                aria-label={`编辑渠道 ${name}`}
                aria-expanded={open}
                aria-controls={open ? bodyId : undefined}
                onClick={() => {
                  if (open) {
                    setCollapsed(channel.id)
                  } else {
                    setCollapsed(null)
                    onChange({ ...group, activeId: channel.id })
                  }
                }}
              >
                <span className="provider-icon">
                  <Icon name={kind === '对话' ? 'globe' : 'image'} size={17} />
                </span>
                <span className="provider-label">
                  <strong>{name}</strong>
                  <small title={model || undefined}>
                    {protocol}
                    {model && ` · ${model}`}
                  </small>
                </span>
                <span className={`provider-key-status ${hasKey ? 'configured' : ''}`}>
                  {hasKey ? '密钥已配置' : '待配置'}
                </span>
                <span className="provider-chevron">
                  <Icon name="chevron" size={14} />
                </span>
              </button>
              {open && (
                <div id={bodyId} className="provider-fields">
                  <Field label="渠道名称">
                    <input
                      value={channel.name}
                      maxLength={48}
                      onChange={(event) =>
                        onChange({
                          ...group,
                          channels: group.channels.map((entry) =>
                            entry.id === channel.id ? { ...entry, name: event.target.value } : entry
                          ),
                        })
                      }
                    />
                  </Field>
                  {children}
                  {group.channels.length > 1 && (
                    <div className="provider-actions">
                      <button
                        type="button"
                        aria-label={`移除渠道 ${name}`}
                        onClick={() => {
                          const channels = group.channels.filter((entry) => entry.id !== channel.id)
                          onChange({ activeId: channels[0].id, channels })
                        }}
                      >
                        <Icon name="trash" size={14} /> 移除渠道
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
      <button
        type="button"
        className="provider-add"
        onClick={() => {
          let suffix = group.channels.length + 1
          while (group.channels.some((channel) => channel.name === `${kind}渠道 ${suffix}`))
            suffix++
          const channel = create(`${kind}渠道 ${suffix}`)
          onChange({ activeId: channel.id, channels: [...group.channels, channel] })
          setCollapsed(null)
        }}
      >
        <Icon name="plus" size={15} /> 新增渠道
      </button>
    </section>
  )
}

function NetworkCompatibility({
  enabled,
  onChange,
}: {
  enabled?: boolean
  onChange: (value: boolean) => void
}) {
  const native = isAndroidApp()
  return (
    <label className="toggle-row">
      <div>
        <strong>改善网络兼容性</strong>
        <small>
          {native
            ? '使用 Android 原生网络直连此 API。'
            : '原生网络兼容功能可在 Android 安装版中使用。'}
        </small>
      </div>
      <input
        type="checkbox"
        checked={native && !!enabled}
        disabled={!native}
        onChange={(event) => onChange(event.target.checked)}
      />
    </label>
  )
}

export function SettingsModal({
  settings,
  initialTab,
  onSave,
  onClose,
  onExport,
  onImport,
  onClear,
  count,
  onboarding = false,
  preferredSearchChannel,
}: {
  settings: WorkspaceSettings
  initialTab: SettingsTab
  onSave: (s: WorkspaceSettings) => void
  onClose: () => void
  onExport: (keys: boolean) => void
  onImport: (f: File) => void
  onClear: () => void
  count: number
  onboarding?: boolean
  preferredSearchChannel?: string
}) {
  const searchChannelAtOpen = initialTab === 'search' && preferredSearchChannel
  const [workspace, setWorkspace] = useState(() =>
    searchChannelAtOpen
      ? { ...settings, chatChannels: { ...settings.chatChannels, activeId: searchChannelAtOpen } }
      : settings
  )
  const chatChannel = activeChannel(workspace.chatChannels)
  const imageChannel = activeChannel(workspace.imageChannels)
  const form = activeSettings(workspace)
  const setForm = (update: (s: Settings) => Settings) =>
    setWorkspace((s) => updateSettings(s, update))
  const [tab, setTab] = useState(initialTab)
  const [status, setStatus] = useState('')
  const [exportKeys, setExportKeys] = useState(false)
  const change = <K extends keyof Settings>(k: K, v: Settings[K]) =>
    setForm((s) => {
      if (['base', 'key', 'protocol'].includes(k) && s[k] !== v)
        return applyAutoLimits({
          ...s,
          [k]: v,
          model: k === 'key' ? s.model : '',
          modelInfo: undefined,
          reasoningEffort: '',
        })
      if (k === 'imageBase' && s.imageBase !== v) return { ...s, [k]: v, imageModel: '' }
      return { ...s, [k]: v }
    })
  const replaceChatChannels = (group: WorkspaceSettings['chatChannels']) => {
    setWorkspace((s) => ({ ...s, chatChannels: group }))
    setStatus('')
  }
  const replaceImageChannels = (group: WorkspaceSettings['imageChannels']) => {
    setWorkspace((s) => ({ ...s, imageChannels: group }))
    setStatus('')
  }
  const save = () => {
    if (onboarding && !form.key.trim()) {
      setStatus('请填写 API Key，或选择“稍后配置”。')
      return
    }
    for (const channel of workspace.chatChannels.channels) {
      const config = channel.config
      if (
        !channel.name.trim() ||
        !Number.isSafeInteger(config.maxTokens) ||
        !Number.isSafeInteger(config.contextLimit) ||
        config.maxTokens < 1 ||
        config.contextLimit < 1024 ||
        !Number.isFinite(config.temperature) ||
        config.temperature < 0 ||
        config.temperature > 2
      ) {
        setWorkspace((s) => ({ ...s, chatChannels: { ...s.chatChannels, activeId: channel.id } }))
        setTab('api')
        setStatus('请检查渠道名称和 Token 参数。')
        return
      }
      if (config.base.trim() || config.key.trim()) {
        try {
          endpoint(config.base, 'models')
        } catch {
          setWorkspace((s) => ({ ...s, chatChannels: { ...s.chatChannels, activeId: channel.id } }))
          setTab('api')
          setStatus('请输入有效的 HTTP(S) API 地址。')
          return
        }
      }
    }
    for (const channel of workspace.imageChannels.channels) {
      try {
        if (!channel.name.trim()) throw new Error('请输入生图渠道名称。')
        const { imageBase, imageKey } = channel.config
        if (imageBase.trim() || imageKey.trim()) endpoint(imageBase, 'models')
      } catch {
        setWorkspace((s) => ({ ...s, imageChannels: { ...s.imageChannels, activeId: channel.id } }))
        setTab('images')
        setStatus('请检查生图渠道名称和 HTTP(S) API 地址。')
        return
      }
    }
    if (!form.username.trim() || !form.assistantName.trim()) {
      setTab('profile')
      setStatus('请输入用户与助手名称。')
      return
    }
    onSave(
      searchChannelAtOpen && workspace.chatChannels.activeId === searchChannelAtOpen
        ? {
            ...workspace,
            chatChannels: { ...workspace.chatChannels, activeId: settings.chatChannels.activeId },
          }
        : workspace
    )
  }
  const selectedLimits = resolveModelLimits(form.model, form.modelInfo)
  const sourceLabel = (source: string) =>
    source === 'api'
      ? '接口返回的模型上限'
      : source === 'official'
        ? '已核对的官方规格'
        : '未提供上限，使用 1M 预设'

  const tabs: [SettingsTab, IconName, string][] = [
    ['api', 'globe', '对话 API'],
    ['search', 'search', '联网搜索'],
    ['images', 'image', '生图 API'],
    ['profile', 'user', '个人形象'],
    ['appearance', 'sun', '外观与背景'],
    ['data', 'download', '数据管理'],
  ]
  return (
    <Modal
      title={onboarding ? '先连接你的 API' : '设置'}
      subtitle={onboarding ? '填写地址和 API Key，再从列表中选择模型。' : '让这个空间，更像你。'}
      wide={!onboarding}
      onClose={onClose}
    >
      <div className="settings-layout">
        {!onboarding && (
          <nav className="settings-tabs">
            {tabs.map(([id, icon, title]) => (
              <button
                key={id}
                className={tab === id ? 'selected' : ''}
                onClick={() => {
                  setTab(id)
                  setStatus('')
                }}
              >
                <Icon name={icon} />
                {title}
              </button>
            ))}
          </nav>
        )}
        <div className={`settings-content ${onboarding ? 'api-onboarding' : ''}`}>
          {status && (
            <p role="alert" className="notice channel-error">
              {status}
            </p>
          )}
          {tab === 'api' && (
            <ChannelEditor
              kind="对话"
              group={workspace.chatChannels}
              create={createChatChannel}
              onChange={replaceChatChannels}
              simple={onboarding}
              hasError={!!status}
              describe={(config) => ({
                protocol:
                  config.protocol === 'anthropic'
                    ? 'Anthropic Messages'
                    : 'OpenAI Chat Completions',
                model: config.model,
                hasKey: !!config.key.trim(),
              })}
            >
              <Field label="接口协议">
                <select
                  value={form.protocol}
                  onChange={(e) => change('protocol', e.target.value as Settings['protocol'])}
                >
                  <option value="openai">OpenAI 兼容 · Chat Completions</option>
                  <option value="anthropic">Anthropic 兼容 · Messages</option>
                </select>
              </Field>
              <Field
                label="API 地址"
                hint="支持根地址、/v1 地址或完整接口路径。服务需允许浏览器跨域访问。"
              >
                <input
                  value={form.base}
                  placeholder="https://api.deepseek.com"
                  onChange={(e) => change('base', e.target.value)}
                />
              </Field>
              <Field label="API Key">
                <Secret key={chatChannel.id} value={form.key} onChange={(v) => change('key', v)} />
              </Field>
              <NetworkCompatibility
                enabled={form.networkCompat}
                onChange={(v) => change('networkCompat', v)}
              />
              <div className="field">
                <span>{onboarding ? '对话模型' : '模型目录'}</span>
                <ModelPicker
                  key={chatChannel.id}
                  settingsCatalog={!onboarding}
                  settings={form}
                  onSelect={(id, model) => setForm((s) => selectModel(s, id, model))}
                  onResolve={(model) => setForm((s) => applyAutoLimits(s, model))}
                />
              </div>
              {!onboarding && (
                <details className="provider-advanced" open={status ? true : undefined}>
                  <summary>高级参数</summary>
                  <label className="toggle-row model-limit-toggle">
                    <div>
                      <strong>自动使用模型上限</strong>
                      <small>切换模型时自动更新最大输出和上下文，无需手填。</small>
                    </div>
                    <input
                      type="checkbox"
                      aria-label="自动使用模型上限"
                      checked={form.limitsMode !== 'manual' || !form.model}
                      disabled={!form.model}
                      onChange={(e) =>
                        setForm((s) =>
                          applyAutoLimits({
                            ...s,
                            limitsMode: e.target.checked ? 'auto' : 'manual',
                          })
                        )
                      }
                    />
                  </label>
                  <div className="two-fields">
                    <Field label={`温度 · ${form.temperature}`}>
                      <input
                        type="range"
                        min="0"
                        max="2"
                        step="0.1"
                        value={form.temperature}
                        onChange={(e) => change('temperature', Number(e.target.value))}
                      />
                    </Field>
                    <Field
                      label="最大输出 Token"
                      hint={
                        !form.model
                          ? '未选择模型：1M（1,000,000）'
                          : sourceLabel(selectedLimits.outputSource)
                      }
                    >
                      <input
                        type="number"
                        min="1"
                        max={form.limitsMode === 'manual' ? undefined : selectedLimits.maxTokens}
                        readOnly={form.limitsMode !== 'manual' || !form.model}
                        value={form.maxTokens}
                        onChange={(e) =>
                          setForm((s) => ({
                            ...s,
                            maxTokens: Number(e.target.value),
                            limitsMode: 'manual',
                          }))
                        }
                      />
                    </Field>
                  </div>
                  <Field
                    label="上下文窗口（Token）"
                    hint={
                      !form.model
                        ? '未选择模型：1M（1,000,000）'
                        : sourceLabel(selectedLimits.contextSource)
                    }
                  >
                    <input
                      type="number"
                      min="1024"
                      max={form.limitsMode === 'manual' ? undefined : selectedLimits.contextLimit}
                      readOnly={form.limitsMode !== 'manual' || !form.model}
                      value={form.contextLimit}
                      onChange={(e) =>
                        setForm((s) => ({
                          ...s,
                          contextLimit: Number(e.target.value),
                          limitsMode: 'manual',
                        }))
                      }
                    />
                  </Field>
                </details>
              )}
            </ChannelEditor>
          )}
          {tab === 'search' && (
            <>
              <Field label={`搜索服务 · ${chatChannel.name}`}>
                <select
                  value={form.searchProvider ?? 'auto'}
                  onChange={(e) => change('searchProvider', e.target.value as SearchProvider)}
                >
                  {Object.entries(searchProviderNames).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </Field>
              <p className="section-description">
                自动选择优先使用可识别的原生搜索，其余接口可使用已配置的
                Tavily。中转接口请按服务商的实际支持选择。
              </p>
              {(form.searchProvider === 'tavily' ||
                !form.searchProvider ||
                form.searchProvider === 'auto') && (
                <>
                  <Field
                    label="Tavily API Key"
                    hint="仅向 Tavily 发送本轮搜索问题，搜索资料交给当前对话模型。"
                  >
                    <Secret
                      value={form.searchKey ?? ''}
                      onChange={(value) => change('searchKey', value)}
                    />
                  </Field>
                  <Field label="Tavily 搜索深度">
                    <select
                      value={form.searchDepth ?? 'basic'}
                      onChange={(e) =>
                        change('searchDepth', e.target.value as 'basic' | 'advanced')
                      }
                    >
                      <option value="basic">基础 · 1 credit</option>
                      <option value="advanced">深入 · 2 credits，包含更多正文</option>
                    </select>
                  </Field>
                </>
              )}
            </>
          )}
          {tab === 'images' && (
            <ChannelEditor
              kind="生图"
              group={workspace.imageChannels}
              create={createImageChannel}
              onChange={replaceImageChannels}
              hasError={!!status}
              describe={(config) => ({
                protocol: 'OpenAI Images',
                model: config.imageModel,
                hasKey: !!config.imageKey.trim(),
              })}
            >
              <Field label="生图 API 地址">
                <input
                  value={form.imageBase}
                  placeholder="https://api.openai.com/v1"
                  onChange={(e) => change('imageBase', e.target.value)}
                />
              </Field>
              <Field label="生图 API Key">
                <Secret
                  key={imageChannel.id}
                  value={form.imageKey}
                  onChange={(v) => change('imageKey', v)}
                />
              </Field>
              <NetworkCompatibility
                enabled={form.imageNetworkCompat}
                onChange={(v) => change('imageNetworkCompat', v)}
              />
              <div className="field">
                <span>模型目录</span>
                <ModelPicker
                  key={imageChannel.id}
                  settingsCatalog
                  purpose="image"
                  settings={form}
                  onSelect={(id) => change('imageModel', id)}
                />
              </div>
              <details className="provider-advanced">
                <summary>出图参数</summary>
                <div className="two-fields">
                  <Field label="图像尺寸">
                    <select
                      value={form.imageSize}
                      onChange={(e) => change('imageSize', e.target.value)}
                    >
                      {[
                        'auto',
                        '1024x1024',
                        '1536x1024',
                        '1024x1536',
                        '1792x1024',
                        '1024x1792',
                      ].map((v) => (
                        <option key={v}>{v}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="图像质量">
                    <select
                      value={form.imageQuality}
                      onChange={(e) => change('imageQuality', e.target.value)}
                    >
                      {['auto', 'low', 'medium', 'high', 'standard', 'hd'].map((v) => (
                        <option key={v}>{v}</option>
                      ))}
                    </select>
                  </Field>
                </div>
                <label className="toggle-row">
                  <div>
                    <strong>流式图片预览</strong>
                    <small>仅对支持 stream / partial_images 的服务启用。</small>
                  </div>
                  <input
                    type="checkbox"
                    checked={form.imageStream}
                    onChange={(e) => change('imageStream', e.target.checked)}
                  />
                </label>
              </details>
            </ChannelEditor>
          )}
          {tab === 'profile' && (
            <>
              <h3>每一次对话，都有你的样子</h3>
              <p className="section-description">名字与头像会显示在聊天中，并自动保存在本机。</p>
              <Field label="你的用户名">
                <input
                  value={form.username}
                  maxLength={40}
                  onChange={(e) => change('username', e.target.value)}
                />
              </Field>
              <ImageUpload
                title="用户头像"
                value={form.avatar}
                onChange={(v) => change('avatar', v)}
              />
              <hr />
              <Field label="助手名称">
                <input
                  value={form.assistantName}
                  maxLength={40}
                  onChange={(e) => change('assistantName', e.target.value)}
                />
              </Field>
              <ImageUpload
                title="助手头像"
                value={form.assistantAvatar}
                onChange={(v) => change('assistantAvatar', v)}
              />
            </>
          )}
          {tab === 'appearance' && (
            <>
              <h3>你的空间，你的氛围</h3>
              <p className="section-description">从明暗主题到自定义背景，找到舒服的对话方式。</p>
              <Field label="外观">
                <div className="theme-options">
                  {(['light', 'dark', 'system'] as const).map((v, i) => (
                    <button
                      key={v}
                      className={form.theme === v ? 'active' : ''}
                      onClick={() => change('theme', v)}
                    >
                      <Icon
                        name={v === 'dark' ? 'moon' : v === 'system' ? 'globe' : 'sun'}
                        size={24}
                      />
                      {['浅色', '深色', '跟随系统'][i]}
                      {form.theme === v && <Icon name="check" size={14} />}
                    </button>
                  ))}
                </div>
              </Field>
              <Field label="自定义背景">
                <ImageUpload
                  title="背景"
                  value={form.background}
                  onChange={(v) => change('background', v)}
                />
              </Field>
              <Field
                label={`背景遮罩 · ${form.backgroundDim}%`}
                hint="遮罩越高，文字越清晰；背景会保存在当前浏览器。"
              >
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={form.backgroundDim}
                  onChange={(e) => change('backgroundDim', Number(e.target.value))}
                />
              </Field>
            </>
          )}
          {tab === 'data' && (
            <>
              <h3>把记忆留在自己手里</h3>
              <p className="section-description">
                当前保存了 {count} 个对话。记录、图片、人设与世界书均保存在此浏览器的 IndexedDB 中。
              </p>
              <div className="data-card">
                <Icon name="download" size={24} />
                <div>
                  <strong>导出完整备份</strong>
                  <p>包括聊天、图片、API 渠道、头像、背景和独立对话设定。</p>
                  <label className="check-row">
                    <input
                      type="checkbox"
                      checked={exportKeys}
                      onChange={(e) => setExportKeys(e.target.checked)}
                    />
                    包含 API 密钥（请妥善保管备份）
                  </label>
                </div>
                <button className="button secondary" onClick={() => onExport(exportKeys)}>
                  导出
                </button>
              </div>
              <div className="data-card">
                <Icon name="upload" size={24} />
                <div>
                  <strong>恢复备份</strong>
                  <p>导入 Studio JSON 备份，将替换当前全部数据。</p>
                </div>
                <label className="button secondary file-button">
                  导入
                  <input
                    type="file"
                    accept=".json,application/json"
                    onChange={(e) => {
                      const f = e.target.files?.[0]
                      if (f) onImport(f)
                      e.target.value = ''
                    }}
                  />
                </label>
              </div>
              <div className="data-card danger-card">
                <Icon name="trash" size={24} />
                <div>
                  <strong>删除所有对话</strong>
                  <p>清除聊天和对话设定，保留 API 与外观设置。</p>
                </div>
                <button className="button danger" onClick={onClear}>
                  删除
                </button>
              </div>
              <p className="footnote">
                数据不会跨设备同步。清除浏览器数据会移除本机记录，请定期导出备份。无法跨域缓存的远程图片可能随原链接失效。
              </p>
            </>
          )}
        </div>
      </div>
      <footer className="modal-footer">
        <span className="muted">保存后将在当前浏览器保留</span>
        <button className="button secondary" onClick={onClose}>
          {onboarding ? '稍后配置' : '取消'}
        </button>
        <button className="button primary" onClick={save}>
          <Icon name="check" size={16} />
          保存设置
        </button>
      </footer>
    </Modal>
  )
}

type WorldSettings = Pick<Chat, 'id' | 'persona' | 'userPersona' | 'world' | 'summary' | 'compressedUntil'>

export function WorldModal({
  chat,
  onSave,
  onClose,
}: {
  chat: Chat
  onSave: (settings: WorldSettings) => void
  onClose: () => void
}) {
  const [form, setForm] = useState<WorldSettings>(() => ({
    id: chat.id,
    persona: chat.persona,
    userPersona: chat.userPersona,
    world: chat.world,
    summary: chat.summary,
    compressedUntil: chat.compressedUntil,
  }))
  const [tab, setTab] = useState<'persona' | 'world' | 'summary'>('persona')
  const patchWorld = (id: string, patch: Partial<Chat['world'][number]>) =>
    setForm((c) => ({ ...c, world: c.world.map((w) => (w.id === id ? { ...w, ...patch } : w)) }))
  return (
    <Modal
      title="对话设定"
      subtitle="只作用于当前对话，每个故事都可以有自己的世界。"
      wide
      onClose={onClose}
    >
      <div className="world-tabs">
        {(
          [
            ['persona', 'user', '人设'],
            ['world', 'book', '世界书'],
            ['summary', 'compress', '上下文摘要'],
          ] as const
        ).map(([v, icon, title]) => (
          <button className={tab === v ? 'active' : ''} key={v} onClick={() => setTab(v)}>
            <Icon name={icon} />
            {title}
            {v === 'world' && <span className="tiny-badge">{form.world.length}</span>}
          </button>
        ))}
      </div>
      <div className="world-content">
        {tab === 'persona' && (
          <>
            <Field label="助手人设" hint="作为系统提示发送给模型，定义助手身份、语气和行为。">
              <textarea
                rows={7}
                placeholder="例如：你是一位温和、严谨的旅行向导，擅长规划小众路线……"
                value={form.persona}
                onChange={(e) => setForm((c) => ({ ...c, persona: e.target.value }))}
              />
            </Field>
            <Field label="用户人设" hint="你希望助手在这个对话中了解的身份与背景。">
              <textarea
                rows={5}
                placeholder="例如：我是一名旅行摄影师，喜欢安静的自然风景……"
                value={form.userPersona}
                onChange={(e) => setForm((c) => ({ ...c, userPersona: e.target.value }))}
              />
            </Field>
          </>
        )}
        {tab === 'world' && (
          <>
            <div className="section-title">
              <div>
                <h3>世界书条目</h3>
                <p>始终注入，或由最近 6 条消息及当前输入的关键词触发。</p>
              </div>
              <button
                className="button secondary"
                onClick={() =>
                  setForm((c) => ({
                    ...c,
                    world: [
                      ...c.world,
                      { id: uid(), title: '', keys: '', content: '', enabled: true, always: true },
                    ],
                  }))
                }
              >
                <Icon name="plus" />
                添加条目
              </button>
            </div>
            {!form.world.length && (
              <div className="empty-world">
                <Icon name="book" size={38} />
                <h3>故事的规则，从这里开始</h3>
                <p>
                  添加地点、角色关系或背景知识，
                  <br />
                  让助手理解你构建的世界。
                </p>
              </div>
            )}
            {form.world.map((w, index) => (
              <section className={`world-entry ${!w.enabled ? 'disabled-entry' : ''}`} key={w.id}>
                <div className="entry-head">
                  <span className="entry-number">{String(index + 1).padStart(2, '0')}</span>
                  <input
                    value={w.title}
                    placeholder="条目名称"
                    aria-label="条目名称"
                    onChange={(e) => patchWorld(w.id, { title: e.target.value })}
                  />
                  <label className="check-row">
                    <input
                      type="checkbox"
                      checked={w.enabled}
                      onChange={(e) => patchWorld(w.id, { enabled: e.target.checked })}
                    />
                    启用
                  </label>
                  <button
                    className="icon-button"
                    aria-label="删除条目"
                    onClick={() =>
                      setForm((c) => ({ ...c, world: c.world.filter((x) => x.id !== w.id) }))
                    }
                  >
                    <Icon name="trash" size={17} />
                  </button>
                </div>
                <textarea
                  rows={4}
                  aria-label="条目内容"
                  placeholder="写下这个世界需要记住的事……"
                  value={w.content}
                  onChange={(e) => patchWorld(w.id, { content: e.target.value })}
                />
                <div className="entry-trigger">
                  <select
                    aria-label="触发方式"
                    value={w.always ? 'always' : 'keywords'}
                    onChange={(e) => patchWorld(w.id, { always: e.target.value === 'always' })}
                  >
                    <option value="always">始终启用</option>
                    <option value="keywords">关键词触发</option>
                  </select>
                  {!w.always && (
                    <input
                      aria-label="触发关键词"
                      value={w.keys}
                      placeholder="关键词，用逗号分隔"
                      onChange={(e) => patchWorld(w.id, { keys: e.target.value })}
                    />
                  )}
                  <span className="muted">≈ {estimateTokens(w.content)} tokens</span>
                </div>
              </section>
            ))}
          </>
        )}
        {tab === 'summary' && (
          <>
            <h3>模型正在使用的记忆摘要</h3>
            <p className="section-description">
              压缩会总结较早的消息，并保留最近两轮对话。原始聊天始终完整保存。你也可以在这里修订摘要。
            </p>
            <Field label="压缩摘要">
              <textarea
                rows={12}
                value={form.summary}
                placeholder="暂未压缩上下文"
                onChange={(e) => setForm((c) => ({ ...c, summary: e.target.value }))}
              />
            </Field>
            <p className="notice">已从模型上下文中折叠 {form.compressedUntil} 条历史消息。</p>
            {form.compressedUntil > 0 && (
              <button
                className="button secondary"
                onClick={() => setForm((c) => ({ ...c, summary: '', compressedUntil: 0 }))}
              >
                <Icon name="refresh" />
                恢复完整上下文
              </button>
            )}
          </>
        )}
      </div>
      <footer className="modal-footer">
        <span className="muted">仅当前对话生效</span>
        <button className="button secondary" onClick={onClose}>
          取消
        </button>
        <button className="button primary" onClick={() => onSave(form)}>
          保存设定
        </button>
      </footer>
    </Modal>
  )
}

