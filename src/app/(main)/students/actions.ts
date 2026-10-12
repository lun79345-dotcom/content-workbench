"use server";
import { UserFacingError, actionResult } from "@/lib/action-errors";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { audit, get, nextCode, run, transaction } from "@/lib/db";
import { monthOf, today } from "@/lib/rules";
import { text as s, number as n, id as parseId, month, choice, date } from "@/lib/validation";
async function guard() { const me = await requireUser(); if (!["boss", "editor"].includes(me.role)) throw new UserFacingError("无权限"); return me; }
export async function addStudent(fd: FormData) {
  const me = await guard();
  const vals = [s(fd, "name", true, 100), s(fd, "school"), s(fd, "contact"), month(s(fd, "theme_month") ?? monthOf(today())), s(fd, "title", true), s(fd, "content"), fd.get("license_signed") ? 1 : 0];
  transaction(() => {
    const id = Number(run("INSERT INTO students(code,name,school,contact,theme_month,title,content,license_signed) VALUES(?,?,?,?,?,?,?,?)", nextCode("students", "S"), ...vals).lastInsertRowid);
    // Contact information is deliberately excluded from the audit ledger.
    audit(me.id, "student", id, "登记投稿", null, { name: vals[0], title: vals[4] });
  }); revalidatePath("/students");
}
export async function updateStudent(fd: FormData) {
  const me = await guard(), id = parseId(fd);
  transaction(() => {
    const st = get<{ license_signed: number; title: string; content: string | null; idea_id: number | null; name: string; code: string; bonus_kind: string | null; bonus_amount: number | null; paid_at: string | null; result: string }>("SELECT * FROM students WHERE id=?", id);
    if (!st) throw new UserFacingError("投稿不存在");
    const signed = fd.get("license_signed") ? 1 : 0;
    const result = choice(s(fd, "result") ?? "待评", ["待评", "入围", "采用", "未入选"], "评审结果");
    if (!signed && result !== "待评") throw new UserFacingError("授权书未签，不得进入评审");
    const amount = fd.has("bonus_amount") ? n(fd, "bonus_amount", { max: 1000000 }) : st.bonus_amount;
    const paid = fd.has("paid_at") ? date(s(fd, "paid_at")) : st.paid_at;
    const kind = fd.has("bonus_kind") ? s(fd, "bonus_kind") : st.bonus_kind;
    if (kind) choice(kind, ["入围奖", "采用奖", "爆款分成"], "奖项");
    if (me.role !== "boss" && (amount !== st.bonus_amount || paid !== st.paid_at || kind !== st.bonus_kind)) throw new UserFacingError("奖金及发放仅老板可登记");
    if (paid && (!signed || !amount || paid > today())) throw new UserFacingError("请核对授权、奖金金额和发放日期");
    run("UPDATE students SET license_signed=?,result=?,bonus_kind=?,bonus_amount=?,paid_at=?,note=? WHERE id=?", signed, result, kind, amount, paid, s(fd, "note"), id);
    if (signed && (result === "入围" || result === "采用") && !st.idea_id) {
      const r = run("INSERT INTO ideas(code,submitter_id,submitter_name,source,kind,content,status,note) VALUES(?,?,?,?,?,?,?,?)", nextCode("ideas", "C"), me.id, `学生：${st.name}`, "学生悬赏", "选题", st.title + (st.content ? `｜${st.content}` : ""), "待评", `来自 ${st.code}`);
      run("UPDATE students SET idea_id=? WHERE id=?", Number(r.lastInsertRowid), id);
    }
    audit(me.id, "student", id, "评审与发放", { result: st.result, bonus_amount: st.bonus_amount, paid_at: st.paid_at }, { signed, result, amount, paid });
  }); revalidatePath("/students"); revalidatePath("/ideas");
}

export async function addStudentForm(fd: FormData) { return actionResult(() => addStudent(fd)); }

export async function updateStudentForm(fd: FormData) { return actionResult(() => updateStudent(fd)); }
