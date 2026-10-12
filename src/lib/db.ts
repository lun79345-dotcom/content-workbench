import type { DatabaseSync as DB } from "node:sqlite";
import path from "node:path";
import fs from "node:fs";
import { migrate } from "./migrations";

// 通过 getBuiltinModule 加载，避免打包器处理 node:sqlite
const { DatabaseSync } = process.getBuiltinModule("node:sqlite") as typeof import("node:sqlite");

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL,              -- boss | editor | cutter | pending | disabled
  feishu_open_id TEXT UNIQUE,
  avatar TEXT,
  created_at TEXT DEFAULT (datetime('now','+8 hours'))
);
CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,              -- 人设号 | 剧情号
  new_since TEXT,                  -- 新号起始日期；为空表示老号
  editor_id INTEGER REFERENCES users(id),
  douyin_home TEXT, wechat_home TEXT, xhs_home TEXT,
  sort INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS videos (
  id INTEGER PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,       -- V001
  title TEXT NOT NULL,
  account_id INTEGER REFERENCES accounts(id),
  editor_id INTEGER REFERENCES users(id),
  cutter_id INTEGER REFERENCES users(id),
  content_type TEXT,               -- 剧情/口播/vlog…
  cut_level TEXT DEFAULT '常规',
  extra_units REAL DEFAULT 0,      -- 改版加件
  stage TEXT NOT NULL DEFAULT '选题',
  due_script TEXT, due_shoot TEXT, due_rough TEXT, due_review TEXT, publish_date TEXT,
  published_at TEXT,
  douyin_url TEXT, wechat_url TEXT, xhs_url TEXT,
  idea_id INTEGER,
  brief TEXT,                      -- 需求说明 / 脚本链接
  note TEXT,
  analysis TEXT,                   -- 数据复盘分析
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now','+8 hours'))
);
CREATE TABLE IF NOT EXISTS stage_log (
  id INTEGER PRIMARY KEY,
  video_id INTEGER NOT NULL,
  from_stage TEXT, to_stage TEXT,
  user_id INTEGER,
  at TEXT DEFAULT (datetime('now','+8 hours'))
);
CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY,
  video_id INTEGER NOT NULL REFERENCES videos(id),
  node TEXT NOT NULL,              -- 脚本审核 | 成片审核
  submitter_id INTEGER, reviewer_id INTEGER,
  status TEXT NOT NULL DEFAULT '待审',  -- 待审 | 通过 | 打回
  reason TEXT,                     -- 打回原因归类，如 剪辑责任-错别字
  comment TEXT,
  recheck TEXT,                    -- 复审结果
  submitted_at TEXT DEFAULT (datetime('now','+8 hours')),
  done_at TEXT
);
CREATE TABLE IF NOT EXISTS metrics (
  id INTEGER PRIMARY KEY,
  video_id INTEGER NOT NULL REFERENCES videos(id),
  checkpoint TEXT NOT NULL,        -- d7 | d30 | live
  platform TEXT NOT NULL,          -- douyin | wechat | xhs
  plays INTEGER, likes INTEGER, comments INTEGER, collects INTEGER, shares INTEGER, fans INTEGER,
  source TEXT,                     -- manual | tikhub | douyin_open
  screenshot TEXT,
  updated_by INTEGER,
  updated_at TEXT DEFAULT (datetime('now','+8 hours')),
  UNIQUE(video_id, checkpoint, platform)
);
CREATE TABLE IF NOT EXISTS bonuses (
  id INTEGER PRIMARY KEY,
  month TEXT NOT NULL,             -- 2026-10
  user_id INTEGER NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL,              -- 爆款奖 | 升档补差 | 抖音单项奖 | 小红书奖 | 创意采用奖 | 其他
  amount REAL NOT NULL,
  description TEXT,
  video_id INTEGER,
  auto INTEGER DEFAULT 0,          -- 1=系统自动计算
  published INTEGER DEFAULT 0,     -- 已公示/已确认
  created_at TEXT DEFAULT (datetime('now','+8 hours'))
);
CREATE TABLE IF NOT EXISTS targets (
  month TEXT NOT NULL, account_id INTEGER NOT NULL, target_plays INTEGER,
  PRIMARY KEY(month, account_id)
);
CREATE TABLE IF NOT EXISTS ideas (
  id INTEGER PRIMARY KEY,
  code TEXT UNIQUE,
  submitter_id INTEGER, submitter_name TEXT,
  source TEXT,                     -- 内部拆解/评论区挖矿/学生悬赏/平台付费/UGC征集/对标监控
  account_id INTEGER, kind TEXT,   -- 选题/钩子/梗/形式
  content TEXT NOT NULL, ref_url TEXT,
  grade TEXT,                      -- S/A/B/C
  status TEXT DEFAULT '待评',       -- 待评/入库/已排期/已拍/已弃
  video_id INTEGER,
  note TEXT,
  created_at TEXT DEFAULT (datetime('now','+8 hours'))
);
CREATE TABLE IF NOT EXISTS students (
  id INTEGER PRIMARY KEY,
  code TEXT UNIQUE,
  name TEXT, school TEXT, contact TEXT, theme_month TEXT,
  title TEXT, content TEXT,
  license_signed INTEGER DEFAULT 0,
  result TEXT DEFAULT '待评',       -- 待评/入围/采用/未入选
  bonus_kind TEXT, bonus_amount REAL, paid_at TEXT,
  idea_id INTEGER, note TEXT,
  created_at TEXT DEFAULT (datetime('now','+8 hours'))
);
CREATE TABLE IF NOT EXISTS weekly (
  id INTEGER PRIMARY KEY,
  week TEXT NOT NULL,              -- 2026-W41
  user_id INTEGER NOT NULL,
  best TEXT, best_why TEXT, worst TEXT, worst_why TEXT,
  insight TEXT, self_score INTEGER, blockers TEXT, next_plan TEXT,
  updated_at TEXT DEFAULT (datetime('now','+8 hours')),
  UNIQUE(week, user_id)
);
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,
  text TEXT NOT NULL, link TEXT,
  dedupe TEXT UNIQUE,
  read INTEGER DEFAULT 0,
  pushed INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now','+8 hours'))
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
`;

let _db: DB | null = null;

export function db(): DB {
  if (_db) return _db;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const d = new DatabaseSync(path.join(DATA_DIR, "app.db"));
  d.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
  d.exec(SCHEMA);
  migrate(d);
  _db = d;
  seedIfEmpty(d);
  return d;
}

type Row = Record<string, unknown>;
export function all<T = Row>(sql: string, ...args: unknown[]): T[] {
  return db().prepare(sql).all(...(args as never[])) as T[];
}
export function get<T = Row>(sql: string, ...args: unknown[]): T | undefined {
  return db().prepare(sql).get(...(args as never[])) as T | undefined;
}
export function run(sql: string, ...args: unknown[]) {
  return db().prepare(sql).run(...(args as never[]));
}

export function nextCode(table: "videos" | "ideas" | "students", prefix: string) {
  const r = get<{ code: string }>(`SELECT code FROM ${table} WHERE code LIKE ? ORDER BY length(code) DESC, code DESC LIMIT 1`, prefix + "%");
  const n = r ? parseInt(r.code.slice(prefix.length), 10) + 1 : 1;
  return prefix + String(n).padStart(3, "0");
}

function seedIfEmpty(d: DB) {
  const c = d.prepare("SELECT count(*) n FROM users").get() as { n: number };
  if (c.n > 0) return;
  const ins = d.prepare("INSERT INTO users(name, role) VALUES(?, ?)");
  const ids: Record<string, number> = {};
  for (const [n, r] of [["老板", "boss"], ["编导A", "editor"], ["编导B", "editor"], ["编导C", "editor"], ["剪辑①", "cutter"], ["剪辑②", "cutter"], ["剪辑③", "cutter"]]) {
    ids[n] = Number(ins.run(n, r).lastInsertRowid);
  }
  const acc = d.prepare("INSERT INTO accounts(name, kind, new_since, editor_id, sort) VALUES(?,?,?,?,?)");
  acc.run("人设号①", "人设号", null, ids["编导A"], 1);
  acc.run("人设号②", "人设号", null, ids["编导B"], 2);
  acc.run("人设号③", "人设号", null, ids["编导C"], 3);
  acc.run("剧情号④", "剧情号", "2026-10-01", ids["编导A"], 4);
  acc.run("剧情号⑤", "剧情号", "2026-10-01", ids["编导B"], 5);
  acc.run("剧情号⑥", "剧情号", "2026-10-01", ids["编导C"], 6);
  d.prepare("INSERT INTO settings(key, value) VALUES('leader_id', ?)").run(String(ids["编导A"]));
}

export function transaction<T>(fn: () => T): T {
  const d = db();
  if (d.isTransaction) return fn();
  d.exec("BEGIN IMMEDIATE");
  try { const result = fn(); d.exec("COMMIT"); return result; }
  catch (e) { d.exec("ROLLBACK"); throw e; }
}
export function audit(actorId: number, entity: string, entityId: number | null, action: string, before: unknown, after: unknown, reason?: string | null) {
  run("INSERT INTO audit_log(actor_id,entity,entity_id,action,before_json,after_json,reason) VALUES(?,?,?,?,?,?,?)",
    actorId, entity, entityId, action, before == null ? null : JSON.stringify(before), after == null ? null : JSON.stringify(after), reason ?? null);
}
