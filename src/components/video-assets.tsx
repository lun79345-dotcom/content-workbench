import { ASSET_LABELS, type AssetKind, type VideoAsset } from "@/lib/video-assets";
import { ActionForm } from "./action-form";
import { Field, Section, Tag } from "./ui";
import { Submit } from "./submit";
import { saveVideoAssetForm } from "@/app/(main)/videos/actions";

export function VideoAssets({ id, revision, assets, kinds, approvedIds }: { id: number; revision: number; assets: VideoAsset[]; kinds: AssetKind[]; approvedIds: number[] }) {
  return <Section title="素材与成片交接" className="mb-4">
    <p className="mb-4 text-sm text-stone-500">粘贴现有飞书或网盘链接即可。每次保存新增一个版本，历史链接保留；审核通过会标明对应版本。</p>
    <div className="grid gap-3 sm:grid-cols-3">{(Object.keys(ASSET_LABELS) as AssetKind[]).map((kind) => {
      const entries = assets.filter((a) => a.kind === kind), latest = entries[0], approved = entries.find((a) => approvedIds.includes(a.id));
      return <div key={kind} className="min-w-0 rounded-xl border border-stone-200 p-3">
        <h3 className="mb-2 text-sm font-medium">{ASSET_LABELS[kind]}</h3>
        {latest ? <><a href={latest.url} target="_blank" rel="noopener noreferrer" className="block break-all text-sm text-brand-700 underline">打开最新版本 · V{latest.version}</a>{latest.note && <p className="mt-2 whitespace-pre-wrap break-words text-sm">{latest.note}</p>}<p className="mt-2 text-xs text-stone-500">{latest.name ?? "原成员"} · {latest.created_at.slice(5, 16)}</p></> : <p className="text-sm text-stone-500">暂未登记{kind === "script" ? "，原需求单的脚本链接仍可使用" : ""}</p>}
        {approved && <div className="mt-3"><Tag tone="green">已通过 V{approved.version}</Tag>{approved.id !== latest?.id && <a href={approved.url} target="_blank" rel="noopener noreferrer" className="ml-2 text-sm text-brand-700 underline">打开已通过版本</a>}</div>}
        {entries.length > 1 && <details className="mt-3 text-xs"><summary className="cursor-pointer text-stone-600">版本记录（{entries.length}）</summary><ul className="mt-2 space-y-3">{entries.map((a) => <li key={a.id}><a href={a.url} target="_blank" rel="noopener noreferrer" className="text-brand-700 underline">V{a.version} · {a.created_at.slice(5, 16)}</a><p className="whitespace-pre-wrap break-words text-stone-500">{a.note ?? ""}</p></li>)}</ul></details>}
      </div>;
    })}</div>
    {kinds.length > 0 && <details className="mt-4 border-t border-stone-100 pt-4">
      <summary className="cursor-pointer text-sm font-medium text-brand-700">登记交付链接 / 新版本</summary>
      <ActionForm action={saveVideoAssetForm} className="mt-4 grid gap-3 sm:grid-cols-2">
        <input type="hidden" name="id" value={id} /><input type="hidden" name="revision" value={revision} />
        <Field label="交付类型"><select name="kind" className="input">{kinds.map((kind) => <option key={kind} value={kind}>{ASSET_LABELS[kind]}</option>)}</select></Field>
        <Field label="飞书 / 网盘链接"><input name="url" type="url" required maxLength={2048} className="input" placeholder="https://…" /></Field>
        <Field label="版本说明 · 可不填" className="sm:col-span-2"><textarea name="note" rows={2} maxLength={1000} className="input" placeholder="如：补齐素材、调整字幕、修订结尾；提取码可写在这里" /></Field>
        <div className="sm:col-span-2"><Submit className="btn btn-primary">保存交付版本</Submit></div>
      </ActionForm>
    </details>}
  </Section>;
}
