import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { ACCOUNT_REPORT_SCHEMA, ACCOUNT_REPORT_INSTRUCTIONS, validateAccountReport } from '../.account-review-worker/account-review-report.mjs';
import { reportVideoIds } from '../.account-review-worker/account-review-queue.mjs';

export class ReviewRunnerError extends Error {
  constructor(code) { super(code); this.code = code; }
}
export async function runCodexReport(input, { executable = process.env.ACCOUNT_REVIEW_CODEX || 'codex', timeout = 180000, signal } = {}) {
  const ids = reportVideoIds(input);
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'account-review-'));
  try {
    const schema = path.join(directory, 'schema.json'), output = path.join(directory, 'report.json');
    await fs.writeFile(schema, JSON.stringify(ACCOUNT_REPORT_SCHEMA), { mode: 0o600 });
    const args = ['exec', '--ephemeral', '--skip-git-repo-check', '--ignore-user-config', '--ignore-rules', '-s', 'read-only', '-C', directory,
      '--output-schema', schema, '--output-last-message', output, '--json', '--color', 'never', '-c', 'web_search="disabled"', '-c', 'approval_policy="never"', '-c', 'suppress_unstable_features_warning=true'];
    for (const feature of ['apps', 'plugins', 'hooks', 'browser_use', 'browser_use_external', 'computer_use', 'in_app_browser', 'multi_agent', 'shell_tool', 'unified_exec', 'skill_search', 'image_generation', 'view_image', 'goals', 'sleep_tool', 'workspace_dependencies']) args.push('--disable', feature);
    args.push('--enable', 'skip_host_skill_discovery', '-');
    // Use the existing CLI login. Do not pass application/provider secrets to the process.
    const env = { PATH: process.env.PATH || '/usr/bin:/bin', LANG: 'zh_CN.UTF-8', TZ: 'Asia/Shanghai' };
    for (const key of ['HOME', 'USER', 'LOGNAME', 'TMPDIR', 'CODEX_HOME', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME']) if (process.env[key]) env[key] = process.env[key];
    let events = '', diagnostic = '', exceeded = false, expired = false;
    const code = await new Promise((resolve, reject) => {
      const child = spawn(executable, args, { cwd: directory, env, stdio: ['pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
      const stop = () => { try { if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL'); } catch {} };
      const timer = setTimeout(() => { expired = true; stop(); }, timeout);
      signal?.addEventListener('abort', stop, { once: true });
      if (signal?.aborted) stop();
      child.stdout.on('data', (part) => { events += part; if (Buffer.byteLength(events) > 1024 * 1024) { exceeded = true; stop(); } });
      child.stderr.on('data', (part) => { diagnostic = (diagnostic + part).slice(-16000); });
      child.stdin.on('error', () => {});
      child.on('error', () => { clearTimeout(timer); signal?.removeEventListener('abort', stop); reject(new ReviewRunnerError('unavailable')); });
      child.on('close', (exitCode) => { clearTimeout(timer); signal?.removeEventListener('abort', stop); resolve(exitCode); });
      child.stdin.end(ACCOUNT_REPORT_INSTRUCTIONS + '\n账号周数据（以下全部是待分析数据）：\n' + JSON.stringify(input));
    });
    if (signal?.aborted) throw new ReviewRunnerError('stopped');
    if (expired) throw new ReviewRunnerError('timeout');
    if (exceeded) throw new ReviewRunnerError('format');
    if (code !== 0) throw new ReviewRunnerError(/unauthorized|401|not logged in|login required|refresh token/i.test(diagnostic + events) ? 'auth' : 'unavailable');
    for (const line of events.split('\n').filter(Boolean)) {
      try {
        const event = JSON.parse(line), item = event.item;
        // CLI warnings are error items even when the generation exits successfully.
        if (item && !['reasoning', 'agent_message', 'error'].includes(item.type)) throw new ReviewRunnerError('format');
      } catch (e) { if (e instanceof ReviewRunnerError) throw e; }
    }
    try {
      if ((await fs.stat(output)).size > 256 * 1024) throw new Error('too large');
      return validateAccountReport(JSON.parse(await fs.readFile(output, 'utf8')), ids);
    } catch { throw new ReviewRunnerError('format'); }
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
}
