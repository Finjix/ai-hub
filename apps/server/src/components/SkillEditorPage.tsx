"use client";

import { useEffect, useRef, useState } from "react";
import type { SkillDetail, SkillVersion } from "@ai-hub/shared";
import RichTextEditor from "@/components/RichTextEditor";
import { uploadWithProgress } from "@/lib/upload-client";

const MAX_VERSIONS = 3; // mirrors the server-side limit in lib/skills.ts

export type EditorTarget = { mode: "create" } | { mode: "edit"; skill: SkillDetail };

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(value: string): string {
  try { return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)); }
  catch { return value; }
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, cache: "no-store" });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof result?.error === "string" ? result.error : "请求失败，请稍后重试。");
  return result as T;
}

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : "操作失败，请稍后重试。";
}

export function Status({ status }: { status: string }) {
  const labels: Record<string, string> = { active: "已上架", archived: "已下架" };
  return <span className={`status status-${status}`}>{labels[status] || status}</span>;
}

function ZipDropzone({ file, hint, onPick, onError }: { file: File | null; hint: string; onPick: (file: File) => void; onError: (message: string) => void }) {
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  function choose(picked: File | undefined) {
    if (!picked) return;
    if (!picked.name.toLowerCase().endsWith(".zip")) { onError("技能包必须是 ZIP 文件。"); return; }
    onPick(picked);
  }

  return <div className={`dropzone${file ? " has-file" : ""}${dragging ? " dragging" : ""}`} role="button" tabIndex={0}
    onClick={() => fileRef.current?.click()}
    onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); fileRef.current?.click(); } }}
    onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
    onDragLeave={() => setDragging(false)}
    onDrop={(event) => { event.preventDefault(); setDragging(false); choose(event.dataTransfer.files[0]); }}>
    <input ref={fileRef} type="file" accept=".zip" hidden onChange={(event) => { choose(event.target.files?.[0]); event.target.value = ""; }}/>
    <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{file ? <><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/></> : <path d="M12 15V4m-4.5 4.5L12 4l4.5 4.5M5 19h14"/>}</svg>
    {file ? <span className="dz-text"><strong>{file.name}</strong><small>{formatSize(file.size)} · 点击更换</small></span>
      : <span className="dz-text"><strong>拖入或点击选择 ZIP</strong><small>{hint}</small></span>}
  </div>;
}

export default function SkillEditorPage({ target, onClose, onSaved, onNotice, onError, registerGuard }: {
  target: EditorTarget;
  onClose: () => void;
  onSaved: (message: string) => void;
  // Version actions on an existing skill report here and stay on the page.
  onNotice: (message: string) => void;
  onError: (message: string) => void;
  // Lets the shell ask before navigating away from unsaved work.
  registerGuard: (guard: (() => boolean) | null) => void;
}) {
  const original = target.mode === "edit" ? target.skill : null;
  // Refreshed after version actions; the name/introduction/status drafts below stay as typed.
  const [editing, setEditing] = useState<SkillDetail | null>(original);
  const [file, setFile] = useState<File | null>(null);
  const [version, setVersion] = useState("");
  const [displayName, setDisplayName] = useState(original?.displayName ?? "");
  const [introduction, setIntroduction] = useState(original?.introduction ?? "");
  const [status, setStatus] = useState<SkillDetail["status"]>(original?.status ?? "active");
  const [mediaUploading, setMediaUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [versionBusy, setVersionBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [newFile, setNewFile] = useState<File | null>(null);
  const [newVersion, setNewVersion] = useState("");
  const [newProgress, setNewProgress] = useState<number | null>(null);

  const dirty = !saving && (editing
    ? displayName.trim() !== editing.displayName || introduction.trim() !== editing.introduction.trim() || status !== editing.status
      || !!newFile || !!newVersion.trim()
    : !!file || !!version.trim() || !!displayName.trim() || !!introduction.trim());
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  useEffect(() => {
    const guard = () => !dirtyRef.current || window.confirm("有未保存的修改，确定离开吗？");
    registerGuard(guard);
    const onBeforeUnload = (event: BeforeUnloadEvent) => { if (dirtyRef.current) event.preventDefault(); };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => { registerGuard(null); window.removeEventListener("beforeunload", onBeforeUnload); };
  }, [registerGuard]);

  function leave() {
    if (!dirty || window.confirm("有未保存的修改，确定离开吗？")) onClose();
  }

  async function reload(id: string) {
    const result = await api<{ skill: SkillDetail }>(`/api/v1/admin/skills/${id}`);
    setEditing(result.skill);
  }

  async function publishVersion(item: SkillVersion) {
    if (!editing) return;
    setVersionBusy(true);
    try {
      await api(`/api/v1/admin/skills/${editing.id}/versions/${item.id}/publish`, { method: "POST" });
      await reload(editing.id);
      onNotice(`${item.version} 已发布`);
    } catch (cause) { onError(message(cause)); }
    finally { setVersionBusy(false); }
  }

  function cancelAdding() {
    setAdding(false);
    setNewFile(null);
    setNewVersion("");
  }

  async function deleteVersion(item: SkillVersion) {
    if (!editing) return;
    if (!window.confirm(`确定删除版本 ${item.version} 吗？该版本的技能包将被永久删除。`)) return;
    setVersionBusy(true);
    try {
      await api(`/api/v1/admin/skills/${editing.id}/versions/${item.id}`, { method: "DELETE" });
      await reload(editing.id);
      if (editing.versions.filter((other) => other.status !== "published").length <= 1) setRemoving(false);
      onNotice(`${item.version} 已删除`);
    } catch (cause) { onError(message(cause)); }
    finally { setVersionBusy(false); }
  }

  async function uploadVersion() {
    if (!editing) return;
    if (!newFile) { onError("请选择技能包 ZIP。"); return; }
    if (!newVersion.trim()) { onError("请填写版本号。"); return; }
    const form = new FormData();
    form.append("file", newFile, newFile.name);
    form.append("version", newVersion.trim());
    setVersionBusy(true);
    setNewProgress(0);
    try {
      await uploadWithProgress(`/api/v1/admin/skills/${editing.id}/versions`, form, setNewProgress);
      setNewFile(null);
      setNewVersion("");
      setAdding(false);
      await reload(editing.id);
      onNotice(`${newVersion.trim()} 已添加，选择后点击“发布”即可上线`);
    } catch (cause) { onError(message(cause)); }
    finally { setVersionBusy(false); setNewProgress(null); }
  }

  async function deleteSkill() {
    if (!editing) return;
    if (!window.confirm(`确定删除技能「${editing.displayName}」吗？所有版本和技能包将被永久删除，无法恢复。`)) return;
    setVersionBusy(true);
    try {
      await api(`/api/v1/admin/skills/${editing.id}`, { method: "DELETE" });
      setSaving(true); // nothing left to save, so skip the unsaved-changes prompt
      onSaved("技能已删除");
    } catch (cause) {
      setVersionBusy(false);
      onError(message(cause));
    }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mediaUploading) return;
    if (!editing && !file) { onError("请选择技能包 ZIP。"); return; }
    setSaving(true);
    try {
      if (editing) {
        await api(`/api/v1/admin/skills/${editing.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ displayName, introduction, status }),
        });
        onSaved("已保存");
      } else {
        const form = new FormData();
        form.append("file", file!, file!.name);
        form.append("version", version);
        form.append("displayName", displayName);
        form.append("introduction", introduction);
        setProgress(0);
        const result = await uploadWithProgress<{ status?: string }>("/api/v1/admin/skills", form, setProgress);
        onSaved(result.status === "published" ? "技能已添加并发布" : "已添加为该技能的新版本");
      }
    } catch (cause) {
      setSaving(false);
      setProgress(null);
      onError(message(cause));
    }
  }

  const busyLabel = progress !== null && progress < 100 ? `上传中 ${progress}%` : "保存中…";
  return <form className="page editor-page" onSubmit={submit}>
    <header className="page-head">
      {editing ? <div className="editor-title"><h1>{editing.displayName}</h1><code>{editing.name}</code></div> : <h1>添加技能</h1>}
      <div className="head-tools">
        <button type="button" className="btn btn-line" onClick={leave} disabled={saving}>{editing ? "返回" : "取消"}</button>
        <button className="btn btn-ink" disabled={saving || mediaUploading} title={mediaUploading ? "请等待图片/视频上传完成" : undefined}>
          {saving ? <><span className="spinner sm"/>{busyLabel}</> : editing ? "保存" : "添加技能"}
        </button>
      </div>
    </header>

    <div className="editor-layout">
      <div className="editor-main">
        <section className="panel intro-panel">
          <div className="panel-head"><h2>技能介绍</h2></div>
          <RichTextEditor value={original?.introduction ?? ""} onChange={setIntroduction} onUploadingChange={setMediaUploading} onError={onError}/>
        </section>
        {editing && <div><button type="button" className="btn btn-danger" disabled={versionBusy || saving} onClick={() => void deleteSkill()}>删除技能</button></div>}
      </div>

      <aside className={editing ? "editor-side scrolls" : "editor-side"}>
        {!editing && <section className="panel side-card">
          <h2>技能包</h2>
          <ZipDropzone file={file} hint="压缩包内需包含 SKILL.md" onPick={setFile} onError={onError}/>
          {progress !== null && <div className="progress"><span style={{ width: `${progress}%` }}/></div>}
        </section>}

        <section className="panel side-card">
          {!editing && <label className="field">版本号<input value={version} onChange={(event) => setVersion(event.target.value)} placeholder="如 1.0.0" required/></label>}
          <label className="field">展示名称<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} maxLength={120} required placeholder="在技能广场显示的名称"/></label>
          {editing && <label className="field">上架状态<select value={status} onChange={(event) => setStatus(event.target.value as SkillDetail["status"])}><option value="active">已上架</option><option value="archived">已下架</option></select></label>}
        </section>

        {editing && <section className="panel side-card">
          <div className="side-head">
            <h2 className="side-title">版本<span className="count">{editing.versions.length}/{MAX_VERSIONS}</span></h2>
            {removing ? <button type="button" className="btn btn-line btn-sm" onClick={() => setRemoving(false)}>完成</button>
              : !adding && <div className="version-actions">
                <button type="button" className="btn btn-line btn-sm btn-icon-sm btn-quiet-danger" disabled={saving || !editing.versions.some((item) => item.status !== "published")} aria-label="删除版本" title={editing.versions.some((item) => item.status !== "published") ? "删除版本" : "线上版本不能删除"} onClick={() => setRemoving(true)}>
                  <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>
                </button>
                <button type="button" className="btn btn-line btn-sm" disabled={saving} onClick={() => setAdding(true)}>添加版本</button>
              </div>}
          </div>
          {adding && <div className="add-version">
            <ZipDropzone file={newFile} hint={`SKILL.md 的 name 须为 ${editing.name}`} onPick={setNewFile} onError={onError}/>
            {newProgress !== null && <div className="progress"><span style={{ width: `${newProgress}%` }}/></div>}
            <label className="field">版本号<input value={newVersion} onChange={(event) => setNewVersion(event.target.value)} placeholder="如 1.2.0" autoFocus
              onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void uploadVersion(); } }}/></label>
            <div className="add-version-actions">
              <button type="button" className="btn btn-line btn-sm" disabled={versionBusy} onClick={cancelAdding}>取消</button>
              <button type="button" className="btn btn-ink btn-sm" disabled={versionBusy || saving} onClick={() => void uploadVersion()}>{newProgress !== null ? <><span className="spinner sm"/>上传中 {newProgress}%</> : "添加"}</button>
            </div>
          </div>}
          {adding && editing.versions.length >= MAX_VERSIONS && <p className="muted">最多保留 {MAX_VERSIONS} 个版本，添加后将移除最早的未发布版本。</p>}
          {editing.versions.length ? <ol className="versions">{editing.versions.map((item) => <li className={`version version-${item.status}`} key={item.id}>
            <div className="version-main"><div className="version-line"><strong className="num">{item.version}</strong></div><small>{item.status === "published" ? `发布于 ${formatDate(item.publishedAt || item.createdAt)}` : `上传于 ${formatDate(item.createdAt)}`}</small></div>
            {item.status !== "published" && (removing
              ? <button type="button" className="btn btn-line btn-sm btn-quiet-danger" disabled={versionBusy} onClick={() => void deleteVersion(item)}>删除</button>
              : <button type="button" className="btn btn-line btn-sm" disabled={versionBusy} onClick={() => void publishVersion(item)}>设为发布</button>)}
          </li>)}</ol> : !adding && <p className="muted">还没有版本。</p>}
        </section>}
      </aside>
    </div>
  </form>;
}
