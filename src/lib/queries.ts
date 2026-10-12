import { all, get } from "./db";
import { getSetting, type VideoRow } from "./rules";

export const VIDEO_SELECT = `
  SELECT v.*, a.name account_name, a.new_since account_new_since,
         e.name editor_name, c.name cutter_name
  FROM videos v
  LEFT JOIN accounts a ON a.id=v.account_id
  LEFT JOIN users e ON e.id=v.editor_id
  LEFT JOIN users c ON c.id=v.cutter_id`;

export function getVideo(id: number) {
  return get<VideoRow>(`${VIDEO_SELECT} WHERE v.id=?`, id);
}
export function listVideos(where = "1=1", ...args: unknown[]) {
  return all<VideoRow>(`${VIDEO_SELECT} WHERE v.archived_at IS NULL AND (${where}) ORDER BY COALESCE(v.publish_date,'9999'), v.id`, ...args);
}

export type Person = { id: number; name: string; role: string };
export function people(role?: string) {
  const bound = process.env.FEISHU_APP_ID && process.env.FEISHU_APP_SECRET ? " AND feishu_open_id IS NOT NULL" : "";
  return role
    ? all<Person>(`SELECT id,name,role FROM users WHERE role=?${bound} ORDER BY id`, role)
    : all<Person>(`SELECT id,name,role FROM users WHERE role IN ('boss','editor','cutter')${bound} ORDER BY id`);
}
export type Account = { id: number; name: string; kind: string; new_since: string | null; editor_id: number | null; douyin_home: string | null; wechat_home: string | null; xhs_home: string | null };
export function accounts() {
  return all<Account>("SELECT * FROM accounts ORDER BY sort, id");
}

/** 当前轮值组长（脚本审核人） */
export function leaderId(): number | null {
  const v = getSetting("leader_id");
  const bound = process.env.FEISHU_APP_ID && process.env.FEISHU_APP_SECRET ? " AND feishu_open_id IS NOT NULL" : "";
  return v ? get<{ id: number }>(`SELECT id FROM users WHERE id=? AND role='editor'${bound}`, Number(v))?.id ?? null : null;
}
/** 某条视频的脚本审核人：轮值组长；组长审自己的视频时改由老板审 */
export function scriptReviewer(editorId: number) {
  const l = leaderId();
  if (l && l !== editorId) return l;
  return bossId();
}
export function bossId() {
  return get<{ id: number }>(`SELECT id FROM users WHERE role='boss'${process.env.FEISHU_APP_ID && process.env.FEISHU_APP_SECRET ? " AND feishu_open_id IS NOT NULL" : ""} ORDER BY id LIMIT 1`)?.id ?? null;
}
