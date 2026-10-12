import { UserFacingError } from "./action-errors";
import { all, get, run } from "./db";
import { getRules, type VideoRow } from "./rules";
export type Delivery = { video_id: number; cutter_id: number; code: string; title: string; account_name: string; cutter_name: string;
  cut_level: string; base_units: number; extra_units: number; due_rough: string | null; late_exempt_reason: string | null; submitted_at: string; provenance: string };
export function recordDelivery(v: VideoRow) {
  if (get("SELECT id FROM work_deliveries WHERE video_id=?", v.id)) return;
  if (!v.cutter_id) throw new UserFacingError("请先指定剪辑");
  const base = getRules().cut_levels[v.cut_level];
  if (!(base > 0) || v.extra_units < 0) throw new UserFacingError("请先确认剪辑定档和加件");
  run(`INSERT INTO work_deliveries(video_id,cutter_id,editor_id,code,title,account_name,cutter_name,cut_level,base_units,extra_units,due_rough,late_exempt_reason,submitted_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,datetime('now','+8 hours')) ON CONFLICT(video_id) DO NOTHING`,
    v.id, v.cutter_id, v.editor_id, v.code, v.title, v.account_name ?? null, v.cutter_name ?? null,
    v.cut_level, base, v.extra_units, v.due_rough, v.late_exempt_reason ?? null);
}
export function cutterRange(uid: number, start: string, end: string) {
  const deliveries = all<Delivery>("SELECT * FROM work_deliveries WHERE cutter_id=? AND date(submitted_at) BETWEEN ? AND ? ORDER BY submitted_at DESC", uid, start, end);
  const eligible = deliveries.filter((v) => v.due_rough && !v.late_exempt_reason);
  const onTime = eligible.filter((v) => v.submitted_at.slice(0, 10) <= v.due_rough!).length;
  const rejects = all<{ reason: string; n: number }>(`SELECT reason,count(*) n FROM reviews
    WHERE node='成片审核' AND status='打回' AND cutter_id_snapshot=? AND reason LIKE '剪辑责任-%'
      AND (recheck IS NULL OR recheck!='免责') AND date(done_at) BETWEEN ? AND ? GROUP BY reason ORDER BY n DESC`, uid, start, end);
  return { deliveries, delivered: deliveries.length,
    baseUnits: deliveries.reduce((n, v) => n + v.base_units, 0), extraUnits: deliveries.reduce((n, v) => n + v.extra_units, 0),
    units: deliveries.reduce((n, v) => n + v.base_units + v.extra_units, 0),
    eligible: eligible.length, onTime, late: eligible.length - onTime,
    missingDue: deliveries.filter((v) => !v.due_rough).length, exempt: deliveries.filter((v) => !!v.late_exempt_reason).length,
    onTimeRate: eligible.length ? onTime / eligible.length : null,
    rework: rejects.reduce((n, r) => n + r.n, 0), reworkReason: rejects[0]?.reason.replace("剪辑责任-", "") ?? null,
    ideas: get<{ n: number }>("SELECT count(*) n FROM ideas WHERE submitter_id=? AND date(created_at) BETWEEN ? AND ?", uid, start, end)!.n };
}
