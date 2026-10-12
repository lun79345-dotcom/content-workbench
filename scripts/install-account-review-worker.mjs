// macOS user service. Uses the current user's existing Codex login and SSH identity.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
if (process.platform !== 'darwin') throw new Error('This installer is for macOS');
const configFile = process.argv[2], nodePath = process.argv[3] || process.execPath;
if (!configFile) throw new Error('Usage: node scripts/install-account-review-worker.mjs <config.json> [node-path]');
const config = JSON.parse(await fs.readFile(configFile, 'utf8'));
if (config.transport !== 'ssh' || !/^[a-zA-Z0-9_.@:-]+$/.test(config.host) || !path.isAbsolute(config.identityFile) || !path.isAbsolute(config.codexPath) || !path.isAbsolute(nodePath)) throw new Error('Invalid service config');
await fs.access(config.identityFile); await fs.access(nodePath);
const auth = spawnSync(config.codexPath, ['login', 'status'], { encoding: 'utf8', timeout: 10000 });
if (auth.status !== 0) throw new Error('Log into Codex on this Mac before installing the worker');
const root = path.resolve(import.meta.dirname, '..'), directory = path.join(os.homedir(), 'Library/Application Support/Content Workbench/账号复盘');
const label = 'org.contentworkbench.account-review';
await fs.mkdir(path.join(directory, 'scripts'), { recursive: true, mode: 0o700 });
await fs.chmod(directory, 0o700);
await fs.mkdir(path.join(directory, '.account-review-worker'), { recursive: true, mode: 0o700 });
for (const file of ['account-review-worker.mjs', 'account-review-jobs.mjs', 'codex-account-review.mjs']) await fs.copyFile(path.join(root, 'scripts', file), path.join(directory, 'scripts', file));
for (const file of ['account-review-report.mjs', 'account-review-queue.mjs', 'ai-analysis.mjs', 'ai-queue.mjs', 'media-source.mjs']) await fs.copyFile(path.join(root, '.account-review-worker', file), path.join(directory, '.account-review-worker', file));
await fs.writeFile(path.join(directory, 'config.json'), JSON.stringify(config, null, 2), { mode: 0o600 });
await fs.chmod(path.join(directory, 'config.json'), 0o600);
for (const name of ['service.log', 'service-error.log']) { const f = await fs.open(path.join(directory, name), 'a', 0o600); await f.close(); }
const xml = (text) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${label}</string>
<key>ProgramArguments</key><array><string>${xml(nodePath)}</string><string>${xml(path.join(directory, 'scripts/account-review-worker.mjs'))}</string></array>
<key>WorkingDirectory</key><string>${xml(directory)}</string>
<key>EnvironmentVariables</key><dict><key>ACCOUNT_REVIEW_CONFIG</key><string>${xml(path.join(directory, 'config.json'))}</string><key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string></dict>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>15</integer>
<key>StandardOutPath</key><string>${xml(path.join(directory, 'service.log'))}</string>
<key>StandardErrorPath</key><string>${xml(path.join(directory, 'service-error.log'))}</string>
</dict></plist>\n`;
const agents = path.join(os.homedir(), 'Library/LaunchAgents'); await fs.mkdir(agents, { recursive: true });
const dest = path.join(agents, label + '.plist'), target = `gui/${process.getuid()}`;
spawnSync('/bin/launchctl', ['bootout', `${target}/${label}`]);
// launchd can retain a terminating process until its polling sleep finishes.
for (let attempt = 0; attempt < 45; attempt++) {
  if (spawnSync('/bin/launchctl', ['print', `${target}/${label}`], { stdio: 'ignore' }).status !== 0) break;
  await new Promise(resolve => setTimeout(resolve, 1000));
}
await fs.writeFile(dest, plist, { mode: 0o600 });
const result = spawnSync('/bin/launchctl', ['bootstrap', target, dest], { encoding: 'utf8' });
if (result.status !== 0) throw new Error('Unable to start the account review service');
process.stdout.write('账号复盘后台服务已安装并启动。\n');
