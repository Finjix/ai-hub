// Shared by the media API and the admin editor, so it must stay free of server-only imports.

export type MediaKind = "image" | "video";
export interface MediaType { kind: MediaKind; extension: string; contentType: string }

export const MEDIA_LIMITS: Record<MediaKind, number> = { image: 10 * 1024 * 1024, video: 100 * 1024 * 1024 };

// SVG is deliberately excluded: served from our origin it could run script.
const TYPES: Record<string, Omit<MediaType, "extension">> = {
  png: { kind: "image", contentType: "image/png" },
  jpg: { kind: "image", contentType: "image/jpeg" },
  jpeg: { kind: "image", contentType: "image/jpeg" },
  gif: { kind: "image", contentType: "image/gif" },
  webp: { kind: "image", contentType: "image/webp" },
  mp4: { kind: "video", contentType: "video/mp4" },
  webm: { kind: "video", contentType: "video/webm" },
};

export const MEDIA_ACCEPT: Record<MediaKind, string> = {
  image: Object.keys(TYPES).filter((ext) => TYPES[ext].kind === "image").map((ext) => `.${ext}`).join(","),
  video: Object.keys(TYPES).filter((ext) => TYPES[ext].kind === "video").map((ext) => `.${ext}`).join(","),
};

export function describeMedia(fileName: string): MediaType | null {
  const extension = /\.([a-z0-9]+)$/i.exec(fileName)?.[1]?.toLowerCase();
  return extension && TYPES[extension] ? { extension, ...TYPES[extension] } : null;
}

export function mediaSizeError(type: MediaType, size: number): string | null {
  if (size <= 0) return "文件为空。";
  if (size > MEDIA_LIMITS[type.kind]) return type.kind === "image" ? "图片不能超过 10MB。" : "视频不能超过 100MB。";
  return null;
}

export function mediaTypeError(): string {
  return "仅支持 PNG、JPG、GIF、WebP 图片和 MP4、WebM 视频。";
}

export function isMediaFileName(name: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]+$/.test(name) && describeMedia(name) !== null;
}
