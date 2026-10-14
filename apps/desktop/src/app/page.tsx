'use client';
import { useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { formatAppVersion } from '@ai-hub/shared';
import { renderIntroduction } from './introduction';
import type { DesktopSnapshot, LocalSkill, Skill, SkillDetail, TaskStatus } from '@ai-hub/shared';

type View = 'store' | 'installed' | 'settings';
const empty: DesktopSnapshot = { serverUrl: '', connected: false, connectionMessage: '未连接服务器', appVersion: '0.1.0', installRoot: '', skills: [], localSkills: [], tasks: [], busy: false, autoUpdateSkills: true, launchAtLogin: true, appUpdate: { status: 'idle', progress: 0, message: '尚未检查更新' } };
const paths: Record<string, React.ReactNode> = {
  grid: <><rect x="4" y="4" width="6.5" height="6.5" rx="1"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1"/></>,
  box: <><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9"/></>,
  settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></>,
  search: <><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></>,
  refresh: <><path d="M20 11a8 8 0 0 0-14.3-4.9L4 8m0-5v5h5"/><path d="M4 13a8 8 0 0 0 14.3 4.9L20 16m0 5v-5h-5"/></>,
  check: <path d="m5 12.5 4.5 4.5L19 7"/>,
  close: <path d="m6 6 12 12M6 18 18 6"/>,
  download: <path d="M12 4v11m-4.5-4.5L12 15l4.5-4.5M5 19h14"/>,
  folder: <path d="M3.5 6.5a1 1 0 0 1 1-1h4.6l2 2.5h8.4a1 1 0 0 1 1 1v9.5a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1z"/>,
  trash: <path d="M4.5 7h15M10 11v6m4-6v6M6 7l1 12.5a1 1 0 0 0 1 .9h8a1 1 0 0 0 1-.9L18 7M9 7V4.5h6V7"/>,
};
function Icon({ name, size = 18 }: { name: string; size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>; }
function Mark() { return <span className="mark"><img src="/brand-logo.png" alt="Century Games"/></span>; }
function formatDay(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(date).replace(/\//g, '-');
}
function glyph(name: string) { const han = name.match(/[一-龥]/); return han ? han[0] : (name.replace(/[^a-zA-Z]/g, '').slice(0, 2) || 'S').replace(/^./, c => c.toUpperCase()); }
// The server always listens on http port 3000, so users only enter the host.
const hostOf = (url: string) => url.trim().replace(/^https?:\/\//i, '').replace(/[:/].*$/, '');
const cleanError = (error: unknown) => String(error instanceof Error ? error.message : error).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '');
const titles: Record<View, string> = { store: '技能广场', installed: '已安装', settings: '设置' };

export default function Home() {
  const [state, setState] = useState<DesktopSnapshot>(empty);
  const [view, setView] = useState<View>('store');
  const [query, setQuery] = useState('');
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
    bridge.snapshot().then(snapshot => { receive(snapshot); setServerInput(hostOf(snapshot.serverUrl)); setReady(true); }).catch(error => setFeedback(cleanError(error)));
    return unsubscribe;
  }, []);
  useEffect(() => { if (!feedback) return; const timer = setTimeout(() => setFeedback(''), 7000); return () => clearTimeout(timer); }, [feedback]);
  useEffect(() => {
    if (!detail && !remove) return;
    // Esc closes the confirm dialog first, then leaves the detail page.
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { if (remove) setRemove(null); else setDetail(null); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [detail, remove]);
  const filtered = useMemo(() => state.skills.filter(skill => `${skill.displayName} ${skill.name} ${skill.description}`.toLowerCase().includes(query.toLowerCase())), [state.skills, query]);
  const managed = state.localSkills.filter(skill => skill.managed);
  const external = state.localSkills.filter(skill => !skill.managed);
  const action = async (callback: () => Promise<unknown>) => { try { if (!window.aiHub) throw new Error('请在 AI Hub 桌面应用中操作'); await callback(); } catch (error) { setFeedback(cleanError(error)); } };
  const connect = async () => {
    const host = hostOf(serverInput);
    if (!host) { setFeedback('请输入服务器 IP'); return; }
    setConnecting(true);
    await action(async () => { const snapshot = await window.aiHub!.connect(`http://${host}:3000`); setState(snapshot); setServerInput(hostOf(snapshot.serverUrl)); setFeedback('已连接服务器'); });
    setConnecting(false);
  };
  const showDetail = async (skill: Skill) => {
    window.scrollTo(0, 0);
    setDetail({ ...skill, introduction: '', versions: skill.latestVersion ? [skill.latestVersion] : [] });
    if (state.connected) await action(async () => setDetail(await window.aiHub!.detail(skill.id)));
  };
  // Only flag offline once the startup/refresh sync has finished without connecting.
  const offline = ready && !state.connected && !state.tasks.some(task => task.kind === 'sync' && (task.status === 'running' || task.status === 'queued'));
  const activeTask = (skillId: string) => state.tasks.find(task => task.skillId === skillId && (task.status === 'running' || task.status === 'queued'));
  // Inline progress shown in place of the action button while a skill operation runs.
  const taskProgress = (task: TaskStatus) => <span className="task-pill" role="status">
    <span className="task-pill-fill" style={{ width: `${task.status === 'queued' ? 0 : task.progress}%` }}/>
    <span className="task-pill-text">{task.status === 'queued' ? '等待中' : task.kind === 'uninstall' ? '卸载中' : `${task.kind === 'update' ? '更新中' : '安装中'} ${task.progress}%`}</span>
  </span>;
  const isInstalled = (skill: Skill) => state.localSkills.some(local => local.managed?.skillId === skill.id);
  const installButton = (skill: Skill) => {
    const task = activeTask(skill.id);
    if (task) return taskProgress(task);
    if (isInstalled(skill)) return <span className="installed-state"><Icon name="check" size={15}/>已安装</span>;
    return <button className="btn btn-ink btn-sm" disabled={!state.connected || !skill.latestVersion} onClick={event => { event.stopPropagation(); void action(() => window.aiHub!.install(skill.id)); }}>安装</button>;
  };
  const serverForm = () => <div className="field-row">
    <input id="server-url" aria-label="服务器 IP" disabled={!ready || connecting} placeholder="10.9.168.24" value={serverInput} onChange={event => setServerInput(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void connect(); }}/>
    <button className="btn btn-ink" disabled={!ready || connecting || state.busy} onClick={() => void connect()}>{connecting ? '连接中…' : '保存'}</button>
  </div>;
  const localRow = (skill: LocalSkill) => <div className="row" key={skill.name}>
    <span className={`glyph${skill.managed ? ' is-installed' : ''}`}>{glyph(skill.managed?.displayName ?? skill.name)}</span>
    <div className="row-main"><h3>{skill.managed?.displayName ?? skill.name}</h3><p>{skill.description}</p><span className="path">{skill.path}</span></div>
    {skill.managed && <span className="num">{skill.managed.version}</span>}
    {skill.managed && (activeTask(skill.managed.skillId) ? taskProgress(activeTask(skill.managed.skillId)!) : <button className="btn btn-line btn-sm" onClick={() => setRemove(skill)}>卸载</button>)}
  </div>;

  return <div className="shell">
    <aside className="rail">
      <div className="brand"><Mark/><div className="brand-title"><span className="brand-name">MCC AI 工具平台</span><button className="brand-by" onClick={() => void action(() => window.aiHub!.openAdmin())}>by 薯薯</button></div></div>
      <nav>{([['store', 'grid'], ['installed', 'box'], ['settings', 'settings']] as const).map(([id, icon]) => <button key={id} className={`nav-item${view === id ? ' active' : ''}`} aria-current={view === id ? 'page' : undefined} onClick={() => { setView(id); setDetail(null); }}><Icon name={icon}/><span>{titles[id]}</span>{id === 'installed' && managed.length > 0 && <em>{managed.length}</em>}</button>)}</nav>
      <div className="rail-foot">
        <button className={`rail-status${offline ? ' offline' : ''}`} onClick={() => setView('settings')} title={state.connectionMessage}><span className={`dot${state.connected ? ' on' : ''}`}/>{state.connected ? '已连接' : offline ? '未连接服务器' : '连接中…'}</button>
      </div>
    </aside>
    <main className="main">
      {!desktop && <div className="banner warn">当前为页面预览，安装功能需在桌面应用中使用。</div>}
      {state.appUpdate.status === 'ready' && <div className="banner"><span>AI Hub {formatAppVersion(state.appUpdate.version ?? '')} 已下载完成</span><button className="btn btn-ink btn-sm" disabled={state.busy} onClick={() => void action(() => window.aiHub!.restartForUpdate())}>重启更新</button></div>}
      <div className="page">
        {view === 'store' && detail && <article className="detail-page">
          <header className="detail-head">
            <div className="detail-title"><h1>{detail.displayName}</h1><div className="detail-meta"><span className="card-version num">{detail.latestVersion ? detail.latestVersion.version : '未发布'}</span><span className="num">{formatDay(detail.latestVersion?.publishedAt ?? detail.updatedAt)} 更新</span></div></div>
            <div className="detail-actions"><button className="btn btn-line btn-sm" onClick={() => setDetail(null)}>返回</button>{installButton(detail)}</div>
          </header>
          <section className="detail-body">
            {detail.introduction?.trim()
              ? <div className="markdown intro" dangerouslySetInnerHTML={{ __html: renderIntroduction(detail.introduction, state.serverUrl) }}/>
              : <div className="markdown"><ReactMarkdown skipHtml>{detail.latestVersion?.markdown.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '') ?? '暂无说明'}</ReactMarkdown></div>}
          </section>
        </article>}
        {view === 'store' && !detail && <>
          <header className="page-head">
            <h1>技能广场</h1>
            <div className="head-tools">
              <label className="search"><Icon name="search" size={16}/><input placeholder="搜索技能" aria-label="搜索技能" value={query} onChange={event => setQuery(event.target.value)}/></label>
              <button className="btn btn-line btn-icon" aria-label="刷新技能库" title="刷新" disabled={state.busy} onClick={() => void action(() => window.aiHub!.refresh())}><Icon name="refresh" size={16}/></button>
            </div>
          </header>
          <div className="skill-grid">{filtered.map(skill => <article className={`skill-card${isInstalled(skill) ? ' is-installed' : ''}`} key={skill.id} onClick={() => void showDetail(skill)} tabIndex={0} onKeyDown={event => { if (event.target === event.currentTarget && event.key === 'Enter') void showDetail(skill); }}>
            <div className="card-head"><h3>{skill.displayName}</h3>{installButton(skill)}</div>
            <p className="desc">{skill.description}</p>
            <div className="card-foot"><span className="card-version num">{skill.latestVersion ? skill.latestVersion.version : '未发布'}</span><span className="card-time num">{formatDay(skill.latestVersion?.publishedAt ?? skill.updatedAt)} 更新</span></div>
          </article>)}</div>
          {!filtered.length && <div className="empty">{query ? <><h3>没有匹配的技能</h3><p>换个关键词试试。</p></> : <h3>{offline ? '未连接到服务器，请检查服务器 IP 设置' : '还没有发布的技能'}</h3>}</div>}
        </>}
        {view === 'installed' && <>
          <header className="page-head"><h1>已安装</h1><span className="count">{state.localSkills.length}</span><div className="head-tools"><button className="btn btn-line" onClick={() => void action(() => window.aiHub!.openFolder())}><Icon name="folder" size={16}/>打开技能安装目录</button></div></header>
          {managed.length > 0 && <section className="group"><h2>由 AI Hub 管理{state.autoUpdateSkills && <span>启动时自动更新</span>}</h2><div className="list">{managed.map(localRow)}</div></section>}
          {external.length > 0 && <section className="group"><h2>其他来源</h2><div className="list">{external.map(localRow)}</div></section>}
          {!state.localSkills.length && <div className="empty"><h3>还没有安装技能</h3></div>}
        </>}
        {view === 'settings' && <>
          <header className="page-head"><h1>设置</h1></header>
          <div className="settings">
            <section className="setting">
              <div className="setting-label"><label htmlFor="server-url">服务器 IP</label></div>
              <div className="setting-body">{serverForm()}</div>
            </section>
            <section className="setting">
              <div className="setting-label">开机自启</div>
              <div className="setting-body split"><span>开机后在后台静默启动</span><button className="switch" role="switch" aria-checked={state.launchAtLogin} aria-label="开机自启" disabled={!ready} onClick={() => void action(async () => setState(await window.aiHub!.setLaunchAtLogin(!state.launchAtLogin)))}/></div>
            </section>
            <section className="setting">
              <div className="setting-label">自动更新技能</div>
              <div className="setting-body split"><span>每次启动时更新技能到最新版本</span><button className="switch" role="switch" aria-checked={state.autoUpdateSkills} aria-label="自动更新技能" disabled={!ready} onClick={() => void action(async () => setState(await window.aiHub!.setAutoUpdateSkills(!state.autoUpdateSkills)))}/></div>
            </section>
            <section className="setting">
              <div className="setting-label">应用版本</div>
              <div className="setting-body split">
                <div><span>{formatAppVersion(state.appVersion)}</span>{state.appUpdate.message && <div className="hint">{state.appUpdate.message}</div>}{state.appUpdate.status === 'downloading' && <div className="progress"><span style={{ width: `${state.appUpdate.progress}%` }}/></div>}</div>
                {state.appUpdate.status === 'ready' ? <button className="btn btn-ink btn-sm" disabled={state.busy} onClick={() => void action(() => window.aiHub!.restartForUpdate())}>重启更新</button> : <button className="btn btn-line btn-sm" disabled={!state.serverUrl || ['checking', 'downloading', 'available'].includes(state.appUpdate.status)} onClick={() => void action(() => window.aiHub!.checkAppUpdate())}>检查更新</button>}
              </div>
            </section>
          </div>
        </>}
      </div>
    </main>
    {feedback && <div className="toast" role="status"><span>{feedback}</span><button aria-label="关闭提示" onClick={() => setFeedback('')}><Icon name="close" size={15}/></button></div>}
    {remove && <div className="backdrop" onClick={() => setRemove(null)}><section className="dialog confirm" role="dialog" aria-modal="true" aria-label="卸载技能" onClick={event => event.stopPropagation()}>
      <h2>卸载「{remove.managed?.displayName}」？</h2>
      <p>本地文件会被删除，包括你做过的修改。</p>
      <div className="dialog-actions"><button className="btn btn-line" onClick={() => setRemove(null)}>取消</button><button className="btn btn-danger" onClick={() => { const name = remove.name; setRemove(null); void action(() => window.aiHub!.uninstall(name)); }}>确认卸载</button></div>
    </section></div>}
  </div>;
}
