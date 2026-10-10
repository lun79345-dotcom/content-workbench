import Link from "next/link";
import { Submit } from "@/components/submit";
import { requireUser } from "@/lib/auth";
import { all } from "@/lib/db";
import { PageHeader, Section, Tabs, Tag, Empty } from "@/components/ui";
import { ReviewDecision } from "@/components/review";
import { setRecheck } from "../videos/actions";

type R = { id: number; node: string; status: string; reason: string | null; comment: string | null; recheck: string | null; submitted_at: string; done_at: string | null;
  video_id: number; code: string; title: string; submitter: string; reviewer: string; reviewer_id: number };

export default async function ReviewsPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const me = await requireUser();
  const tab = (await searchParams).tab ?? "todo";
  const base = `SELECT r.*, v.code, v.title, s.name submitter, u.name reviewer FROM reviews r JOIN videos v ON v.id=r.video_id
                LEFT JOIN users s ON s.id=r.submitter_id LEFT JOIN users u ON u.id=r.reviewer_id`;
  const todo = all<R>(`${base} WHERE r.status='待审' AND (r.reviewer_id=? OR ?) ORDER BY r.id`, me.id, me.role === "boss" ? 1 : 0);
  const history = all<R>(`${base} WHERE r.status IN ('通过','打回') ORDER BY r.id DESC LIMIT 300`);
  const rejects = all<{ reason: string; n: number }>("SELECT reason, count(*) n FROM reviews WHERE status='打回' AND submitted_at >= date('now','-30 day') GROUP BY reason ORDER BY n DESC");

  return (
    <>
      <PageHeader title="内容审核" desc="脚本审核：轮值组长审，4小时内；成片审核：编导自审 + 组长复核。打回必须归类，归类决定扣谁的分。" />
      <Tabs current={tab} items={[{ key: "todo", label: `待审（${todo.length}）`, href: "/reviews" }, { key: "all", label: "审核记录", href: "/reviews?tab=all" }]} />
      {tab === "todo" ? (
        todo.length === 0 ? <Empty>没有待审的内容</Empty> : (
          <div className="space-y-3">
            {todo.map((r) => (
              <div key={r.id} className="card p-4">
                <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
                  <Tag tone="amber">{r.node}</Tag>
                  <Link href={`/videos/${r.video_id}`} className="font-medium hover:underline">{r.code}《{r.title}》</Link>
                  <span className="text-xs text-stone-400">{r.submitter} 提交于 {r.submitted_at.slice(5, 16)}{r.reviewer_id !== me.id && ` · 审核人 ${r.reviewer}`}</span>
                </div>
                <ReviewDecision reviewId={r.id} />
              </div>
            ))}
          </div>
        )
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1fr_260px]">
          <div className="card overflow-x-auto">
            <table className="tbl">
              <thead><tr><th>日期</th><th>视频</th><th>节点</th><th>提交人</th><th>审核人</th><th>结果</th><th>打回原因</th><th>修改意见</th><th>复审</th></tr></thead>
              <tbody>
                {history.map((r) => (
                  <tr key={r.id}>
                    <td className="whitespace-nowrap text-stone-500">{r.submitted_at.slice(5, 10)}</td>
                    <td><Link href={`/videos/${r.video_id}`} className="hover:underline">{r.code} {r.title}</Link></td>
                    <td className="whitespace-nowrap">{r.node}</td>
                    <td className="whitespace-nowrap">{r.submitter}</td>
                    <td className="whitespace-nowrap">{r.reviewer}</td>
                    <td><Tag tone={r.status === "通过" ? "green" : "red"}>{r.status}</Tag></td>
                    <td className="whitespace-nowrap text-red-600">{r.reason}</td>
                    <td className="min-w-48 text-stone-600">{r.comment}</td>
                    <td>
                      {r.node === "成片审核" && me.role !== "cutter" ? (
                        <form action={setRecheck} className="flex gap-1">
                          <input type="hidden" name="review_id" value={r.id} />
                          <select name="recheck" defaultValue={r.recheck ?? ""} className="input h-7 w-20 text-xs"><option value="">—</option><option>通过</option><option>有问题</option></select>
                          <Submit done="已存" className="btn btn-sm">存</Submit>
                        </form>
                      ) : r.recheck}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {history.length === 0 && <div className="p-6 text-center text-sm text-stone-400">暂无记录</div>}
          </div>
          <Section title="近30天打回原因">
            {rejects.length === 0 ? <p className="text-sm text-stone-400">暂无</p> : (
              <ul className="space-y-1.5 text-sm">
                {rejects.map((x) => <li key={x.reason} className="flex justify-between"><span className={x.reason.startsWith("剪辑") ? "text-orange-700" : x.reason.startsWith("编导") ? "text-violet-700" : ""}>{x.reason}</span><span className="tabular-nums">{x.n}</span></li>)}
              </ul>
            )}
          </Section>
        </div>
      )}
    </>
  );
}
