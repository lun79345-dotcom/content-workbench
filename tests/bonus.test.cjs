/* CommonJS is intentional: this test loads actual TypeScript modules in Node without a bundler. */
/* eslint-disable @typescript-eslint/no-require-imports */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ts = require('typescript');
const Module = require('node:module');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'content-workbench-test-'));
process.env.DATA_DIR = dir;
const cache = new Map();
function load(file) {
  file = path.resolve(file);
  if (cache.has(file)) return cache.get(file).exports;
  const m = new Module(file, module);
  m.filename = file;
  m.paths = module.paths;
  cache.set(file, m);
  m.require = id => id.startsWith('.') ? load(path.resolve(path.dirname(file), id + '.ts')) : require(id);
  m._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, file);
  return m.exports;
}
const db = load('src/lib/db.ts');
const rules = load('src/lib/rules.ts');
before(() => {
  db.run("INSERT INTO videos(id,code,title,account_id,editor_id,cutter_id,stage,published_at) VALUES(1,'V001','虚构测试',1,2,5,'已发布','2026-09-01')");
});
after(() => { db.db().close(); fs.rmSync(dir,{recursive:true,force:true}); });
function metric(cp, platform, plays) {
  db.run('INSERT INTO metrics(video_id,checkpoint,platform,plays) VALUES(1,?,?,?) ON CONFLICT(video_id,checkpoint,platform) DO UPDATE SET plays=excluded.plays',cp,platform,plays);
}
test('one platform alone does not generate a bonus', () => {
  metric('d7','douyin',30000);
  rules.recalcVideoBonus(1);
  assert.equal(db.all('SELECT * FROM bonuses').length,0);
});
test('complete metrics split a tier award and recomputation stays idempotent', () => {
  metric('d7','wechat',1000);
  rules.recalcVideoBonus(1); rules.recalcVideoBonus(1);
  const rows=db.all("SELECT * FROM bonuses WHERE kind='爆款奖'");
  assert.equal(rows.length,2);
  assert.deepEqual(rows.map(r=>r.amount),[150,150]);
});
test('day-30 settlement pays only the tier difference', () => {
  metric('d30','douyin',100000); metric('d30','wechat',1000);
  rules.recalcVideoBonus(1);
  assert.equal(db.get("SELECT sum(amount) total FROM bonuses WHERE kind='升档补差'").total,500);
  assert.equal(db.get('SELECT sum(amount) total FROM bonuses').total,800);
});
test('published awards are frozen when source metrics change', () => {
  db.run('UPDATE bonuses SET published=1');
  metric('d7','douyin',0); metric('d7','wechat',0);
  metric('d30','douyin',0); metric('d30','wechat',0);
  rules.recalcVideoBonus(1);
  assert.equal(db.get('SELECT sum(amount) total FROM bonuses').total,800);
  assert.equal(db.all('SELECT * FROM bonuses').length,4);
});
