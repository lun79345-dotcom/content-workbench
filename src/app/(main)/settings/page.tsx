import { requireBoss, feishuEnabled, ROLE_LABEL } from "@/lib/auth";
import { Submit } from "@/components/submit";
import { all } from "@/lib/db";
import { accounts, leaderId, people } from "@/lib/queries";
import { getRules, getSetting } from "@/lib/rules";
import { Field, PageHeader, Section, Select, Tag } from "@/components/ui";
import { runJobsNow, saveAccount, saveLeader, saveRulesAction, saveUser, syncNow } from "./actions";

const ROLES = ["boss", "editor", "cutter", "pending", "disabled"].map((r) => ({ value: r, label: ROLE_LABEL[r] }));

export default async function Settings() {
  await requireBoss();
  const users = all<{ id: number; name: string; role: string; feishu_open_id: string | null }>("SELECT * FROM users ORDER BY role='pending' DESC, id");
  const accs = accounts();
  const editors = people("editor");
  const r = getRules();
  const lastSync = getSetting("last_tikhub");

  return (
    <>
      <PageHeader title="设置" />
      <div className="grid gap-4 xl:grid-cols-2">
        <Section title="成员与角色">
          <div className="space-y-2">
            {users.map((u) => (
              <form key={u.id} action={saveUser} className="flex items-center gap-2">
                <input type="hidden" name="id" value={u.id} />
                <input name="name" defaultValue={u.name} className="input" />
                <div className="w-28 shrink-0"><Select name="role" defaultValue={u.role} options={ROLES} /></div>
                <span className="w-16 shrink-0 text-center">{u.feishu_open_id ? <Tag tone="blue">飞书</Tag> : <Tag>未绑定</Tag>}</span>
                <Submit className="btn btn-sm shrink-0">保存</Submit>
              </form>
            ))}
            <form action={saveUser} className="flex items-center gap-2 border-t border-stone-100 pt-3">
              <input name="name" required placeholder="新成员姓名（与飞书姓名一致可自动绑定）" className="input" />
              <div className="w-28 shrink-0"><Select name="role" defaultValue="editor" options={ROLES.slice(0, 3)} /></div>
              <span className="w-16 shrink-0" />
              <Submit done={null} className="btn btn-sm btn-primary shrink-0">添加</Submit>
            </form>
          </div>
        </Section>

        <div className="space-y-4">
          <Section title="轮值组长（脚本审核人）">
            <form action={saveLeader} className="flex gap-2">
              <Select name="leader_id" defaultValue={leaderId()} options={editors.map((e) => ({ value: e.id, label: e.name }))} />
              <Submit className="btn btn-primary shrink-0">保存</Submit>
            </form>
            <p className="mt-2 text-xs text-stone-400">组长自己的视频由老板审核。</p>
          </Section>

          <Section title="集成状态">
            <ul className="space-y-2 text-sm">
              <li className="flex justify-between">飞书登录 / 消息推送 {feishuEnabled() ? <Tag tone="green">已配置</Tag> : <Tag tone="amber">未配置（开发登录模式）</Tag>}</li>
              <li className="flex justify-between">TikHub 互动数据 {process.env.TIKHUB_API_KEY ? <Tag tone="green">已配置</Tag> : <Tag tone="amber">未配置</Tag>}</li>
              <li className="flex justify-between">抖音开放平台（播放量） <Tag>待申请</Tag></li>
            </ul>
            {lastSync && <p className="mt-2 break-all text-xs text-stone-400">上次抓取：{lastSync}</p>}
            <div className="mt-3 flex gap-2">
              <form action={runJobsNow}><Submit className="btn btn-sm">立即运行提醒任务</Submit></form>
              <form action={syncNow}><Submit className="btn btn-sm">立即抓取 TikHub</Submit></form>
            </div>
          </Section>
        </div>

        <Section title="账号" className="xl:col-span-2">
          <div className="overflow-x-auto">
            <div className="min-w-[900px] space-y-2">
              <div className="grid grid-cols-[1fr_100px_140px_110px_1fr_1fr_1fr_60px] gap-2 text-xs text-stone-500">
                <span>名称</span><span>类型</span><span>新号起始日（空=老号）</span><span>负责编导</span><span>抖音主页</span><span>视频号主页</span><span>小红书主页</span><span />
              </div>
              {[...accs, null].map((a, i) => (
                <form key={a?.id ?? "new"} action={saveAccount} className="grid grid-cols-[1fr_100px_140px_110px_1fr_1fr_1fr_60px] gap-2">
                  {a && <input type="hidden" name="id" value={a.id} />}
                  <input name="name" required defaultValue={a?.name} placeholder={i === accs.length ? "新账号" : ""} className="input" />
                  <Select name="kind" defaultValue={a?.kind ?? "人设号"} options={["人设号", "剧情号"]} />
                  <input type="date" name="new_since" defaultValue={a?.new_since ?? ""} className="input" />
                  <Select name="editor_id" defaultValue={a?.editor_id} placeholder="—" options={editors.map((e) => ({ value: e.id, label: e.name }))} />
                  <input name="douyin_home" defaultValue={a?.douyin_home ?? ""} className="input" />
                  <input name="wechat_home" defaultValue={a?.wechat_home ?? ""} className="input" />
                  <input name="xhs_home" defaultValue={a?.xhs_home ?? ""} className="input" />
                  <Submit className={`btn btn-sm h-9 ${a ? "" : "btn-primary"}`} done={a ? "已保存" : null}>{a ? "保存" : "添加"}</Submit>
                </form>
              ))}
            </div>
          </div>
        </Section>

        <Section title="奖金与考核规则" className="xl:col-span-2">
          <form action={saveRulesAction} className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-2">
              <span className="label">老号爆款档位（万播放）→ 奖金（元）</span>
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex items-center gap-2">
                  <input name={`tier_${i}`} type="number" step="0.1" defaultValue={r.tiers[i] / 10000} className="input" />
                  <span className="text-stone-400">→</span>
                  <input name={`amount_${i}`} type="number" defaultValue={r.tier_amounts[i]} className="input" />
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
              <p className="text-xs text-stone-400">修改规则后，保存后，所有未公示的自动奖金立即按新规则重算；已公示的不变。</p>
              <Submit className="btn btn-primary w-full">保存规则</Submit>
            </div>
          </form>
        </Section>
      </div>
    </>
  );
}
