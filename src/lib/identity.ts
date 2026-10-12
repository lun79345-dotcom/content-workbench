import { get, run, transaction } from "./db";
export function identifyFeishu(info: { open_id: string; name: string; avatar_url?: string }) {
  if (!info.open_id || !info.name) throw new Error("飞书返回的身份信息不完整");
  return transaction(() => {
    const existing = get<{ id: number }>("SELECT id FROM users WHERE feishu_open_id=?", info.open_id);
    if (existing) {
      run("UPDATE users SET avatar=? WHERE id=?", info.avatar_url ?? null, existing.id);
      return { id: existing.id, created: false };
    }
    // Identity comes exclusively from open_id. Display names never grant roles or bind presets.
    const allowed = (process.env.BOSS_FEISHU_OPEN_IDS ?? "").split(",").map((x) => x.trim()).filter(Boolean);
    const role = allowed.includes(info.open_id) ? "boss" : "pending";
    const result = run("INSERT INTO users(name,role,feishu_open_id,avatar) VALUES(?,?,?,?)", info.name, role, info.open_id, info.avatar_url ?? null);
    return { id: Number(result.lastInsertRowid), created: role === "pending" };
  });
}
