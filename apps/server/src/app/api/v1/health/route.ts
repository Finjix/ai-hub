import { getStore } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const { serverId } = getStore();
  return Response.json({ ok: true, serverId, nodeVersion: process.version });
}
