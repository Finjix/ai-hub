import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { NextResponse } from "next/server";
import { getStore } from "@/lib/db";
import { HttpError, boundedFormData, jsonError, requireSameOrigin } from "@/lib/http";
import { MEDIA_LIMITS, describeMedia, mediaSizeError, mediaTypeError } from "@/lib/media";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Room for multipart boundaries and headers on top of the largest allowed file.
const MAX_BODY = MEDIA_LIMITS.video + 1024 * 1024;

export async function POST(request: Request) {
  let target: string | undefined;
  let saved = false;
  try {
    requireSameOrigin(request);
    const form = await boundedFormData(request, MAX_BODY, "视频不能超过 100MB。");
    const file = form.get("file");
    if (!file || typeof file === "string") throw new HttpError(400, "请选择要上传的图片或视频。");
    const type = describeMedia(file.name);
    if (!type) throw new HttpError(400, mediaTypeError());
    const sizeError = mediaSizeError(type, file.size);
    if (sizeError) throw new HttpError(file.size > 0 ? 413 : 400, sizeError);

    const { root } = getStore();
    const name = `${randomUUID()}.${type.extension}`;
    target = path.join(root, "media", name);
    await pipeline(Readable.fromWeb(file.stream() as never), createWriteStream(target, { flags: "wx" }));
    saved = true;
    return NextResponse.json({ url: `/media/${name}`, kind: type.kind }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  } finally {
    if (target && !saved) await rm(target, { force: true }).catch(() => undefined);
  }
}
