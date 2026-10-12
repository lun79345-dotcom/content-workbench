import { cutterRange } from "./workload";
import { all, get } from "./db";
import { weekRange } from "./rules";

export type EditorWeek = { produced: number; persona: number; drama: number; distRate: number | null; reserve: number; ideas: number;
  best: { title: string; plays: number } | null; worst: { title: string; plays: number } | null };
export type CutterWeek = { delivered: number; onTimeRate: number | null; rework: number; reworkReason: string | null; ideas: number; units: number; baseUnits: number; extraUnits: number; eligible: number; missingDue: number; exempt: number };

export function editorWeek(uid: number, week: string): EditorWeek {
  const [s, e] = weekRange(week);
  const pub = all<{ id: number; title: string; kind: string; douyin_url: string | null; wechat_url: string | null; plays: number | null }>(`
    SELECT v.id, v.title, a.kind, v.douyin_url, v.wechat_url,
      (SELECT sum(plays) FROM metrics m WHERE m.video_id=v.id AND m.platform IN ('douyin','wechat') AND m.checkpoint='d7') plays
    FROM videos v JOIN accounts a ON a.id=v.account_id
    WHERE v.editor_id=? AND v.published_at BETWEEN ? AND ?`, uid, s, e);
  const withPlays = pub.filter((p) => p.plays != null).sort((a, b) => b.plays! - a.plays!);
  return {
    produced: pub.length,
    persona: pub.filter((p) => p.kind === "人设号").length,
    drama: pub.filter((p) => p.kind === "剧情号").length,
    distRate: pub.length ? pub.filter((p) => p.douyin_url && p.wechat_url).length / pub.length : null,
    reserve: get<{ n: number }>("SELECT count(*) n FROM videos WHERE editor_id=? AND archived_at IS NULL AND stage IN ('拍摄','剪辑','成片审核','待发布')", uid)!.n,
    ideas: get<{ n: number }>("SELECT count(*) n FROM ideas WHERE submitter_id=? AND date(created_at) BETWEEN ? AND ?", uid, s, e)!.n,
    best: withPlays[0] ? { title: withPlays[0].title, plays: withPlays[0].plays! } : null,
    worst: withPlays.length > 1 ? { title: withPlays.at(-1)!.title, plays: withPlays.at(-1)!.plays! } : null,
  };
}

export function cutterWeek(uid: number, week: string): CutterWeek {
  const [s, e] = weekRange(week);
  return cutterRange(uid, s, e);
}
