import { notifyAccountAnomalies } from "./account-anomalies";
import { all, get } from "./db";
import { dailyBackup } from "./backups";
import { notify, retryNotifications } from "./notify";
import { leaderId, listVideos } from "./queries";
import { syncTikhub } from "./tikhub";
import { getRules, setSetting, DUE_LABEL, currentDue, diffDays, stageOwner, today, needsMetrics } from "./rules";

/**
 * 定时任务（每 30 分钟跑一次，靠 dedupe 保证同一提醒只发一次）：
 * - 截止前一天 / 当天 / 逾期提醒到当前环节负责人
 * - 脚本审核超 4 小时提醒审核人
 * - 第 7 / 30 天提醒编导登记播放数据
 * - 每天抓一次 TikHub 互动数据
 */
async function executeJobs() {
  await retryNotifications();
  dailyBackup();
  const t = today();
  const leader = leaderId();

  for (const v of listVideos("v.stage!='已发布'")) {
    const due = currentDue(v);
    if (!due?.date) continue;
    const owner = v.stage.endsWith("审核") ? get<{ reviewer_id: number }>("SELECT reviewer_id FROM reviews WHERE video_id=? AND status='待审' ORDER BY id DESC LIMIT 1", v.id)?.reviewer_id ?? stageOwner(v, leader) : stageOwner(v, leader);
    const d = diffDays(due.date, t);
    const what = `${v.code}《${v.title}》${DUE_LABEL[due.field]} ${due.date.slice(5)}`;
    if (d === 1) await notify(owner, `⏰ 明天到期：${what}`, `/videos/${v.id}`, `due1-${v.id}-${due.field}-${due.date}`);
    else if (d === 0) await notify(owner, `⏰ 今天到期：${what}`, `/videos/${v.id}`, `due0-${v.id}-${due.field}-${due.date}`);
    else if (d < 0) {
      await notify(owner, `🔴 已逾期${-d}天：${what}`, `/videos/${v.id}`, `od-${v.id}-${due.field}-${t}`);
      if (d === -1) {
        const boss = get<{ id: number }>(`SELECT id FROM users WHERE role='boss'${process.env.FEISHU_APP_ID && process.env.FEISHU_APP_SECRET ? " AND feishu_open_id IS NOT NULL" : ""} ORDER BY id LIMIT 1`);
        await notify(boss?.id, `🔴 逾期：${what}（${v.stage}）`, `/videos/${v.id}`, `od-boss-${v.id}-${due.field}`);
      }
    }
  }

  const slow = all<{ id: number; video_id: number; reviewer_id: number; code: string }>(`
    SELECT r.id, r.video_id, r.reviewer_id, v.code FROM reviews r JOIN videos v ON v.id=r.video_id
    WHERE v.archived_at IS NULL AND r.status='待审' AND r.node='脚本审核' AND r.submitted_at <= datetime('now','+8 hours',?)`, `-${getRules().script_review_hours} hours`);
  for (const r of slow) await notify(r.reviewer_id, `脚本审核已超4小时：${r.code}`, "/reviews", `slow-${r.id}`);

  for (const v of listVideos("v.stage='已发布' AND v.published_at IS NOT NULL")) {
    const age = diffDays(t, v.published_at!);
    for (const [cp, day] of [["d7", 7], ["d30", 30]] as const) {
      if (age < day) continue;
      if (needsMetrics(v.id, cp)) await notify(v.editor_id, `📊 ${v.code}《${v.title}》发布满${day}天，请登记已发布平台的数据`, `/videos/${v.id}`, `data-${v.id}-${cp}-${t}`);
    }
  }

  await notifyAccountAnomalies();

  const hour = Number(new Intl.DateTimeFormat("en", { timeZone: "Asia/Shanghai", hour: "numeric", hourCycle: "h23" }).format(new Date()));
  if (hour >= 10) {
    const result = await syncTikhub();
    setSetting("last_tikhub", JSON.stringify({ at: new Date().toISOString(), ...result }));
  }
}

let running: Promise<void> | null = null;
export function runJobs() {
  if (running) return running;
  running = executeJobs().then(() => { setSetting("last_jobs", JSON.stringify({ at: new Date().toISOString(), ok: true })); })
    .catch((error) => { setSetting("last_jobs", JSON.stringify({ at: new Date().toISOString(), ok: false, error: String(error).slice(0, 300) })); throw error; })
    .finally(() => { running = null; });
  return running;
}

declare global { var __jobsStarted: boolean | undefined }

export function startScheduler() {
  if (globalThis.__jobsStarted) return;
  globalThis.__jobsStarted = true;
  const tick = () => runJobs().catch((e) => console.error("[jobs]", e));
  setTimeout(tick, 15_000);
  setInterval(tick, 30 * 60 * 1000);
}
