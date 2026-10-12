import { ActionForm } from "@/components/action-form";
import { requireUser } from "@/lib/auth";
import { Submit } from "@/components/submit";
import { all } from "@/lib/db";
import { monthOf, shortDate, today } from "@/lib/rules";
import { Field, PageHeader, Section, Tag } from "@/components/ui";
import { addStudentForm as addStudent, updateStudentForm as updateStudent } from "./actions";

type St = { id: number; code: string; name: string; school: string | null; contact: string | null; theme_month: string; title: string; content: string | null;
  license_signed: number; result: string; bonus_kind: string | null; bonus_amount: number | null; paid_at: string | null; idea_id: number | null; note: string | null; created_at: string };

export default async function StudentsPage() {
  const me = await requireUser();
  const canEdit = me.role !== "cutter";
  const rows = all<St>("SELECT * FROM students ORDER BY id DESC");
  const paid = rows.filter((r) => r.paid_at).reduce((s, r) => s + (r.bonus_amount ?? 0), 0);
  const owed = rows.filter((r) => r.bonus_amount && !r.paid_at).reduce((s, r) => s + (r.bonus_amount ?? 0), 0);

  return (
    <>
      <PageHeader title="学生创意征集"
        desc={<>入围奖 50-200 / 采用奖 300-800 / 播出爆款分成（参照内部爆款奖 50%）。<b className="text-red-600">授权书未签不得进入评审</b>；入围或采用后自动进创意库。已发 ¥{paid}，待发 ¥{owed}。</>} />
      {canEdit && (
        <Section title="登记投稿" className="mb-4">
          <ActionForm action={addStudent} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
            <Field label="姓名"><input name="name" required className="input" /></Field>
            <Field label="学校/院系"><input name="school" className="input" /></Field>
            <Field label="联系方式"><input name="contact" className="input" /></Field>
            <Field label="主题月份"><input type="month" name="theme_month" defaultValue={monthOf(today())} className="input" /></Field>
            <Field label="创意标题" className="lg:col-span-2"><input name="title" required className="input" /></Field>
            <Field label="创意内容" className="sm:col-span-2 lg:col-span-4"><input name="content" className="input" /></Field>
            <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" name="license_signed" /> 授权书已签</label>
            <div className="flex items-end"><Submit done={null} className="btn btn-primary w-full">登记</Submit></div>
          </ActionForm>
        </Section>
      )}
      <div className="card overflow-x-auto">
        <table className="tbl">
          <thead><tr><th>编号</th><th>日期</th><th>姓名</th><th>学校</th><th>联系</th><th>创意</th><th>授权 / 评审 / 奖金 / 发放</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="text-stone-500">{r.code}</td>
                <td className="text-stone-500">{shortDate(r.created_at)}</td>
                <td className="whitespace-nowrap">{r.name}</td>
                <td className="whitespace-nowrap text-stone-600">{r.school}</td>
                <td className="whitespace-nowrap text-stone-600">{canEdit ? r.contact : "仅编导和老板可见"}</td>
                <td className="min-w-56"><div className="font-medium">{r.title}</div>{r.content && <div className="text-xs text-stone-500">{r.content}</div>}{r.idea_id && <Tag tone="blue">已入创意库</Tag>}</td>
                <td>
                  {canEdit ? (
                    <ActionForm action={updateStudent} className="flex flex-wrap items-center gap-1">
                      <input type="hidden" name="id" value={r.id} />
                      <label className="flex items-center gap-1 text-xs"><input type="checkbox" name="license_signed" defaultChecked={!!r.license_signed} />授权</label>
                      <select name="result" defaultValue={r.result} className="input h-7 w-20 text-xs">{["待评", "入围", "采用", "未入选"].map((x) => <option key={x} disabled={!r.license_signed && x !== "待评"}>{x}</option>)}</select>
                      <select disabled={me.role !== "boss"} name="bonus_kind" defaultValue={r.bonus_kind ?? ""} className="input h-7 w-20 text-xs"><option value="">奖项</option>{["入围奖", "采用奖", "爆款分成"].map((x) => <option key={x}>{x}</option>)}</select>
                      <input disabled={me.role !== "boss"} name="bonus_amount" defaultValue={r.bonus_amount ?? ""} placeholder="金额" className="input h-7 w-16 text-xs" />
                      <input disabled={me.role !== "boss"} type="date" name="paid_at" defaultValue={r.paid_at ?? ""} className="input h-7 w-32 text-xs" title="发放日期" />
                      <Submit done="已存" className="btn btn-sm">存</Submit>
                    </ActionForm>
                  ) : <Tag>{r.result}</Tag>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <div className="p-6 text-center text-sm text-stone-400">暂无投稿</div>}
      </div>
    </>
  );
}
