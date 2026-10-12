import type { DatabaseSync } from "node:sqlite";

/** Additive, repeatable migration. Never delete or rebuild historical records. */
export function migrate(d: DatabaseSync) {
  const add = (table: string, name: string, definition: string) => {
    const columns = d.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (!columns.some((c) => c.name === name)) d.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
  };
  d.exec("BEGIN IMMEDIATE");
  try {
    add("users", "session_version", "INTEGER NOT NULL DEFAULT 0");
    add("videos", "archived_at", "TEXT");
    add("videos", "late_exempt_reason", "TEXT");
    add("videos", "bonus_snapshot", "TEXT");
    add("videos", "revision", "INTEGER NOT NULL DEFAULT 0");
    add("reviews", "cutter_id_snapshot", "INTEGER");
    add("reviews", "editor_id_snapshot", "INTEGER");
    add("reviews", "recheck_by", "INTEGER");
    add("reviews", "asset_id_snapshot", "INTEGER");
    add("notifications", "attempts", "INTEGER NOT NULL DEFAULT 0");
    add("notifications", "next_attempt_at", "TEXT");
    add("notifications", "last_error", "TEXT");
    d.exec(`
      CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY, actor_id INTEGER, entity TEXT NOT NULL, entity_id INTEGER,
        action TEXT NOT NULL, before_json TEXT, after_json TEXT, reason TEXT,
        created_at TEXT DEFAULT (datetime('now','+8 hours'))
      );
      CREATE TABLE IF NOT EXISTS video_assets (
        id INTEGER PRIMARY KEY, video_id INTEGER NOT NULL REFERENCES videos(id),
        kind TEXT NOT NULL CHECK(kind IN ('script','material','cut')),
        version INTEGER NOT NULL, url TEXT NOT NULL, note TEXT,
        created_by INTEGER NOT NULL REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT (datetime('now','+8 hours')),
        UNIQUE(video_id,kind,version)
      );
      CREATE TABLE IF NOT EXISTS benchmark_runs (
        id INTEGER PRIMARY KEY, sec_user_id TEXT NOT NULL, nickname TEXT, input_url TEXT NOT NULL,
        requested_by INTEGER NOT NULL REFERENCES users(id), status TEXT NOT NULL,
        cutoff TEXT NOT NULL, truncated INTEGER NOT NULL DEFAULT 0, error TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now','+8 hours'))
      );
      CREATE UNIQUE INDEX IF NOT EXISTS benchmark_running ON benchmark_runs(sec_user_id) WHERE status='running';
      CREATE TABLE IF NOT EXISTS benchmark_videos (
        id INTEGER PRIMARY KEY, run_id INTEGER NOT NULL REFERENCES benchmark_runs(id), aweme_id TEXT NOT NULL,
        caption TEXT NOT NULL, published_at TEXT NOT NULL, duration INTEGER,
        plays INTEGER, likes INTEGER, comments INTEGER, collects INTEGER, shares INTEGER,
        UNIQUE(run_id,aweme_id)
      );
      CREATE TABLE IF NOT EXISTS ai_jobs (
        id INTEGER PRIMARY KEY, kind TEXT NOT NULL, source_key TEXT NOT NULL,
        requested_by INTEGER NOT NULL REFERENCES users(id), input_json TEXT NOT NULL, input_hash TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'queued', report_json TEXT, transcript TEXT, error TEXT,
        lease_id TEXT, lease_until TEXT, requested_at TEXT NOT NULL DEFAULT (datetime('now','+8 hours')),
        started_at TEXT, completed_at TEXT
      );
      DROP INDEX IF EXISTS ai_job_pending;
      CREATE UNIQUE INDEX ai_job_pending ON ai_jobs(kind,source_key) WHERE status IN ('queued','transcribing','ready','running');
      CREATE TABLE IF NOT EXISTS work_deliveries (
        id INTEGER PRIMARY KEY, video_id INTEGER NOT NULL UNIQUE REFERENCES videos(id),
        cutter_id INTEGER NOT NULL REFERENCES users(id), editor_id INTEGER,
        code TEXT NOT NULL, title TEXT NOT NULL, account_name TEXT, cutter_name TEXT,
        cut_level TEXT NOT NULL, base_units REAL NOT NULL, extra_units REAL NOT NULL,
        due_rough TEXT, late_exempt_reason TEXT, submitted_at TEXT NOT NULL,
        provenance TEXT NOT NULL DEFAULT 'snapshot'
      );
      CREATE TABLE IF NOT EXISTS workload_requests (
        id INTEGER PRIMARY KEY, video_id INTEGER NOT NULL REFERENCES videos(id), cutter_id INTEGER NOT NULL,
        cut_level TEXT NOT NULL, extra_units REAL NOT NULL, due_rough TEXT, reason TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending', reviewer_id INTEGER, comment TEXT,
        created_at TEXT DEFAULT (datetime('now','+8 hours')), done_at TEXT
      );
      CREATE TABLE IF NOT EXISTS account_weekly (
        account_id INTEGER NOT NULL REFERENCES accounts(id), week TEXT NOT NULL,
        summary TEXT, successes TEXT, issues TEXT, next_plan TEXT,
        updated_by INTEGER REFERENCES users(id), revision INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL DEFAULT (datetime('now','+8 hours')),
        PRIMARY KEY(account_id,week)
      );
      CREATE TABLE IF NOT EXISTS metric_snapshots (
        id INTEGER PRIMARY KEY, video_id INTEGER NOT NULL REFERENCES videos(id),
        platform TEXT NOT NULL, collected_date TEXT NOT NULL, collected_at TEXT NOT NULL,
        published_at TEXT NOT NULL, publication_url TEXT NOT NULL,
        plays INTEGER, likes INTEGER, comments INTEGER, collects INTEGER, shares INTEGER,
        source TEXT NOT NULL, UNIQUE(video_id,platform,collected_date)
      );
      CREATE TABLE IF NOT EXISTS platform_video_ids (
        video_id INTEGER NOT NULL REFERENCES videos(id), platform TEXT NOT NULL,
        publication_url TEXT NOT NULL, item_id TEXT NOT NULL,
        PRIMARY KEY(video_id,platform)
      );
      CREATE TABLE IF NOT EXISTS tikhub_requests (
        id INTEGER PRIMARY KEY, request_date TEXT NOT NULL, kind TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now','+8 hours'))
      );
      CREATE INDEX IF NOT EXISTS tikhub_requests_day ON tikhub_requests(request_date,kind);
      CREATE TABLE IF NOT EXISTS tikhub_attempts (
        video_id INTEGER NOT NULL REFERENCES videos(id), platform TEXT NOT NULL, kind TEXT NOT NULL,
        attempt_date TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, success INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY(video_id,platform,kind,attempt_date)
      );
      CREATE TABLE IF NOT EXISTS account_review_jobs (
        id INTEGER PRIMARY KEY, account_id INTEGER NOT NULL REFERENCES accounts(id), week TEXT NOT NULL,
        requested_by INTEGER NOT NULL REFERENCES users(id), input_json TEXT NOT NULL, input_hash TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'queued', report_json TEXT, error TEXT,
        lease_id TEXT, lease_until TEXT, started_at TEXT, completed_at TEXT,
        requested_at TEXT NOT NULL DEFAULT (datetime('now','+8 hours'))
      );
      CREATE UNIQUE INDEX IF NOT EXISTS account_review_pending ON account_review_jobs(account_id,week) WHERE status IN ('queued','running');
      CREATE INDEX IF NOT EXISTS account_review_period ON account_review_jobs(account_id,week,id);
      CREATE INDEX IF NOT EXISTS work_period ON work_deliveries(cutter_id,submitted_at);
      CREATE INDEX IF NOT EXISTS review_video ON reviews(video_id,status);
      CREATE INDEX IF NOT EXISTS bonus_video ON bonuses(video_id,published);
      CREATE INDEX IF NOT EXISTS notification_queue ON notifications(pushed,next_attempt_at);
      CREATE UNIQUE INDEX IF NOT EXISTS request_pending ON workload_requests(video_id) WHERE status='pending';
      CREATE TRIGGER IF NOT EXISTS bonus_lock_update BEFORE UPDATE ON bonuses WHEN OLD.published=1
        BEGIN SELECT RAISE(ABORT,'已公示奖金不可修改，请新增调整记录'); END;
      CREATE TRIGGER IF NOT EXISTS bonus_lock_delete BEFORE DELETE ON bonuses WHEN OLD.published=1
        BEGIN SELECT RAISE(ABORT,'已公示奖金不可删除'); END;
    `);
    // Older defaults may use server-local time. Normalize NEW inserts explicitly to Beijing,
    // even on an existing database whose CREATE TABLE defaults cannot be altered in place.
    for (const [table, field] of [["users", "created_at"], ["videos", "created_at"], ["stage_log", "at"],
      ["reviews", "submitted_at"], ["metrics", "updated_at"], ["bonuses", "created_at"],
      ["ideas", "created_at"], ["students", "created_at"], ["weekly", "updated_at"], ["notifications", "created_at"]]) {
      d.exec(`CREATE TRIGGER IF NOT EXISTS beijing_insert_${table} AFTER INSERT ON ${table}
        WHEN NEW.${field} = datetime('now','localtime') AND NEW.${field} != datetime('now','+8 hours')
        BEGIN UPDATE ${table} SET ${field}=datetime('now','+8 hours') WHERE rowid=NEW.rowid; END;`);
    }
    const rulesRow = d.prepare("SELECT value FROM settings WHERE key='rules'").get() as { value: string } | undefined;
    const levels: Record<string, number> = { 简单: 0.5, 常规: 1, 精剪: 1.5, ...(rulesRow ? JSON.parse(rulesRow.value).cut_levels : {}) };
    const legacy = d.prepare(`SELECT v.*, a.name account_name, u.name cutter_name,
        (SELECT min(submitted_at) FROM reviews WHERE video_id=v.id AND node='成片审核') first_at,
        (SELECT CASE WHEN s.role='cutter' THEN r.submitter_id ELSE v.cutter_id END
          FROM reviews r LEFT JOIN users s ON s.id=r.submitter_id
          WHERE r.video_id=v.id AND r.node='成片审核' ORDER BY r.submitted_at,r.id LIMIT 1) credited_id
      FROM videos v LEFT JOIN accounts a ON a.id=v.account_id LEFT JOIN users u ON u.id=v.cutter_id
      WHERE EXISTS (SELECT 1 FROM reviews WHERE video_id=v.id AND node='成片审核')
        AND NOT EXISTS (SELECT 1 FROM work_deliveries WHERE video_id=v.id)`).all() as Array<Record<string, string | number | null>>;
    for (const v of legacy) {
      if (!v.credited_id) continue;
      d.prepare(`INSERT INTO work_deliveries(video_id,cutter_id,editor_id,code,title,account_name,cutter_name,
        cut_level,base_units,extra_units,due_rough,late_exempt_reason,submitted_at,provenance)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,'legacy')`).run(v.id, v.credited_id, v.editor_id, v.code, v.title, v.account_name, (d.prepare("SELECT name FROM users WHERE id=?").get(v.credited_id) as { name: string } | undefined)?.name ?? null,
        v.cut_level || "常规", levels[String(v.cut_level)] ?? 1, v.extra_units ?? 0, v.due_rough, v.late_exempt_reason, v.first_at);
    }
    d.exec(`UPDATE reviews SET cutter_id_snapshot=COALESCE(
        (SELECT cutter_id FROM work_deliveries w WHERE w.video_id=reviews.video_id),
        (SELECT cutter_id FROM videos v WHERE v.id=reviews.video_id))
      WHERE cutter_id_snapshot IS NULL;
      UPDATE reviews SET editor_id_snapshot=(SELECT editor_id FROM videos v WHERE v.id=reviews.video_id) WHERE editor_id_snapshot IS NULL;`);
    // Resolve unreachable legacy reviewers without touching completed review history.
    if (process.env.FEISHU_APP_ID && process.env.FEISHU_APP_SECRET) {
      const boss = d.prepare("SELECT id FROM users WHERE role='boss' AND feishu_open_id IS NOT NULL ORDER BY id LIMIT 1").get() as { id: number } | undefined;
      if (boss) {
        const stranded = d.prepare("SELECT r.id,r.reviewer_id FROM reviews r LEFT JOIN users u ON u.id=r.reviewer_id WHERE r.status='待审' AND (u.id IS NULL OR u.role NOT IN ('boss','editor') OR u.feishu_open_id IS NULL)").all() as { id: number; reviewer_id: number }[];
        for (const row of stranded) {
          d.prepare("UPDATE reviews SET reviewer_id=? WHERE id=?").run(boss.id, row.id);
          d.prepare("INSERT INTO audit_log(entity,entity_id,action,before_json,after_json,reason) VALUES('review',?,'修复不可用审核人',?,?,?)").run(row.id, JSON.stringify({ reviewer_id: row.reviewer_id }), JSON.stringify({ reviewer_id: boss.id }), "原审核人无法登录，转交可登录老板");
        }
      }
    }
    d.exec("COMMIT");
  } catch (e) { d.exec("ROLLBACK"); throw e; }
}
