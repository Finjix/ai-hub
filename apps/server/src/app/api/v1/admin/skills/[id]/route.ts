import { NextResponse } from "next/server";
import { getStore, type SkillRow } from "@/lib/db";
import { HttpError, jsonError, requireSameOrigin } from "@/lib/http";
import { getSkill, isValidSkillId } from "@/lib/skills";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function readId(context: { params: Promise<{ id: string }> }): Promise<string> {
  const { id } = await context.params;
  if (!isValidSkillId(id)) throw new HttpError(404, "找不到这个技能。");
  return id;
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const result = getSkill(await readId(context), true);
    if (!result) throw new HttpError(404, "找不到这个技能。");
    return NextResponse.json(result);
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    requireSameOrigin(request);
    const id = await readId(context);
    const { db } = getStore();
    const row = db.prepare("SELECT * FROM skills WHERE id = ?").get(id) as unknown as SkillRow | undefined;
    if (!row) throw new HttpError(404, "找不到这个技能。");
    const body: unknown = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new HttpError(400, "请求内容格式不正确。");
    const input = body as Record<string, unknown>;
    const displayName = input.displayName === undefined ? row.display_name : textField(input.displayName, "展示名称", 120);
    const description = input.description === undefined ? row.description : textField(input.description, "简介", 2000, true);
    const introduction = input.introduction === undefined ? row.introduction : textField(input.introduction, "技能介绍", 200_000, true);
    const status = input.status === undefined ? row.status : input.status;
    if (status !== "active" && status !== "archived") throw new HttpError(400, "技能状态只能是 active 或 archived。");
    db.prepare("UPDATE skills SET display_name=?,description=?,introduction=?,status=?,updated_at=? WHERE id=?")
      .run(displayName, description, introduction, status, new Date().toISOString(), id);
    const result = getSkill(id, true);
    return NextResponse.json(result);
  } catch (error) {
    return jsonError(error);
  }
}

function textField(value: unknown, label: string, max: number, allowEmpty = false): string {
  if (typeof value !== "string") throw new HttpError(400, `${label}格式不正确。`);
  const trimmed = value.trim();
  if ((!trimmed && !allowEmpty) || trimmed.length > max) throw new HttpError(400, `${label}不能为空且不能超过 ${max} 个字符。`);
  return trimmed;
}
