"use server";
import { revalidatePath } from "next/cache";
import { requireBoss } from "@/lib/auth";
import { run } from "@/lib/db";

export async function saveTarget(fd: FormData) {
  await requireBoss();
  const raw = String(fd.get("target") ?? "").replace(/[,，\s]/g, "");
  const v = raw === "" ? null : Math.round(Number(raw.replace(/w$/i, "")) * (/w$/i.test(raw) ? 10000 : 1));
  run("INSERT INTO targets(month, account_id, target_plays) VALUES(?,?,?) ON CONFLICT(month, account_id) DO UPDATE SET target_plays=excluded.target_plays",
    fd.get("month"), Number(fd.get("account_id")), v);
  revalidatePath("/data");
  revalidatePath("/dashboard");
}
