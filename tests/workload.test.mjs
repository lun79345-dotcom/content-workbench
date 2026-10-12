import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fixture, videoForm } from './helpers.mjs';
import { makeSession, readSession, SESSION_AGE } from '../src/lib/session.ts';
const scenario = (name, fn) => test(name, async () => { const f = fixture(); try { await fn(f); } finally { f.close(); } });
scenario('周/月汇总包含指定剪辑的档位与加件，缺截止和免责不计准时率', (f) => {
  const { recordDelivery, cutterRange } = f.load('@/lib/workload'), { getVideo } = f.load('@/lib/queries');
  const fields = [
    { cut_level: '简单', extra_units: 0.5, due_rough: '2026-10-10' },
    { cut_level: '精剪', extra_units: 1, due_rough: null },
    { cut_level: '常规', extra_units: 0, due_rough: '2026-10-09', late_exempt_reason: '冻结后改需求' },
  ];
  for (let i = 0; i < fields.length; i++) { const id = f.video(fields[i]); recordDelivery(getVideo(id)); f.run('UPDATE work_deliveries SET submitted_at=? WHERE video_id=?', '2026-10-10 23:59:00', id); }
  const week = cutterRange(3, '2026-10-05', '2026-10-11'), month = cutterRange(3, '2026-10-01', '2026-10-31');
  assert.equal(week.delivered, 3); assert.equal(week.units, 4.5); assert.equal(month.units, 4.5);
  assert.equal(week.eligible, 1); assert.equal(week.onTimeRate, 1); assert.equal(week.missingDue, 1); assert.equal(week.exempt, 1);
  assert.equal(cutterRange(3, '2026-10-12', '2026-10-18').delivered, 0);
});
scenario('交付后改负责人或规则不改历史归属与折算', (f) => {
  const id = f.video({ cut_level: '精剪', extra_units: 0.5 }), workload = f.load('@/lib/workload');
  workload.recordDelivery(f.load('@/lib/queries').getVideo(id));
  f.run('UPDATE videos SET cutter_id=4,cut_level=? WHERE id=?', '简单', id);
  const rules = f.load('@/lib/rules'); rules.saveRules({ ...rules.getRules(), cut_levels: { 简单: 10, 常规: 20, 精剪: 30 } });
  const row = f.get('SELECT * FROM work_deliveries'); assert.equal(row.cutter_id, 3); assert.equal(row.base_units + row.extra_units, 2);
});
scenario('返工按审核时负责人统计，复核免责剔除', async (f) => {
  const id = f.video({ cutter_id: 4 });
  f.run("INSERT INTO reviews(video_id,node,status,reason,cutter_id_snapshot,done_at) VALUES(?,'成片审核','打回','剪辑责任-音画问题',3,'2026-10-10 10:00:00')", id);
  const range = () => f.load('@/lib/workload').cutterRange(3, '2026-10-01', '2026-10-31');
  assert.equal(range().rework, 1);
  await f.load('@/app/(main)/videos/actions').setRecheck(new Map([['review_id','1'],['recheck','免责']]));
  assert.equal(range().rework, 0); assert.equal(f.get('SELECT recheck_by FROM reviews').recheck_by, 1);
});
test('会话验证有效期、未来时间、篡改和撤销版本', () => {
  const now = Date.now(), secret = 'fixture-only';
  const valid = makeSession(3, 2, secret, now - 1000);
  assert.deepEqual(readSession(valid, secret, now), { uid: 3, version: 2 });
  assert.equal(readSession(makeSession(3, 2, secret, now - SESSION_AGE), secret, now), null);
  assert.equal(readSession(makeSession(3, 2, secret, now + 120000), secret, now), null);
  assert.equal(readSession(valid.replace('3.', '4.'), secret, now), null);
  assert.equal(readSession('invalid', secret, now), null);
});
scenario('旧数据库增量迁移回填代提交，重复迁移不重复交付或破坏历史', (f) => {
  const id = f.video({ extra_units: 0.5 });
  f.run("INSERT INTO reviews(video_id,node,submitter_id,reviewer_id,submitted_at) VALUES(?,'成片审核',2,2,'2026-10-10 23:30:00')", id);
  const migrate = f.load('@/lib/migrations').migrate;
  migrate(f.d); migrate(f.d);
  const delivery = f.get('SELECT * FROM work_deliveries'); assert.equal(delivery.cutter_id, 3); assert.equal(delivery.provenance, 'legacy');
  assert.equal(f.get('SELECT count(*) n FROM work_deliveries').n, 1);
  assert.equal(f.get('SELECT submitted_at FROM reviews').submitted_at, '2026-10-10 23:30:00');
  assert.deepEqual(f.all('PRAGMA foreign_key_check'), []);
});
scenario('北京时间插入在 UTC 服务器上也正确', (f) => {
  const expected = f.get("SELECT datetime('now','+8 hours') value").value;
  const id = f.video(); assert.equal(f.get('SELECT created_at FROM videos WHERE id=?', id).created_at, expected);
});
scenario('确认加件不会用新规则重估未改变的历史档位', async (f) => {
  const workload = f.load('@/lib/workload'), rules = f.load('@/lib/rules'), id = f.video({ cut_level: '精剪' });
  workload.recordDelivery(f.load('@/lib/queries').getVideo(id));
  rules.saveRules({ ...rules.getRules(), cut_levels: { 精剪: 3, 常规: 1 } });
  f.as(2);
  await f.load('@/app/(main)/videos/actions').updateVideo(videoForm(f, { id, extra_units: 0.5, change_reason: '新增改版' }));
  assert.equal(f.get('SELECT base_units FROM work_deliveries').base_units, 1.5);
  assert.equal(f.get('SELECT extra_units FROM work_deliveries').extra_units, 0.5);
});
scenario('从真实旧表结构升级：增量补列、保留锁定账目、重复执行安全', async (f) => {
  const fs = await import('node:fs'), { DatabaseSync } = await import('node:sqlite');
  const source = fs.readFileSync(new URL('../src/lib/db.ts', import.meta.url), 'utf8');
  const schema = source.match(/const SCHEMA = `([\s\S]*?)`;/)[1].replaceAll("'+8 hours'", "'localtime'");
  const legacy = new DatabaseSync(':memory:');
  try {
    legacy.exec(schema + `INSERT INTO users(id,name,role) VALUES(1,'老板','boss'),(2,'编导','editor'),(3,'原剪辑','cutter'),(4,'后改剪辑','cutter');
      INSERT INTO accounts(id,name,kind) VALUES(1,'账号','人设号');
      INSERT INTO videos(id,code,title,account_id,editor_id,cutter_id) VALUES(1,'V001','旧视频',1,2,4);
      INSERT INTO reviews(video_id,node,submitter_id,reviewer_id,submitted_at) VALUES(1,'成片审核',3,2,'2026-10-10 23:00:00');
      INSERT INTO bonuses(month,user_id,kind,amount,video_id,published) VALUES('2026-10',3,'爆款奖',80,1,1);`);
    const original = legacy.prepare('SELECT * FROM bonuses').get(), migrate = f.load('@/lib/migrations').migrate;
    migrate(legacy); migrate(legacy);
    assert.equal(legacy.prepare('SELECT cutter_id FROM work_deliveries').get().cutter_id, 3);
    assert.equal(legacy.prepare('SELECT count(*) n FROM work_deliveries').get().n, 1);
    assert.deepEqual(legacy.prepare('SELECT * FROM bonuses').get(), original);
    assert.throws(() => legacy.prepare('DELETE FROM bonuses').run(), /不可删除/);
  } finally { legacy.close(); }
});
