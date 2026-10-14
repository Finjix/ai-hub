"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatAppVersion } from "@ai-hub/shared";
import type { Skill, SkillDetail } from "@ai-hub/shared";
import SkillEditorPage, { Status, type EditorTarget } from "@/components/SkillEditorPage";

type Release = { id: string; version: string; createdAt: string; active: boolean; files: string[] };
type Tab = "skills" | "releases";
type StatusFilter = "all" | "active" | "archived";

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

function Icon({ name, size = 18 }: { name: "box" | "download" | "search" | "plus" | "close" | "upload" | "refresh" | "file"; size?: number }) {
  const shapes: Record<string, React.ReactNode> = {
    box: <><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9"/></>,
    download: <path d="M12 4v11m-4.5-4.5L12 15l4.5-4.5M5 19h14"/>,
    search: <><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></>,
    plus: <path d="M12 5v14M5 12h14"/>,
    close: <path d="m6 6 12 12M18 6 6 18"/>,
    upload: <path d="M12 15V4m-4.5 4.5L12 4l4.5 4.5M5 19h14"/>,
    refresh: <><path d="M20 11a8 8 0 0 0-14.3-4.9L4 8m0-5v5h5"/><path d="M4 13a8 8 0 0 0 14.3 4.9L20 16m0 5v-5h-5"/></>,
    file: <><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{shapes[name]}</svg>;
}

function Mark() {
  return <span className="mark"><img src="/brand-logo.png" alt="Century Games"/></span>;
}

function FileField({ name, accept, multiple, label }: { name: string; accept: string; multiple?: boolean; label: string }) {
  const [picked, setPicked] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const form = inputRef.current?.form;
    if (!form) return;
    const clear = () => setPicked([]);
    form.addEventListener("reset", clear);
    return () => form.removeEventListener("reset", clear);
  }, []);
  return <label className={`file-field${picked.length ? " has-file" : ""}`}>
    <input ref={inputRef} type="file" name={name} accept={accept} multiple={multiple} required onChange={(event) => setPicked(Array.from(event.target.files || []).map((file) => file.name))}/>
    <Icon name="upload"/>
    <span>{picked.length ? picked.join("、") : label}</span>
  </label>;
}

export default function Home() {
  const [tab, setTab] = useState<Tab>("skills");
  const [skills, setSkills] = useState<Skill[]>([]);
  const [releases, setReleases] = useState<Release[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [editor, setEditor] = useState<EditorTarget | null>(null);
  const leaveGuard = useRef<(() => boolean) | null>(null);
  const registerGuard = useCallback((guard: (() => boolean) | null) => { leaveGuard.current = guard; }, []);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const [error, setError] = useState("");

  const refreshSkills = useCallback(async () => {
    const response = await api<{ serverId: string; skills: Skill[] }>("/api/v1/admin/skills");
    setSkills(response.skills);
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
  useEffect(() => { if (!toast) return; const timer = window.setTimeout(() => setToast(""), 4200); return () => window.clearTimeout(timer); }, [toast]);

  const visibleSkills = useMemo(() => skills.filter((skill) => {
    const matchesStatus = statusFilter === "all" || skill.status === statusFilter;
    const needle = search.trim().toLocaleLowerCase();
    const matchesSearch = !needle || [skill.displayName, skill.name].join(" ").toLocaleLowerCase().includes(needle);
    return matchesStatus && matchesSearch;
  }), [skills, statusFilter, search]);
  const activeCount = skills.filter((skill) => skill.status === "active").length;
  const statusTabs: [StatusFilter, string, number][] = [["all", "全部", skills.length], ["active", "已上架", activeCount], ["archived", "已下架", skills.length - activeCount]];
  const filtering = !!search || statusFilter !== "all";
  const current = releases.find((release) => release.active);

  async function openSkill(skill: Skill) {
    setError("");
    try {
      const result = await api<{ skill: SkillDetail }>(`/api/v1/admin/skills/${skill.id}`);
      setEditor({ mode: "edit", skill: result.skill });
    } catch (cause) { showError(cause); }
  }

  function showError(cause: unknown) {
    setToast(cause instanceof Error ? cause.message : "操作失败，请稍后重试。");
  }

  function goTo(next: Tab) {
    if (editor && leaveGuard.current && !leaveGuard.current()) return;
    setEditor(null);
    setTab(next);
  }

  async function editorSaved(message: string) {
    setEditor(null);
    setToast(message);
    await refreshSkills().catch(showError);
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
      setToast(`桌面端 ${formatAppVersion(result.version)} 已发布`);
    } catch (cause) { showError(cause); }
    finally { setBusy(false); }
  }

  return <div className="shell">
    <aside className="rail">
      <div className="brand"><Mark/><div className="brand-title"><span className="brand-name">MCC AI 工具平台</span><span className="brand-by">管理后台</span></div></div>
      <nav aria-label="主导航">
        <button className={tab === "skills" ? "nav-item active" : "nav-item"} aria-current={tab === "skills" ? "page" : undefined} onClick={() => goTo("skills")}><Icon name="box"/><span>技能库</span></button>
        <button className={tab === "releases" ? "nav-item active" : "nav-item"} aria-current={tab === "releases" ? "page" : undefined} onClick={() => goTo("releases")}><Icon name="download"/><span>桌面端更新</span></button>
      </nav>
    </aside>

    <main className="main">
      {error && <div className="banner"><span>{error}</span><button className="btn btn-line btn-sm" onClick={() => void refreshAll()}>重新连接</button></div>}

      {tab === "skills" && editor ? <SkillEditorPage key={editor.mode === "edit" ? editor.skill.id : "new"} target={editor} onClose={() => setEditor(null)} onSaved={(message) => void editorSaved(message)} onNotice={(message) => { setToast(message); void refreshSkills().catch(showError); }} onError={setToast} registerGuard={registerGuard}/>
      : tab === "skills" ? <section className="page">
        <header className="page-head"><h1>技能库</h1><div className="head-tools"><button className="btn btn-ink" onClick={() => setEditor({ mode: "create" })}><Icon name="plus" size={16}/>添加技能</button></div></header>
        <div className="toolbar">
          <div className="tabs" role="tablist" aria-label="上架状态">{statusTabs.map(([id, label, count]) => <button key={id} role="tab" aria-selected={statusFilter === id} className={statusFilter === id ? "selected" : ""} onClick={() => setStatusFilter(id)}>{label}<span>{loading ? "–" : count}</span></button>)}</div>
          <label className="search"><Icon name="search" size={16}/><input aria-label="搜索技能" placeholder="搜索技能" value={search} onChange={(event) => setSearch(event.target.value)}/></label>
          <button className="btn btn-line btn-icon" aria-label="刷新" title="刷新" onClick={() => void refreshSkills()}><Icon name="refresh" size={16}/></button>
        </div>
        {loading ? <div className="empty"><span className="spinner"/></div> : visibleSkills.length ? <div className="table">
          <div className="table-row table-head" aria-hidden="true"><span>技能</span><span>线上版本</span><span>状态</span><span>更新时间</span></div>
          {visibleSkills.map((skill) => <button className="table-row skill-card" key={skill.id} onClick={() => void openSkill(skill)}>
            <span className="cell-name"><strong>{skill.displayName}</strong></span>
            <span className={skill.latestVersion ? "num" : "cell-muted"}>{skill.latestVersion ? `${skill.latestVersion.version}` : "未发布"}</span>
            <span><Status status={skill.status}/></span>
            <span className="cell-muted">{formatDate(skill.updatedAt)}</span>
          </button>)}
        </div> : <div className="empty">{filtering ? <><h3>没有匹配的技能</h3><p>调整筛选条件后再试。</p></> : <h3>还没有技能</h3>}</div>}
      </section> : <section className="page">
        <header className="page-head"><h1>桌面端更新</h1></header>
        <div className="release-top">
          <div className="panel current-release">
            <span className="panel-label">线上版本</span>
            <strong className={current ? "release-version" : "release-version none"}>{current ? formatAppVersion(current.version) : "未发布"}</strong>
            <p>{current ? `发布于 ${formatDate(current.createdAt)}` : "客户端暂不会收到更新。"}</p>
            <div className="manifest"><span>更新清单</span><code>/updates/win-x64/latest.yml</code></div>
          </div>
          <form className="panel release-form" onSubmit={uploadRelease}>
            <h2>发布新版本</h2>
            <p>同时选择同一次构建生成的 latest.yml、.exe 和 .exe.blockmap。版本号须高于线上版本。</p>
            <FileField name="files" accept=".yml,.exe,.blockmap" multiple label="选择更新文件"/>
            <button className="btn btn-ink" disabled={busy}>{busy ? <><span className="spinner sm"/>正在校验…</> : "发布桌面端更新"}</button>
          </form>
        </div>
        <div className="section-head"><h2>发布记录</h2><span className="count">{releases.length}</span><button className="btn btn-line btn-icon" aria-label="刷新" title="刷新" onClick={() => void refreshReleases()}><Icon name="refresh" size={16}/></button></div>
        {releases.length ? <div className="list">{releases.map((release) => <div className="release-row" key={release.id}>
          <strong className="num">{formatAppVersion(release.version)}</strong>
          {release.active ? <span className="status status-published">线上</span> : <span/>}
          <span className="cell-muted">{formatDate(release.createdAt)}</span>
          <span className="files">{release.files.map((file) => <span key={file}><Icon name="file" size={14}/>{file}</span>)}</span>
        </div>)}</div> : <div className="empty small"><p>还没有发布记录。</p></div>}
      </section>}
    </main>

    {toast && <div className="toast" role="status"><span>{toast}</span><button aria-label="关闭提示" onClick={() => setToast("")}><Icon name="close" size={15}/></button></div>}
  </div>;
}
