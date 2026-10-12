import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { fixture } from './helpers.mjs';
test('飞书发送失败保留队列，去重不会阻止后续重试', async () => {
  let calls = 0;
  const f = fixture({ mocks: { './feishu': { sendCard: async () => { calls++; if (calls === 1) throw new Error('fixture failure'); } } } });
  try {
    process.env.FEISHU_APP_ID = 'test'; process.env.FEISHU_APP_SECRET = 'test';
    const notify = f.load('./lib/notify');
    await notify.notify(3, '测试通知', '/board', 'same-key');
    assert.equal(f.get('SELECT pushed FROM notifications').pushed, 0);
    await notify.notify(3, '测试通知', '/board', 'same-key');
    assert.equal(f.get('SELECT count(*) n FROM notifications').n, 1); assert.equal(calls, 1);
    f.run('UPDATE notifications SET next_attempt_at=NULL');
    await notify.retryNotifications();
    assert.equal(calls, 2); assert.equal(f.get('SELECT pushed FROM notifications').pushed, 1);
    await notify.notify(3, '测试通知', '/board', 'same-key'); assert.equal(calls, 2);
  } finally { f.close(); }
});
test('每日备份包含 WAL 中的已提交数据，一天只创建一次', () => {
  const f = fixture(); try {
    f.video(); const backups = f.load('@/lib/backups'); backups.dailyBackup(); backups.dailyBackup();
    const files = fs.readdirSync(`${f.directory}/backups`); assert.equal(files.length, 1);
    const d = new DatabaseSync(`${f.directory}/backups/${files[0]}`, { readOnly: true });
    assert.equal(d.prepare('SELECT count(*) n FROM videos').get().n, 1); d.close();
  } finally { f.close(); }
});
