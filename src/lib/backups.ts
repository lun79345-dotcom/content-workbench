import fs from "node:fs";
import path from "node:path";
import { db } from "./db";
import { getSetting, setSetting, today } from "./rules";
/** VACUUM INTO includes committed WAL data; copying app.db alone does not. */
export function dailyBackup() {
  const day = today();
  if (getSetting("last_backup_day") === day) return;
  const directory = path.join(process.env.DATA_DIR || path.join(process.cwd(), "data"), "backups");
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, `daily-${day}-${Date.now()}.db`);
  db().exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  setSetting("last_backup_day", day);
  setSetting("last_backup", JSON.stringify({ at: new Date().toISOString(), file: path.basename(file), ok: true }));
  const files = fs.readdirSync(directory).filter((f) => /^daily-.*\.db$/.test(f)).sort().reverse();
  for (const old of files.slice(30)) fs.unlinkSync(path.join(directory, old));
}
