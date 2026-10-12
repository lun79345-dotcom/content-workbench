import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { deleteUnboundMember } from "../src/lib/members.ts";

function fixture() {
  const d = new DatabaseSync(":memory:");
  d.exec(`
    PRAGMA foreign_keys=ON;
    CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, role TEXT, feishu_open_id TEXT);
    CREATE TABLE accounts (id INTEGER PRIMARY KEY, editor_id INTEGER REFERENCES users(id));
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE notifications (id INTEGER PRIMARY KEY, user_id INTEGER);
    CREATE TABLE videos (id INTEGER PRIMARY KEY, editor_id INTEGER REFERENCES users(id), cutter_id INTEGER REFERENCES users(id), created_by INTEGER);
    CREATE TABLE stage_log (id INTEGER PRIMARY KEY, user_id INTEGER);
    CREATE TABLE reviews (id INTEGER PRIMARY KEY, submitter_id INTEGER, reviewer_id INTEGER);
    CREATE TABLE metrics (id INTEGER PRIMARY KEY, updated_by INTEGER);
    CREATE TABLE bonuses (id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users(id));
    CREATE TABLE ideas (id INTEGER PRIMARY KEY, submitter_id INTEGER);
    CREATE TABLE weekly (id INTEGER PRIMARY KEY, user_id INTEGER);
    CREATE TABLE account_weekly (updated_by INTEGER REFERENCES users(id));
    CREATE TABLE account_review_jobs (requested_by INTEGER REFERENCES users(id));
    INSERT INTO users VALUES (1, '真实老板', 'boss', 'bound-boss'), (2, '编导A', 'editor', NULL), (3, '真实剪辑', 'cutter', 'bound-cutter');
    INSERT INTO accounts VALUES (1, 2), (2, 3);
    INSERT INTO settings VALUES ('leader_id', '2'), ('other', 'keep');
    INSERT INTO notifications VALUES (1, 2), (2, 3);
  `);
  return d;
}

test("删除未使用的预设成员，解除当前分配，保留其他成员与账号", () => {
  const d = fixture();
  try {
    assert.deepEqual(deleteUnboundMember(d, 2, 1), { ok: true });
    assert.equal(d.prepare("SELECT id FROM users WHERE id=2").get(), undefined);
    assert.equal(d.prepare("SELECT editor_id FROM accounts WHERE id=1").get().editor_id, null);
    assert.equal(d.prepare("SELECT editor_id FROM accounts WHERE id=2").get().editor_id, 3);
    assert.equal(d.prepare("SELECT value FROM settings WHERE key='leader_id'").get(), undefined);
    assert.equal(d.prepare("SELECT value FROM settings WHERE key='other'").get().value, "keep");
    assert.equal(d.prepare("SELECT count(*) n FROM users").get().n, 2);
    assert.equal(d.prepare("SELECT user_id FROM notifications").get().user_id, 3);
    assert.deepEqual(d.prepare("PRAGMA foreign_key_check").all(), []);
  } finally { d.close(); }
});

test("绑定飞书的成员、当前用户及无效编号不能删除", () => {
  const d = fixture();
  try {
    for (const id of [1, 3, 0, -1, 2.5, NaN, 999]) assert.equal(deleteUnboundMember(d, id, 1).ok, false);
    assert.equal(d.prepare("SELECT count(*) n FROM users").get().n, 3);
    assert.equal(d.prepare("SELECT editor_id FROM accounts WHERE id=1").get().editor_id, 2);
  } finally { d.close(); }
});

for (const [table, column] of [
  ["videos", "editor_id"], ["videos", "cutter_id"], ["videos", "created_by"],
  ["stage_log", "user_id"], ["reviews", "submitter_id"], ["reviews", "reviewer_id"],
  ["metrics", "updated_by"], ["bonuses", "user_id"], ["ideas", "submitter_id"], ["weekly", "user_id"],
  ["account_weekly", "updated_by"], ["account_review_jobs", "requested_by"],
]) {
  test(`有关联的 ${table}.${column} 记录时保留成员及历史数据`, () => {
    const d = fixture();
    try {
      d.prepare(`INSERT INTO ${table} (${column}) VALUES (?)`).run(2);
      const result = deleteUnboundMember(d, 2, 1);
      assert.equal(result.ok, false);
      assert.match(result.message, /已停用/);
      assert.equal(d.prepare(`SELECT ${column} FROM ${table}`).get()[column], 2);
      assert.equal(d.prepare("SELECT editor_id FROM accounts WHERE id=1").get().editor_id, 2);
      assert.equal(d.prepare("SELECT value FROM settings WHERE key='leader_id'").get().value, "2");
      assert.equal(d.prepare("SELECT count(*) n FROM users").get().n, 3);
    } finally { d.close(); }
  });
}

test("删除失败时账号、组长和提醒的修改全部回滚", () => {
  const d = fixture();
  try {
    d.exec("CREATE TRIGGER prevent_delete BEFORE DELETE ON users BEGIN SELECT RAISE(ABORT, 'test failure'); END");
    assert.throws(() => deleteUnboundMember(d, 2, 1), /test failure/);
    assert.equal(d.prepare("SELECT editor_id FROM accounts WHERE id=1").get().editor_id, 2);
    assert.equal(d.prepare("SELECT value FROM settings WHERE key='leader_id'").get().value, "2");
    assert.equal(d.prepare("SELECT count(*) n FROM notifications").get().n, 2);
    assert.equal(d.prepare("SELECT count(*) n FROM users").get().n, 3);
  } finally { d.close(); }
});
