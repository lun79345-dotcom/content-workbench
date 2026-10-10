import Link from "next/link";
import { Submit } from "@/components/submit";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { all, run } from "@/lib/db";
import { Empty, PageHeader } from "@/components/ui";

async function markAllRead() {
  "use server";
  const me = await requireUser();
  run("UPDATE notifications SET read=1 WHERE user_id=?", me.id);
  revalidatePath("/", "layout");
}

export default async function Notifications() {
  const me = await requireUser();
  const rows = all<{ id: number; text: string; link: string | null; read: number; created_at: string }>(
    "SELECT * FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 100", me.id);
  return (
    <>
      <PageHeader title="通知" desc="配置飞书应用后，这些通知会同步推送到飞书。"
        actions={<form action={markAllRead}><Submit done={null} className="btn btn-sm">全部已读</Submit></form>} />
      {rows.length === 0 ? <Empty>暂无通知</Empty> : (
        <ul className="card divide-y divide-stone-100">
          {rows.map((n) => (
            <li key={n.id} className={`flex items-center justify-between gap-3 px-4 py-3 text-sm ${n.read ? "text-stone-500" : ""}`}>
              <span className="flex items-center gap-2">{!n.read && <span className="h-1.5 w-1.5 rounded-full bg-red-500" />}{n.link ? <Link href={n.link} className="hover:underline">{n.text}</Link> : n.text}</span>
              <span className="shrink-0 text-xs text-stone-400">{n.created_at.slice(5, 16)}</span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
