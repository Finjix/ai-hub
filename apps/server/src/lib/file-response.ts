import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";

export async function streamFile(filePath: string, request?: Request, name?: string, extraHeaders: Record<string, string> = {}): Promise<Response> {
  const info = await stat(filePath);
  const range = request?.headers.get("range");
  const headers = new Headers({
    "Accept-Ranges": "bytes",
    "Content-Length": String(info.size),
    "Content-Type": "application/octet-stream",
    "X-Content-Type-Options": "nosniff",
    ...extraHeaders,
  });
  if (name) headers.set("Content-Disposition", `attachment; filename="${name.replace(/["\\\r\n]/g, "_")}"`);

  if (!range) {
    const stream = createReadStream(filePath);
    return new Response(Readable.toWeb(stream) as ReadableStream, { status: 200, headers });
  }
  const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  if (!match || (!match[1] && !match[2])) {
    headers.set("Content-Range", `bytes */${info.size}`);
    headers.set("Content-Length", "0");
    return new Response(null, { status: 416, headers });
  }
  let start = match[1] ? Number(match[1]) : Math.max(0, info.size - Number(match[2]));
  let end = match[2] && match[1] ? Number(match[2]) : (match[1] ? info.size - 1 : info.size - 1);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || start >= info.size) {
    headers.set("Content-Range", `bytes */${info.size}`);
    headers.set("Content-Length", "0");
    return new Response(null, { status: 416, headers });
  }
  end = Math.min(end, info.size - 1);
  headers.set("Content-Length", String(end - start + 1));
  headers.set("Content-Range", `bytes ${start}-${end}/${info.size}`);
  const stream = createReadStream(filePath, { start, end });
  return new Response(Readable.toWeb(stream) as ReadableStream, { status: 206, headers });
}
