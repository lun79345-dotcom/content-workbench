"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { get, run, nextCode } from "@/lib/db";
import { requireUser, type User } from "@/lib/auth";
import { notify } from "@/lib/notify";
import { getVideo, scriptReviewer } from "@/lib/queries";
import { STAGES, recalcVideoBonus, today, isFrozen, type Stage, type VideoRow } from "@/lib/rules";

const s = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return v == null || v === "" ? null : String(v).trim();
};
const n = (fd: FormData, k: string) => {
  const v = s(fd, k);
  return v == null ? null : Number(v.replace(/[,，\s]/g, ""));
};

function canEdit(u: User, v: VideoRow) {
  return u.role === "boss" || u.id === v.editor_id || u.id === v.cutter_id;
}
function moveStage(v: VideoRow, to: Stage, uid: number) {
  run("UPDATE videos SET stage=? WHERE id=?", to, v.id);
  run("INSERT INTO stage_log(video_id, from_stage, to_stage, user_id) VALUES(?,?,?,?)", v.id, v.stage, to, uid);
}
function refresh(id?: number) {
  revalidatePath("/", "layout");
  if (id) revalidatePath(`/videos/${id}`);
}

const VIDEO_FIELDS = ["title", "account_id", "editor_id", "cutter_id", "content_type", "cut_level", "extra_units",
  "due_script", "due_shoot", "due_rough", "due_review", "publish_date", "brief", "note", "douyin_url", "wechat_url", "xhs_url", "analysis"] as const;
const NUM_FIELDS = new Set(["account_id", "editor_id", "cutter_id", "extra_units"]);

export async function createVideo(fd: FormData) {
  const me = await requireUser();
  const code = nextCode("videos", "V");
  const vals = VIDEO_FIELDS.map((f) => (NUM_FIELDS.has(f) ? n(fd, f) : s(fd, f)));
  const ideaId = n(fd, "idea_id");
  const r = run(
    `INSERT INTO videos(code, ${VIDEO_FIELDS.join(",")}, idea_id, created_by) VALUES(?, ${VIDEO_FIELDS.map(() => "?").join(",")}, ?, ?)`,
    code, ...vals.map((x, i) => (VIDEO_FIELDS[i] === "extra_units" ? x ?? 0 : x)), ideaId, me.id);
  const id = Number(r.lastInsertRowid);
  if (ideaId) run("UPDATE ideas SET status='已排期', video_id=? WHERE id=?", id, ideaId);
  const v = getVideo(id)!;
  if (v.editor_id !== me.id) await notify(v.editor_id, `新排期：${code}《${v.title}》，脚本截止 ${v.due_script ?? "未定"}`, `/videos/${id}`);
  if (v.cutter_id) await notify(v.cutter_id, `新排期：${code}《${v.title}》，初剪截止 ${v.due_rough ?? "未定"}`, `/videos/${id}`);
  refresh();
  redirect(`/videos/${id}`);
}

export async function updateVideo(fd: FormData) {
  const me = await requireUser();
  const id = n(fd, "id")!;
  const v = getVideo(id);
  if (!v || !canEdit(me, v)) return;
  const fields = VIDEO_FIELDS.filter((f) => fd.has(f));
  if (!fields.length) return;
  run(`UPDATE videos SET ${fields.map((f) => `${f}=?`).join(",")} WHERE id=?`,
    ...fields.map((f) => (NUM_FIELDS.has(f) ? n(fd, f) : s(fd, f))), id);
  // 冻结期内编导改需求：提醒剪辑，并留痕
  if (isFrozen(v) && me.id === v.editor_id && (fd.has("brief") || fd.has("title"))) {
    run("UPDATE videos SET note=COALESCE(note,'') || ? WHERE id=?", `\n[${today()}] 冻结期内改需求（不计剪辑拖期）`, id);
    await notify(v.cutter_id, `⚠️ ${v.code} 在冻结期内被修改需求（不计你的拖期）`, `/videos/${id}`);
  }
  refresh(id);
}

export async function deleteVideo(fd: FormData) {
  const me = await requireUser();
  const id = n(fd, "id")!;
  if (me.role !== "boss") return;
  for (const t of ["reviews", "metrics", "stage_log"]) run(`DELETE FROM ${t} WHERE video_id=?`, id);
  run("DELETE FROM bonuses WHERE video_id=? AND auto=1", id);
  run("UPDATE ideas SET status='入库', video_id=NULL WHERE video_id=?", id);
  run("DELETE FROM videos WHERE id=?", id);
  refresh();
  redirect("/board");
}

/** 推进到下一阶段（含提交审核、交剪辑等动作） */
export async function advance(fd: FormData) {
  const me = await requireUser();
  const id = n(fd, "id")!;
  const v = getVideo(id);
  if (!v || !canEdit(me, v)) return;
  const link = `/videos/${id}`;
  switch (v.stage) {
    case "选题":
      moveStage(v, "脚本", me.id);
      break;
    case "脚本": {
      const reviewer = scriptReviewer(v.editor_id);
      run("INSERT INTO reviews(video_id,node,submitter_id,reviewer_id) VALUES(?,?,?,?)", id, "脚本审核", me.id, reviewer);
      moveStage(v, "脚本审核", me.id);
      await notify(reviewer, `待你审脚本：${v.code}《${v.title}》（4小时内）`, "/reviews");
      break;
    }
    case "拍摄":
      if (!v.cutter_id) throw new Error("请先指定剪辑");
      moveStage(v, "剪辑", me.id);
      await notify(v.cutter_id, `素材已交付：${v.code}《${v.title}》，初剪截止 ${v.due_rough ?? "未定"}`, link);
      break;
    case "剪辑":
      run("INSERT INTO reviews(video_id,node,submitter_id,reviewer_id) VALUES(?,?,?,?)", id, "成片审核", me.id, v.editor_id);
      moveStage(v, "成片审核", me.id);
      await notify(v.editor_id, `待你审成片：${v.code}《${v.title}》`, "/reviews");
      break;
  }
  refresh(id);
}

/** 老板/编导手动调整阶段（回退或跳过） */
export async function setStage(fd: FormData) {
  const me = await requireUser();
  const id = n(fd, "id")!;
  const to = s(fd, "stage") as Stage;
  const v = getVideo(id);
  if (!v || !STAGES.includes(to) || !(me.role === "boss" || me.id === v.editor_id)) return;
  run("UPDATE reviews SET status='已撤回', done_at=datetime('now','localtime') WHERE video_id=? AND status='待审'", id);
  moveStage(v, to, me.id);
  refresh(id);
}

export async function decideReview(fd: FormData) {
  const me = await requireUser();
  const rid = n(fd, "review_id")!;
  const pass = s(fd, "decision") === "pass";
  const rv = get<{ id: number; video_id: number; node: string; reviewer_id: number; status: string }>("SELECT * FROM reviews WHERE id=?", rid);
  if (!rv || rv.status !== "待审" || !(me.id === rv.reviewer_id || me.role === "boss")) return;
  const v = getVideo(rv.video_id)!;
  const reason = s(fd, "reason");
  if (!pass && !reason) throw new Error("打回必须选择原因归类");
  run("UPDATE reviews SET status=?, reason=?, comment=?, reviewer_id=?, done_at=datetime('now','localtime') WHERE id=?",
    pass ? "通过" : "打回", pass ? null : reason, s(fd, "comment"), me.id, rid);
  const link = `/videos/${v.id}`;
  if (rv.node === "脚本审核") {
    moveStage(v, pass ? "拍摄" : "脚本", me.id);
    await notify(v.editor_id, pass ? `脚本通过：${v.code}，可以开拍` : `脚本被打回：${v.code}（${reason}）`, link);
  } else {
    moveStage(v, pass ? "待发布" : "剪辑", me.id);
    await notify(v.cutter_id, pass ? `成片通过：${v.code}《${v.title}》` : `成片被打回：${v.code}（${reason}）${s(fd, "comment") ?? ""}`, link);
  }
  refresh(v.id);
}

export async function setRecheck(fd: FormData) {
  const me = await requireUser();
  if (me.role === "cutter") return;
  run("UPDATE reviews SET recheck=? WHERE id=?", s(fd, "recheck"), n(fd, "review_id"));
  refresh();
}

export async function publishVideo(fd: FormData) {
  const me = await requireUser();
  const id = n(fd, "id")!;
  const v = getVideo(id);
  if (!v || !canEdit(me, v)) return;
  const date = s(fd, "published_at") ?? today();
  run("UPDATE videos SET published_at=?, douyin_url=?, wechat_url=?, xhs_url=? WHERE id=?", date, s(fd, "douyin_url"), s(fd, "wechat_url"), s(fd, "xhs_url"), id);
  moveStage(v, "已发布", me.id);
  if (v.idea_id) run("UPDATE ideas SET status='已拍' WHERE id=?", v.idea_id);
  refresh(id);
}

/** 登记某个节点（7天/30天）的播放数据 */
export async function saveMetrics(fd: FormData) {
  const me = await requireUser();
  const id = n(fd, "id")!;
  const cp = s(fd, "checkpoint")!;
  for (const p of ["douyin", "wechat", "xhs"]) {
    const plays = n(fd, `${p}_plays`), fans = n(fd, `${p}_fans`), likes = n(fd, `${p}_likes`), collects = n(fd, `${p}_collects`);
    if ([plays, fans, likes, collects].every((x) => x == null)) continue;
    run(`INSERT INTO metrics(video_id,checkpoint,platform,plays,fans,likes,collects,source,updated_by)
         VALUES(?,?,?,?,?,?,?,'manual',?)
         ON CONFLICT(video_id,checkpoint,platform) DO UPDATE SET
           plays=COALESCE(excluded.plays,plays), fans=COALESCE(excluded.fans,fans),
           likes=COALESCE(excluded.likes,likes), collects=COALESCE(excluded.collects,collects),
           source='manual', updated_by=excluded.updated_by, updated_at=datetime('now','localtime')`,
      id, cp, p, plays, fans, likes, collects, me.id);
  }
  recalcVideoBonus(id);
  refresh(id);
}
