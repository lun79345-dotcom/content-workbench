import Link from "next/link";
import { Submit } from "@/components/submit";
import { requireUser } from "@/lib/auth";
import { all } from "@/lib/db";
import { accounts } from "@/lib/queries";
import { IDEA_SOURCES, IDEA_STATUS, fmtNum, shortDate } from "@/lib/rules";
import { Field, PageHeader, Section, Select, Tabs, Tag } from "@/components/ui";
import { gradeIdea, submitIdea } from "./actions";

type Idea = { id: number; code: string; submitter_name: string; source: string; account_name: string | null; kind: string | null; content: string; ref_url: string | null;
  grade: string | null; status: string; video_id: number | null; video_code: string | null; video_published: string | null; plays: number | null; note: string | null; created_at: string };

const GRADE_TONE = { S: "red", A: "amber", B: "blue", C: "gray" } as const;

export default async function IdeasPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const me = await requireUser();
  const status = (await searchParams).status ?? "待评";
  const canGrade = me.role !== "cutter";
  const ideas = all<Idea>(`
    SELECT i.*, a.name account_name, v.code video_code, v.publish_date video_published,
      (SELECT sum(plays) FROM metrics m WHERE m.video_id=i.video_id AND m.checkpoint='d7' AND m.platform IN ('douyin','wechat')) plays
    FROM ideas i LEFT JOIN accounts a ON a.id=i.account_id LEFT JOIN videos v ON v.id=i.video_id
    WHERE ${status === "全部" ? "1=1" : "i.status=?"} ORDER BY CASE i.grade WHEN 'S' THEN 0 WHEN 'A' THEN 1 WHEN 'B' THEN 2 WHEN 'C' THEN 3 ELSE 4 END, i.id DESC`,
    ...(status === "全部" ? [] : [status]));
  const counts = all<{ status: string; n: number }>("SELECT status, count(*) n FROM ideas GROUP BY status");
  const accs = accounts();

  return (
    <>
      <PageHeader title="创意库" desc="全员随时投递，周一选题会评级；S/A 级一键转成选题，拍完自动回填成片播放。" />
      <Section title="投个创意" className="mb-4">
        <form action={submitIdea} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1fr_1fr_auto]">
          <Field label="一句话创意"><input name="content" required className="input" placeholder="开头直接抛冲突：'我删掉了老板微信'" /></Field>
          <Field label="来源"><Select name="source" options={IDEA_SOURCES} /></Field>
          <Field label="类型"><Select name="kind" options={["选题", "钩子", "梗/台词", "形式", "BGM/包装"]} /></Field>
          <Field label="归属账号"><Select name="account_id" placeholder="不限" options={accs.map((a) => ({ value: a.id, label: a.name }))} /></Field>
          <Field label="参考链接"><input name="ref_url" className="input" /></Field>
          <div className="flex items-end"><Submit done={null} className="btn btn-primary w-full">投递</Submit></div>
        </form>
      </Section>
      <Tabs current={status} items={[...IDEA_STATUS, "全部"].map((s) => ({ key: s, href: `/ideas?status=${s}`, label: `${s}${s === "全部" ? "" : ` ${counts.find((c) => c.status === s)?.n ?? 0}`}` }))} />
      <div className="card overflow-x-auto">
        <table className="tbl">
          <thead><tr><th>编号</th><th>日期</th><th>投递人</th><th>来源</th><th>账号</th><th>创意</th><th>评级 / 状态 / 备注</th><th>成片</th></tr></thead>
          <tbody>
            {ideas.map((i) => (
              <tr key={i.id}>
                <td className="text-stone-500">{i.code}</td>
                <td className="whitespace-nowrap text-stone-500">{shortDate(i.created_at)}</td>
                <td className="whitespace-nowrap">{i.submitter_name}</td>
                <td className="whitespace-nowrap">{i.source}</td>
                <td className="whitespace-nowrap">{i.account_name ?? "—"}</td>
                <td className="min-w-64">
                  {i.kind && <Tag>{i.kind}</Tag>} {i.content}
                  {i.ref_url && <a href={i.ref_url} target="_blank" className="ml-1 text-xs text-brand-600">参考↗</a>}
                </td>
                <td>
                  {canGrade ? (
                    <form action={gradeIdea} className="flex flex-wrap gap-1">
                      <input type="hidden" name="id" value={i.id} />
                      <select name="grade" defaultValue={i.grade ?? ""} className="input h-7 w-14 text-xs"><option value="">—</option>{["S", "A", "B", "C"].map((g) => <option key={g}>{g}</option>)}</select>
                      <select name="status" defaultValue={i.status} className="input h-7 w-20 text-xs">{IDEA_STATUS.map((s) => <option key={s}>{s}</option>)}</select>
                      <input name="note" defaultValue={i.note ?? ""} placeholder="备注" className="input h-7 w-28 text-xs" />
                      <Submit done="已存" className="btn btn-sm">存</Submit>
                    </form>
                  ) : <span className="flex gap-1">{i.grade && <Tag tone={GRADE_TONE[i.grade as keyof typeof GRADE_TONE]}>{i.grade}</Tag>}<Tag>{i.status}</Tag></span>}
                </td>
                <td className="whitespace-nowrap">
                  {i.video_id ? <Link href={`/videos/${i.video_id}`} className="text-brand-600 hover:underline">{i.video_code}{i.plays ? ` · 7天${fmtNum(i.plays)}` : ""}</Link>
                    : canGrade && i.status !== "已弃" ? <Link href={`/videos/new?idea=${i.id}`} className="btn btn-sm">转为选题</Link> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {ideas.length === 0 && <div className="p-6 text-center text-sm text-stone-400">暂无</div>}
      </div>
    </>
  );
}
