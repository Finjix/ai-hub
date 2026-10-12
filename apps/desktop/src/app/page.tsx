'use client';
import { useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import type { DesktopSnapshot, LocalSkill, Skill, SkillDetail, TaskStatus } from '@ai-hub/shared';

type View = 'store' | 'installed' | 'tasks' | 'settings';
const empty: DesktopSnapshot = { serverUrl: '', connected: false, connectionMessage: '未连接服务器', appVersion: '0.1.0', installRoot: '', skills: [], localSkills: [], tasks: [], busy: false, appUpdate: { status: 'idle', progress: 0, message: '尚未检查更新' } };
const paths: Record<string, React.ReactNode> = {
  grid: <><rect x="4" y="4" width="6.5" height="6.5" rx="1"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1"/></>,
  box: <><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9"/></>,
  activity: <path d="M3 12h4l3-7 4 14 3-7h4"/>,
  settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></>,
  search: <><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></>,
  refresh: <><path d="M20 11a8 8 0 0 0-14.3-4.9L4 8m0-5v5h5"/><path d="M4 13a8 8 0 0 0 14.3 4.9L20 16m0 5v-5h-5"/></>,
  check: <path d="m5 12.5 4.5 4.5L19 7"/>,
  close: <path d="m6 6 12 12M6 18 18 6"/>,
  download: <path d="M12 4v11m-4.5-4.5L12 15l4.5-4.5M5 19h14"/>,
  folder: <path d="M3.5 6.5a1 1 0 0 1 1-1h4.6l2 2.5h8.4a1 1 0 0 1 1 1v9.5a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1z"/>,
  external: <path d="M14 4h6v6m0-6-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>,
  trash: <path d="M4.5 7h15M10 11v6m4-6v6M6 7l1 12.5a1 1 0 0 0 1 .9h8a1 1 0 0 0 1-.9L18 7M9 7V4.5h6V7"/>,
};
function Icon({ name, size = 18 }: { name: string; size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>; }
function Mark() { return <svg className="mark" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="7" fill="#2A2A2A"/><path d="M6.5 25 13.4 7h5.2l6.9 18h-4.6L16 11.6 11.1 25z" fill="#fff"/><rect x="9.6" y="18.4" width="9.4" height="3.3" fill="#3BFF93"/></svg>; }
function glyph(name: string) { const han = name.match(/[一-龥]/); return han ? han[0] : (name.replace(/[^a-zA-Z]/g, '').slice(0, 2) || 'S').replace(/^./, c => c.toUpperCase()); }
const cleanError = (error: unknown) => String(error instanceof Error ? error.message : error).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '');
const titles: Record<View, string> = { store: '技能广场', installed: '已安装', tasks: '任务', settings: '设置' };

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
  useEffect(() => {
    if (!detail && !remove) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { setDetail(null); setRemove(null); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [detail, remove]);
  const categoryCounts = useMemo(() => state.skills.reduce<Record<string, number>>((counts, skill) => { const key = skill.category || '未分类'; counts[key] = (counts[key] ?? 0) + 1; return counts; }, {}), [state.skills]);
  const categories = ['全部', ...Object.keys(categoryCounts)];
  const filtered = useMemo(() => state.skills.filter(skill => (category === '全部' || (skill.category || '未分类') === category) && `${skill.displayName} ${skill.name} ${skill.description} ${skill.tags.join(' ')}`.toLowerCase().includes(query.toLowerCase())), [state.skills, category, query]);
  const managed = state.localSkills.filter(skill => skill.managed);
  const external = state.localSkills.filter(skill => !skill.managed);
  const activeTasks = state.tasks.filter(task => task.status === 'running' || task.status === 'queued').length;
  const action = async (callback: () => Promise<unknown>) => { try { if (!window.aiHub) throw new Error('请在 AI Hub 桌面应用中操作'); await callback(); } catch (error) { setFeedback(cleanError(error)); } };
  const connect = async () => {
    if (!serverInput.trim()) { setFeedback('请输入服务器地址'); return; }
    setConnecting(true);
    await action(async () => { const snapshot = await window.aiHub!.connect(serverInput); setState(snapshot); setServerInput(snapshot.serverUrl); setFeedback('已连接服务器'); });
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
  const statusText = { queued: '等待中', running: '进行中', success: '完成', failed: '失败' };
  const isInstalled = (skill: Skill) => state.localSkills.some(local => local.managed?.skillId === skill.id);
  const installButton = (skill: Skill) => {
    const installed = isInstalled(skill);
    const pending = state.tasks.some(task => task.skillId === skill.id && ['running', 'queued'].includes(task.status));
    if (installed) return <span className="installed-state"><Icon name="check" size={15}/>已安装</span>;
    return <button className="btn btn-green btn-sm" disabled={!state.connected || pending || !skill.latestVersion} onClick={event => { event.stopPropagation(); void action(() => window.aiHub!.install(skill.id)); }}>{pending ? '安装中' : '安装'}</button>;
  };
  const serverForm = (label: string) => <div className="field-row">
    <input id="server-url" aria-label="服务器地址" disabled={!ready || connecting} placeholder="http://192.168.1.10:3000" value={serverInput} onChange={event => setServerInput(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void connect(); }}/>
    <button className="btn btn-ink" disabled={!ready || connecting || state.busy} onClick={() => void connect()}>{connecting ? '连接中…' : label}</button>
  </div>;
  const localRow = (skill: LocalSkill) => <div className="row" key={skill.name}>
    <span className={`glyph${skill.managed ? ' is-installed' : ''}`}>{glyph(skill.managed?.displayName ?? skill.name)}</span>
    <div className="row-main"><h3>{skill.managed?.displayName ?? skill.name}</h3><p>{skill.description}</p><span className="path">{skill.path}</span></div>
    {skill.managed && <span className="num">v{skill.managed.version}</span>}
    {skill.managed && <button className="btn btn-line btn-sm" onClick={() => setRemove(skill)}>卸载</button>}
  </div>;

  return <div className="shell">
    <aside className="rail">
      <div className="brand"><Mark/><span>AI Hub</span></div>
      <nav>{([['store', 'grid'], ['installed', 'box'], ['tasks', 'activity'], ['settings', 'settings']] as const).map(([id, icon]) => <button key={id} className={`nav-item${view === id ? ' active' : ''}`} aria-current={view === id ? 'page' : undefined} onClick={() => setView(id)}><Icon name={icon}/><span>{titles[id]}</span>{id === 'installed' && managed.length > 0 && <em>{managed.length}</em>}{id === 'tasks' && activeTasks > 0 && <em className="busy">{activeTasks}</em>}</button>)}</nav>
      <div className="rail-foot">
        <button className="rail-link" onClick={() => void action(() => window.aiHub!.openAdmin())} disabled={!state.serverUrl}><Icon name="external" size={15}/>管理后台</button>
        <button className="rail-status" onClick={() => setView('settings')} title={state.connectionMessage}><span className={`dot${state.connected ? ' on' : ''}`}/>{state.connected ? '已连接' : '未连接'}<span className="num">v{state.appVersion}</span></button>
      </div>
    </aside>
    <main className="main">
      {!desktop && <div className="banner warn">当前为页面预览，安装功能需在桌面应用中使用。</div>}
      {state.appUpdate.status === 'ready' && <div className="banner"><span>AI Hub {state.appUpdate.version} 已下载完成</span><button className="btn btn-ink btn-sm" disabled={state.busy} onClick={() => void action(() => window.aiHub!.restartForUpdate())}>重启更新</button></div>}
      <div className="page">
        {view === 'store' && <>
          <header className="page-head">
            <h1>技能广场</h1>{state.serverUrl && <span className="count">{state.skills.length}</span>}
            {state.serverUrl && <div className="head-tools">
              <label className="search"><Icon name="search" size={16}/><input placeholder="搜索技能或标签" aria-label="搜索技能" value={query} onChange={event => setQuery(event.target.value)}/></label>
              <button className="btn btn-line btn-icon" aria-label="刷新技能库" title="刷新" disabled={state.busy} onClick={() => void action(() => window.aiHub!.refresh())}><Icon name="refresh" size={16}/></button>
            </div>}
          </header>
          {!state.serverUrl ? <section className="connect">
            <h2>连接技能服务器</h2>
            <p>填写团队服务器的局域网地址。</p>
            {serverForm('连接服务器')}
          </section> : <>
            {!state.connected && <div className="banner warn inline">{state.connectionMessage}<button className="btn-text" onClick={() => void action(() => window.aiHub!.refresh())}>重新连接</button></div>}
            {categories.length > 2 && <div className="tabs" role="tablist" aria-label="技能分类">{categories.map(item => <button key={item} role="tab" aria-selected={category === item} className={category === item ? 'selected' : ''} onClick={() => setCategory(item)}>{item}<span>{item === '全部' ? state.skills.length : categoryCounts[item]}</span></button>)}</div>}
            <div className="skill-grid">{filtered.map(skill => <article className="skill-card" key={skill.id} onClick={() => void showDetail(skill)} tabIndex={0} onKeyDown={event => { if (event.target === event.currentTarget && event.key === 'Enter') void showDetail(skill); }}>
              <div className="card-head"><span className={`glyph${isInstalled(skill) ? ' is-installed' : ''}`}>{glyph(skill.displayName)}</span><div><h3>{skill.displayName}</h3><span className="slug">{skill.name}</span></div></div>
              <p className="desc">{skill.description}</p>
              <div className="card-foot"><span className="meta">{skill.category || '未分类'}</span><span className="meta num">{skill.latestVersion ? `v${skill.latestVersion.version}` : '未发布'}</span>{installButton(skill)}</div>
            </article>)}</div>
            {!filtered.length && <div className="empty">{query || category !== '全部' ? <><h3>没有匹配的技能</h3><p>换个关键词试试。</p></> : <><h3>还没有发布的技能</h3><p>在管理后台上传并发布后，技能会出现在这里。</p><button className="btn btn-line" onClick={() => void action(() => window.aiHub!.openAdmin())}>打开管理后台</button></>}</div>}
          </>}
        </>}
        {view === 'installed' && <>
          <header className="page-head"><h1>已安装</h1><span className="count">{state.localSkills.length}</span><div className="head-tools"><button className="btn btn-line" onClick={() => void action(() => window.aiHub!.openFolder())}><Icon name="folder" size={16}/>打开技能目录</button></div></header>
          {managed.length > 0 && <section className="group"><h2>由 AI Hub 管理<span>启动时自动更新</span></h2><div className="list">{managed.map(localRow)}</div></section>}
          {external.length > 0 && <section className="group"><h2>其他来源<span>AI Hub 不会修改或卸载</span></h2><div className="list">{external.map(localRow)}</div></section>}
          {!state.localSkills.length && <div className="empty"><h3>还没有安装技能</h3><button className="btn btn-ink" onClick={() => setView('store')}>去技能广场</button></div>}
        </>}
        {view === 'tasks' && <>
          <header className="page-head"><h1>任务</h1>{activeTasks > 0 && <span className="count">{activeTasks} 进行中</span>}</header>
          {state.tasks.length > 0 && <div className="list">{state.tasks.map(task => <div className="row task" key={task.id}>
            <span className={`task-icon ${task.status}`}><Icon name={task.status === 'success' ? 'check' : task.status === 'failed' ? 'close' : task.kind === 'uninstall' ? 'trash' : task.kind === 'sync' ? 'refresh' : 'download'} size={16}/></span>
            <div className="row-main"><h3>{task.label}</h3><p>{task.message}</p>{task.status === 'running' && <div className="progress"><span style={{ width: `${task.progress}%` }}/></div>}</div>
            <time className="num">{new Date(task.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</time>
            <span className={`task-status ${task.status}`}>{statusText[task.status]}</span>
            {task.status === 'failed' && <button className="btn btn-line btn-sm" onClick={() => void retry(task)}>重试</button>}
          </div>)}</div>}
          {!state.tasks.length && <div className="empty"><h3>暂无任务</h3><p>安装、更新和卸载的进度会显示在这里。</p></div>}
        </>}
        {view === 'settings' && <>
          <header className="page-head"><h1>设置</h1></header>
          <div className="settings">
            <section className="setting">
              <div className="setting-label"><label htmlFor="server-url">服务器地址</label></div>
              <div className="setting-body">{serverForm('保存并连接')}<div className="hint"><span className={`dot${state.connected ? ' on' : ''}`}/>{state.connectionMessage}</div></div>
            </section>
            <section className="setting">
              <div className="setting-label">技能目录</div>
              <div className="setting-body split"><span className="path">{state.installRoot || '~/.codex/skills'}</span><button className="btn btn-line btn-sm" onClick={() => void action(() => window.aiHub!.openFolder())}>打开</button></div>
            </section>
            <section className="setting">
              <div className="setting-label">自动更新技能</div>
              <div className="setting-body split"><span>每次启动时更新到最新版本，本地修改会被覆盖。</span><span className="on-tag">已开启</span></div>
            </section>
            <section className="setting">
              <div className="setting-label">应用版本</div>
              <div className="setting-body split">
                <div><strong className="num big">v{state.appVersion}</strong><div className="hint">{state.appUpdate.message}</div>{state.appUpdate.status === 'downloading' && <div className="progress"><span style={{ width: `${state.appUpdate.progress}%` }}/></div>}</div>
                {state.appUpdate.status === 'ready' ? <button className="btn btn-ink btn-sm" disabled={state.busy} onClick={() => void action(() => window.aiHub!.restartForUpdate())}>重启更新</button> : <button className="btn btn-line btn-sm" disabled={!state.serverUrl || ['checking', 'downloading', 'available'].includes(state.appUpdate.status)} onClick={() => void action(() => window.aiHub!.checkAppUpdate())}>检查更新</button>}
              </div>
            </section>
          </div>
        </>}
      </div>
    </main>
    {feedback && <div className="toast" role="status"><span>{feedback}</span><button aria-label="关闭提示" onClick={() => setFeedback('')}><Icon name="close" size={15}/></button></div>}
    {detail && <div className="backdrop" onClick={() => setDetail(null)}><section className="dialog detail" role="dialog" aria-modal="true" aria-label="技能详情" onClick={event => event.stopPropagation()}>
      <button className="dialog-close" aria-label="关闭详情" onClick={() => setDetail(null)}><Icon name="close"/></button>
      <header className="detail-head">
        <span className={`glyph lg${isInstalled(detail) ? ' is-installed' : ''}`}>{glyph(detail.displayName)}</span>
        <div className="detail-title"><h2>{detail.displayName}</h2><div className="detail-meta"><span>{detail.name}</span><span className="num">{detail.latestVersion ? `v${detail.latestVersion.version}` : '未发布'}</span><span>{detail.category || '未分类'}</span></div></div>
        {installButton(detail)}
      </header>
      {detail.description && <p className="detail-desc">{detail.description}</p>}
      {detail.tags.length > 0 && <div className="tags">{detail.tags.map(tag => <span key={tag}>{tag}</span>)}</div>}
      {detail.latestVersion?.changelog && <div className="changelog"><strong className="num">v{detail.latestVersion.version} 更新</strong><p>{detail.latestVersion.changelog}</p></div>}
      <div className="markdown"><ReactMarkdown skipHtml>{detail.latestVersion?.markdown.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '') ?? '暂无说明'}</ReactMarkdown></div>
    </section></div>}
    {remove && <div className="backdrop" onClick={() => setRemove(null)}><section className="dialog confirm" role="dialog" aria-modal="true" aria-label="卸载技能" onClick={event => event.stopPropagation()}>
      <h2>卸载「{remove.managed?.displayName}」？</h2>
      <p>本地文件会被删除，包括你做过的修改。</p>
      <div className="dialog-actions"><button className="btn btn-line" onClick={() => setRemove(null)}>取消</button><button className="btn btn-danger" onClick={() => { const name = remove.name; setRemove(null); void action(() => window.aiHub!.uninstall(name)); }}>确认卸载</button></div>
    </section></div>}
  </div>;
}
