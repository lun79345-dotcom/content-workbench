import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { deleteUnusedAccount } from "../src/lib/accounts.ts";

function fixture() {
  const d = new DatabaseSync(":memory:");
  d.exec(`
    PRAGMA foreign_keys=ON;
    CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE accounts (id INTEGER PRIMARY KEY, name TEXT, editor_id INTEGER REFERENCES users(id));
    CREATE TABLE videos (id INTEGER PRIMARY KEY, account_id INTEGER REFERENCES accounts(id));
    CREATE TABLE ideas (id INTEGER PRIMARY KEY, account_id INTEGER);
    CREATE TABLE targets (month TEXT, account_id INTEGER, target_plays INTEGER);
    CREATE TABLE account_weekly (account_id INTEGER REFERENCES accounts(id));
    CREATE TABLE account_review_jobs (account_id INTEGER REFERENCES accounts(id));
    INSERT INTO users VALUES (1, '编导A');
    INSERT INTO accounts VALUES (1, '人设号①', 1), (2, '真实账号', 1);
    INSERT INTO videos VALUES (1, 2);
    INSERT INTO ideas VALUES (1, 2);
    INSERT INTO targets VALUES ('2026-10', 2, 100000);
  `);
  return d;
}

test("删除未使用的预设账号，保留成员、其他账号和业务记录", () => {
  const d = fixture();
  try {
    assert.deepEqual(deleteUnusedAccount(d, 1), { ok: true });
    assert.equal(d.prepare("SELECT id FROM accounts WHERE id=1").get(), undefined);
    assert.equal(d.prepare("SELECT name FROM accounts WHERE id=2").get().name, "真实账号");
    assert.equal(d.prepare("SELECT name FROM users WHERE id=1").get().name, "编导A");
    for (const table of ["videos", "ideas", "targets"]) assert.equal(d.prepare(`SELECT account_id FROM ${table}`).get().account_id, 2);
    assert.deepEqual(d.prepare("PRAGMA foreign_key_check").all(), []);
  } finally { d.close(); }
});

for (const table of ["videos", "ideas", "targets", "account_weekly", "account_review_jobs"]) {
  test(`有关联的 ${table} 记录时不能删除账号`, () => {
    const d = fixture();
    try {
      d.prepare(`INSERT INTO ${table} (account_id) VALUES (?)`).run(1);
      const result = deleteUnusedAccount(d, 1);
      assert.equal(result.ok, false);
      assert.match(result.message, /历史数据/);
      assert.equal(d.prepare("SELECT name FROM accounts WHERE id=1").get().name, "人设号①");
      assert.equal(d.prepare(`SELECT count(*) n FROM ${table} WHERE account_id=1`).get().n, 1);
    } finally { d.close(); }
  });
}

test("无效或已不存在的账号编号不能删除", () => {
  const d = fixture();
  try {
    for (const id of [0, -1, 1.5, NaN, 999]) assert.equal(deleteUnusedAccount(d, id).ok, false);
    assert.equal(d.prepare("SELECT count(*) n FROM accounts").get().n, 2);
  } finally { d.close(); }
});

test("删除异常时回滚账号数据", () => {
  const d = fixture();
  try {
    d.exec("CREATE TRIGGER prevent_delete BEFORE DELETE ON accounts BEGIN SELECT RAISE(ABORT, 'test failure'); END");
    assert.throws(() => deleteUnusedAccount(d, 1), /test failure/);
    assert.equal(d.prepare("SELECT count(*) n FROM accounts").get().n, 2);
    assert.equal(d.isTransaction, false);
  } finally { d.close(); }
});
