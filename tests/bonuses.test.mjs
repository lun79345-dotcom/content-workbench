import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fixture } from './helpers.mjs';
function scenario(name, fn) { test(name, () => { const f = fixture(); try {
  const id = f.video({ stage: '已发布', published_at: '2026-01-01' });
  const rules = f.load('@/lib/rules');
  const metric = (cp, plays) => { for (const p of ['douyin','wechat']) f.run("INSERT INTO metrics(video_id,checkpoint,platform,plays) VALUES(?,?,?,?) ON CONFLICT(video_id,checkpoint,platform) DO UPDATE SET plays=excluded.plays", id, cp, p, plays / 2); rules.recalcVideoBonus(id); };
  const total = () => f.get('SELECT COALESCE(sum(amount),0) n FROM bonuses WHERE video_id=?', id).n;
  const lock = () => { rules.freezeBonusBasis(id); f.run('UPDATE bonuses SET published=1 WHERE video_id=? AND published=0', id); };
  fn({ ...f, id, rules, metric, total, lock });
} finally { f.close(); } }); }
scenario('更换剪辑清理原未公示自动奖金，不重复分配', (f) => {
  f.metric('d7', 100000); assert.equal(f.total(), 200);
  f.run('UPDATE videos SET cutter_id=4 WHERE id=?', f.id); f.rules.recalcVideoBonus(f.id);
  assert.equal(f.total(), 200); assert.equal(f.get('SELECT count(*) n FROM bonuses WHERE user_id=3').n, 0);
});
scenario('已公示200元，纠正7天为500元后仍补300元', (f) => {
  f.metric('d7', 100000); f.lock();
  const original = f.all('SELECT * FROM bonuses WHERE published=1');
  f.metric('d7', 500000); f.metric('d30', 500000);
  assert.equal(f.total(), 500); assert.equal(f.get('SELECT sum(amount) n FROM bonuses WHERE published=0').n, 300);
  f.rules.recalcVideoBonus(f.id); assert.equal(f.total(), 500);
  assert.deepEqual(f.all('SELECT * FROM bonuses WHERE published=1'), original);
});
scenario('先录30天并公示，之后补7天不重复发奖金', (f) => {
  f.metric('d30', 500000); assert.equal(f.total(), 500); f.lock();
  f.metric('d7', 100000); assert.equal(f.total(), 500);
  assert.equal(f.get('SELECT sum(amount) n FROM bonuses WHERE published=0').n, 0);
});
scenario('纠正较低播放通过负数冲正，锁定条目保持不变', (f) => {
  f.metric('d7', 500000); f.lock(); f.metric('d7', 100000);
  assert.equal(f.total(), 200); assert.equal(f.get('SELECT sum(amount) n FROM bonuses WHERE published=0').n, -300);
  assert.equal(f.get('SELECT sum(amount) n FROM bonuses WHERE published=1').n, 500);
});
scenario('公示后规则和负责人变化不重新分配已锁定视频', (f) => {
  f.metric('d7', 100000); f.lock();
  f.rules.saveRules({ ...f.rules.getRules(), editor_share: 0.1, tier_amounts: [10,20,30] });
  f.run('UPDATE videos SET cutter_id=4 WHERE id=?', f.id); f.metric('d30', 500000);
  assert.equal(f.total(), 500);
  assert.equal(f.get('SELECT count(*) n FROM bonuses WHERE user_id=4').n, 0);
});
scenario('重算异常事务回滚，保留原奖金', (f) => {
  f.metric('d7', 100000); const before = f.all('SELECT * FROM bonuses');
  f.d.exec("CREATE TRIGGER no_bonus BEFORE INSERT ON bonuses BEGIN SELECT RAISE(ABORT,'failure'); END");
  assert.throws(() => f.rules.recalcVideoBonus(f.id), /failure/);
  assert.deepEqual(f.all('SELECT * FROM bonuses'), before);
});
