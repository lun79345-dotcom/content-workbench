"use server";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { get, nextCode, run } from "@/lib/db";
import { notify } from "@/lib/notify";

const s = (fd: FormData, k: string) => (fd.get(k) ? String(fd.get(k)).trim() : null);

export async function submitIdea(fd: FormData) {
  const me = await requireUser();
  run("INSERT INTO ideas(code, submitter_id, submitter_name, source, account_id, kind, content, ref_url) VALUES(?,?,?,?,?,?,?,?)",
    nextCode("ideas", "C"), me.id, me.name, s(fd, "source") ?? "内部拆解", s(fd, "account_id") ? Number(fd.get("account_id")) : null,
    s(fd, "kind"), s(fd, "content"), s(fd, "ref_url"));
  revalidatePath("/ideas");
}

export async function gradeIdea(fd: FormData) {
  const me = await requireUser();
  if (me.role === "cutter") return;
  const id = Number(fd.get("id"));
  const before = get<{ grade: string | null; submitter_id: number | null; code: string }>("SELECT grade, submitter_id, code FROM ideas WHERE id=?", id);
  run("UPDATE ideas SET grade=?, status=?, note=? WHERE id=?", s(fd, "grade"), s(fd, "status") ?? "待评", s(fd, "note"), id);
  const grade = s(fd, "grade");
  if (before && grade && grade !== before.grade && (grade === "S" || grade === "A")) {
    await notify(before.submitter_id, `你投的创意 ${before.code} 被评为 ${grade} 级`, "/ideas");
  }
  revalidatePath("/ideas");
}
