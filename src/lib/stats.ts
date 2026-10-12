import { all, get } from "./db";
import { accounts } from "./queries";
import { getRules, isNewAccountAt, tierIndex, monthOf, today, playTotals, bonusPlatforms, type BonusBasis } from "./rules";

/** 每条已发布视频的数据行（对应原「单条视频数据记录」） */
export type DataRow = {
  id: number; code: string; title: string; published_at: string; account_id: number; account_name: string; new_since: string | null;
  content_type: string | null; editor_id: number; editor_name: string; cutter_id: number | null; cutter_name: string | null; cut_level: string; extra_units: number;
  analysis: string | null; bonus_snapshot: string | null; work_units: number | null;
  douyin_url: string | null; wechat_url: string | null; xhs_url: string | null;
  dy7: number | null; wx7: number | null; fans7: number | null; dy30: number | null; wx30: number | null; xhs_likes: number | null; xhs_collects: number | null;
};

export function dataRows(month?: string, range?: { accountId: number; start: string; end: string }): DataRow[] {
  return all<DataRow>(`
    SELECT v.id, v.code, v.title, v.published_at, v.account_id, a.name account_name, a.new_since, v.content_type,
      v.editor_id, e.name editor_name, v.cutter_id, c.name cutter_name, v.cut_level, v.extra_units, v.analysis, v.bonus_snapshot, v.douyin_url,v.wechat_url,v.xhs_url,
      (SELECT base_units+extra_units FROM work_deliveries w WHERE w.video_id=v.id) work_units,
      (SELECT plays FROM metrics WHERE video_id=v.id AND checkpoint='d7' AND platform='douyin') dy7,
      (SELECT plays FROM metrics WHERE video_id=v.id AND checkpoint='d7' AND platform='wechat') wx7,
      (SELECT sum(fans) FROM metrics WHERE video_id=v.id AND checkpoint='d7') fans7,
      (SELECT plays FROM metrics WHERE video_id=v.id AND checkpoint='d30' AND platform='douyin') dy30,
      (SELECT plays FROM metrics WHERE video_id=v.id AND checkpoint='d30' AND platform='wechat') wx30,
      (SELECT likes FROM metrics WHERE video_id=v.id AND platform='xhs' ORDER BY checkpoint='live' LIMIT 1) xhs_likes,
      (SELECT collects FROM metrics WHERE video_id=v.id AND platform='xhs' ORDER BY checkpoint='live' LIMIT 1) xhs_collects
    FROM videos v JOIN accounts a ON a.id=v.account_id LEFT JOIN users e ON e.id=v.editor_id LEFT JOIN users c ON c.id=v.cutter_id
    WHERE v.stage='已发布' ${month ? "AND substr(v.published_at,1,7)=?" : ""} ${range ? "AND v.account_id=? AND v.published_at BETWEEN ? AND ?" : ""}
    ORDER BY v.published_at DESC, v.id DESC`, ...(month ? [month] : []), ...(range ? [range.accountId, range.start, range.end] : []));
}
export function dataCheckpoint(x: DataRow, checkpoint: "d7" | "d30") {
  const basis: BonusBasis | null = x.bonus_snapshot ? JSON.parse(x.bonus_snapshot) : null;
  return playTotals(x, checkpoint === "d7" ? x.dy7 : x.dy30, checkpoint === "d7" ? x.wx7 : x.wx30, bonusPlatforms(basis));
}

export function bonusByVideo() {
  const rows = all<{ video_id: number; kind: string; s: number }>(
    "SELECT video_id, kind, sum(amount) s FROM bonuses WHERE auto=1 GROUP BY video_id, kind");
  const map = new Map<number, { hit: number; diff: number }>();
  for (const r of rows) {
    const x = map.get(r.video_id) ?? { hit: 0, diff: 0 };
    if (r.kind === "爆款奖") x.hit += r.s; else x.diff += r.s;
    map.set(r.video_id, x);
  }
  return map;
}

/** 账号月度汇总（对应原「账号月度汇总」） */
export function accountMonthly(month: string) {
  const r = getRules();
  const rows = dataRows(month);
  const prev = prevMonth(month);
  const prevRows = dataRows(prev);
  const targets = all<{ account_id: number; target_plays: number }>("SELECT account_id, target_plays FROM targets WHERE month=?", month);
  return accounts().map((a) => {
    const vs = rows.filter((x) => x.account_id === a.id);
    const plays = vs.reduce((s, x) => s + dataCheckpoint(x, "d7").total, 0);
    const fans = vs.reduce((s, x) => s + (x.fans7 ?? 0), 0);
    const hits = vs.filter((x) => {
      const c = dataCheckpoint(x, "d7"), basis: BonusBasis | null = x.bonus_snapshot ? JSON.parse(x.bonus_snapshot) : null;
      const rules = basis?.rules ?? r;
      return c.complete && tierIndex(c.total, isNewAccountAt(basis ? basis.new_since : a.new_since, x.published_at, rules), rules) >= 0;
    }).length;
    const prevPlays = prevRows.filter((x) => x.account_id === a.id).reduce((s, x) => s + dataCheckpoint(x, "d7").total, 0);
    const target = targets.find((t) => t.account_id === a.id)?.target_plays ?? null;
    const editor = get<{ name: string }>("SELECT name FROM users WHERE id=?", a.editor_id)?.name ?? "—";
    return {
      account: a, editor, isNew: isNewAccountAt(a.new_since, month + "-15", r),
      count: vs.length, plays, fans, hits, target, rate: target ? plays / target : null,
      suggestNext: plays ? Math.round(plays * r.target_growth) : null,
      suggestThis: prevPlays ? Math.round(prevPlays * r.target_growth) : null,
    };
  });
}

export function prevMonth(m: string) {
  const [y, mo] = m.split("-").map(Number);
  return mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, "0")}`;
}
export function recentMonths(n = 6, from = monthOf(today())) {
  const out = [from];
  while (out.length < n) out.push(prevMonth(out[out.length - 1]));
  return out;
}
