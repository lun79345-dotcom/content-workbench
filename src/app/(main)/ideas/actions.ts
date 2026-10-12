"use server";
import { UserFacingError, actionResult } from "@/lib/action-errors";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { audit, get, nextCode, run, transaction } from "@/lib/db";
import { notify } from "@/lib/notify";

import { text as s, id, choice, number, url } from "@/lib/validation";
import { IDEA_SOURCES, IDEA_STATUS, IDEA_KINDS } from "@/lib/rules";

export async function submitIdea(fd: FormData) {
  const me = await requireUser();
  const source = choice(s(fd, "source") ?? "内部拆解", IDEA_SOURCES, "创意来源"), account = number(fd, "account_id", { min: 1, integer: true }), content = s(fd, "content", true);
  const kind = s(fd, "kind"); if (kind) choice(kind, [...IDEA_KINDS, "梗"], "创意类型");
  if (account && !get("SELECT id FROM accounts WHERE id=?", account)) throw new UserFacingError("账号不存在");
  transaction(() => {
    const iid = Number(run("INSERT INTO ideas(code,submitter_id,submitter_name,source,account_id,kind,content,ref_url) VALUES(?,?,?,?,?,?,?,?)",
      nextCode("ideas", "C"), me.id, me.name, source, account, kind, content, url(s(fd, "ref_url"))).lastInsertRowid);
    audit(me.id, "idea", iid, "投递创意", null, { source, content });
  });
  revalidatePath("/ideas");
}

export async function gradeIdea(fd: FormData) {
  const me = await requireUser();
  if (!["boss", "editor"].includes(me.role)) throw new UserFacingError("无评审权限");
  const iid = id(fd);
  const before = get<{ grade: string | null; submitter_id: number | null; code: string }>("SELECT grade, submitter_id, code FROM ideas WHERE id=?", iid);
  if (!before) throw new UserFacingError("创意不存在");
  const grade = s(fd, "grade"); if (grade) choice(grade, ["S", "A", "B", "C"], "创意等级");
  const status = choice(s(fd, "status") ?? "待评", IDEA_STATUS, "创意状态");
  const video = get<{ stage: string; archived_at: string | null }>("SELECT v.stage,v.archived_at FROM videos v JOIN ideas i ON i.video_id=v.id WHERE i.id=?", iid);
  if (["已排期", "已拍"].includes(status) && (!video || video.archived_at || (status === "已拍" && video.stage !== "已发布"))) throw new UserFacingError("排期与已拍状态应由视频流程生成");
  if (video && !video.archived_at && status !== (video.stage === "已发布" ? "已拍" : "已排期")) throw new UserFacingError("此创意已关联视频，排期状态由视频流程更新");
  transaction(() => { run("UPDATE ideas SET grade=?,status=?,note=? WHERE id=?", grade, status, s(fd, "note"), iid); audit(me.id, "idea", iid, "评审创意", before, { grade, status }); });
  if (before && grade && grade !== before.grade && (grade === "S" || grade === "A")) {
    await notify(before.submitter_id, `你投的创意 ${before.code} 被评为 ${grade} 级`, "/ideas");
  }
  revalidatePath("/ideas");
}

export async function submitIdeaForm(fd: FormData) { return actionResult(() => submitIdea(fd)); }

export async function gradeIdeaForm(fd: FormData) { return actionResult(() => gradeIdea(fd)); }
