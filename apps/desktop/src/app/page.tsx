'use client';
import { useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import type { DesktopSnapshot, LocalSkill, Skill, SkillDetail, TaskStatus } from '@ai-hub/shared';

type View = 'store' | 'installed' | 'tasks' | 'settings';
const empty: DesktopSnapshot = { serverUrl: '', connected: false, connectionMessage: '请连接团队技能服务器', appVersion: '0.1.0', installRoot: '', skills: [], localSkills: [], tasks: [], busy: false, appUpdate: { status: 'idle', progress: 0, message: '启动后自动检查应用版本' } };
const paths: Record<string, React.ReactNode> = {
  grid: <><rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/></>,
  box: <><path d="m12 3 9 5v9l-9 5-9-5V8z"/><path d="m3 8 9 5 9-5M12 13v9M8 5l9 5"/></>,
  activity: <><path d="M3 12h4l3-8 4 16 3-8h4"/></>,
  settings: <><circle cx="12" cy="12" r="3"/><path d="m9 3-1 3-3 1-2 3 2 2-1 3 3 3 3-1 2 3 3-1 1-3 3-1 2-3-2-2 1-3-3-3-3 1z"/></>,
  search: <><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></>,
  arrow: <><path d="M4 12h16m-6-6 6 6-6 6"/></>,
  refresh: <><path d="M20 7a8 8 0 0 0-14-2L3 8m0-5v5h5M4 17a8 8 0 0 0 14 2l3-3m0 5v-5h-5"/></>,
  check: <path d="m5 12 4 4L19 6"/>,
  close: <path d="m6 6 12 12M6 18 18 6"/>,
  spark: <><path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z"/></>,
  download: <><path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/></>,
  folder: <path d="M3 7V5h7l2 3h9v12H3z"/>,
  external: <><path d="M14 3h7v7m0-7L10 14M10 3H3v18h18v-7"/></>,
};
function Icon({ name, size = 20 }: { name: string; size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] ?? paths.spark}</svg>; }
function monogram(name: string) { return name.replace(/[^a-zA-Z\u4e00-\u9fa5]/g, '').slice(0, 2).toUpperCase() || 'SK'; }
function tone(name: string) { return ['violet', 'blue', 'mint', 'amber'][[...name].reduce((n, c) => n + c.charCodeAt(0), 0) % 4]; }
const cleanError = (error: unknown) => String(error instanceof Error ? error.message : error).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '');

export default function Home() {
  const [state, setState] = useState<DesktopSnapshot>(empty);
  const [view, setView] = useState<View>('store');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('全部');
  const [serverInput, setServerInput] = useState('');
  const [feedback, setFeedback] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [detail, setDetail] = useState<SkillDetail | null>(null);
  const [remove, setRemove] = useState<LocalSkill | null>(null);
  const [desktop, setDesktop] = useState(true);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const bridge = window.aiHub;
    if (!bridge) { setDesktop(false); return; }
    const receive = (snapshot: DesktopSnapshot) => { setState(snapshot); };
    const unsubscribe = bridge.onChange(receive);
    bridge.snapshot().then(snapshot => { receive(snapshot); setServerInput(snapshot.serverUrl); setReady(true); }).catch(error => setFeedback(cleanError(error)));
    return unsubscribe;
  }, []);
  useEffect(() => { if (!feedback) return; const timer = setTimeout(() => setFeedback(''), 7000); return () => clearTimeout(timer); }, [feedback]);
  const categories = ['全部', ...new Set(state.skills.map(skill => skill.category || '未分类'))];
  const filtered = useMemo(() => state.skills.filter(skill => (category === '全部' || (skill.category || '未分类') === category) && `${skill.displayName} ${skill.name} ${skill.description} ${skill.tags.join(' ')}`.toLowerCase().includes(query.toLowerCase())), [state.skills, category, query]);
  const managed = state.localSkills.filter(skill => skill.managed);
  const activeTasks = state.tasks.filter(task => task.status === 'running' || task.status === 'queued').length;
  const action = async (callback: () => Promise<unknown>) => { try { if (!window.aiHub) throw new Error('请通过 AI Hub 桌面应用执行此操作'); await callback(); } catch (error) { setFeedback(cleanError(error)); } };
  const connect = async () => {
    if (!serverInput.trim()) { setFeedback('请输入服务器地址'); return; }
    setConnecting(true);
    await action(async () => { const snapshot = await window.aiHub!.connect(serverInput); setState(snapshot); setServerInput(snapshot.serverUrl); setFeedback('已连接团队服务器'); });
    setConnecting(false);
  };
  const showDetail = async (skill: Skill) => {
    setDetail({ ...skill, versions: skill.latestVersion ? [skill.latestVersion] : [] });
    if (state.connected) await action(async () => setDetail(await window.aiHub!.detail(skill.id)));
  };
  const retry = (task: TaskStatus) => action(async () => {
    if (task.kind === 'sync') await window.aiHub!.refresh();
    else if (task.kind === 'uninstall') { const local = state.localSkills.find(item => item.managed?.skillId === task.skillId); if (!local) throw new Error('该技能已卸载'); await window.aiHub!.uninstall(local.name); }
    else if (task.skillId) await window.aiHub!.install(task.skillId);
  });
  const statusText = { queued: '等待中', running: '进行中', success: '已完成', failed: '失败' };
  const installButton = (skill: Skill) => {
    const installed = state.localSkills.find(local => local.managed?.skillId === skill.id);
    const pending = state.tasks.some(task => task.skillId === skill.id && ['running', 'queued'].includes(task.status));
    return <button className={`button ${installed ? 'installed-button' : 'install-button'}`} disabled={!state.connected || pending || !!installed || !skill.latestVersion} onClick={event => { event.stopPropagation(); void action(() => window.aiHub!.install(skill.id)); }}><Icon name={installed ? 'check' : 'download'} size={15}/>{pending ? '处理中' : installed ? '已安装' : '安装'}</button>;
  };
  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-icon"><Icon name="spark" size={24}/></span><div>AI Hub<small>你的团队技能库</small></div></div>
      <div className="nav-heading">工作空间</div>
      <nav>{([['store', 'grid', '技能广场'], ['installed', 'box', '已安装'], ['tasks', 'activity', '任务'], ['settings', 'settings', '设置']] as const).map(([id, icon, label]) => <button key={id} className={`nav-item ${view === id ? 'active' : ''}`} onClick={() => setView(id)}><Icon name={icon}/><span>{label}</span>{id === 'installed' && <em>{managed.length}</em>}{id === 'tasks' && activeTasks > 0 && <em>{activeTasks}</em>}</button>)}</nav>
      <div className="sidebar-note"><span className="note-symbol">✦</span><strong>技能，始终保持新鲜</strong><p>每次启动自动同步，让团队的最新经验随手可用。</p></div>
      <div className="sidebar-bottom"><div><span className={`status-dot ${state.connected ? 'online' : ''}`}/>{state.connected ? '团队服务器已连接' : '服务器未连接'}</div><button onClick={() => setView('settings')}>AI Hub <span>v{state.appVersion}</span><Icon name="settings" size={14}/></button></div>
    </aside>
    <main className="main">
      <header className="topbar"><div className="breadcrumb">工作空间 <span>/</span> <strong>{{ store: '技能广场', installed: '已安装', tasks: '任务', settings: '设置' }[view]}</strong></div><button className="quiet-button" onClick={() => void action(() => window.aiHub!.openAdmin())} disabled={!state.serverUrl}><Icon name="external" size={15}/>管理后台</button></header>
      {!desktop && <div className="notice">这是客户端页面预览。本地安装功能请通过 Electron 桌面应用使用。</div>}
      {state.appUpdate.status === 'ready' && <div className="update-banner"><Icon name="spark"/><span>AI Hub {state.appUpdate.version} 已准备好。重启即可体验新版。</span><button className="button primary" disabled={state.busy} onClick={() => void action(() => window.aiHub!.restartForUpdate())}>重启更新</button></div>}
      <div className="page-content">
        {view === 'store' && <>
          <section className="store-heading"><div className="eyebrow"><span/>DISCOVER YOUR NEXT SKILL</div><h1>好用的技能，<span>随时就位。</span></h1><p>探索团队共享的 Codex 技能，把重复工作交给更好的方法。</p><div className="heading-bottom"><div className="catalog-stat"><strong>{state.skills.length}</strong> 个团队技能 <span>·</span><Icon name="refresh" size={13}/> 自动保持最新</div><button className="quiet-button" disabled={!state.serverUrl || state.busy} onClick={() => void action(() => window.aiHub!.refresh())}><Icon name="refresh" size={15}/>刷新技能库</button></div><div className="hero-art" aria-hidden="true"><div className="art-grid"/><div className="art-tile tile-one"><Icon name="box" size={37}/></div><div className="art-tile tile-two"><Icon name="spark" size={37}/></div><div className="art-tile tile-three"><Icon name="check" size={26}/></div><span className="art-star">✦</span></div></section>
          {!state.serverUrl ? <section className="connect-card"><div className="connect-icon"><Icon name="box" size={28}/></div><div><h2>连接你的团队技能库</h2><p>填入局域网服务器地址，即可开始发现与安装技能。</p><div className="connect-form"><input aria-label="服务器地址" disabled={!ready || connecting} placeholder="http://192.168.1.10:3000" value={serverInput} onChange={event => setServerInput(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void connect(); }}/><button className="button primary" disabled={!ready || connecting} onClick={() => void connect()}>{connecting ? '正在连接…' : '连接服务器'}<Icon name="arrow" size={16}/></button></div></div></section> : <>
            {!state.connected && <div className="notice">{state.connectionMessage}。<button onClick={() => void action(() => window.aiHub!.refresh())}>重新连接</button></div>}
            <div className="catalog-tools"><div className="category-tabs">{categories.map(item => <button key={item} className={category === item ? 'selected' : ''} onClick={() => setCategory(item)}>{item}</button>)}</div><label className="search"><Icon name="search" size={18}/><input placeholder="搜索技能、标签…" aria-label="搜索技能" value={query} onChange={event => setQuery(event.target.value)}/></label></div>
            <div className="section-label"><h2>{category === '全部' ? '全部技能' : category}</h2><span>{filtered.length} 个结果</span></div>
            <div className="skill-grid">{filtered.map(skill => <article className="skill-card" key={skill.id} onClick={() => void showDetail(skill)} tabIndex={0} onKeyDown={event => { if (event.target === event.currentTarget && event.key === 'Enter') void showDetail(skill); }}><div className="card-top"><div className={`skill-icon ${tone(skill.name)}`}>{monogram(skill.displayName)}</div><span className="category-label">{skill.category || '未分类'}</span></div><h3>{skill.displayName}</h3><div className="skill-slug">{skill.name}</div><p>{skill.description}</p><div className="tags">{skill.tags.slice(0, 3).map(tag => <span key={tag}>{tag}</span>)}</div><div className="card-bottom"><span>v{skill.latestVersion?.version ?? '未发布'}</span>{installButton(skill)}</div></article>)}</div>
            {!filtered.length && <div className="empty-state"><Icon name="search" size={38}/><h3>{query ? '没有找到匹配的技能' : '技能库正在等待第一份灵感'}</h3><p>{query ? '试试其他关键词或分类。' : '在管理后台上传并发布 Skill ZIP，它就会出现在这里。'}</p></div>}
          </>}
          <div className="page-footnote"><Icon name="check" size={14}/> 安装前校验资源完整性 <span>·</span> 自动更新团队发布的技能</div>
        </>}
        {view === 'installed' && <><div className="section-heading"><div><div className="eyebrow">YOUR TOOLKIT</div><h1>已安装的技能</h1><p>管理你的技能工具箱。AI Hub 安装的技能会在启动时自动更新。</p></div><button className="button secondary" onClick={() => void action(() => window.aiHub!.openFolder())}><Icon name="folder" size={16}/>打开技能目录</button></div><div className="list-panel">{state.localSkills.map(skill => <div className="local-row" key={skill.name}><div className={`skill-icon small ${tone(skill.name)}`}>{monogram(skill.name)}</div><div className="local-info"><h3>{skill.managed?.displayName ?? skill.name}<span className={`source-tag ${skill.managed ? 'owned' : ''}`}>{skill.managed ? 'AI Hub 管理' : '外部安装'}</span></h3><p>{skill.description}</p><code>{skill.path}</code></div><span className="version-text">{skill.managed ? `v${skill.managed.version}` : '—'}</span>{skill.managed && <button className="button danger-quiet" onClick={() => setRemove(skill)}>卸载</button>}</div>)}</div>{!state.localSkills.length && <div className="empty-state"><Icon name="box" size={42}/><h3>你的工具箱还是空的</h3><p>前往技能广场，安装第一个团队技能。</p><button className="button primary" onClick={() => setView('store')}>发现技能<Icon name="arrow" size={16}/></button></div>}</>}
        {view === 'tasks' && <><div className="section-heading"><div><div className="eyebrow">ACTIVITY</div><h1>任务记录</h1><p>查看技能安装、自动更新和卸载的进度。</p></div><span className="summary-pill">{activeTasks ? `${activeTasks} 个任务进行中` : '所有任务已就绪'}</span></div><div className="list-panel">{state.tasks.map(task => <div className="task-row" key={task.id}><div className={`task-symbol ${task.status}`}><Icon name={task.status === 'success' ? 'check' : task.status === 'failed' ? 'close' : 'download'}/></div><div className="task-info"><h3>{task.label}</h3><p>{task.message}</p>{task.status === 'running' && <div className="progress"><span style={{ width: `${task.progress}%` }}/></div>}</div><time>{new Date(task.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</time><span className={`task-status ${task.status}`}>{statusText[task.status]}</span>{task.status === 'failed' && <button className="button secondary" onClick={() => void retry(task)}>重试</button>}</div>)}</div>{!state.tasks.length && <div className="empty-state"><Icon name="activity" size={42}/><h3>还没有任务记录</h3><p>安装技能后，处理进度会显示在这里。</p></div>}</>}
        {view === 'settings' && <><div className="section-heading"><div><div className="eyebrow">PREFERENCES</div><h1>设置</h1><p>连接团队服务器，查看安装位置与应用更新。</p></div></div><section className="settings-panel"><h2>团队服务器</h2><p>客户端与管理后台使用同一个局域网服务器。</p><label className="field-label" htmlFor="server-url">服务器地址</label><div className="connect-form"><input id="server-url" value={serverInput} placeholder="http://192.168.1.10:3000" onChange={event => setServerInput(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void connect(); }}/><button className="button primary" disabled={connecting || state.busy} onClick={() => void connect()}>{connecting ? '正在连接…' : '保存并连接'}</button></div><div className="connection-status"><span className={`status-dot ${state.connected ? 'online' : ''}`}/>{state.connectionMessage}</div></section><section className="settings-panel"><h2>技能安装</h2><div className="setting-row"><div><strong>当前用户的全局目录</strong><code>{state.installRoot || '~/.codex/skills'}</code></div><button className="button secondary" onClick={() => void action(() => window.aiHub!.openFolder())}><Icon name="folder" size={16}/>打开目录</button></div><div className="setting-row"><div><strong>启动时自动更新</strong><p>新版发布后直接替换本应用管理的技能文件，包括本地修改。</p></div><span className="enabled-tag">已开启</span></div></section><section className="settings-panel"><h2>应用更新</h2><div className="setting-row"><div><strong>AI Hub <span className="version-text">v{state.appVersion}</span></strong><p>{state.appUpdate.message}</p>{state.appUpdate.status === 'downloading' && <div className="progress"><span style={{ width: `${state.appUpdate.progress}%` }}/></div>}</div>{state.appUpdate.status === 'ready' ? <button className="button primary" disabled={state.busy} onClick={() => void action(() => window.aiHub!.restartForUpdate())}>重启更新</button> : <button className="button secondary" disabled={!state.serverUrl || ['checking', 'downloading', 'available'].includes(state.appUpdate.status)} onClick={() => void action(() => window.aiHub!.checkAppUpdate())}><Icon name="refresh" size={15}/>检查更新</button>}</div><p className="muted-small">发现新版后自动下载，确认重启后安装。</p></section></>}
      </div>
    </main>
    {feedback && <div className="toast" role="status"><Icon name="activity" size={17}/>{feedback}<button aria-label="关闭提示" onClick={() => setFeedback('')}><Icon name="close" size={16}/></button></div>}
    {detail && <div className="modal-backdrop" onClick={() => setDetail(null)}><section className="detail-modal" role="dialog" aria-modal="true" aria-label="技能详情" onClick={event => event.stopPropagation()}><button className="modal-close" aria-label="关闭详情" onClick={() => setDetail(null)}><Icon name="close"/></button><div className="detail-heading"><div className={`skill-icon large ${tone(detail.name)}`}>{monogram(detail.displayName)}</div><div><span className="category-label">{detail.category || '未分类'}</span><h2>{detail.displayName}</h2><p>{detail.name} · v{detail.latestVersion?.version}</p></div>{installButton(detail)}</div><p className="detail-description">{detail.description}</p><div className="tags">{detail.tags.map(tag => <span key={tag}>{tag}</span>)}</div><div className="detail-tabs">使用说明</div><div className="markdown"><ReactMarkdown skipHtml>{detail.latestVersion?.markdown.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '') ?? '暂无说明'}</ReactMarkdown></div>{detail.latestVersion?.changelog && <div className="changelog"><strong>本次更新</strong><p>{detail.latestVersion.changelog}</p></div>}</section></div>}
    {remove && <div className="modal-backdrop"><section className="confirm-modal" role="dialog" aria-modal="true" aria-label="卸载技能"><div className="connect-icon"><Icon name="box" size={28}/></div><h2>卸载 {remove.managed?.displayName}？</h2><p>这会删除该技能的本地文件，包括你的修改。卸载后不会再自动更新。</p><div className="confirm-actions"><button className="button secondary" onClick={() => setRemove(null)}>取消</button><button className="button destructive" onClick={() => { const name = remove.name; setRemove(null); void action(() => window.aiHub!.uninstall(name)); }}>确认卸载</button></div></section></div>}
  </div>;
}
