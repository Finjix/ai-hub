import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { mkdir, rename, rm } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { isNewerVersion, isValidVersion } from "@ai-hub/shared";
import { parse as parseYaml } from "yaml";
import { getStore, type ReleaseRow } from "@/lib/db";
import { boundedFormData, HttpError, jsonError, requireSameOrigin } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_RELEASE_BYTES = 1_500_000_000;
const SAFE_RELEASE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,200}$/;

export async function GET() {
  try {
    const { db } = getStore();
    const releases = (db.prepare("SELECT * FROM releases ORDER BY created_at DESC").all() as unknown as ReleaseRow[]).map((row) => ({
      id: row.id,
      version: row.version,
      createdAt: row.created_at,
      active: Boolean(row.active),
      files: JSON.parse(row.files_json) as string[],
    }));
    return Response.json({ releases });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  const { root, db } = getStore();
  const releaseId = randomUUID();
  const staging = path.join(root, "updates", "staging", releaseId);
  const finalDirectory = path.join(root, "updates", "versions", releaseId);
  let promoted = false;
  try {
    requireSameOrigin(request);
    const form = await boundedFormData(request, MAX_RELEASE_BYTES + 1024 * 1024, "更新文件总大小不能超过 1.5 GB。");
    const uploads = form.getAll("files").filter((item): item is File => typeof item !== "string" && typeof item.arrayBuffer === "function");
    if (!uploads.length) throw new HttpError(400, "请选择更新文件。");
    const names = new Set<string>();
    let total = 0;
    for (const file of uploads) {
      if (!SAFE_RELEASE_NAME.test(file.name) || file.name !== path.basename(file.name)) throw new HttpError(400, `文件名「${file.name}」无效，只能使用简单文件名。`);
      const canonicalName = file.name.toLowerCase();
      if (names.has(canonicalName)) throw new HttpError(400, `文件「${file.name}」重复。`);
      names.add(canonicalName);
      total += file.size;
      if (total > MAX_RELEASE_BYTES) throw new HttpError(413, "更新文件总大小不能超过 1.5 GB。");
    }
    const manifestFile = uploads.find((file) => file.name === "latest.yml");
    if (!manifestFile || manifestFile.size > 1024 * 1024) throw new HttpError(400, "请上传不超过 1 MiB 的 latest.yml。 ");
    const exeFiles = uploads.filter((file) => file.name.toLowerCase().endsWith(".exe"));
    if (exeFiles.length !== 1) throw new HttpError(400, "每个更新版本必须包含且只包含一个 .exe 安装包。");
    const exe = exeFiles[0];
    const blockmaps = uploads.filter((file) => file.name.toLowerCase().endsWith(".blockmap"));
    if (blockmaps.length !== 1 || blockmaps[0].name !== `${exe.name}.blockmap`) throw new HttpError(400, `请上传且只上传 ${exe.name}.blockmap 差分文件。`);
    if (uploads.some((file) => file.name !== "latest.yml" && !file.name.toLowerCase().endsWith(".exe") && !file.name.toLowerCase().endsWith(".blockmap"))) {
      throw new HttpError(400, "更新目录只接受 latest.yml、.exe 和对应的 .blockmap 文件。");
    }
    const historicalNames = new Set<string>();
    const previousReleases = db.prepare("SELECT files_json FROM releases").all() as unknown as Array<{ files_json: string }>;
    for (const previous of previousReleases) {
      for (const filename of JSON.parse(previous.files_json) as string[]) historicalNames.add(filename.toLowerCase());
    }
    const reused = uploads.find((file) => file.name !== "latest.yml" && historicalNames.has(file.name.toLowerCase()));
    if (reused) throw new HttpError(409, `文件名「${reused.name}」已被历史版本使用，请为本次发布生成唯一文件名。`);

    await mkdir(staging, { recursive: true });
    for (const file of uploads) {
      await pipeline(Readable.fromWeb(file.stream() as never), createWriteStream(path.join(staging, file.name), { flags: "wx" }));
    }
    const manifestText = await (await import("node:fs/promises")).readFile(path.join(staging, manifestFile.name), "utf8");
    let manifest: Record<string, unknown>;
    try { manifest = parseYaml(manifestText) as Record<string, unknown>; }
    catch { throw new HttpError(400, "latest.yml 不是有效的 YAML 文件。"); }
    if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) throw new HttpError(400, "latest.yml 内容格式无效。");
    const version = stringField(manifest.version, "version");
    if (!isValidVersion(version)) throw new HttpError(400, "latest.yml 中的版本号无效。");
    const active = db.prepare("SELECT version FROM releases WHERE active=1").get() as { version: string } | undefined;
    if (active && !isNewerVersion(version, active.version)) throw new HttpError(409, `新版本 ${version} 必须高于当前版本 ${active.version}。`);

    const primaryPath = stringField(manifest.path, "path");
    const primarySha = stringField(manifest.sha512, "sha512");
    if (!SAFE_RELEASE_NAME.test(primaryPath) || primaryPath !== exe.name) throw new HttpError(400, "latest.yml 的 path 必须指向本次上传的 .exe 文件。");
    const primaryDigest = await sha512(path.join(staging, exe.name));
    if (primaryDigest !== primarySha) throw new HttpError(400, `latest.yml 中 ${exe.name} 的 SHA512 与文件内容不一致。`);
    if (manifest.size !== undefined && Number(manifest.size) !== exe.size) throw new HttpError(400, `latest.yml 中 ${exe.name} 的 size 与实际大小不一致。`);
    const manifestFiles = manifest.files;
    if (!Array.isArray(manifestFiles) || manifestFiles.length === 0) throw new HttpError(400, "latest.yml 缺少 files 文件清单。");
    const referenced = new Set<string>();
    for (const entry of manifestFiles) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new HttpError(400, "latest.yml 的 files 清单格式无效。");
      const item = entry as Record<string, unknown>;
      const name = stringField(item.url, "files.url");
      const digest = stringField(item.sha512, "files.sha512");
      if (referenced.has(name)) throw new HttpError(400, `latest.yml 的 files 清单重复引用了「${name}」。`);
      const file = uploads.find((candidate) => candidate.name === name);
      if (!SAFE_RELEASE_NAME.test(name) || !file || file.name === "latest.yml") throw new HttpError(400, `latest.yml 引用了未上传或无效的文件「${name}」。`);
      if (await sha512(path.join(staging, name)) !== digest) throw new HttpError(400, `latest.yml 中 ${name} 的 SHA512 与文件内容不一致。`);
      if (!Number.isSafeInteger(item.size) || item.size !== file.size) throw new HttpError(400, `latest.yml 中 ${name} 的 size 与实际大小不一致。`);
      referenced.add(name);
    }
    if (!referenced.has(exe.name)) throw new HttpError(400, "latest.yml 的 files 清单必须包含 .exe 安装包。");

    const assetFiles = uploads.filter((file) => file.name !== "latest.yml").map((file) => file.name).sort();
    await rename(staging, finalDirectory);
    promoted = true;
    try {
      db.exec("BEGIN IMMEDIATE");
      const latestActive = db.prepare("SELECT version FROM releases WHERE active=1").get() as { version: string } | undefined;
      if (latestActive && !isNewerVersion(version, latestActive.version)) {
        throw new HttpError(409, `新版本 ${version} 必须高于当前版本 ${latestActive.version}。`);
      }
      db.prepare("UPDATE releases SET active=0 WHERE active=1").run();
      db.prepare("INSERT INTO releases (id,version,directory,manifest,files_json,created_at,active) VALUES (?,?,?,?,?,?,1)")
        .run(releaseId, version, releaseId, "latest.yml", JSON.stringify(assetFiles), new Date().toISOString());
      db.exec("COMMIT");
    } catch (error) {
      try { db.exec("ROLLBACK"); } catch { /* transaction may not have started */ }
      throw error;
    }
    return Response.json({ ok: true, id: releaseId, version, files: assetFiles }, { status: 201 });
  } catch (error) {
    if (promoted) await rm(finalDirectory, { recursive: true, force: true }).catch(() => undefined);
    return jsonError(error);
  } finally {
    await rm(staging, { recursive: true, force: true }).catch(() => undefined);
  }
}

function stringField(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new HttpError(400, `latest.yml 缺少有效的 ${field} 字段。`);
  return value.trim();
}

async function sha512(file: string): Promise<string> {
  const hash = createHash("sha512");
  const { createReadStream } = await import("node:fs");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("base64");
}
