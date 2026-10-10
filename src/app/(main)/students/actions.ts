"use server";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { get, nextCode, run } from "@/lib/db";
import { monthOf, today } from "@/lib/rules";

const s = (fd: FormData, k: string) => (fd.get(k) ? String(fd.get(k)).trim() : null);

async function guard() {
  const me = await requireUser();
  if (me.role === "cutter") throw new Error("无权限");
  return me;
}

export async function addStudent(fd: FormData) {
  await guard();
  run("INSERT INTO students(code,name,school,contact,theme_month,title,content,license_signed) VALUES(?,?,?,?,?,?,?,?)",
    nextCode("students", "S"), s(fd, "name"), s(fd, "school"), s(fd, "contact"), s(fd, "theme_month") ?? monthOf(today()),
    s(fd, "title"), s(fd, "content"), fd.get("license_signed") ? 1 : 0);
  revalidatePath("/students");
}

export async function updateStudent(fd: FormData) {
  const me = await guard();
  const id = Number(fd.get("id"));
  const st = get<{ license_signed: number; title: string; content: string | null; idea_id: number | null; name: string; code: string }>("SELECT * FROM students WHERE id=?", id);
  if (!st) return;
  const signed = fd.get("license_signed") ? 1 : 0;
  let result = s(fd, "result") ?? "待评";
  // 授权书未签：不得进入评审
  if (!signed && result !== "待评") result = "待评";
  const amount = s(fd, "bonus_amount") ? Number(fd.get("bonus_amount")) : null;
  run("UPDATE students SET license_signed=?, result=?, bonus_kind=?, bonus_amount=?, paid_at=?, note=? WHERE id=?",
    signed, result, s(fd, "bonus_kind"), amount, s(fd, "paid_at"), s(fd, "note"), id);
  // 入围/采用的投稿自动进创意库
  if (signed && (result === "入围" || result === "采用") && !st.idea_id) {
    const r = run("INSERT INTO ideas(code, submitter_id, submitter_name, source, kind, content, status, note) VALUES(?,?,?,?,?,?,?,?)",
      nextCode("ideas", "C"), me.id, `学生：${st.name}`, "学生悬赏", "选题", st.title + (st.content ? `｜${st.content}` : ""), "待评", `来自 ${st.code}`);
    run("UPDATE students SET idea_id=? WHERE id=?", Number(r.lastInsertRowid), id);
  }
  revalidatePath("/students");
  revalidatePath("/ideas");
}
