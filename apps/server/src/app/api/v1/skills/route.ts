import { NextRequest, NextResponse } from "next/server";
import { listSkills } from "@/lib/skills";
import { jsonError } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const query = request.nextUrl.searchParams;
    // Desktop clients up to v0.1.1 reject skills without a tags array, so keep an empty one for them.
    const result = listSkills({ q: query.get("q") ?? "" });
    return NextResponse.json({ ...result, skills: result.skills.map((skill) => ({ ...skill, tags: [] })) });
  } catch (error) {
    return jsonError(error);
  }
}
