import { ActionForm } from "@/components/action-form";
import { requireUser } from "@/lib/auth";
import { get } from "@/lib/db";
import { accounts, people } from "@/lib/queries";
import { getRules } from "@/lib/rules";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { NewVideoForm } from "@/components/new-video-form";
import { createVideoForm as createVideo } from "../actions";

export default async function NewVideo({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const me = await requireUser();
  if (!["boss", "editor"].includes(me.role)) redirect("/board");
  const sp = await searchParams;
  const idea = sp.idea ? get<{ id: number; content: string; account_id: number | null }>("SELECT id, content, account_id FROM ideas WHERE id=?", Number(sp.idea)) : undefined;
  return (
    <>
      <PageHeader title="新建需求单" desc="先填核心信息，排期和剪辑可在后续阶段补充。" />
      <ActionForm action={createVideo} className="workflow-form max-w-6xl space-y-5">
        <NewVideoForm accounts={accounts().map(({ id, name, editor_id }) => ({ id, name, editor_id }))} editors={people("editor").map((p) => ({ ...p }))} cutters={people("cutter").map((p) => ({ ...p }))} cutLevels={Object.keys(getRules().cut_levels)} viewerId={me.id} viewerRole={me.role} ideaId={idea?.id} defaultTitle={idea?.content} defaultAccountId={sp.account ? Number(sp.account) : idea?.account_id ?? undefined} />
      </ActionForm>
    </>
  );
}
