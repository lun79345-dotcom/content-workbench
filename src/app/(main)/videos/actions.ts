"use server";
import { UserFacingError, actionResult } from "@/lib/action-errors";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { all, audit, get, run, nextCode, transaction } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { notify } from "@/lib/notify";
import { getVideo, leaderId, scriptReviewer, bossId } from "@/lib/queries";
import { STAGES, REJECT_REASONS, DUE_LABEL, recalcVideoBonus, freezeBonusBasis, getRules, today, diffDays, isFrozen, type Stage, type VideoRow } from "@/lib/rules";
import { canAdvanceVideo, canManageVideo, canRecheck } from "@/lib/permissions";
import { recordDelivery } from "@/lib/workload";
import { usablePerson } from "@/lib/admin";
import { parsePublicationText, PUBLICATION_PLATFORMS, PUBLICATION_LABELS } from "@/lib/publication-input";
import { text as s, number as n, id as parseId, choice, date, url } from "@/lib/validation";

function editable(id: number) {
  const v = getVideo(id);
  if (!v || v.archived_at) throw new UserFacingError("视频不存在或已归档");
  return v;
}
function moveStage(v: VideoRow, to: Stage, uid: number) {
  run("UPDATE videos SET stage=?,revision=revision+1 WHERE id=?", to, v.id);
  run("INSERT INTO stage_log(video_id, from_stage, to_stage, user_id) VALUES(?,?,?,?)", v.id, v.stage, to, uid);
}
function currentRevision(fd: FormData, v: VideoRow) {
  if (n(fd, "revision", { integer: true }) !== v.revision) throw new UserFacingError("此记录已有更新，请刷新页面后重试");
}
function refresh(id?: number) {
  revalidatePath("/", "layout");
  if (id) revalidatePath(`/videos/${id}`);
}
const FIELDS = ["title", "account_id", "editor_id", "cutter_id", "content_type", "cut_level", "extra_units", "due_script", "due_shoot", "due_rough", "due_review", "publish_date", "brief", "note", "douyin_url", "wechat_url", "xhs_url", "analysis"] as const;
function values(fd: FormData, old?: VideoRow): Record<string, string | number | null> {
  const result: Record<string, string | number | null> = {};
  for (const field of FIELDS) {
    result[field] = old && !fd.has(field) ? old[field] : ["account_id", "editor_id", "cutter_id", "extra_units"].includes(field) ? n(fd, field, { integer: field !== "extra_units", max: field === "extra_units" ? 100 : 1e12 }) : s(fd, field);
    if (field.startsWith("due_") || field === "publish_date") date(result[field] as string | null, DUE_LABEL[field]);
    if (field.endsWith("_url")) result[field] = url(result[field] as string | null);
  }
  if (!result.title) throw new UserFacingError("请填写标题");
  if (!get("SELECT id FROM accounts WHERE id=?", result.account_id)) throw new UserFacingError("请选择有效账号");
  for (const [field, role] of [["editor_id", "editor"], ["cutter_id", "cutter"]]) {
    if (field === "cutter_id" && !result[field]) continue;
    const bound = process.env.FEISHU_APP_ID && process.env.FEISHU_APP_SECRET ? " AND feishu_open_id IS NOT NULL" : "";
    if (!(old && result[field] === old[field as "editor_id" | "cutter_id"]) && !get(`SELECT id FROM users WHERE id=? AND role=?${bound}`, result[field], role)) throw new UserFacingError(`请选择已启用的${role === "editor" ? "编导" : "剪辑"}`);
  }
  if (!(old && result.cut_level === old.cut_level && get("SELECT id FROM work_deliveries WHERE video_id=?", old.id))) choice(result.cut_level as string | null, Object.keys(getRules().cut_levels), "剪辑定档");
  result.extra_units ??= 0;
  const deadlines = ["due_script", "due_shoot", "due_rough", "due_review", "publish_date"].filter((f) => result[f]);
  for (let i = 1; i < deadlines.length; i++) {
    const field = deadlines[i], previous = deadlines[i - 1];
    if (String(result[field]) < String(result[previous])) throw new UserFacingError(`各阶段截止日期应按流程先后排列：${DUE_LABEL[field]}（${result[field]}）不能早于${DUE_LABEL[previous]}（${result[previous]}）`);
  }
  return result;
}

export async function createVideo(fd: FormData) {
  const me = await requireUser();
  if (!["boss", "editor"].includes(me.role)) throw new UserFacingError("只有编导和老板可以创建视频");
  if (!s(fd, "editor_id")) {
    const assigned = me.role === "editor" ? me.id : get<{ editor_id: number | null }>("SELECT editor_id FROM accounts WHERE id=?", n(fd, "account_id"))?.editor_id;
    if (assigned && usablePerson(assigned, "editor")) fd.set("editor_id", String(assigned));
  }
  if (!s(fd, "cut_level")) {
    const levels = Object.keys(getRules().cut_levels);
    fd.set("cut_level", levels.includes("常规") ? "常规" : levels[0] ?? "");
  }
  const vals = values(fd);
  if (me.role !== "boss" && vals.editor_id !== me.id) throw new UserFacingError("只能创建自己负责的视频");
  const ideaId = n(fd, "idea_id", { min: 1, integer: true });
  const id = transaction(() => {
    if (ideaId && !get("SELECT id FROM ideas WHERE id=? AND video_id IS NULL", ideaId)) throw new UserFacingError("创意已排期或不存在");
    const code = nextCode("videos", "V");
    const id = Number(run(`INSERT INTO videos(code,${FIELDS.join(",")},idea_id,created_by) VALUES(?,${FIELDS.map(() => "?").join(",")},?,?)`, code, ...FIELDS.map((f) => vals[f]), ideaId, me.id).lastInsertRowid);
    if (ideaId) run("UPDATE ideas SET status='已排期', video_id=? WHERE id=?", id, ideaId);
    audit(me.id, "video", id, "创建", null, vals);
    return id;
  });
  const v = getVideo(id)!;
  if (v.editor_id !== me.id) await notify(v.editor_id, `新排期：${v.code}《${v.title}》，脚本截止 ${v.due_script ?? "未定"}`, `/videos/${id}`);
  if (v.cutter_id) await notify(v.cutter_id, `新排期：${v.code}《${v.title}》，初剪截止 ${v.due_rough ?? "未定"}`, `/videos/${id}`);
  refresh(); redirect(`/videos/${id}`);
}

export async function updateVideo(fd: FormData) {
  const me = await requireUser(), id = parseId(fd);
  let changedDemand = false;
  let resetStage: Stage | null = null;
  transaction(() => {
    const v = editable(id);
    if (!canManageVideo(me, v)) {
      if (me.role !== "cutter" || me.id !== v.cutter_id) throw new UserFacingError("无修改权限");
      if (FIELDS.some((f) => f !== "note" && fd.has(f))) throw new UserFacingError("考核字段需要编导或老板确认，请提交调整申请");
      currentRevision(fd, v);
      run("UPDATE videos SET note=?,revision=revision+1 WHERE id=?", s(fd, "note"), id);
      audit(me.id, "video", id, "剪辑备注", { note: v.note }, { note: s(fd, "note") }); return;
    }
    currentRevision(fd, v);
    const vals = values(fd, v);
    const changed = FIELDS.filter((f) => vals[f] !== v[f]);
    if (!changed.length) return;
    const delivery = get<{ cut_level: string; base_units: number }>("SELECT cut_level,base_units FROM work_deliveries WHERE video_id=?", id);
    const paid = get("SELECT id FROM bonuses WHERE video_id=? AND published=1 LIMIT 1", id);
    if (paid && changed.some((f) => ["account_id", "editor_id", "cutter_id"].includes(f))) throw new UserFacingError("已有已公示奖金，不能更换归属人员或账号");
    if (delivery && changed.some((f) => ["cutter_id", "editor_id"].includes(f))) throw new UserFacingError("已计入工作量，不能更换交付归属人员");
    const assessmentChanged = delivery && changed.some((f) => ["cut_level", "extra_units", "due_rough"].includes(f));
    const reason = s(fd, "change_reason");
    if (assessmentChanged && !reason) throw new UserFacingError("交付后调整考核字段，请填写调整原因");
    if (paid) freezeBonusBasis(id);
    run(`UPDATE videos SET ${changed.map((f) => `${f}=?`).join(",")},revision=revision+1 WHERE id=?`, ...changed.map((f) => vals[f]), id);
    if (assessmentChanged) run("UPDATE work_deliveries SET cut_level=?,base_units=?,extra_units=?,due_rough=? WHERE video_id=?", vals.cut_level, delivery?.cut_level === vals.cut_level ? delivery.base_units : getRules().cut_levels[String(vals.cut_level)], vals.extra_units, vals.due_rough, id);
    const coreChanged = changed.some((f) => f === "brief" || f === "title");
    changedDemand = (isFrozen(v) || isFrozen({ ...v, publish_date: vals.publish_date as string | null })) && coreChanged;
    if (changedDemand) {
      const reason = `${today()} 冻结期内修改需求`;
      run("UPDATE videos SET late_exempt_reason=? WHERE id=?", reason, id);
      run("UPDATE work_deliveries SET late_exempt_reason=? WHERE video_id=?", reason, id);
    }
    if (coreChanged && !v.published_at) {
      resetStage = v.stage === "脚本审核" ? "脚本" : ["成片审核", "待发布"].includes(v.stage) ? "剪辑" : null;
      if (resetStage) {
        run("UPDATE reviews SET status='已撤回',comment='核心需求已修改，请重新提交审核',done_at=datetime('now','+8 hours') WHERE video_id=? AND status='待审'", id);
        moveStage(v, resetStage, me.id);
        audit(me.id, "video", id, "需求变更重新审核", { stage: v.stage }, { stage: resetStage }, "标题或需求说明已修改");
      }
    }
    audit(me.id, "video", id, assessmentChanged ? "调整工作量" : "修改需求单", v, { ...vals, late_exempt_reason: changedDemand ? "冻结后改需求" : v.late_exempt_reason }, reason);
    recalcVideoBonus(id);
  });
  if (changedDemand) await notify(getVideo(id)!.cutter_id, `⚠️ ${getVideo(id)!.code} 在冻结期内被修改需求（不计你的拖期）`, `/videos/${id}`);
  if (resetStage) {
    const v = getVideo(id)!;
    await notify(resetStage === "脚本" ? v.editor_id : v.cutter_id, `${v.code} 核心需求已修改，请处理后重新提交审核`, `/videos/${id}`);
  }
  refresh(id);
}

/** Archive retains metrics, reviews, delivery credit and every bonus entry. */
export async function deleteVideo(fd: FormData) {
  const me = await requireUser();
  if (me.role !== "boss") throw new UserFacingError("仅老板可归档");
  const id = parseId(fd);
  transaction(() => {
    const v = editable(id);
    run("UPDATE videos SET archived_at=datetime('now','+8 hours'),revision=revision+1 WHERE id=?", id);
    if (!v.published_at) run("UPDATE ideas SET status='入库',video_id=NULL WHERE video_id=?", id);
    run("UPDATE reviews SET status='已撤回',done_at=datetime('now','+8 hours') WHERE video_id=? AND status='待审'", id);
    run("UPDATE workload_requests SET status='rejected',comment='视频已归档',done_at=datetime('now','+8 hours') WHERE video_id=? AND status='pending'", id);
    audit(me.id, "video", id, "归档", { stage: v.stage }, { archived: true });
  });
  refresh(); redirect("/board");
}

export async function advance(fd: FormData) {
  const me = await requireUser(), id = parseId(fd);
  const notification = transaction(() => {
    const v = editable(id);
    if (!canAdvanceVideo(me, v)) throw new UserFacingError("当前阶段无推进权限");
    if (get("SELECT id FROM reviews WHERE video_id=? AND status='待审'", id)) throw new UserFacingError("此视频已有待审记录");
    currentRevision(fd, v);
    if (v.stage === "选题") { moveStage(v, "脚本", me.id); return null; }
    if (v.stage === "脚本") {
      const reviewer = scriptReviewer(v.editor_id);
      if (!reviewer) throw new UserFacingError("请先配置有效审核人");
      run("INSERT INTO reviews(video_id,node,submitter_id,reviewer_id,cutter_id_snapshot,editor_id_snapshot) VALUES(?,'脚本审核',?,?,?,?)", id, me.id, reviewer, v.cutter_id, v.editor_id);
      moveStage(v, "脚本审核", me.id); return { uid: reviewer, text: `待你审脚本：${v.code}《${v.title}》（4小时内）` };
    }
    if (v.stage === "拍摄") {
      if (!usablePerson(v.cutter_id, "cutter")) throw new UserFacingError("请先指定已启用的有效剪辑");
      moveStage(v, "剪辑", me.id); return { uid: v.cutter_id, text: `素材已交付：${v.code}《${v.title}》，初剪截止 ${v.due_rough ?? "未定"}` };
    }
    if (v.stage === "剪辑") {
      if (!get("SELECT id FROM work_deliveries WHERE video_id=?", id) && !usablePerson(v.cutter_id, "cutter")) throw new UserFacingError("请先指定已启用的有效剪辑");
      const reviewer = usablePerson(v.editor_id, "editor") ? v.editor_id : bossId();
      if (!reviewer) throw new UserFacingError("请先配置有效审核人");
      recordDelivery(v);
      run("INSERT INTO reviews(video_id,node,submitter_id,reviewer_id,cutter_id_snapshot,editor_id_snapshot) VALUES(?,'成片审核',?,?,?,?)", id, me.id, reviewer, v.cutter_id, v.editor_id);
      moveStage(v, "成片审核", me.id); return { uid: reviewer, text: `待你审成片：${v.code}《${v.title}》` };
    }
    throw new UserFacingError("当前阶段不能继续推进");
  });
  if (notification) await notify(notification.uid, notification.text, `/videos/${id}`);
  refresh(id);
}

export async function setStage(fd: FormData) {
  const me = await requireUser(), id = parseId(fd);
  const to = choice(s(fd, "stage"), STAGES, "阶段"), reason = s(fd, "reason", true);
  transaction(() => {
    const v = editable(id);
    if (!canManageVideo(me, v)) throw new UserFacingError("无调整权限");
    if (v.published_at || !["选题", "脚本", "拍摄", "剪辑"].includes(to) || STAGES.indexOf(to) >= STAGES.indexOf(v.stage)) throw new UserFacingError("仅允许回退到前面的生产阶段；审核和发布请按流程完成");
    currentRevision(fd, v);
    run("UPDATE reviews SET status='已撤回',done_at=datetime('now','+8 hours') WHERE video_id=? AND status='待审'", id);
    moveStage(v, to, me.id); audit(me.id, "video", id, "回退阶段", { stage: v.stage }, { stage: to }, reason);
  }); refresh(id);
}

export async function decideReview(fd: FormData) {
  const me = await requireUser(), rid = parseId(fd, "review_id");
  const pass = choice(s(fd, "decision"), ["pass", "reject"], "审核结果") === "pass";
  const reason = pass ? null : choice(s(fd, "reason"), REJECT_REASONS, "打回原因");
  const comment = s(fd, "comment", !pass);
  const result = transaction(() => {
    const rv = get<{ video_id: number; node: Stage; reviewer_id: number; status: string }>("SELECT * FROM reviews WHERE id=?", rid);
    if (!rv || rv.status !== "待审" || !(me.id === rv.reviewer_id || me.role === "boss")) throw new UserFacingError("无审核权限或审核已完成");
    const v = editable(rv.video_id);
    if (v.stage !== rv.node) throw new UserFacingError("视频阶段已改变，请刷新");
    run("UPDATE reviews SET status=?,reason=?,comment=?,reviewer_id=?,done_at=datetime('now','+8 hours') WHERE id=?", pass ? "通过" : "打回", reason, comment, me.id, rid);
    moveStage(v, rv.node === "脚本审核" ? pass ? "拍摄" : "脚本" : pass ? "待发布" : "剪辑", me.id);
    audit(me.id, "review", rid, pass ? "通过" : "打回", rv, { reason, comment });
    return { id: v.id, uid: rv.node === "脚本审核" ? v.editor_id : v.cutter_id, text: `${rv.node}${pass ? "通过" : "被打回"}：${v.code}《${v.title}》${reason ? `（${reason}）${comment}` : ""}` };
  });
  await notify(result.uid, result.text, `/videos/${result.id}`); refresh(result.id);
}

export async function setRecheck(fd: FormData) {
  const me = await requireUser(), rid = parseId(fd, "review_id");
  if (!canRecheck(me, leaderId())) throw new UserFacingError("仅老板或轮值组长可复核");
  const recheck = choice(s(fd, "recheck"), ["确认归类", "免责"], "复核结果");
  transaction(() => {
    const rv = get<{ status: string }>("SELECT * FROM reviews WHERE id=?", rid);
    if (!rv || rv.status !== "打回") throw new UserFacingError("只能复核打回记录");
    run("UPDATE reviews SET recheck=?,recheck_by=? WHERE id=?", recheck, me.id, rid);
    audit(me.id, "review", rid, "复核", rv, { recheck });
  }); refresh();
}

export async function publishVideo(fd: FormData) {
  const me = await requireUser(), id = parseId(fd);
  const published = date(s(fd, "published_at") ?? today())!;
  if (published > today()) throw new UserFacingError("实际发布日期不能在未来");
  const pasted = parsePublicationText(s(fd, "publish_text") ?? "");
  if (pasted.invalid.length) throw new UserFacingError("分享内容中有格式不正确的链接，请检查后重试");
  const links = PUBLICATION_PLATFORMS.map((p) => {
    const manual = url(s(fd, `${p}_url`));
    if (!manual && pasted.links[p].length > 1) throw new UserFacingError(`${PUBLICATION_LABELS[p]}有多个链接，请选择这条视频的发布链接`);
    return manual ?? pasted.links[p][0] ?? null;
  });
  if (pasted.unknown.some((link) => !links.some((value) => value && new URL(value).href === link))) throw new UserFacingError("有无法识别的平台链接，请选择对应平台，或移除与发布无关的链接");
  if (!links.some(Boolean)) throw new UserFacingError("请登记至少一个平台的发布链接");
  transaction(() => {
    const v = editable(id);
    if (!canManageVideo(me, v) || v.stage !== "待发布" || v.published_at) throw new UserFacingError("仅负责人或老板可登记已过审、待发布的视频");
    currentRevision(fd, v);
    run("UPDATE videos SET published_at=?,douyin_url=?,wechat_url=?,xhs_url=? WHERE id=?", published, ...links, id);
    moveStage(v, "已发布", me.id);
    if (v.idea_id) run("UPDATE ideas SET status='已拍' WHERE id=?", v.idea_id);
    audit(me.id, "video", id, "登记发布", null, { published, links });
  }); refresh(id);
}

export async function saveMetrics(fd: FormData) {
  const me = await requireUser(), id = parseId(fd);
  const cp = choice(s(fd, "checkpoint"), ["d7", "d30"], "数据节点");
  transaction(() => {
    const v = editable(id);
    if (!canManageVideo(me, v)) throw new UserFacingError("只有视频编导和老板可以登记数据");
    if (!v.published_at || diffDays(today(), v.published_at) < (cp === "d7" ? 7 : 30)) throw new UserFacingError("尚未到该数据登记节点");
    const before = all("SELECT * FROM metrics WHERE video_id=? AND checkpoint=?", id, cp);
    for (const p of ["douyin", "wechat", "xhs"]) {
      const vals = ["plays", "fans", "likes", "collects"].map((f) => n(fd, `${p}_${f}`, { integer: true }));
      if (vals.every((x) => x == null)) continue;
      run(`INSERT INTO metrics(video_id,checkpoint,platform,plays,fans,likes,collects,source,updated_by)
        VALUES(?,?,?,?,?,?,?,'manual',?) ON CONFLICT(video_id,checkpoint,platform) DO UPDATE SET
        plays=COALESCE(excluded.plays,plays),fans=COALESCE(excluded.fans,fans),likes=COALESCE(excluded.likes,likes),collects=COALESCE(excluded.collects,collects),
        source='manual',updated_by=excluded.updated_by,updated_at=datetime('now','+8 hours')`, id, cp, p, ...vals, me.id);
    }
    recalcVideoBonus(id);
    audit(me.id, "video", id, `登记${cp}数据`, before, all("SELECT * FROM metrics WHERE video_id=? AND checkpoint=?", id, cp));
  }); refresh(id);
}

export async function requestWorkload(fd: FormData) {
  const me = await requireUser(), id = parseId(fd);
  const grade = s(fd, "cut_level", true)!, extra = n(fd, "extra_units", { max: 100, required: true })!;
  const due = date(s(fd, "due_rough")), reason = s(fd, "reason", true);
  transaction(() => {
    const v = editable(id);
    if (me.role !== "cutter" || me.id !== v.cutter_id) throw new UserFacingError("只能申请调整自己负责的视频");
    const delivered = get("SELECT id FROM work_deliveries WHERE video_id=?", id);
    choice(grade, [...Object.keys(getRules().cut_levels), ...(delivered ? [v.cut_level] : [])], "剪辑定档");
    if (get("SELECT id FROM workload_requests WHERE video_id=? AND status='pending'", id)) throw new UserFacingError("已有待确认申请");
    const rid = Number(run("INSERT INTO workload_requests(video_id,cutter_id,cut_level,extra_units,due_rough,reason) VALUES(?,?,?,?,?,?)", id, me.id, grade, extra, due, reason).lastInsertRowid);
    audit(me.id, "workload_request", rid, "提交申请", null, { grade, extra, due }, reason);
  });
  await notify(getVideo(id)!.editor_id, `请确认 ${getVideo(id)!.code} 的定档、加件或截止调整申请`, `/videos/${id}`); refresh(id);
}
export async function decideWorkload(fd: FormData) {
  const me = await requireUser(), rid = parseId(fd, "request_id");
  const decision = choice(s(fd, "decision"), ["approve", "reject"], "确认结果"), comment = s(fd, "comment", decision === "reject");
  const vid = transaction(() => {
    const request = get<{ video_id: number; status: string; cutter_id: number; cut_level: string; extra_units: number; due_rough: string | null; reason: string }>("SELECT * FROM workload_requests WHERE id=?", rid);
    if (!request || request.status !== "pending") throw new UserFacingError("申请已处理或不存在");
    const v = editable(request.video_id);
    if (!canManageVideo(me, v)) throw new UserFacingError("仅视频编导或老板可确认");
    if (decision === "approve") {
      if (request.cutter_id !== v.cutter_id) throw new UserFacingError("剪辑归属已改变，请拒绝旧申请");
      const delivered = get<{ cut_level: string; base_units: number }>("SELECT cut_level,base_units FROM work_deliveries WHERE video_id=?", v.id);
      if (delivered?.cut_level !== request.cut_level && !(getRules().cut_levels[request.cut_level] > 0)) throw new UserFacingError("该档位已停用，请重新申请");
      const deadlines = [v.due_script, v.due_shoot, request.due_rough, v.due_review, v.publish_date].filter(Boolean) as string[];
      if (deadlines.some((d, i) => i > 0 && d < deadlines[i - 1])) throw new UserFacingError("新初剪截止与其他阶段截止冲突，请先调整排期");
      run("UPDATE videos SET cut_level=?,extra_units=?,due_rough=?,revision=revision+1 WHERE id=?", request.cut_level, request.extra_units, request.due_rough, v.id);
      run("UPDATE work_deliveries SET cut_level=?,base_units=?,extra_units=?,due_rough=? WHERE video_id=?", request.cut_level, delivered?.cut_level === request.cut_level ? delivered.base_units : getRules().cut_levels[request.cut_level], request.extra_units, request.due_rough, v.id);
    }
    run("UPDATE workload_requests SET status=?,reviewer_id=?,comment=?,done_at=datetime('now','+8 hours') WHERE id=?", decision === "approve" ? "approved" : "rejected", me.id, comment, rid);
    audit(me.id, "video", v.id, decision === "approve" ? "确认工作量调整" : "拒绝工作量调整", { cut_level: v.cut_level, extra_units: v.extra_units, due_rough: v.due_rough }, request, comment ?? request.reason);
    return v.id;
  });
  await notify(getVideo(vid)!.cutter_id, `工作量调整申请已${decision === "approve" ? "确认" : "拒绝"}：${getVideo(vid)!.code}`, `/videos/${vid}`); refresh(vid);
}

export async function createVideoForm(fd: FormData) { return actionResult(() => createVideo(fd)); }

export async function updateVideoForm(fd: FormData) { return actionResult(() => updateVideo(fd)); }

export async function deleteVideoForm(fd: FormData) { return actionResult(() => deleteVideo(fd)); }

export async function advanceForm(fd: FormData) { return actionResult(() => advance(fd)); }

export async function setStageForm(fd: FormData) { return actionResult(() => setStage(fd)); }

export async function decideReviewForm(fd: FormData) { return actionResult(() => decideReview(fd)); }

export async function setRecheckForm(fd: FormData) { return actionResult(() => setRecheck(fd)); }

export async function publishVideoForm(fd: FormData) { return actionResult(() => publishVideo(fd)); }

export async function saveMetricsForm(fd: FormData) { return actionResult(() => saveMetrics(fd)); }

export async function requestWorkloadForm(fd: FormData) { return actionResult(() => requestWorkload(fd)); }

export async function decideWorkloadForm(fd: FormData) { return actionResult(() => decideWorkload(fd)); }
