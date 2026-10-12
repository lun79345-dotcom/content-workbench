import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { AI_REPORT_SCHEMA, AI_ANALYSIS_INSTRUCTIONS, validateAiReport } from '../.account-review-worker/ai-analysis.mjs';
import { runCodexReport, runStructuredReport } from './codex-account-review.mjs';

const configPath = process.env.ACCOUNT_REVIEW_CONFIG;
if (!configPath) throw new Error('Set ACCOUNT_REVIEW_CONFIG to the local worker config path');
const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
const script = path.resolve(import.meta.dirname, 'account-review-jobs.mjs');
let stopping = false;
const controller = new AbortController();
const stop = () => { stopping = true; controller.abort(); };
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
async function request(payload) {
  let binary, args, env = process.env;
  if (config.transport === 'local' && typeof config.dataDir === 'string' && path.isAbsolute(config.dataDir)) {
    binary = process.execPath; args = [script]; env = { ...env, DATA_DIR: config.dataDir };
  } else if (config.transport === 'ssh' && /^[a-zA-Z0-9_.@:-]+$/.test(config.host) && path.isAbsolute(config.identityFile)) {
    binary = '/usr/bin/ssh';
    args = ['-i', config.identityFile, '-o', 'IdentitiesOnly=yes', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=10', config.host, 'docker exec -i yunying node scripts/account-review-jobs.mjs'];
  } else throw new Error('Invalid worker transport');
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { env, stdio: ['pipe', 'pipe', 'pipe'] });
    let result = '', tooLarge = false;
    const timer = setTimeout(() => { child.kill('SIGKILL'); }, 25000);
    child.stdout.on('data', (part) => { result += part; if (Buffer.byteLength(result) > 2 * 1024 * 1024) { tooLarge = true; child.kill('SIGKILL'); } });
    child.stderr.resume();
    child.stdin.on('error', () => {});
    child.on('error', () => { clearTimeout(timer); reject(new Error('transport unavailable')); });
    child.on('close', (code) => { clearTimeout(timer); try { if (code !== 0 || tooLarge) throw new Error(); resolve(JSON.parse(result)); } catch { reject(new Error('transport unavailable')); } });
    child.stdin.end(JSON.stringify(payload));
  });
}
let heartbeatBusy = false;
let activeJob = false;
const heartbeat = setInterval(async () => {
  if (heartbeatBusy || stopping || !activeJob) return;
  heartbeatBusy = true;
  try { await request({ action: 'heartbeat' }); } catch {} finally { heartbeatBusy = false; }
}, 20000);
let connectionDown = false;
try {
  while (!stopping) {
    try {
      const weekly = await request({ action: 'claim' });
      const job = weekly || await request({ action: 'claim_ai' });
      const kind = weekly ? '复盘' : '拆解';
      if (connectionDown) { process.stdout.write('复盘服务连接已恢复\n'); connectionDown = false; }
      if (job) {
        activeJob = true;
        process.stdout.write(`开始${kind}任务 ${job.id}\n`);
        let report;
        try { report = weekly ? await runCodexReport(job.input, { executable: config.codexPath, signal: controller.signal }) : await runStructuredReport(job.input, { executable: config.codexPath, signal: controller.signal, reportSchema: AI_REPORT_SCHEMA, instructions: AI_ANALYSIS_INSTRUCTIONS, validate: (value) => validateAiReport(value, job.input) }); }
        catch (error) { activeJob = false; await request({ action: weekly ? 'fail' : 'fail_ai', id: job.id, lease: job.lease, code: error.code || 'unavailable' }); process.stdout.write(`${kind}任务 ${job.id} 未完成，可在页面重试\n`); continue; }
        // Retry publishing the same report after a temporary connection issue; never charge for generating it again.
        let published = false;
        for (let attempt = 0; attempt < 3 && !published; attempt++) {
          try { published = await request({ action: weekly ? 'finish' : 'finish_ai', id: job.id, lease: job.lease, report }); }
          catch { if (attempt < 2) await delay(3000, undefined, {signal:controller.signal}).catch(()=>{}); }
        }
        process.stdout.write(`${kind}任务 ${job.id} ${published ? '已完成' : '结果未写入，等待任务恢复'}\n`);
        activeJob = false;
        continue;
      }
    } catch { activeJob = false; if (!connectionDown) { process.stdout.write('复盘服务暂时无法连接，正在等待恢复\n'); connectionDown = true; } }
    await delay(connectionDown ? 30000 : 10000, undefined, {signal:controller.signal}).catch(()=>{});
  }
} finally { clearInterval(heartbeat); }
