import Link from "next/link";
import type { ReactNode } from "react";
import { requireUser } from "@/lib/auth";
import { leaderId } from "@/lib/queries";
import { getRules, fmtNum } from "@/lib/rules";
import { PageHeader, Tabs } from "@/components/ui";
import { FlowDiagram } from "@/components/flow-diagram";

const L = ({ href, children }: { href: string; children: ReactNode }) => (
  <Link href={href} className="font-medium text-brand-600 hover:underline">{children}</Link>
);

function Block({ title, intro, steps, children }: { title: string; intro?: ReactNode; steps?: ReactNode[]; children?: ReactNode }) {
  return (
    <section className="card p-5">
      <h3 className="font-semibold">{title}</h3>
      {intro && <p className="mt-1 text-sm text-stone-600">{intro}</p>}
      {steps && (
        <ol className="mt-3 space-y-2 text-sm">
          {steps.map((s, i) => (
            <li key={i} className="flex gap-3">
              <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-brand-50 text-xs font-medium text-brand-700">{i + 1}</span>
              <span className="leading-6">{s}</span>
            </li>
          ))}
        </ol>
      )}
      {children}
    </section>
  );
}

function Lead({ children }: { children: ReactNode }) {
  return <p className="mb-4 rounded-xl bg-brand-50 px-4 py-3 text-sm text-brand-700">{children}</p>;
}

const TABS = [
  { key: "start", label: "开始之前" },
  { key: "editor", label: "编导" },
  { key: "cutter", label: "剪辑" },
  { key: "leader", label: "轮值组长" },
  { key: "boss", label: "老板" },
  { key: "rhythm", label: "节奏表" },
  { key: "faq", label: "常见问题" },
];

export default async function GuidePage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const me = await requireUser();
  const isLeader = leaderId() === me.id;
  const mine = me.role === "boss" ? "boss" : me.role === "cutter" ? "cutter" : isLeader ? "leader" : "editor";
  const tab = (await searchParams).tab ?? mine;
  const r = getRules();
  const tiers = r.tiers.map(fmtNum).join(" / ");
  const amounts = r.tier_amounts.join(" / ");
  const share = Math.round(r.editor_share * 100);

  return (
    <>
      <PageHeader title="使用指南" desc={<>按岗位写好的操作步骤，默认打开你的岗位（{TABS.find((t) => t.key === mine)?.label}）。</>} />
      <Tabs current={tab} items={TABS.map((t) => ({ ...t, href: `/guide?tab=${t.key}`, label: t.key === mine ? `${t.label} · 我` : t.label }))} />

      <div className="max-w-4xl space-y-4">
        {tab === "start" && (
          <>
            <Lead>一条视频从选题到发奖金，都在这里流转；每天打开「<L href="/">我的工作台</L>」，看到的就是今天轮到你做的事。</Lead>
            <Block title="入口与第一次登录" steps={[
              <>飞书 → 工作台 → 搜「内容工作台」，飞书内打开自动登录；也可以用浏览器打开 自己部署的工作台地址，点「飞书登录」。</>,
              <>第一次打开点「授权」。如果显示「等待老板分配角色」，告诉老板，老板在「设置 → 成员」里给你选岗位。</>,
              <>分配后刷新页面即可使用。之后所有提醒都会以「内容工作台」机器人消息卡片发到你的飞书。</>,
            ]} />
            <Block title="一条视频怎么流转" intro="8 个阶段：选题 → 脚本 → 脚本审核 → 拍摄 → 剪辑 → 成片审核 → 待发布 → 已发布。每个阶段都有截止日，过了就标红并提醒当前负责人。">
              <div className="-mx-1 mt-3 overflow-x-auto"><FlowDiagram /></div>
            </Block>
            <section className="card overflow-x-auto">
              <table className="tbl">
                <thead><tr><th>角色</th><th>主要负责</th><th>常用页面</th></tr></thead>
                <tbody>
                  <tr><td>编导</td><td>选题、脚本、拍摄、审成片、发布、登记播放数据</td><td>工作台、生产看板、视频详情、创意库、周复盘</td></tr>
                  <tr><td>剪辑</td><td>接素材、剪辑、提交成片、返工</td><td>工作台、视频详情、周复盘</td></tr>
                  <tr><td>轮值组长</td><td>由一位编导轮值，4 小时内审其他编导的脚本</td><td>审核</td></tr>
                  <tr><td>老板</td><td>成员/账号/规则设置、定目标、抽审、奖金公示</td><td>老板驾驶舱、奖金清算、设置</td></tr>
                </tbody>
              </table>
            </section>
          </>
        )}

        {tab === "editor" && (
          <>
            <Lead>编导是一条视频的负责人：从建选题到登记第 30 天数据都由你推进，只有「剪辑」阶段在剪辑手上。</Lead>
            <Block title="1. 新建选题（周一选题会后）" steps={[
              <>点「<L href="/videos/new">+ 新建选题</L>」；从创意库来的，在<L href="/ideas">创意库</L>那一行点「转为选题」，标题自动带过来。</>,
              <>填标题、账号、编导、剪辑、剪辑定档（简单 / 常规 / 精剪）。</>,
              <>填五个日期：脚本截止、拍摄截止、初剪截止、审核截止、发布日期。这就是你在选题会上的承诺。</>,
              <>「需求说明」写给剪辑看：风格、参考、重点镜头、脚本文档链接。</>,
            ]} />
            <Block title="2. 写脚本并提交审核" steps={[
              <>进入视频详情页，点「开始写脚本」。</>,
              <>写完点「提交脚本审核」，系统自动发给轮值组长（组长自己的视频发给老板）。</>,
              <>被打回会收到飞书通知，在详情页「审核记录」看修改意见，改完再提交。</>,
            ]} />
            <Block title="3. 拍摄与交剪辑" steps={[
              <>脚本通过后进入「拍摄」。</>,
              <>拍完点「拍完了，素材交剪辑」，剪辑会收到通知。还没定剪辑的话，先在需求单里选好。</>,
            ]} />
            <Block title="4. 审成片" steps={[
              <>剪辑提交后，「<L href="/reviews">审核</L>」菜单出现红点，你也会收到飞书通知。</>,
              <>没问题点「通过」，视频进入「待发布」。</>,
              <>打回<b>必须选原因归类</b>并写清修改意见（如「字幕 02:14「的」应为「得」」）。选「剪辑责任-…」扣剪辑返工分，选「编导责任-…」扣你自己的协作分，请如实选择。</>,
            ]} />
            <Block title="5. 登记发布" steps={[
              <>发完视频，在详情页「登记发布」填实际发布日期和抖音、视频号、小红书链接（有就填）。</>,
              <>点「确认已发布」。填了链接，系统每天自动抓点赞、评论、收藏、分享。</>,
            ]} />
            <Block title="6. 第 7 天、第 30 天登记播放数据" intro="播放量和涨粉平台不公开，只能从后台看了填；到日子系统会发飞书提醒。" steps={[
              <>打开抖音创作者中心、视频号助手，查这条视频的播放和涨粉。</>,
              <>在详情页「播放数据」里填入：第 7 天点「保存并定档」，第 30 天点「保存并算补差」。</>,
              <>系统按双平台合计自动定爆款档（{tiers}），算爆款奖和升档补差，不用自己算。</>,
            ]} />
            <Block title="7. 随时投创意" intro={<>刷到好的开头、选题、梗，在「<L href="/ideas">创意库</L>」顶部写一句话投递；投递数计入周复盘。</>} />
            <Block title="8. 周五填周复盘" intro={<>打开「<L href="/weekly">周复盘</L>」：产出条数、分发完成率、脚本储备、创意投递数都已自动统计，你只需填最佳/最差及原因、卡点与所需支持、下周计划。</>} />
          </>
        )}

        {tab === "cutter" && (
          <>
            <Lead>剪辑只管「剪辑」这一段：收到素材通知就开剪，在初剪截止前提交成片；准时率和返工次数自动计入周复盘。</Lead>
            <Block title="1. 接单" steps={[
              <>编导建选题时选了你，你会收到「新排期」通知，可以提前看需求说明。</>,
              <>编导点「素材交剪辑」后你会收到「素材已交付」通知，视频出现在「<L href="/">我的工作台 → 我手上的活</L>」。</>,
            ]} />
            <Block title="2. 剪辑并提交" steps={[
              <>点进视频详情页，看「需求单」里的要求和脚本链接。</>,
              <>剪完点「提交成片审核」，系统通知编导来审。</>,
              <><b>第一次提交的时间</b>决定是否准时：不晚于「初剪截止」就算准时。</>,
            ]} />
            <Block title="3. 被打回时" steps={[
              <>你会收到「成片被打回」通知，里面有原因和修改意见。</>,
              <>改完再点「提交成片审核」。</>,
              <>只有归类为「剪辑责任-…」的打回才算你的返工；觉得归类不对，找编导或组长复核。</>,
            ]} />
            <Block title="4. 冻结期规则" intro={<>发布前 24 小时视频进入「已冻结」。这时编导再改需求，你会收到提醒，系统在备注里留痕，<b>不计你的拖期</b>。</>} />
            <Block title="5. 周五填周复盘" intro={<>出片条数、准时交付率、返工条数和主因已自动统计；你只需填最满意作品、自我评分、包装/节奏心得、卡点、下周计划。</>} />
            <p className="text-sm text-stone-500">奖金在「<L href="/bonus">我的奖金</L>」只显示你自己的；爆款奖按规则自动分到你名下（当前编导 {share}% / 剪辑 {100 - share}%）。</p>
          </>
        )}

        {tab === "leader" && (
          <>
            <Lead>组长由一位编导轮值（老板在「设置 → 轮值组长」指定），负责在提交后 <b>4 小时内</b>审完其他编导的脚本；超时会收到催办提醒。</Lead>
            <Block title="脚本审核" steps={[
              <>收到「待你审脚本」通知，或看到「<L href="/reviews">审核</L>」菜单的红点。</>,
              <>点进视频详情，在需求单里打开脚本链接看内容。</>,
              <>通过：点「通过」，视频进入拍摄。</>,
              <>打回：选原因归类（脚本阶段一般是「编导责任-选题方向」或「编导责任-脚本问题」），写具体修改意见。</>,
            ]} />
            <Block title="成片复审" intro={<>成片由编导自审。组长在「<L href="/reviews?tab=all">审核记录</L>」里抽查，在「复审」列选「通过」或「有问题」。</>} />
            <section className="card overflow-x-auto">
              <table className="tbl">
                <thead><tr><th>问题出在</th><th>选</th><th>扣谁的分</th></tr></thead>
                <tbody>
                  <tr><td>错别字、字幕</td><td>剪辑责任-错别字/字幕</td><td>剪辑返工分</td></tr>
                  <tr><td>节奏、包装、音画</td><td>剪辑责任-节奏/包装、剪辑责任-音画问题</td><td>剪辑返工分</td></tr>
                  <tr><td>没按需求剪</td><td>剪辑责任-未按需求</td><td>剪辑返工分</td></tr>
                  <tr><td>选题、脚本、素材不足</td><td>编导责任-…</td><td>编导协作分</td></tr>
                  <tr><td>冻结后编导改需求</td><td>编导责任-冻结后改需求</td><td>编导协作分</td></tr>
                </tbody>
              </table>
            </section>
          </>
        )}

        {tab === "boss" && (
          <>
            <Lead>老板日常只用三个页面：「<L href="/dashboard">老板驾驶舱</L>」看全局、「<L href="/bonus">奖金清算</L>」月底公示、「<L href="/settings">设置</L>」管人和规则；抽审和代审在任何视频详情页都能做。</Lead>
            <Block title="上线时做一次（设置）" steps={[
              <><b>成员</b>：同事飞书登录后出现在列表顶部，角色是「待审批」；选「编导」或「剪辑」保存。示例成员改为「已停用」。</>,
              <><b>账号</b>：核对名称、类型、负责编导；新号填「新号起始日」，前 {r.new_months} 个月自动按 {r.new_discount * 10} 折档定爆款。</>,
              <><b>轮值组长</b>：选当前负责审脚本的编导，换人时改这里。</>,
              <><b>奖金与考核规则</b>：爆款档位与金额（当前 {tiers} → {amounts} 元）、编导分成（当前 {share}%）、剪辑定档折算件数。保存后未公示的奖金立即重算。</>,
            ]} />
            <Block title="每月初：定播放目标" intro={<>「<L href="/data?tab=accounts">播放数据 → 账号月度汇总</L>」，在每个账号的「本月播放目标」里填数字（可写 15w）。输入框会提示建议值 = 上月 × {r.target_growth}；第一个月只记基线，不填。</>} />
            <Block title="日常：看驾驶舱" steps={[
              <>顶部：本月播放与目标达成率、爆款数、发布条数、涨粉、逾期数、本月奖金。</>,
              <>「谁在拖期」：按人统计逾期条数，点「去看板」看具体哪条。</>,
              <>「近30天打回原因」：剪辑和编导各自哪类问题最多。逾期第一天你也会收到飞书提醒。</>,
            ]} />
            <Block title="月底：奖金清算与公示" steps={[
              <>打开「<L href="/bonus">奖金清算</L>」选月份。爆款奖（计入发布第 7 天所在月）和升档补差（计入第 30 天所在月）已自动算好。</>,
              <>右侧「登记其他奖项」补录：平台单项奖、创意采用奖等；金额使用自己的规则。</>,
              <>核对「按人汇总」，点「确认并公示」：金额锁定，每人收到飞书通知；需要发放时点「导出 CSV」。</>,
            ]} />
            <Block title="学生创意征集" intro={<>在「<L href="/students">学生征集</L>」登记投稿。<b>授权书未签不能评审</b>；评为入围或采用后自动进入创意库。奖金和发放日期也记在这里。</>} />
          </>
        )}

        {tab === "rhythm" && (
          <>
            <Lead>一周两个固定会（周一选题会、周五复盘会），其余时间按系统提醒做事。</Lead>
            <section className="card overflow-x-auto">
              <table className="tbl">
                <thead><tr><th>时间</th><th>编导</th><th>剪辑</th><th>轮值组长</th><th>老板</th></tr></thead>
                <tbody>
                  <tr><td className="whitespace-nowrap">每天早上</td><td>看工作台，先做红的</td><td>同左</td><td>处理「待我审核」</td><td>看驾驶舱「逾期中」</td></tr>
                  <tr><td className="whitespace-nowrap">每天随时</td><td>推进阶段、审成片、登记发布、投创意</td><td>剪辑、提交、返工</td><td>4 小时内审完脚本</td><td>抽审</td></tr>
                  <tr><td className="whitespace-nowrap">发布第 7/30 天</td><td>收到提醒后登记播放和涨粉</td><td>—</td><td>—</td><td>—</td></tr>
                  <tr><td className="whitespace-nowrap">周一</td><td>选题会后新建选题，填五个日期</td><td>确认本周排期</td><td>—</td><td>主持选题会，给创意库评级</td></tr>
                  <tr><td className="whitespace-nowrap">周五</td><td>复盘会前填周复盘</td><td>复盘会前填周复盘</td><td>抽查成片复审</td><td>看全员周复盘</td></tr>
                  <tr><td className="whitespace-nowrap">每月初</td><td>—</td><td>—</td><td>—</td><td>定各账号播放目标</td></tr>
                  <tr><td className="whitespace-nowrap">每月底</td><td>确认自己的奖金</td><td>确认自己的奖金</td><td>—</td><td>补录奖项、公示、导出</td></tr>
                </tbody>
              </table>
            </section>
          </>
        )}

        {tab === "faq" && (
          <div className="card divide-y divide-stone-100">
            {[
              ["打开提示「你没有内容工作台的使用权限」", "飞书应用的可用范围还没加上你。找老板在飞书开发者后台或管理后台把你加入可用范围。"],
              ["登录后显示「等待老板分配角色」", "正常，老板已收到通知。分配后刷新页面即可。"],
              ["电脑版飞书里打不开（ERR_CONNECTION_CLOSED）", "一般是电脑开了代理软件（如 Clash）。先用手机飞书或浏览器打开；或在代理规则里给 工作台域名 加直连。"],
              ["播放量为什么要手动填", "抖音和视频号不对外公开播放量，第三方接口抓到的是 0。配置 TikHub 接口后可辅助获取点赞、评论、收藏、分享；演示版默认不调用外部服务。"],
              ["数据填错了怎么办", "直接改数字再点保存，爆款档和奖金会自动重算；已公示的奖金不再变动，需要找老板手动调整。"],
              ["阶段点错了", "编导或老板可以在视频详情页右上方「手动调整阶段」退回，待审的审核会自动撤回。"],
              ["通知太多或没收到", "系统内「通知」页保留全部记录；飞书没收到时先看是否屏蔽了「内容工作台」机器人。"],
            ].map(([q, a]) => (
              <div key={q} className="p-4">
                <div className="text-sm font-semibold">{q}</div>
                <div className="mt-1 text-sm text-stone-600">{a}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
