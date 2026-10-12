import type { User } from "./auth";
import type { VideoRow } from "./rules";
export function canManageVideo(u: Pick<User, "id" | "role">, v: VideoRow) {
  return !v.archived_at && (u.role === "boss" || (u.role === "editor" && u.id === v.editor_id));
}
export function canAdvanceVideo(u: Pick<User, "id" | "role">, v: VideoRow) {
  return canManageVideo(u, v) || (!v.archived_at && v.stage === "剪辑" && u.role === "cutter" && u.id === v.cutter_id);
}
export function canRecheck(u: Pick<User, "id" | "role">, leader: number | null) {
  return u.role === "boss" || (u.role === "editor" && u.id === leader);
}
