import { NextResponse } from "next/server";

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "HttpError";
  }
}

export function jsonError(error: unknown): NextResponse {
  if (error instanceof HttpError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
    if (error.message.includes("UNIQUE constraint failed: skills.name")) {
      return NextResponse.json({ error: "这个技能名称已经存在，请刷新列表后重试。" }, { status: 409 });
    }
    if (error.message.includes("UNIQUE constraint failed: skill_versions.skill_id, skill_versions.version")) {
      return NextResponse.json({ error: "这个技能版本已经存在，请填写一个新的版本号。" }, { status: 409 });
    }
  }
  if (error instanceof SyntaxError) {
    return NextResponse.json({ error: "请求内容格式不正确。" }, { status: 400 });
  }
  console.error("AI Hub request failed:", error);
  return NextResponse.json({ error: "服务器暂时无法处理请求，请稍后重试。" }, { status: 500 });
}

export function requireSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (!origin) return;
  const host = request.headers.get("host");
  try {
    if (!host || new URL(origin).host.toLowerCase() !== host.toLowerCase()) {
      throw new HttpError(403, "管理操作必须从当前 AI Hub 页面发起。");
    }
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(403, "管理操作必须从当前 AI Hub 页面发起。");
  }
}

export async function boundedFormData(request: Request, maxBodyBytes: number, limitMessage: string): Promise<FormData> {
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    if (!/^\d+$/.test(contentLength)) throw new HttpError(400, "上传请求长度无效。");
    if (BigInt(contentLength) > BigInt(maxBodyBytes)) throw new HttpError(413, limitMessage);
  }
  if (!request.body) return new FormData();
  let exceeded = false;
  let received = 0;
  const boundedBody = request.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      received += chunk.byteLength;
      if (received > maxBodyBytes) {
        exceeded = true;
        throw new HttpError(413, limitMessage);
      }
      controller.enqueue(chunk);
    },
  }));
  const headers = new Headers(request.headers);
  headers.delete("content-length");
  headers.delete("transfer-encoding");
  headers.delete("host");
  try {
    const boundedRequest = new Request(request.url, {
      method: request.method,
      headers,
      body: boundedBody,
      duplex: "half",
    } as RequestInit);
    return await boundedRequest.formData();
  } catch (error) {
    if (exceeded) throw new HttpError(413, limitMessage);
    throw error;
  }
}

export function requiredText(value: FormDataEntryValue | null, label: string, max = 4000): string {
  if (typeof value !== "string") throw new HttpError(400, `请填写${label}。`);
  const trimmed = value.trim();
  if (!trimmed) throw new HttpError(400, `请填写${label}。`);
  if (trimmed.length > max) throw new HttpError(400, `${label}不能超过 ${max} 个字符。`);
  return trimmed;
}

export function optionalText(value: FormDataEntryValue | null, max = 4000): string | undefined {
  if (value === null) return undefined;
  if (typeof value !== "string") throw new HttpError(400, "请求字段格式不正确。");
  const trimmed = value.trim();
  if (trimmed.length > max) throw new HttpError(400, `字段不能超过 ${max} 个字符。`);
  return trimmed;
}

export function parseTagsInput(value: unknown): string[] {
  let tags = value;
  if (typeof value === "string") {
    try { tags = JSON.parse(value); } catch { throw new HttpError(400, "标签格式不正确，请使用 JSON 数组。"); }
  }
  if (!Array.isArray(tags) || tags.some((tag) => typeof tag !== "string")) {
    throw new HttpError(400, "标签格式不正确，请使用字符串数组。");
  }
  const normalized = [...new Set(tags.map((tag: string) => tag.trim()).filter(Boolean))];
  if (normalized.length > 30 || normalized.some((tag) => tag.length > 40)) {
    throw new HttpError(400, "最多可添加 30 个标签，每个标签不超过 40 个字符。");
  }
  return normalized;
}
