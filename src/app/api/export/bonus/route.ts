import { NextRequest } from "next/server";
import { currentUser } from "@/lib/auth";
import { all } from "@/lib/db";

export async function GET(req: NextRequest) {
  const me = await currentUser();
  if (me?.role !== "boss") return new Response("forbidden", { status: 403 });
  const month = req.nextUrl.searchParams.get("month") ?? "";
  const rows = all<Record<string, string | number>>(
    "SELECT u.name 姓名, b.kind 类型, b.amount 金额, b.description 说明, CASE b.published WHEN 1 THEN '已公示' ELSE '待公示' END 状态 FROM bonuses b JOIN users u ON u.id=b.user_id WHERE b.month=? ORDER BY u.id", month);
  const head = ["姓名", "类型", "金额", "说明", "状态"];
  const esc = (v: unknown) => {
    const raw = String(v ?? "");
    const safe = typeof v === "string" && /^[\s]*[=+@-]/.test(raw) ? "'" + raw : raw;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  const csv = "﻿" + [head.join(","), ...rows.map((r) => head.map((h) => esc(r[h])).join(","))].join("\n");
  return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`奖金清算-${month}.csv`)}` } });
}
