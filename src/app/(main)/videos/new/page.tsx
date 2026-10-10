import { requireUser } from "@/lib/auth";
import { Submit } from "@/components/submit";
import { get } from "@/lib/db";
import { accounts, people } from "@/lib/queries";
import { PageHeader } from "@/components/ui";
import { VideoForm } from "@/components/video";
import { createVideo } from "../actions";

export default async function NewVideo({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  await requireUser();
  const sp = await searchParams;
  const idea = sp.idea ? get<{ id: number; content: string }>("SELECT id, content FROM ideas WHERE id=?", Number(sp.idea)) : undefined;
  return (
    <>
      <PageHeader title="新建选题" desc="一条视频 = 一张编导→剪辑需求单。五个截止时间在周一选题会上承诺。" />
      <form action={createVideo} className="card p-5">
        <VideoForm accounts={accounts()} editors={people("editor")} cutters={people("cutter")} ideaId={idea?.id} defaultTitle={idea?.content} />
        <div className="mt-5 flex justify-end"><Submit done={null} className="btn btn-primary">创建</Submit></div>
      </form>
    </>
  );
}
