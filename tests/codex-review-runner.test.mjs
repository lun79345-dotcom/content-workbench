import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runCodexReport } from '../scripts/codex-account-review.mjs';
const input = { current: { videos: [{ id: 1, title: '$(touch SHOULD_NOT_RUN)' }] }, previous: { videos: [] }, performance: { videos: [] }, previous_performance: { videos: [] } };
async function fakeRunner(body, fn) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-review-test-'));
  const executable = path.join(directory, 'fake-codex');
  try {
    await fs.writeFile(executable, '#!/usr/bin/env node\n' + body, { mode: 0o700 });
    await fn(executable);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
}
const output = `const fs=require('node:fs'); const args=process.argv.slice(2); let prompt='';
process.stdin.on('data',part=>prompt+=part); process.stdin.on('end',()=>{
 if(!args.includes('--ignore-user-config') || !args.includes('read-only') || !args.includes('shell_tool') || !args.includes('--output-schema') || !prompt.includes('$(touch SHOULD_NOT_RUN)')) process.exit(2);
 fs.writeFileSync(args[args.indexOf('--output-last-message')+1],JSON.stringify({overview:process.env.FEISHU_APP_SECRET?'leaked':'isolated',observations:[{point:'仅使用输入',video_ids:[1]}],hypotheses:[],actions:['补数'],limits:['无完播率']}));
 console.log(JSON.stringify({type:'item.completed',item:{type:'error',message:'nonfatal CLI warning'}}));
 console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message'}}));
});`;
test('Codex进程以只读模式和结构化输出运行，隔离应用密钥，提示内容通过标准输入传递', async () => {
  const previous = process.env.FEISHU_APP_SECRET; process.env.FEISHU_APP_SECRET = 'test-secret-must-not-be-passed';
  try { await fakeRunner(output, async executable => { const report = await runCodexReport(input, { executable }); assert.equal(report.overview, 'isolated'); assert.deepEqual(report.observations[0].video_ids, [1]); }); }
  finally { if (previous === undefined) delete process.env.FEISHU_APP_SECRET; else process.env.FEISHU_APP_SECRET = previous; }
});
test('拒绝调用工具的分析结果，即使返回了看似有效的报告', async () => {
  await fakeRunner(output.replace("type:'agent_message'", "type:'command_execution'"), executable => assert.rejects(runCodexReport(input, { executable }), error => error.code === 'format'));
});
test('Codex超时或服务终止会中止子进程，任务可重试', async () => {
  await fakeRunner('setInterval(()=>{},1000);', async executable => {
    await assert.rejects(runCodexReport(input, { executable, timeout: 100 }), error => error.code === 'timeout');
    const controller = new AbortController(), task = runCodexReport(input, { executable, signal: controller.signal });
    controller.abort();
    await assert.rejects(task, error => error.code === 'stopped');
  });
});
