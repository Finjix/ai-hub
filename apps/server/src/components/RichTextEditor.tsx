"use client";

import { useEffect, useRef, useState } from "react";
import { EditorContent, Node, mergeAttributes, useEditor, useEditorState, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import { Color, FontSize, TextStyle } from "@tiptap/extension-text-style";
import { Placeholder } from "@tiptap/extensions";
import { TextSelection } from "@tiptap/pm/state";
import type { EditorProps } from "@tiptap/pm/view";
import { MEDIA_ACCEPT, describeMedia, mediaSizeError, mediaTypeError, type MediaKind } from "@/lib/media";
import { uploadWithProgress } from "@/lib/upload-client";

type Upload = { id: number; name: string; percent: number };

const Video = Node.create({
  name: "video",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() { return { src: { default: null } }; },
  parseHTML() { return [{ tag: "video[src]" }]; },
  renderHTML({ HTMLAttributes }) { return ["video", mergeAttributes(HTMLAttributes, { controls: "", preload: "metadata" })]; },
});

const ICONS: Record<string, React.ReactNode> = {
  undo: <path d="M9 14 4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3"/>,
  redo: <path d="m15 14 5-5-5-5M20 9H9a5 5 0 0 0 0 10h3"/>,
  bold: <path d="M7 5h6a3.5 3.5 0 0 1 0 7H7zm0 7h7a3.5 3.5 0 0 1 0 7H7z"/>,
  underline: <path d="M7 4v7a5 5 0 0 0 10 0V4M5 20h14"/>,
  link: <><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></>,
  ul: <path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01"/>,
  ol: <path d="M10 6h10M10 12h10M10 18h10M4 5l1.5-1V9M3.5 13.5A1.2 1.2 0 0 1 6 14c0 1-2.5 2-2.5 3H6"/>,
  quote: <path d="M5 6h14M9 12h10M9 18h10M5 11v8"/>,
  image: <><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="m21 16-5-5-9 9"/></>,
  video: <><rect x="3" y="5" width="13" height="14" rx="2"/><path d="m16 10 5-3v10l-5-3"/></>,
};

const EXTENSIONS = [
  StarterKit.configure({ heading: false, italic: false, code: false, codeBlock: false, horizontalRule: false, strike: false, link: { openOnClick: false, autolink: true } }),
  TextStyle,
  FontSize,
  Color,
  Image,
  Video,
  Placeholder.configure({ placeholder: "介绍技能的用途、使用方法和示例。可直接粘贴或拖入图片（单张 ≤10MB）、视频（单条 ≤100MB）" }),
];

// "中" is the default body size, so it is stored as no font-size at all.
const FONT_SIZES: [string, string][] = [["24px", "大"], ["", "中"], ["14px", "小"]];
// Black is the default text color, so it is stored as no color at all.
const COLORS: [string, string][] = [
  ["", "黑色"], ["#8c8f89", "灰色"], ["#d93025", "红色"], ["#e8710a", "橙色"], ["#c99a00", "黄色"],
  ["#0b7f45", "绿色"], ["#0f8b8d", "青色"], ["#1a73e8", "蓝色"], ["#8e24aa", "紫色"], ["#e91e8c", "粉色"],
];

// Colors read back from parsed HTML come as rgb(); compare in one notation.
function sameColor(a: string | undefined, b: string): boolean {
  if (!a || !b) return !a && !b;
  const hex = (value: string) => {
    const rgb = /^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/.exec(value);
    return rgb ? `#${rgb.slice(1).map((part) => Number(part).toString(16).padStart(2, "0")).join("")}` : value.toLowerCase();
  };
  return hex(a) === hex(b);
}

function Tool({ icon, label, active, disabled, onClick }: { icon: string; label: string; active?: boolean; disabled?: boolean; onClick: () => void }) {
  return <button type="button" className={active ? "rt-tool active" : "rt-tool"} title={label} aria-label={label} aria-pressed={active} disabled={disabled} onMouseDown={(event) => event.preventDefault()} onClick={onClick}>
    <svg width={17} height={17} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{ICONS[icon]}</svg>
  </button>;
}

function readState(editor: Editor | null) {
  if (!editor) return null;
  const style = editor.getAttributes("textStyle");
  return {
    fontSize: typeof style.fontSize === "string" ? style.fontSize : "",
    color: typeof style.color === "string" ? style.color : "",
    bold: editor.isActive("bold"),
    underline: editor.isActive("underline"),
    link: editor.isActive("link"),
    bulletList: editor.isActive("bulletList"),
    orderedList: editor.isActive("orderedList"),
    blockquote: editor.isActive("blockquote"),
    canUndo: editor.can().undo(),
    canRedo: editor.can().redo(),
  };
}

// Edits the skill introduction as HTML; the desktop app sanitizes it again before rendering.
export default function RichTextEditor({ value, onChange, onUploadingChange, onError }: {
  value: string;
  onChange: (html: string) => void;
  onUploadingChange?: (uploading: boolean) => void;
  onError: (message: string) => void;
}) {
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const paletteRef = useRef<HTMLDivElement>(null);
  const pickerRef = useRef<HTMLInputElement>(null);
  const uploadId = useRef(0);
  // Handlers registered with ProseMirror at creation time read the latest closure through this ref.
  const insertFilesRef = useRef<(files: File[]) => void>(() => undefined);

  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  // useEditor re-applies its options (and redraws the document) whenever they differ by identity,
  // so everything passed to it must stay referentially stable across renders.
  const [editorProps] = useState<EditorProps>(() => ({
    handlePaste(_view, event) {
      const files = Array.from(event.clipboardData?.files || []);
      if (!files.length) return false;
      insertFilesRef.current(files);
      return true;
    },
    handleDrop(view, event, _slice, moved) {
      const files = Array.from(event.dataTransfer?.files || []);
      if (moved || !files.length) return false;
      const position = view.posAtCoords({ left: event.clientX, top: event.clientY });
      if (position) view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(position.pos))));
      insertFilesRef.current(files);
      event.preventDefault();
      return true;
    },
  }));
  const editor = useEditor({
    immediatelyRender: false,
    extensions: EXTENSIONS,
    content: value,
    editorProps,
    onUpdate: ({ editor }) => onChangeRef.current(editor.isEmpty ? "" : editor.getHTML()),
  });
  const state = useEditorState({ editor, selector: ({ editor }) => readState(editor) });

  useEffect(() => { onUploadingChange?.(uploads.length > 0); }, [uploads.length, onUploadingChange]);
  useEffect(() => {
    if (!paletteOpen) return;
    const close = (event: MouseEvent) => { if (!paletteRef.current?.contains(event.target as globalThis.Node)) setPaletteOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setPaletteOpen(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", escape); };
  }, [paletteOpen]);

  async function uploadFile(file: File) {
    const id = ++uploadId.current;
    setUploads((list) => [...list, { id, name: file.name, percent: 0 }]);
    try {
      const form = new FormData();
      form.append("file", file, file.name);
      const result = await uploadWithProgress<{ url: string; kind: MediaKind }>("/api/v1/admin/media", form, (percent) => {
        setUploads((list) => list.map((item) => item.id === id ? { ...item, percent } : item));
      });
      if (!editor) return;
      const node = result.kind === "image" ? { type: "image", attrs: { src: result.url, alt: file.name.replace(/\.[^.]+$/, "") } } : { type: "video", attrs: { src: result.url } };
      // Insert after the selection: a just-inserted image/video stays node-selected and would be replaced.
      editor.chain().focus().insertContentAt(editor.state.selection.to, node).run();
    } catch (cause) {
      onError(`${file.name} 上传失败：${cause instanceof Error ? cause.message : "请稍后重试。"}`);
    } finally {
      setUploads((list) => list.filter((item) => item.id !== id));
    }
  }

  insertFilesRef.current = (files) => {
    const problems: string[] = [];
    for (const file of files) {
      const type = describeMedia(file.name);
      const problem = type ? mediaSizeError(type, file.size) : mediaTypeError();
      if (problem) problems.push(`${file.name}：${problem}`);
      else void uploadFile(file);
    }
    if (problems.length) onError(problems.join(" "));
  };

  function pick(kind: MediaKind) {
    const input = pickerRef.current;
    if (!input) return;
    input.accept = MEDIA_ACCEPT[kind];
    input.click();
  }

  function editLink() {
    if (!editor) return;
    const previous = editor.getAttributes("link").href as string | undefined;
    const href = window.prompt("链接地址（留空则移除链接）", previous || "https://");
    if (href === null) return;
    if (!href.trim()) editor.chain().focus().extendMarkRange("link").unsetLink().run();
    else editor.chain().focus().extendMarkRange("link").setLink({ href: href.trim() }).run();
  }

  function setFontSize(size: string) {
    if (!editor) return;
    if (size) editor.chain().focus().setFontSize(size).run();
    else editor.chain().focus().unsetFontSize().run();
  }

  function setColor(color: string) {
    setPaletteOpen(false);
    if (!editor) return;
    if (color) editor.chain().focus().setColor(color).run();
    else editor.chain().focus().unsetColor().run();
  }

  const off = !editor;
  return <div className="rt-editor">
    <div className="rt-toolbar" role="toolbar" aria-label="编辑工具">
      <Tool icon="undo" label="撤销" disabled={off || !state?.canUndo} onClick={() => editor?.chain().focus().undo().run()}/>
      <Tool icon="redo" label="重做" disabled={off || !state?.canRedo} onClick={() => editor?.chain().focus().redo().run()}/>
      <span className="rt-sep"/>
      <select className="rt-size" aria-label="字号" title="字号" disabled={off} value={FONT_SIZES.some(([size]) => size === state?.fontSize) ? state?.fontSize : ""} onChange={(event) => setFontSize(event.target.value)}>
        {FONT_SIZES.map(([size, label]) => <option key={label} value={size}>字号：{label}</option>)}
      </select>
      <span className="rt-sep"/>
      <Tool icon="bold" label="粗体" active={state?.bold} disabled={off} onClick={() => editor?.chain().focus().toggleBold().run()}/>
      <Tool icon="underline" label="下划线" active={state?.underline} disabled={off} onClick={() => editor?.chain().focus().toggleUnderline().run()}/>
      <div className="rt-color" ref={paletteRef}>
        <button type="button" className={paletteOpen ? "rt-tool open" : "rt-tool"} title="字体颜色" aria-label="字体颜色" aria-haspopup="true" aria-expanded={paletteOpen} disabled={off} onMouseDown={(event) => event.preventDefault()} onClick={() => setPaletteOpen((open) => !open)}>
          <span className="rt-color-glyph">A<i style={{ background: state?.color || "var(--ink)" }}/></span>
        </button>
        {paletteOpen && <div className="rt-palette" role="menu" aria-label="字体颜色">
          <div className="rt-swatches">{COLORS.map(([color, name]) => <button type="button" key={color} role="menuitem" title={name} aria-label={name} className={sameColor(state?.color, color) ? "rt-swatch selected" : "rt-swatch"} style={{ background: color || "var(--ink)" }} onMouseDown={(event) => event.preventDefault()} onClick={() => setColor(color)}/>)}</div>
        </div>}
      </div>
      <Tool icon="link" label="链接" active={state?.link} disabled={off} onClick={editLink}/>
      <span className="rt-sep"/>
      <Tool icon="ul" label="无序列表" active={state?.bulletList} disabled={off} onClick={() => editor?.chain().focus().toggleBulletList().run()}/>
      <Tool icon="ol" label="有序列表" active={state?.orderedList} disabled={off} onClick={() => editor?.chain().focus().toggleOrderedList().run()}/>
      <Tool icon="quote" label="引用" active={state?.blockquote} disabled={off} onClick={() => editor?.chain().focus().toggleBlockquote().run()}/>
      <span className="rt-sep"/>
      <Tool icon="image" label="插入图片（≤10MB）" disabled={off} onClick={() => pick("image")}/>
      <Tool icon="video" label="插入视频（≤100MB）" disabled={off} onClick={() => pick("video")}/>
    </div>
    <input ref={pickerRef} type="file" hidden multiple onChange={(event) => { const files = Array.from(event.target.files || []); event.target.value = ""; insertFilesRef.current(files); }}/>
    <div className="rt-body">{editor ? <EditorContent editor={editor} className="rt-content"/> : <div className="rt-loading"><span className="spinner"/></div>}</div>
    {uploads.length > 0 && <div className="rt-status">
      {uploads.map((item) => <span className="rt-upload" key={item.id}><span className="spinner xs"/>正在上传 {item.name}<b className="num">{item.percent}%</b><i style={{ width: `${item.percent}%` }}/></span>)}
    </div>}
  </div>;
}
