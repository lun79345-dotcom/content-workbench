"use server";
import { revalidatePath } from "next/cache";
import { requireBoss } from "@/lib/auth";
import { all, run } from "@/lib/db";
import { getRules, recalcVideoBonus, saveRules, setSetting } from "@/lib/rules";
import { runJobs } from "@/lib/jobs";
import { syncTikhub } from "@/lib/tikhub";

const s = (fd: FormData, k: string) => (fd.get(k) ? String(fd.get(k)).trim() : null);
const done = () => revalidatePath("/", "layout");

export async function saveUser(fd: FormData) {
  await requireBoss();
  if (fd.get("id")) run("UPDATE users SET name=?, role=? WHERE id=?", s(fd, "name"), s(fd, "role"), Number(fd.get("id")));
  else run("INSERT INTO users(name, role) VALUES(?,?)", s(fd, "name"), s(fd, "role"));
  done();
}

export async function saveAccount(fd: FormData) {
  await requireBoss();
  const vals = [s(fd, "name"), s(fd, "kind"), s(fd, "new_since"), s(fd, "editor_id") ? Number(fd.get("editor_id")) : null, s(fd, "douyin_home"), s(fd, "wechat_home"), s(fd, "xhs_home")];
  if (fd.get("id")) run("UPDATE accounts SET name=?, kind=?, new_since=?, editor_id=?, douyin_home=?, wechat_home=?, xhs_home=? WHERE id=?", ...vals, Number(fd.get("id")));
  else run("INSERT INTO accounts(name, kind, new_since, editor_id, douyin_home, wechat_home, xhs_home, sort) VALUES(?,?,?,?,?,?,?, (SELECT COALESCE(max(sort),0)+1 FROM accounts))", ...vals);
  done();
}

export async function saveLeader(fd: FormData) {
  await requireBoss();
  setSetting("leader_id", String(fd.get("leader_id") ?? ""));
  done();
}

export async function saveRulesAction(fd: FormData) {
  await requireBoss();
  const r = getRules();
  const nums = (k: string) => [0, 1, 2].map((i) => Number(fd.get(`${k}_${i}`)));
  const levels: Record<string, number> = {};
  for (const part of String(fd.get("cut_levels") ?? "").split(/[,，\s]+/)) {
    const [k, v] = part.split(/[=:：]/);
    if (k && v && !isNaN(Number(v))) levels[k.trim()] = Number(v);
  }
  saveRules({
    ...r,
    tiers: nums("tier").map((x) => Math.round(x * 10000)),
    tier_amounts: nums("amount"),
    new_discount: Number(fd.get("new_discount")),
    new_months: Number(fd.get("new_months")),
    editor_share: Number(fd.get("editor_share")) / 100,
    target_growth: Number(fd.get("target_growth")),
    cut_levels: Object.keys(levels).length ? levels : r.cut_levels,
  });
  // 按新规则重算所有未公示的自动奖金
  for (const v of all<{ id: number }>("SELECT id FROM videos WHERE stage='已发布'")) recalcVideoBonus(v.id);
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
