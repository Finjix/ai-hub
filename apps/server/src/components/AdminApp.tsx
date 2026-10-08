"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Skill, SkillDetail, SkillVersion } from "@ai-hub/shared";

type Release = { id: string; version: string; createdAt: string; active: boolean; files: string[] };
type Tab = "skills" | "releases";

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, cache: "no-store" });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof result?.error === "string" ? result.error : "请求失败，请稍后重试。");
  return result as T;
}

function formatDate(value: string): string {
  try { return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)); }
  catch { return value; }
}

function Icon({ name }: { name: "grid" | "box" | "download" | "search" | "plus" | "close" | "arrow" | "spark" | "upload" | "edit" | "check" | "clock" | "archive" | "refresh" | "file" | "chevron" }) {
  const common = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true as const };
  const shapes: Record<string, React.ReactNode> = {
    grid: <><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></>,
    box: <><path d="m4 7 8-4 8 4-8 4-8-4Z"/><path d="M4 7v10l8 4 8-4V7M12 11v10"/></>,
    download: <><path d="M12 3v12m0 0 4-4m-4 4-4-4"/><path d="M4 17v3h16v-3"/></>,
    search: <><circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 4.5 4.5"/></>,
    plus: <><path d="M12 5v14M5 12h14"/></>,
    close: <><path d="m6 6 12 12M18 6 6 18"/></>,
    arrow: <><path d="M5 12h14m-6-6 6 6-6 6"/></>,
    spark: <><path d="m12 3 1.7 5.3L19 10l-5.3 1.7L12 17l-1.7-5.3L5 10l5.3-1.7L12 3Z"/><path d="m19 16 .8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16Z"/></>,
    upload: <><path d="M12 16V4m0 0L8 8m4-4 4 4"/><path d="M5 14v5h14v-5"/></>,
    edit: <><path d="m4 16.5-.8 4.3 4.3-.8L19 8.5 15.5 5 4 16.5Z"/><path d="m13.8 6.7 3.5 3.5"/></>,
    check: <><path d="m5 12 4 4L19 6"/></>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    archive: <><rect x="3" y="4" width="18" height="5" rx="1"/><path d="M5 9v10h14V9m-7 3v4m-2-2h4"/></>,
    refresh: <><path d="M20 7v5h-5M4 17v-5h5"/><path d="M5.5 9A7 7 0 0 1 18 6l2 6M4 12l2 6a7 7 0 0 0 12.5-3"/></>,
    file: <><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v5h5M9 13h6m-6 4h6"/></>,
    chevron: <><path d="m9 18 6-6-6-6"/></>,
  };
  return <svg {...common}>{shapes[name]}</svg>;
}

function Status({ status }: { status: string }) {
  const labels: Record<string, string> = { active: "已上架", archived: "已归档", draft: "草稿", published: "已发布", withdrawn: "已撤回" };
  return <span className={`status status-${status}`}><i />{labels[status] || status}</span>;
}

export default function Home() {
  const [tab, setTab] = useState<Tab>("skills");
  const [skills, setSkills] = useState<Skill[]>([]);
  const [releases, setReleases] = useState<Release[]>([]);
  const [serverId, setServerId] = useState("");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("全部分类");
  const [selected, setSelected] = useState<SkillDetail | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const [error, setError] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  const refreshSkills = useCallback(async () => {
    const response = await api<{ serverId: string; skills: Skill[] }>("/api/v1/admin/skills");
    setSkills(response.skills);
    setServerId(response.serverId);
  }, []);
  const refreshReleases = useCallback(async () => {
    const response = await api<{ releases: Release[] }>("/api/v1/admin/releases");
    setReleases(response.releases);
  }, []);
  const refreshAll = useCallback(async () => {
    setError("");
    try { await Promise.all([refreshSkills(), refreshReleases()]); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "无法连接 AI Hub 服务。"); }
    finally { setLoading(false); }
  }, [refreshSkills, refreshReleases]);
  useEffect(() => { void refreshAll(); }, [refreshAll]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setTab("skills");
        window.setTimeout(() => searchRef.current?.focus(), 0);
      }
      if (event.key === "Escape") { setSelected(null); setNewOpen(false); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const categories = useMemo(() => ["全部分类", ...Array.from(new Set(skills.map((skill) => skill.category).filter(Boolean))).sort((a, b) => a.localeCompare(b, "zh-CN"))], [skills]);
  const visibleSkills = useMemo(() => skills.filter((skill) => {
    const matchesCategory = category === "全部分类" || skill.category === category;
    const needle = search.trim().toLocaleLowerCase();
    const matchesSearch = !needle || [skill.displayName, skill.name, skill.description, skill.category, ...skill.tags].join(" ").toLocaleLowerCase().includes(needle);
    return matchesCategory && matchesSearch;
  }), [skills, category, search]);
  const activeCount = skills.filter((skill) => skill.status === "active").length;
  const archivedCount = skills.length - activeCount;

  async function openSkill(skill: Skill) {
    setError("");
    try {
      const result = await api<{ skill: SkillDetail }>(`/api/v1/admin/skills/${skill.id}`);
      setSelected(result.skill);
    } catch (cause) { showError(cause); }
  }

  function showError(cause: unknown) {
    setToast(cause instanceof Error ? cause.message : "操作失败，请稍后重试。");
    window.setTimeout(() => setToast(""), 4200);
  }

  async function saveMetadata(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const form = new FormData(event.currentTarget);
    const tags = String(form.get("tags") || "").split(/[,，]/).map((tag) => tag.trim()).filter(Boolean);
    setBusy(true);
    try {
      await api(`/api/v1/admin/skills/${selected.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ displayName: form.get("displayName"), description: form.get("description"), category: form.get("category"), tags, status: form.get("status") }) });
      await refreshSkills();
      await openSkill({ ...selected, displayName: String(form.get("displayName")) });
      setToast("技能信息已保存");
    } catch (cause) { showError(cause); }
    finally { setBusy(false); }
  }

  async function uploadSkill(event: React.FormEvent<HTMLFormElement>, targetId?: string) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const data = new FormData(formElement);
    if (data.has("tags")) data.set("tags", JSON.stringify(String(data.get("tags") || "").split(/[,，]/).map(tag => tag.trim()).filter(Boolean)));
    setBusy(true);
    try {
      const endpoint = targetId ? `/api/v1/admin/skills/${targetId}/versions` : "/api/v1/admin/skills";
      await api(endpoint, { method: "POST", body: data });
      formElement.reset();
      setNewOpen(false);
      await refreshSkills();
      if (targetId) await openSkill({ ...selected!, id: targetId });
      setToast(targetId ? "新版本已保存为草稿" : "技能已添加，版本处于草稿状态");
    } catch (cause) { showError(cause); }
    finally { setBusy(false); }
  }

  async function changeVersion(version: SkillVersion, action: "publish" | "withdraw") {
    if (!selected) return;
    setBusy(true);
    try {
      await api(`/api/v1/admin/skills/${selected.id}/versions/${version.id}/${action}`, { method: "POST" });
      await refreshSkills();
      await openSkill(selected);
      setToast(action === "publish" ? `版本 ${version.version} 已发布` : `版本 ${version.version} 已撤回`);
    } catch (cause) { showError(cause); }
    finally { setBusy(false); }
  }

  async function uploadRelease(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData();
    const fileInput = formElement.elements.namedItem("files") as HTMLInputElement;
    Array.from(fileInput.files || []).forEach((file) => form.append("files", file, file.name));
    setBusy(true);
    try {
      const result = await api<{ version: string }>("/api/v1/admin/releases", { method: "POST", body: form });
      formElement.reset();
      await refreshReleases();
      setToast(`桌面端 ${result.version} 已发布`);
    } catch (cause) { showError(cause); }
    finally { setBusy(false); }
  }

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark"><Icon name="spark" /></div><div><strong>AI Hub</strong><span>管理中心</span></div></div>
      <div className="side-label">工作空间</div>
      <nav className="side-nav" aria-label="主导航">
        <button className={tab === "skills" ? "nav-item active" : "nav-item"} onClick={() => setTab("skills")}><Icon name="box"/><span>技能库</span><b>{skills.length}</b></button>
        <button className={tab === "releases" ? "nav-item active" : "nav-item"} onClick={() => setTab("releases")}><Icon name="download"/><span>桌面端更新</span></button>
      </nav>
      <div className="sidebar-bottom">
        <div className="server-indicator"><span className="live-dot"/><div><b>局域网服务在线</b><small>{serverId ? `${serverId.slice(0, 8)} · 持久化` : "正在连接…"}</small></div></div>
        <div className="sidebar-foot">AI Hub · 内部应用商店</div>
      </div>
    </aside>

    <main className="main-area">
      <header className="topbar"><div className="breadcrumb"><span>工作空间</span><Icon name="chevron"/><strong>{tab === "skills" ? "技能库" : "桌面端更新"}</strong></div><div className="topbar-right"><span className="top-status"><i/>局域网可访问</span><div className="avatar">A</div></div></header>
      {error && <div className="connection-error"><span>{error}</span><button className="button subtle small" onClick={() => void refreshAll()}><Icon name="refresh"/>重新连接</button></div>}

      {tab === "skills" ? <section className="content">
        <div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line"/>AI 应用商店</div><h1>技能库</h1><p>管理团队共享的 AI 技能，让好用的能力随时可发现、可更新。</p></div><button className="button primary" onClick={() => setNewOpen(true)}><Icon name="plus"/>添加技能</button></div>
        <div className="stats-grid">
          <div className="stat-card"><div className="stat-icon blue"><Icon name="box"/></div><div><span>技能总数</span><strong>{loading ? "—" : skills.length}</strong></div><small>个技能包</small></div>
          <div className="stat-card"><div className="stat-icon green"><Icon name="check"/></div><div><span>已上架</span><strong>{loading ? "—" : activeCount}</strong></div><small>可供团队使用</small></div>
          <div className="stat-card"><div className="stat-icon amber"><Icon name="archive"/></div><div><span>已归档</span><strong>{loading ? "—" : archivedCount}</strong></div><small>保留历史数据</small></div>
          <div className="stat-card"><div className="stat-icon violet"><Icon name="grid"/></div><div><span>技能分类</span><strong>{loading ? "—" : Math.max(0, categories.length - 1)}</strong></div><small>覆盖团队常用场景</small></div>
        </div>
        <div className="section-title-row"><div><h2>全部技能 <span>{visibleSkills.length}</span></h2><p>浏览并管理已收录的技能</p></div><button className="button subtle small" onClick={() => void refreshSkills()}><Icon name="refresh"/>刷新</button></div>
        <div className="filters"><label className="search-field"><Icon name="search"/><input ref={searchRef} aria-label="搜索技能" placeholder="搜索名称、描述或标签…" value={search} onChange={(event) => setSearch(event.target.value)}/><kbd>⌘ K</kbd></label><label className="select-wrap"><span>分类</span><select value={category} onChange={(event) => setCategory(event.target.value)}>{categories.map((item) => <option key={item}>{item}</option>)}</select></label></div>
        {loading ? <div className="loading-panel"><span className="spinner"/>正在载入技能库…</div> : visibleSkills.length ? <div className="skill-grid">{visibleSkills.map((skill, index) => <button className="skill-card" key={skill.id} onClick={() => void openSkill(skill)}>
          <div className={`skill-symbol symbol-${index % 5}`}><Icon name={index % 2 ? "spark" : "box"}/></div><div className="skill-card-title"><div><h3>{skill.displayName}</h3><code>{skill.name}</code></div><Status status={skill.status}/></div><p className="skill-description">{skill.description || "还没有添加技能简介。"}</p><div className="tag-row">{skill.tags.slice(0, 3).map((tag) => <span className="tag" key={tag}>{tag}</span>)}{skill.tags.length > 3 && <span className="tag muted">+{skill.tags.length - 3}</span>}</div><div className="skill-card-footer"><span className="category-pill">{skill.category || "未分类"}</span><span>{skill.latestVersion ? `v${skill.latestVersion.version}` : "暂无已发布版本"}</span><Icon name="arrow"/></div>
        </button>)}</div> : <div className="empty-state"><div className="empty-icon"><Icon name="box"/></div><h3>{search || category !== "全部分类" ? "没有找到匹配的技能" : "技能库还空着"}</h3><p>{search || category !== "全部分类" ? "试试调整关键词或分类。" : "添加第一个技能包，开始搭建团队的 AI 应用商店。"}</p>{!search && category === "全部分类" && <button className="button primary" onClick={() => setNewOpen(true)}><Icon name="plus"/>添加第一个技能</button>}</div>}
        <div className="page-footer"><span>共 {skills.length} 个技能 · 数据保存在本机</span><span>AI Hub Server <i className="live-dot"/></span></div>
      </section> : <section className="content release-content">
        <div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line"/>发布管理</div><h1>桌面端更新</h1><p>发布 Windows 安装包，客户端将通过局域网自动检查新版本。</p></div></div>
        <div className="release-layout"><div className="release-main">
          <div className="current-release-card"><div className="release-card-top"><div className="stat-icon violet"><Icon name="download"/></div><span className="release-live"><i/>线上版本</span></div><span className="subtle-label">当前稳定版本</span><strong className="release-version">{releases.find((release) => release.active)?.version ? `v${releases.find((release) => release.active)!.version}` : "尚未发布"}</strong><p>{releases.find((release) => release.active) ? `发布于 ${formatDate(releases.find((release) => release.active)!.createdAt)}` : "发布第一个版本后，客户端会从这里检查更新。"}</p><div className="release-url"><span>更新清单地址</span><code>/updates/win-x64/latest.yml</code></div></div>
          <div className="section-title-row release-history-heading"><div><h2>发布历史 <span>{releases.length}</span></h2><p>已发布的 Windows 版本</p></div><button className="button subtle small" onClick={() => void refreshReleases()}><Icon name="refresh"/>刷新</button></div>
          {releases.length ? <div className="release-list">{releases.map((release) => <div className="release-row" key={release.id}><div className="release-row-icon"><Icon name="file"/></div><div className="release-row-main"><div><strong>v{release.version}</strong>{release.active && <span className="active-badge">当前版本</span>}</div><p>{formatDate(release.createdAt)}</p></div><div className="release-files">{release.files.map((file) => <span key={file}>{file}</span>)}</div></div>)}</div> : <div className="empty-inline"><Icon name="download"/><div><strong>还没有发布记录</strong><span>上传安装包后，发布记录会显示在这里。</span></div></div>}
        </div><aside className="release-sidebar"><form className="upload-panel" onSubmit={uploadRelease}><div className="upload-panel-heading"><div className="stat-icon blue"><Icon name="upload"/></div><div><h2>发布新版本</h2><p>上传 electron-builder 生成的更新文件</p></div></div><label className="drop-zone release-drop"><input type="file" name="files" multiple required accept=".yml,.exe,.blockmap"/><span className="drop-icon"><Icon name="upload"/></span><strong>选择更新文件</strong><span>latest.yml、安装程序和 .blockmap</span><small>文件会先校验，再一次性上线</small></label><div className="release-requirements"><span><Icon name="check"/>latest.yml 清单</span><span><Icon name="check"/>一个 .exe 安装包</span><span><Icon name="check"/>对应的 .blockmap</span></div><button className="button primary full" disabled={busy}>{busy ? <><span className="button-spinner"/>正在校验并发布…</> : <><Icon name="upload"/>发布桌面端更新</>}</button><p className="form-footnote">新版本号必须高于当前线上版本。发布前会校验清单中的文件名、SHA512 和大小。</p></form><div className="help-card"><div className="help-icon"><Icon name="spark"/></div><div><strong>自动更新已就绪</strong><p>AI Hub 客户端会读取最新清单并下载对应版本。历史安装文件仍可供正在更新的客户端获取。</p></div></div></aside></div>
      </section>}
    </main>

    {selected && <div className="overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelected(null); }}><section className="drawer" role="dialog" aria-modal="true" aria-label="技能详情"><div className="drawer-header"><div><span className="drawer-kicker">技能详情</span><h2>{selected.displayName}</h2><code>{selected.name}</code></div><button className="icon-button" aria-label="关闭" onClick={() => setSelected(null)}><Icon name="close"/></button></div><div className="drawer-body">
      <form className="editor-form" onSubmit={saveMetadata}><div className="drawer-section-title"><div><h3>基本信息</h3><p>这些信息会展示在技能商店中</p></div><button className="button primary small" disabled={busy}><Icon name="check"/>保存</button></div><label>展示名称<input name="displayName" defaultValue={selected.displayName} required maxLength={120}/></label><label>技能简介<textarea name="description" defaultValue={selected.description} rows={3} maxLength={2000}/></label><div className="form-row"><label>分类<input name="category" defaultValue={selected.category} maxLength={80}/></label><label>上架状态<select name="status" defaultValue={selected.status}><option value="active">已上架</option><option value="archived">已归档</option></select></label></div><label>标签 <span className="field-hint">用逗号分隔</span><input name="tags" defaultValue={selected.tags.join(", ")} placeholder="例如：写作、效率、办公"/></label></form>
      <div className="drawer-divider"/><section className="version-section"><div className="drawer-section-title"><div><h3>版本管理 <span className="count-chip">{selected.versions.length}</span></h3><p>发布前的版本会作为草稿保存</p></div></div>{selected.versions.length ? <div className="version-list">{selected.versions.map((version) => <div className="version-item" key={version.id}><div className="version-dot"/><div className="version-info"><strong>v{version.version}</strong><Status status={version.status}/><small>{version.status === "published" ? `发布于 ${formatDate(version.publishedAt || version.createdAt)}` : `创建于 ${formatDate(version.createdAt)}`}</small>{version.changelog && <p>{version.changelog}</p>}</div><div className="version-actions">{version.status === "draft" && <button className="button primary tiny" disabled={busy || selected.status === "archived"} onClick={() => void changeVersion(version, "publish")}>发布</button>}{version.status === "published" && <button className="button subtle tiny" disabled={busy} onClick={() => void changeVersion(version, "withdraw")}>撤回</button>}</div></div>)}</div> : <div className="version-empty">还没有版本。上传 ZIP 后，版本将以草稿状态等待发布。</div>}</section>
      <div className="drawer-divider"/><form className="editor-form add-version-form" onSubmit={(event) => void uploadSkill(event, selected.id)}><div className="drawer-section-title"><div><h3>上传新版本</h3><p>ZIP 中的 name 必须保持为 <code>{selected.name}</code></p></div></div><label>版本号<input name="version" placeholder="例如 1.2.0" required/></label><label>更新说明<textarea name="changelog" rows={2} placeholder="本版本做了哪些改进？"/></label><label className="compact-drop"><Icon name="upload"/><span>选择 ZIP 技能包</span><input type="file" name="file" accept=".zip" required/></label><button className="button outline full" disabled={busy}>{busy ? "正在上传…" : <><Icon name="plus"/>添加为草稿</>}</button></form>
      <div className="drawer-divider"/><div className="metadata-footer"><span>创建于 {formatDate(selected.createdAt)}</span><span>更新于 {formatDate(selected.updatedAt)}</span></div></div></section></div>}

    {newOpen && <div className="overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) setNewOpen(false); }}><section className="modal" role="dialog" aria-modal="true" aria-label="添加技能"><div className="modal-header"><div className="modal-icon"><Icon name="spark"/></div><div><span className="drawer-kicker">技能库</span><h2>添加技能</h2><p>上传技能 ZIP，补充商店展示信息</p></div><button className="icon-button" aria-label="关闭" onClick={() => setNewOpen(false)}><Icon name="close"/></button></div><form className="modal-form" onSubmit={(event) => void uploadSkill(event)}><label className="drop-zone skill-drop"><input type="file" name="file" accept=".zip" required/><span className="drop-icon"><Icon name="upload"/></span><strong>选择技能 ZIP 文件</strong><span>ZIP 内需包含有效的 SKILL.md</span><small>最大 100 MiB · 解压后最大 500 MiB</small></label><div className="form-row"><label>初始版本<input name="version" placeholder="例如 1.0.0" required/></label><label>商店分类<input name="category" list="category-options" placeholder="例如 效率工具"/><datalist id="category-options">{categories.slice(1).map((item) => <option key={item} value={item}/>)}</datalist></label></div><label>展示名称 <span className="field-hint">默认使用 SKILL.md 名称</span><input name="displayName" placeholder="可选，留空则沿用技能名称"/></label><label>标签 <span className="field-hint">用逗号分隔</span><input name="tags" placeholder="例如：写作、效率、办公"/></label><label>更新说明<textarea name="changelog" rows={2} placeholder="描述这个初始版本"/></label><div className="modal-footer"><span>上传后会先保存为草稿</span><button className="button primary" disabled={busy}>{busy ? <><span className="button-spinner"/>正在上传…</> : <><Icon name="plus"/>添加技能</>}</button></div></form></section></div>}
    {toast && <div className="toast"><span className="toast-mark"><Icon name="check"/></span>{toast}<button aria-label="关闭提示" onClick={() => setToast("")}><Icon name="close"/></button></div>}
  </div>;
}
