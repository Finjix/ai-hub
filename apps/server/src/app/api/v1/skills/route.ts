import { NextRequest, NextResponse } from "next/server";
import { listSkills } from "@/lib/skills";
import { jsonError } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const query = request.nextUrl.searchParams;
    return NextResponse.json(listSkills({ q: query.get("q") ?? "", category: query.get("category") ?? "" }));
  } catch (error) {
    return jsonError(error);
  }
}
