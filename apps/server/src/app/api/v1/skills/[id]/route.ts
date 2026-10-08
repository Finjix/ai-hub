import { NextResponse } from "next/server";
import { getSkill, isValidSkillId } from "@/lib/skills";
import { jsonError, HttpError } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    if (!isValidSkillId(id)) throw new HttpError(404, "找不到这个技能。");
    const result = getSkill(id);
    if (!result) throw new HttpError(404, "找不到这个技能。");
    return NextResponse.json(result);
  } catch (error) {
    return jsonError(error);
  }
}
