import { get } from "@/lib/db";

export const dynamic = "force-dynamic";

export function GET() {
  get("SELECT 1");
  return Response.json({ ok: true });
}
