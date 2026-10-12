import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { safeMediaUrl } from '../.account-review-worker/media-source.mjs';
export async function boundedProcess(binary, args, { timeout = 900000, signal } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ['ignore', 'ignore', 'pipe'], detached: true });
    const stop = () => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} };
    const timer = setTimeout(stop, timeout);
    signal?.addEventListener('abort', stop, { once: true }); if (signal?.aborted) stop();
    child.stderr.resume(); child.on('error', () => { clearTimeout(timer); signal?.removeEventListener('abort', stop); reject(new Error('transcription')); });
    child.on('close', (code) => { clearTimeout(timer); signal?.removeEventListener('abort', stop); if (code === 0) resolve(); else reject(new Error('transcription')); });
  });
}
export async function downloadVideo(raw, file, { signal } = {}) {
  let url = safeMediaUrl(raw);
  for (let redirect = 0; redirect < 5; redirect++) {
    const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.any([AbortSignal.timeout(120000), ...(signal ? [signal] : [])]) });
    if ([301,302,303,307,308].includes(response.status)) {
      const next = response.headers.get('location'); await response.body?.cancel();
      if (!next) throw new Error('transcription'); url = safeMediaUrl(new URL(next, url).href); continue;
    }
    if (!response.ok || !response.body || Number(response.headers.get('content-length')) > 200 * 1024 * 1024) { await response.body?.cancel(); throw new Error('transcription'); }
    const handle = await fs.open(file, 'wx', 0o600); let size = 0;
    try { for await (const chunk of response.body) { size += chunk.length; if (size > 200 * 1024 * 1024) throw new Error('transcription'); await handle.write(chunk); } }
    finally { await handle.close(); }
    if (!size) throw new Error('transcription'); return;
  }
  throw new Error('transcription');
}
export async function transcribeVideo(url, config, signal) {
  // Bound the entire download + conversion + ASR pipeline inside its 20-minute lease.
  signal = AbortSignal.any([AbortSignal.timeout(18 * 60000), ...(signal ? [signal] : [])]);
  const directory = await fs.mkdtemp(path.join(config.tmpDir || os.tmpdir(), 'hit-transcribe-'));
  try {
    const video = path.join(directory, 'video.mp4'), audio = path.join(directory, 'audio.wav'), output = path.join(directory, 'transcript');
    await downloadVideo(url, video, { signal });
    await boundedProcess(config.ffmpegPath, ['-nostdin','-hide_banner','-loglevel','error','-i',video,'-t','600','-vn','-ar','16000','-ac','1','-c:a','pcm_s16le',audio], { timeout: 120000, signal });
    await boundedProcess(config.whisperPath, ['-m',config.modelPath,'-f',audio,'-l','zh','-t','2','-otxt','-of',output,'-np'], { signal });
    const transcript = (await fs.readFile(output + '.txt', 'utf8')).trim();
    if (!transcript || transcript.length > 40000) throw new Error('transcription');
    return transcript;
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
}
