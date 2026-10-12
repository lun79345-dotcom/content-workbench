import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { accounts, listVideos, people } from "@/lib/queries";
import { STAGES, overdueDays, addDays, today } from "@/lib/rules";
import { PageHeader } from "@/components/ui";
import { STAGE_COLOR, VideoCard } from "@/components/video";
import { Plus } from "lucide-react";

export default async function BoardPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const me = await requireUser();
  const sp = await searchParams;
  const conds = ["(v.stage!='已发布' OR v.published_at >= ?)"];
  const args: unknown[] = [addDays(today(), -7)];
  if (sp.account) { conds.push("v.account_id=?"); args.push(Number(sp.account)); }
  if (sp.person) { conds.push("(v.editor_id=? OR v.cutter_id=?)"); args.push(Number(sp.person), Number(sp.person)); }
  const videos = listVideos(conds.join(" AND "), ...args);
  const overdue = videos.filter((v) => overdueDays(v) > 0).length;
  const accs = accounts();
  const ppl = people().filter((p) => p.role !== "boss");
  const q = (k: string, val?: number) => {
    const p = new URLSearchParams(sp);
    if (val == null) p.delete(k); else p.set(k, String(val));
    return `/board?${p}`;
  };

  return (
    <>
      <PageHeader
        title="生产看板"
        desc={<>一条视频一张卡，从选题走到发布。进行中 {videos.filter((v) => v.stage !== "已发布").length} 条{overdue > 0 && <span className="text-red-600">，逾期 {overdue} 条</span>}；已发布只显示近7天。</>}
        actions={me.role !== "cutter" && <Link href={sp.account ? `/videos/new?account=${encodeURIComponent(sp.account)}` : "/videos/new"} className="btn btn-primary"><Plus size={16} />新建需求单</Link>}
      />
      <div className="mb-5 space-y-2">
        <Chips label="账号" items={[{ href: q("account"), label: "全部", on: !sp.account }, ...accs.map((a) => ({ href: q("account", a.id), label: a.name, on: sp.account == String(a.id) }))]} />
        <Chips label="成员" items={[{ href: q("person"), label: "全部", on: !sp.person }, { href: q("person", me.id), label: "只看我", on: sp.person == String(me.id) }, ...ppl.filter((p) => p.id !== me.id).map((p) => ({ href: q("person", p.id), label: p.name, on: sp.person == String(p.id) }))]} />
      </div>
      <div className="-mx-4 overflow-x-auto px-4 pb-4 md:-mx-8 md:px-8">
        <div className="flex gap-3" style={{ minWidth: STAGES.length * 252 }}>
          {STAGES.map((st) => {
            const col = videos.filter((v) => v.stage === st);
            return (
              <div key={st} className="w-60 shrink-0 rounded-2xl bg-stone-200/40 p-2">
                <div className="mb-2 flex items-center gap-2 px-1.5 pt-1 text-xs font-semibold text-stone-700">
                  <span className={`h-2 w-2 rounded-full ${STAGE_COLOR[st]}`} />{st}
                  <span className="ml-auto rounded-full bg-white px-1.5 text-[11px] font-medium text-stone-500">{col.length}</span>
                </div>
                <div className="space-y-2">
                  {col.map((v) => <VideoCard key={v.id} v={v} />)}
                  {col.length === 0 && <div className="rounded-xl border border-dashed border-stone-300/70 py-6 text-center text-xs text-stone-400">暂无</div>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

function Chips({ label, items }: { label: string; items: { href: string; label: string; on: boolean }[] }) {
  return (
    <div className="-mx-4 flex items-center gap-1.5 overflow-x-auto px-4 md:mx-0 md:flex-wrap md:px-0">
      <span className="mr-1 shrink-0 text-xs text-stone-400">{label}</span>
      {items.map((i) => (
        <Link key={i.href + i.label} href={i.href} className={`shrink-0 rounded-full px-3 py-1 text-xs transition-colors ${i.on ? "bg-stone-900 text-white" : "bg-white text-stone-600 ring-1 ring-stone-200 hover:bg-stone-50"}`}>{i.label}</Link>
      ))}
    </div>
  );
}
