import { ActionForm } from "@/components/action-form";
import { requireBoss, feishuEnabled, ROLE_LABEL } from "@/lib/auth";
import { Submit } from "@/components/submit";
import { DeleteMember } from "@/components/delete-member";
import { DeleteAccount } from "@/components/delete-account";
import { all } from "@/lib/db";
import { tikhubLimits, tikhubUsage } from "@/lib/tikhub";
import { saveTikhubLimitsForm } from "./actions";
import { accounts, leaderId, people } from "@/lib/queries";
import { getRules, getSetting } from "@/lib/rules";
import { Field, PageHeader, Section, Select, Tag } from "@/components/ui";
import { deleteAccountForm as deleteAccount, deleteUserForm as deleteUser, runJobsNowForm as runJobsNow, saveAccountForm as saveAccount, saveLeaderForm as saveLeader, saveRulesActionForm as saveRulesAction, saveUserForm as saveUser, syncNowForm as syncNow } from "./actions";

const ROLES = ["boss", "editor", "cutter", "pending", "disabled"].map((r) => ({ value: r, label: ROLE_LABEL[r] }));

export default async function Settings({ searchParams }: { searchParams: Promise<{ member_error?: string; member_deleted?: string; account_error?: string; account_deleted?: string }> }) {
  const me = await requireBoss();
  const feedback = await searchParams;
  const users = all<{ id: number; name: string; role: string; feishu_open_id: string | null }>("SELECT * FROM users ORDER BY role='pending' DESC, id");
  const accs = accounts();
  const editors = people("editor");
  const r = getRules();
  const lastJobs = getSetting("last_jobs"), lastBackup = getSetting("last_backup");
  const queue = all<{ n: number }>("SELECT count(*) n FROM notifications WHERE pushed=0 AND attempts>0")[0].n;
  const lastSync = getSetting("last_tikhub");
  const limits = tikhubLimits(), usage = tikhubUsage();
  let sync: { at?: string; ok?: number; playsOk?: number; fail?: number; skipped?: string; errors?: string[] } | null = null;
  try { sync = lastSync ? JSON.parse(lastSync) : null; } catch {}

  return (
    <>
      <PageHeader title="设置" />
      <div className="grid gap-4 xl:grid-cols-2">
        <Section title="成员与角色">
          {feedback.member_error && <p role="alert" className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{feedback.member_error}</p>}
          {feedback.member_deleted === "1" && <p role="status" className="mb-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">成员已删除。其负责的账号或轮值组长如已解除关联，请重新分配。</p>}
          <div className="space-y-2">
            {users.map((u) => (
              <div key={u.id} className="flex items-center gap-2">
                <ActionForm action={saveUser} className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                  <input type="hidden" name="id" value={u.id} />
                  <input name="name" defaultValue={u.name} aria-label="成员姓名" className="input min-w-0 flex-1 basis-full sm:basis-40" />
                  <div className="w-28 shrink-0"><Select name="role" defaultValue={u.role} options={ROLES} /></div>
                  <span className="w-16 shrink-0 text-center">{u.feishu_open_id ? <Tag tone="blue">飞书</Tag> : <Tag>未绑定</Tag>}</span>
                  <Submit className="btn btn-sm shrink-0">保存</Submit>
                </ActionForm>
                <div className="w-12 shrink-0 self-end pb-1 sm:self-center sm:pb-0">
                  {!u.feishu_open_id && u.id !== me.id && <ActionForm action={deleteUser}>
                    <input type="hidden" name="id" value={u.id} />
                    <DeleteMember name={u.name} />
                  </ActionForm>}
                </div>
              </div>
            ))}
            <ActionForm action={saveUser} className="flex items-center gap-2 border-t border-stone-100 pt-3">
              <input name="name" required placeholder="本地占位成员姓名" className="input" />
              <div className="w-28 shrink-0"><Select name="role" defaultValue="editor" options={ROLES.slice(0, 3)} /></div>
              <span className="w-16 shrink-0" />
              <Submit done={null} className="btn btn-sm btn-primary shrink-0">添加</Submit>
            </ActionForm>
          </div>
          <p className="mt-3 text-xs text-stone-500">飞书首次登录会新增待审批成员，由老板分配角色，不按同名自动绑定。未绑定飞书且无业务记录的成员可删除；已绑定或已有记录的成员，请将角色设为“已停用”。</p>
        </Section>

        <div className="space-y-4">
          <Section title="轮值组长（脚本审核人）">
            <ActionForm action={saveLeader} className="flex gap-2">
              <Select name="leader_id" defaultValue={leaderId()} placeholder="请选择轮值组长" options={editors.map((e) => ({ value: e.id, label: e.name }))} />
              <Submit className="btn btn-primary shrink-0">保存</Submit>
            </ActionForm>
            <p className="mt-2 text-xs text-stone-400">组长自己的视频由老板审核。</p>
          </Section>

          <Section title="集成状态">
            <ul className="space-y-2 text-sm">
              <li className="flex justify-between">飞书登录 / 消息推送 {feishuEnabled() ? <Tag tone="green">已配置</Tag> : <Tag tone="amber">未配置（开发登录模式）</Tag>}</li>
              <li className="flex justify-between">TikHub 互动与抖音播放量 {process.env.TIKHUB_API_KEY ? <Tag tone="green">已配置</Tag> : <Tag tone="amber">未配置</Tag>}</li>
              <li className="flex justify-between">抖音开放平台（播放量） <Tag>待申请</Tag></li>
            </ul>
            <p className="mt-2 text-xs text-stone-500">推送失败待重试：{queue} 条（每次提醒任务自动重试）</p>
            {lastJobs && <p className="mt-2 break-all text-xs text-stone-400">提醒任务：{lastJobs}</p>}
            {lastBackup && <p className="mt-2 break-all text-xs text-stone-400">每日备份：{lastBackup}</p>}
            {sync && <p className="mt-2 text-xs text-stone-500">上次采集：{sync.at ? new Date(sync.at).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false }) : "—"} · {sync.skipped ?? `抖音播放 ${sync.playsOk ?? 0} 条，互动 ${sync.ok ?? 0} 项，失败 ${sync.fail ?? 0} 项`}</p>}
            {!!sync?.errors?.length && <p className="mt-2 text-xs text-amber-700">{sync.errors[0]}</p>}
            <div className="mt-4 rounded-lg bg-stone-50 p-3">
              <p className="text-sm font-medium">每日采集额度</p>
              <p className="mt-1 text-xs text-stone-500">今天已用 {usage.playBatches}/{limits.playBatches} 批抖音播放采集，全部请求 {usage.requests}/{limits.requests} 次。每批最多50条，失败每项每天最多尝试2次；重复点击不会重抓当天已成功的播放量。</p>
              <ActionForm action={saveTikhubLimitsForm} className="mt-3 flex flex-wrap items-end gap-3">
                <Field label="每日播放采集批数"><input className="input w-32" name="daily_play_batches" type="number" min="0" max="1000" required defaultValue={limits.playBatches} /></Field>
                <Field label="每日全部请求上限"><input className="input w-32" name="daily_requests" type="number" min="0" max="10000" required defaultValue={limits.requests} /></Field>
                <Submit className="btn btn-sm">保存额度</Submit>
              </ActionForm>
              <p className="mt-2 text-xs text-stone-500">播放批数设为0可关闭新增播放采集；全部请求设为0可暂停全部采集。次数含失败请求，实际费用以TikHub账单为准。</p>
            </div>
            <div className="mt-3 flex gap-2">
              <ActionForm action={runJobsNow}><Submit className="btn btn-sm">立即运行提醒任务</Submit></ActionForm>
              <ActionForm action={syncNow}><Submit className="btn btn-sm">立即抓取 TikHub</Submit></ActionForm>
            </div>
          </Section>
        </div>

        <Section title="账号" className="xl:col-span-2">
          <div id="accounts" className="scroll-mt-4" />
          {feedback.account_error && <p role="alert" className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{feedback.account_error}</p>}
          {feedback.account_deleted === "1" && <p role="status" className="mb-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">账号已删除。</p>}
          <div className="overflow-x-auto">
            <div className="min-w-[960px] space-y-2">
              <div className="flex gap-2 text-xs text-stone-500">
                <div className="grid min-w-0 flex-1 grid-cols-[1fr_100px_140px_110px_1fr_1fr_1fr_60px] gap-2">
                  <span>名称</span><span>类型</span><span>新号起始日（空=老号）</span><span>负责编导</span><span>抖音主页</span><span>视频号主页</span><span>小红书主页</span><span />
                </div>
                <span className="w-12 shrink-0" />
              </div>
              {[...accs, null].map((a, i) => (
                <div key={a?.id ?? "new"} className="flex items-center gap-2">
                  <ActionForm action={saveAccount} className="grid min-w-0 flex-1 grid-cols-[1fr_100px_140px_110px_1fr_1fr_1fr_60px] gap-2">
                    {a && <input type="hidden" name="id" value={a.id} />}
                    <input name="name" required defaultValue={a?.name} aria-label="账号名称" placeholder={i === accs.length ? "新账号" : ""} className="input" />
                    <Select name="kind" defaultValue={a?.kind ?? "人设号"} options={["人设号", "剧情号"]} />
                    <input type="date" name="new_since" defaultValue={a?.new_since ?? ""} className="input" />
                    <Select name="editor_id" defaultValue={a?.editor_id} placeholder="—" options={editors.map((e) => ({ value: e.id, label: e.name }))} />
                    <input name="douyin_home" defaultValue={a?.douyin_home ?? ""} className="input" />
                    <input name="wechat_home" defaultValue={a?.wechat_home ?? ""} className="input" />
                    <input name="xhs_home" defaultValue={a?.xhs_home ?? ""} className="input" />
                    <Submit className={`btn btn-sm h-9 ${a ? "" : "btn-primary"}`} done={a ? "已保存" : null}>{a ? "保存" : "添加"}</Submit>
                  </ActionForm>
                  <div className="w-12 shrink-0">
                    {a && <ActionForm action={deleteAccount}>
                      <input type="hidden" name="id" value={a.id} />
                      <DeleteAccount name={a.name} />
                    </ActionForm>}
                  </div>
                </div>
              ))}
            </div>
          </div>
          <p className="mt-3 text-xs text-stone-500">没有视频、创意、月度目标或复盘记录的预设账号可删除；已有记录的账号会保留。</p>
        </Section>

        <Section title="奖金与考核规则" className="xl:col-span-2">
          <ActionForm action={saveRulesAction} className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-2">
              <span className="label">老号爆款档位（万播放）→ 奖金（元）</span>
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex items-center gap-2">
                  <input name={`tier_${i}`} type="number" step="0.1" defaultValue={r.tiers[i] / 10000} className="input" />
                  <span className="text-stone-400">→</span>
                  <input name={`amount_${i}`} type="number" step="0.01" defaultValue={r.tier_amounts[i]} className="input" />
                </div>
              ))}
            </div>
            <div className="space-y-3">
              <Field label="新号档位折扣"><input name="new_discount" type="number" step="0.05" defaultValue={r.new_discount} className="input" /></Field>
              <Field label="新号折扣期（月）"><input name="new_months" type="number" defaultValue={r.new_months} className="input" /></Field>
            </div>
            <div className="space-y-3">
              <Field label="爆款奖编导分成 %（其余归剪辑）"><input name="editor_share" type="number" defaultValue={Math.round(r.editor_share * 100)} className="input" /></Field>
              <Field label="下月目标系数"><input name="target_growth" type="number" step="0.05" defaultValue={r.target_growth} className="input" /></Field>
            </div>
            <div className="space-y-3">
              <Field label="剪辑定档 → 折算件数"><input name="cut_levels" defaultValue={Object.entries(r.cut_levels).map(([k, v]) => `${k}=${v}`).join(", ")} className="input" /></Field>
              <p className="text-xs text-stone-400">保存后重算尚未公示视频的自动奖金；已有公示的视频沿用公示时的分成与档位。历史交付件数不受新规则影响。</p>
              <Submit className="btn btn-primary w-full">保存规则</Submit>
            </div>
          </ActionForm>
        </Section>
      </div>
    </>
  );
}
