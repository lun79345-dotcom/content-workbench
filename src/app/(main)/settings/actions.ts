"use server";
import { UserFacingError, actionResult } from "@/lib/action-errors";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireBoss } from "@/lib/auth";
import { all, audit, db, get, run, transaction } from "@/lib/db";
import { deleteUnusedAccount } from "@/lib/accounts";
import { deleteUnboundMember } from "@/lib/members";
import { freezeBonusBasis, getRules, recalcVideoBonus, saveRules, setSetting } from "@/lib/rules";
import { runJobs } from "@/lib/jobs";
import { syncTikhub } from "@/lib/tikhub";

import { text as s, number as n, id, choice, date, url, bounded, money } from "@/lib/validation";
import { changeMember, usablePerson } from "@/lib/admin";
const done = () => revalidatePath("/", "layout");

export async function saveUser(fd: FormData) {
  const me = await requireBoss();
  const name = s(fd, "name", true, 100)!, role = choice(s(fd, "role"), ["boss", "editor", "cutter", "pending", "disabled"], "成员角色");
  transaction(() => {
    if (fd.get("id")) { const uid = id(fd); const old = changeMember(uid, name, role); audit(me.id, "member", uid, "修改成员", old, { name, role }); }
    else { const uid = Number(run("INSERT INTO users(name,role) VALUES(?,?)", name, role).lastInsertRowid); audit(me.id, "member", uid, "添加本地成员", null, { name, role }); }
  }); done();
}

export async function deleteUser(fd: FormData) {
  const me = await requireBoss();
  const result = deleteUnboundMember(db(), Number(fd.get("id")), me.id);
  if (!result.ok) redirect(`/settings?member_error=${encodeURIComponent(result.message)}`);
  done();
  redirect("/settings?member_deleted=1");
}

export async function saveAccount(fd: FormData) {
  const me = await requireBoss();
  const name = s(fd, "name", true, 100), kind = choice(s(fd, "kind"), ["人设号", "剧情号"], "账号类型"), editor = n(fd, "editor_id", { min: 1, integer: true });
  if (editor && !usablePerson(editor, "editor")) throw new UserFacingError("请选择有效编导");
  const vals = [name, kind, date(s(fd, "new_since")), editor, url(s(fd, "douyin_home")), url(s(fd, "wechat_home")), url(s(fd, "xhs_home"))];
  transaction(() => {
    let aid: number;
    const before = fd.get("id") ? get("SELECT * FROM accounts WHERE id=?", id(fd)) : null;
    if (fd.get("id")) {
      aid = id(fd); if (!before) throw new UserFacingError("账号不存在");
      for (const v of all<{ id: number }>("SELECT DISTINCT v.id FROM videos v JOIN bonuses b ON b.video_id=v.id WHERE v.account_id=? AND b.published=1", aid)) freezeBonusBasis(v.id);
      run("UPDATE accounts SET name=?,kind=?,new_since=?,editor_id=?,douyin_home=?,wechat_home=?,xhs_home=? WHERE id=?", ...vals, aid);
    } else aid = Number(run("INSERT INTO accounts(name,kind,new_since,editor_id,douyin_home,wechat_home,xhs_home,sort) VALUES(?,?,?,?,?,?,?,(SELECT COALESCE(max(sort),0)+1 FROM accounts))", ...vals).lastInsertRowid);
    audit(me.id, "account", aid, "保存账号", before, vals);
    for (const v of all<{ id: number }>("SELECT id FROM videos WHERE account_id=? AND published_at IS NOT NULL", aid)) recalcVideoBonus(v.id);
  }); done();
}

export async function deleteAccount(fd: FormData) {
  await requireBoss();
  const result = deleteUnusedAccount(db(), Number(fd.get("id")));
  if (!result.ok) redirect(`/settings?account_error=${encodeURIComponent(result.message)}#accounts`);
  done();
  redirect("/settings?account_deleted=1#accounts");
}

export async function saveLeader(fd: FormData) {
  const me = await requireBoss(), uid = n(fd, "leader_id", { min: 1, integer: true });
  if (uid && !usablePerson(uid, "editor")) throw new UserFacingError("轮值组长必须是可登录的编导");
  transaction(() => {
    const before = get("SELECT value FROM settings WHERE key='leader_id'");
    setSetting("leader_id", uid ? String(uid) : "");
    audit(me.id, "settings", null, "轮值组长", before, { uid });
  }); done();
}

export async function saveRulesAction(fd: FormData) {
  const me = await requireBoss();
  const r = getRules();
  const nums = (k: string) => [0, 1, 2].map((i) => n(fd, `${k}_${i}`, { required: true })!);
  const levels: Record<string, number> = {};
  for (const part of String(fd.get("cut_levels") ?? "").split(/[,，\s]+/).filter(Boolean)) {
    const [k, v] = part.split(/[=:：]/);
    if (!k || !v || !Number.isFinite(Number(v)) || Object.hasOwn(levels, k.trim())) throw new UserFacingError("定档格式不正确或名称重复");
    if (["__proto__", "constructor", "prototype"].includes(k.trim())) throw new UserFacingError("定档名称无效");
    levels[k.trim()] = Number(v);
  }
  const updated = {
    ...r,
    tiers: nums("tier").map((x) => Math.round(x * 10000)),
    tier_amounts: nums("amount").map((v) => money(v, "奖金")),
    new_discount: n(fd, "new_discount", { required: true })!,
    new_months: n(fd, "new_months", { required: true, integer: true })!,
    editor_share: n(fd, "editor_share", { required: true })! / 100,
    target_growth: n(fd, "target_growth", { required: true })!,
    cut_levels: Object.keys(levels).length ? levels : r.cut_levels,
  };
  updated.tiers.forEach((x, i) => { bounded(x, "爆款档位", { min: 1, integer: true }); if (i && x <= updated.tiers[i - 1]) throw new UserFacingError("档位必须严格递增"); });
  updated.tier_amounts.forEach((x, i) => { bounded(x, "奖金", { max: 1000000 }); if (i && x < updated.tier_amounts[i - 1]) throw new UserFacingError("奖金应随档位递增"); });
  bounded(updated.new_discount, "折扣", { min: 0.01, max: 1 });
  bounded(updated.new_months, "新号折扣期", { min: 1, max: 24, integer: true });
  bounded(updated.editor_share, "分成", { max: 1 });
  bounded(updated.target_growth, "目标系数", { min: 0.01, max: 10 });
  if (!Object.keys(levels).length || Object.keys(levels).length > 10) throw new UserFacingError("请填写有效的剪辑定档");
  for (const [key, value] of Object.entries(levels)) { if (key.length > 20) throw new UserFacingError("定档名称过长"); bounded(value, "定档件数", { min: 0.01, max: 100 }); }
  transaction(() => {
    const stillUsed = all<{ code: string; cut_level: string }>("SELECT code,cut_level FROM videos v WHERE archived_at IS NULL AND published_at IS NULL AND NOT EXISTS(SELECT 1 FROM work_deliveries w WHERE w.video_id=v.id)").filter((v) => !Object.hasOwn(updated.cut_levels, v.cut_level));
    if (stillUsed.length) throw new UserFacingError(`尚未交付的视频仍在使用这些档位，请先调整：${stillUsed.slice(0, 5).map((v) => `${v.code} ${v.cut_level}`).join('、')}`);
    const vids = all<{ id: number }>("SELECT id FROM videos WHERE published_at IS NOT NULL");
    for (const v of vids) if (get("SELECT id FROM bonuses WHERE video_id=? AND published=1 LIMIT 1", v.id)) freezeBonusBasis(v.id);
    saveRules(updated);
    for (const v of vids) recalcVideoBonus(v.id);
    audit(me.id, "settings", null, "奖金与考核规则", r, updated);
  });
  done();
}

export async function runJobsNow() {
  await requireBoss();
  await runJobs();
  done();
}
export async function syncNow() {
  await requireBoss();
  const r = await syncTikhub(true);
  setSetting("last_tikhub", JSON.stringify({ at: new Date().toISOString(), ...r, errors: r.errors?.slice(0, 5) }));
  done();
}

export async function saveTikhubLimits(fd: FormData) {
  const me = await requireBoss();
  const requests = n(fd, "daily_requests", { min: 0, max: 10000, integer: true, required: true });
  const batches = n(fd, "daily_play_batches", { min: 0, max: 1000, integer: true, required: true });
  transaction(() => {
    const before = { requests: get<{ value: string }>("SELECT value FROM settings WHERE key='tikhub_daily_requests'")?.value,
      batches: get<{ value: string }>("SELECT value FROM settings WHERE key='tikhub_daily_play_batches'")?.value };
    setSetting("tikhub_daily_requests", String(requests));
    setSetting("tikhub_daily_play_batches", String(batches));
    audit(me.id, "settings", null, "修改每日采集上限", before, { requests, batches });
  });
  done();
}
export async function saveTikhubLimitsForm(fd: FormData) { return actionResult(() => saveTikhubLimits(fd)); }

export async function saveUserForm(fd: FormData) { return actionResult(() => saveUser(fd)); }

export async function deleteUserForm(fd: FormData) { return actionResult(() => deleteUser(fd)); }

export async function saveAccountForm(fd: FormData) { return actionResult(() => saveAccount(fd)); }

export async function deleteAccountForm(fd: FormData) { return actionResult(() => deleteAccount(fd)); }

export async function saveLeaderForm(fd: FormData) { return actionResult(() => saveLeader(fd)); }

export async function saveRulesActionForm(fd: FormData) { return actionResult(() => saveRulesAction(fd)); }

export async function runJobsNowForm() { return actionResult(() => runJobsNow()); }

export async function syncNowForm() { return actionResult(() => syncNow()); }
