import { all, get } from "./db";
import type { User } from "./auth";
import type { VideoRow } from "./rules";
import { canManageVideo } from "./permissions";
export const ASSET_LABELS = { script: "脚本", material: "拍摄素材", cut: "初剪 / 成片" } as const;
export type AssetKind = keyof typeof ASSET_LABELS;
export type VideoAsset = { id: number; kind: AssetKind; version: number; url: string; note: string | null; name: string | null; created_at: string };
export function assetKindsFor(u: Pick<User, "id" | "role">, v: VideoRow): AssetKind[] {
  if (v.archived_at || v.published_at) return [];
  if (canManageVideo(u, v)) {
    if (["选题", "脚本"].includes(v.stage)) return ["script"];
    if (v.stage === "拍摄") return ["material"];
    if (v.stage === "剪辑") return ["material", "cut"];
  }
  return v.stage === "剪辑" && u.role === "cutter" && u.id === v.cutter_id ? ["cut"] : [];
}
export function videoAssets(id: number) {
  return all<VideoAsset>("SELECT a.*,u.name FROM video_assets a LEFT JOIN users u ON u.id=a.created_by WHERE a.video_id=? ORDER BY a.version DESC,a.id DESC", id);
}
export function latestAsset(id: number, kind: AssetKind) {
  return get<{ id: number }>("SELECT id FROM video_assets WHERE video_id=? AND kind=? ORDER BY version DESC LIMIT 1", id, kind)?.id ?? null;
}
