"use client";

import { useEffect, useRef, useState } from "react";
import type { SkillDetail } from "@ai-hub/shared";
import RichTextEditor from "@/components/RichTextEditor";
import { uploadWithProgress } from "@/lib/upload-client";

export type EditorTarget = { mode: "create" } | { mode: "edit"; skill: SkillDetail };

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function SkillEditorPage({ target, onClose, onSaved, onError, registerGuard }: {
  target: EditorTarget;
  onClose: () => void;
  onSaved: (message: string) => void;
  onError: (message: string) => void;
  // Lets the shell ask before navigating away from unsaved work.
  registerGuard: (guard: (() => boolean) | null) => void;
}) {
  const editing = target.mode === "edit" ? target.skill : null;
  const [file, setFile] = useState<File | null>(null);
  const [version, setVersion] = useState("");
  const [displayName, setDisplayName] = useState(editing?.displayName ?? "");
  const [introduction, setIntroduction] = useState(editing?.introduction ?? "");
  const [mediaUploading, setMediaUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const dirty = !saving && (editing
    ? displayName.trim() !== editing.displayName || introduction.trim() !== editing.introduction.trim()
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

  function choose(picked: File | undefined) {
    if (!picked) return;
    if (!picked.name.toLowerCase().endsWith(".zip")) { onError("技能包必须是 ZIP 文件。"); return; }
    setFile(picked);
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mediaUploading) return;
    if (!editing && !file) { onError("请选择技能包 ZIP。"); return; }
    setSaving(true);
    try {
      if (editing) {
        const response = await fetch(`/api/v1/admin/skills/${editing.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ displayName, introduction }),
          cache: "no-store",
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(typeof result?.error === "string" ? result.error : "请求失败，请稍后重试。");
        onSaved("已保存");
      } else {
        const form = new FormData();
        form.append("file", file!, file!.name);
        form.append("version", version);
        form.append("displayName", displayName);
        form.append("introduction", introduction);
        setProgress(0);
        const result = await uploadWithProgress<{ status?: string }>("/api/v1/admin/skills", form, setProgress);
        onSaved(result.status === "published" ? "技能已添加并发布" : "技能已添加为草稿");
      }
    } catch (cause) {
      setSaving(false);
      setProgress(null);
      onError(cause instanceof Error ? cause.message : "操作失败，请稍后重试。");
    }
  }

  const busyLabel = progress !== null && progress < 100 ? `上传中 ${progress}%` : "保存中…";
  return <form className="page editor-page" onSubmit={submit}>
    <header className="page-head">
      <h1>{editing ? "编辑技能" : "添加技能"}</h1>
      <div className="head-tools">
        <button type="button" className="btn btn-line" onClick={leave} disabled={saving}>取消</button>
        <button className="btn btn-ink" disabled={saving || mediaUploading} title={mediaUploading ? "请等待图片/视频上传完成" : undefined}>
          {saving ? <><span className="spinner sm"/>{busyLabel}</> : editing ? "保存" : "添加技能"}
        </button>
      </div>
    </header>

    <div className="editor-layout">
      <section className="panel intro-panel">
        <div className="panel-head"><h2>技能介绍</h2></div>
        <RichTextEditor value={editing?.introduction ?? ""} onChange={setIntroduction} onUploadingChange={setMediaUploading} onError={onError}/>
      </section>

      <aside className="editor-side">
        {editing ? <section className="panel side-card">
          <h2>技能包</h2>
          <dl className="facts">
            <div><dt>技能标识</dt><dd><code>{editing.name}</code></dd></div>
            <div><dt>线上版本</dt><dd className="num">{editing.latestVersion ? `v${editing.latestVersion.version}` : "未发布"}</dd></div>
          </dl>
          <p className="muted">上传新版本请在技能详情中操作。</p>
        </section> : <section className="panel side-card">
          <h2>技能包</h2>
          <div className={`dropzone${file ? " has-file" : ""}${dragging ? " dragging" : ""}`} role="button" tabIndex={0}
            onClick={() => fileRef.current?.click()}
            onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); fileRef.current?.click(); } }}
            onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => { event.preventDefault(); setDragging(false); choose(event.dataTransfer.files[0]); }}>
            <input ref={fileRef} type="file" accept=".zip" hidden onChange={(event) => { choose(event.target.files?.[0]); event.target.value = ""; }}/>
            <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{file ? <><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/></> : <path d="M12 15V4m-4.5 4.5L12 4l4.5 4.5M5 19h14"/>}</svg>
            {file ? <span className="dz-text"><strong>{file.name}</strong><small>{formatSize(file.size)} · 点击更换</small></span>
              : <span className="dz-text"><strong>拖入或点击选择 ZIP</strong><small>压缩包内需包含 SKILL.md</small></span>}
          </div>
          {progress !== null && <div className="progress"><span style={{ width: `${progress}%` }}/></div>}
        </section>}

        <section className="panel side-card">
          <h2>基本信息</h2>
          {!editing && <label className="field">版本号<input value={version} onChange={(event) => setVersion(event.target.value)} placeholder="如 1.0.0" required/></label>}
          <label className="field">展示名称<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} maxLength={120} required placeholder="在技能广场显示的名称"/></label>
        </section>
      </aside>
    </div>
  </form>;
}
