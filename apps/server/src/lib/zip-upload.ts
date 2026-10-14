import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { isValidSkillVersion, validateSkillName } from "@ai-hub/shared";
import { inspectSkillZip, sha256File } from "@ai-hub/shared/archive";
import { getStore } from "@/lib/db";
import { HttpError } from "@/lib/http";

export interface InspectedUpload {
  tempPath: string;
  sha256: string;
  size: number;
  metadata: Awaited<ReturnType<typeof inspectSkillZip>>;
}

export async function inspectUpload(file: FormDataEntryValue | null): Promise<InspectedUpload> {
  if (!file || typeof file === "string" || typeof file.arrayBuffer !== "function") {
    throw new HttpError(400, "请选择一个 .zip 技能包。");
  }
  if (!file.name.toLowerCase().endsWith(".zip")) throw new HttpError(400, "技能包必须是 ZIP 文件。");
  if (file.size === 0) throw new HttpError(400, "ZIP 文件为空。");

  const { root } = getStore();
  const tempPath = path.join(root, "tmp", `${randomUUID()}.zip`);
  try {
    await pipeline(Readable.fromWeb(file.stream() as never), createWriteStream(tempPath, { flags: "wx" }));
    let metadata: Awaited<ReturnType<typeof inspectSkillZip>>;
    try {
      metadata = await inspectSkillZip(tempPath);
    } catch (error) {
      const message = error instanceof Error ? error.message : "ZIP 格式无效";
      throw new HttpError(400, `技能包验证失败：${message.slice(0, 220)}`);
    }
    if (typeof metadata.name !== "string" || !metadata.name.trim()) throw new HttpError(400, "SKILL.md 缺少有效的 name 字段。");
    try {
      validateSkillName(metadata.name);
    } catch {
      throw new HttpError(400, "SKILL.md 中的技能名称无效，请检查 name 字段。");
    }
    return { tempPath, sha256: await sha256File(tempPath), size: file.size, metadata };
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined);
    if (error instanceof HttpError) throw error;
    throw error;
  }
}

export function assertVersion(version: string): void {
  if (!isValidSkillVersion(version)) throw new HttpError(400, "版本号不能为空、不能超过 64 个字符，也不能包含控制字符。");
}

export async function persistArchive(upload: InspectedUpload, skillId: string, versionId: string): Promise<string> {
  const { root } = getStore();
  const directory = path.join(root, "skills", skillId);
  await mkdir(directory, { recursive: true });
  const archivePath = path.join(directory, `${versionId}.zip`);
  await rename(upload.tempPath, archivePath);
  return archivePath;
}

export async function removeTemp(upload: InspectedUpload): Promise<void> {
  await rm(upload.tempPath, { force: true }).catch(() => undefined);
}
