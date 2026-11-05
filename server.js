const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { spawn } = require('child_process');
const crypto = require('crypto');
const { Readable } = require('stream');

const appRoot = __dirname;
const publicRoot = path.join(appRoot, 'public');
const toolsRoot = path.join(appRoot, 'tools');
const jobsRoot = path.join(appRoot, 'data', 'jobs');
const installRoot = path.join(appRoot, 'data', 'install');
const preferredPort = Number(process.env.PORT || 4173);
const ffmpeg = process.env.LINGUA_FFMPEG || path.join(toolsRoot, 'ffmpeg.exe');
const whisper = process.env.LINGUA_WHISPER || path.join(toolsRoot, 'whisper', 'whisper-cli.exe');
const model = process.env.LINGUA_MODEL || path.join(toolsRoot, 'models', 'ggml-small.en.bin');
const translationMarker = path.join(toolsRoot, 'translation-cache', '.ready');
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8' };
let installState = { running: false, stage: 'idle', label: '', progress: 0, error: null };
let transcriptionState = { running: false, stage: 'idle', label: '', progress: 0, error: null, startedAt: null };

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function engineStatus() {
  const fileReady = (file, minimumBytes) => {
    try { return fs.statSync(file).size >= minimumBytes; } catch { return false; }
  };
  const parts = {
    ffmpeg: fileReady(ffmpeg, 1024 * 1024),
    whisper: fileReady(whisper, 100 * 1024),
    model: fileReady(model, 100 * 1024 * 1024),
    translation: fileReady(translationMarker, 8),
  };
  return { ready: Object.values(parts).every(Boolean), parts };
}

function run(command, args, onOutput) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true });
    let errorText = '';
    child.stderr.on('data', chunk => {
      const text = chunk.toString();
      errorText += text;
      if (onOutput) onOutput(text);
    });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve() : reject(new Error(errorText.slice(-1600) || `Process exited with ${code}`)));
  });
}

async function downloadFile(url, target, label) {
  installState = { running: true, stage: 'downloading', label, progress: 0, error: null };
  const response = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': 'Lingua-Player/0.3' } });
  if (!response.ok || !response.body) throw new Error(`${label}下载失败（${response.status}）`);
  const total = Number(response.headers.get('content-length')) || 0;
  let received = 0;
  await fsp.mkdir(path.dirname(target), { recursive: true });
  const output = fs.createWriteStream(target);
  const input = Readable.fromWeb(response.body);
  input.on('data', chunk => {
    received += chunk.length;
    installState.progress = total ? Math.min(99, Math.round(received / total * 100)) : 0;
  });
  await new Promise((resolve, reject) => {
    input.pipe(output);
    input.on('error', reject);
    output.on('error', reject);
    output.on('finish', resolve);
  });
  installState.progress = 100;
}

async function findFile(root, fileName) {
  const entries = await fsp.readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const candidate = path.join(root, entry.name);
    if (entry.isFile() && entry.name.toLowerCase() === fileName.toLowerCase()) return candidate;
    if (entry.isDirectory()) {
      const found = await findFile(candidate, fileName);
      if (found) return found;
    }
  }
  return null;
}

async function whisperDownloadUrl() {
  return 'https://github.com/ggml-org/whisper.cpp/releases/download/v1.8.3/whisper-bin-x64.zip';
}

async function installComponents() {
  if (installState.running) return;
  installState = { running: true, stage: 'starting', label: '正在准备下载', progress: 0, error: null };
  const taskRoot = path.join(installRoot, crypto.randomBytes(6).toString('hex'));
  try {
    await fsp.mkdir(taskRoot, { recursive: true });
    if (!engineStatus().parts.ffmpeg) {
      const archive = path.join(taskRoot, 'ffmpeg.zip');
      const extracted = path.join(taskRoot, 'ffmpeg');
      await downloadFile('https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-lgpl.zip', archive, '视频处理组件');
      installState = { running: true, stage: 'installing', label: '正在安装视频处理组件', progress: 100, error: null };
      await fsp.mkdir(extracted, { recursive: true });
      await run('tar.exe', ['-xf', archive, '-C', extracted]);
      const executable = await findFile(extracted, 'ffmpeg.exe');
      if (!executable) throw new Error('FFmpeg 安装包中缺少 ffmpeg.exe');
      await fsp.mkdir(path.dirname(ffmpeg), { recursive: true });
      await fsp.copyFile(executable, ffmpeg);
    }
    if (!engineStatus().parts.whisper) {
      const archive = path.join(taskRoot, 'whisper.zip');
      const extracted = path.join(taskRoot, 'whisper');
      await downloadFile(await whisperDownloadUrl(), archive, '语音识别组件');
      installState = { running: true, stage: 'installing', label: '正在安装语音识别组件', progress: 100, error: null };
      await fsp.mkdir(extracted, { recursive: true });
      await run('tar.exe', ['-xf', archive, '-C', extracted]);
      const executable = await findFile(extracted, 'whisper-cli.exe');
      if (!executable) throw new Error('Whisper 安装包中缺少 whisper-cli.exe');
      await fsp.mkdir(path.dirname(whisper), { recursive: true });
      await fsp.cp(path.dirname(executable), path.dirname(whisper), { recursive: true, force: true });
    }
    if (!engineStatus().parts.model) {
      const modelDownload = path.join(taskRoot, 'ggml-small.en.bin');
      await downloadFile('https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin?download=true', modelDownload, '英语识别模型（约 466MB）');
      await fsp.mkdir(path.dirname(model), { recursive: true });
      await fsp.copyFile(modelDownload, model);
    }
    if (!engineStatus().parts.translation) {
      installState = { running: true, stage: 'downloading', label: '正在下载英译中模型（约 310MB）', progress: 0, error: null };
      const { getTranslator } = await import('./translation.mjs');
      await getTranslator(event => {
        if (typeof event?.progress === 'number') installState.progress = Math.max(0, Math.min(99, Math.round(event.progress)));
        if (event?.file) installState.label = `正在准备英译中模型：${path.basename(event.file)}`;
      });
      installState.progress = 100;
    }
    installState = { running: false, stage: 'complete', label: '离线识别已准备完成', progress: 100, error: null };
  } catch (error) {
    installState = { running: false, stage: 'error', label: '安装未完成', progress: 0, error: error.message };
  } finally {
    if (taskRoot.startsWith(installRoot + path.sep)) fsp.rm(taskRoot, { recursive: true, force: true }).catch(() => {});
  }
}

async function translateSegments(segments, onProgress) {
  const { translateTexts } = await import('./translation.mjs');
  for (let index = 0; index < segments.length; index += 8) {
    const batch = segments.slice(index, index + 8);
    const translations = await translateTexts(batch.map(segment => segment.en));
    translations.forEach((translation, offset) => { batch[offset].zh = translation; });
    if (onProgress) onProgress(Math.min(100, Math.round((index + batch.length) / segments.length * 100)));
  }
  return segments;
}

function parseTimestamp(value) {
  const parts = value.replace(',', '.').split(':').map(Number);
  return parts[0] * 3600 + parts[1] * 60 + parts[2];
}

function parseSrt(text) {
  return text.replace(/\r/g, '').trim().split(/\n{2,}/).map(block => {
    const lines = block.split('\n');
    const timeline = lines.findIndex(line => line.includes('-->'));
    if (timeline < 0) return null;
    const [start, end] = lines[timeline].split('-->').map(item => parseTimestamp(item.trim()));
    return { start, end, en: lines.slice(timeline + 1).join(' ').replace(/<[^>]+>/g, '').trim(), zh: '' };
  }).filter(segment => segment && segment.en);
}

async function receiveFile(req, target, onProgress) {
  await fsp.mkdir(path.dirname(target), { recursive: true });
  const stream = fs.createWriteStream(target, { flags: 'wx' });
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > 8 * 1024 * 1024 * 1024) { stream.destroy(); throw new Error('视频不能超过 8GB'); }
    if (!stream.write(chunk)) await new Promise(resolve => stream.once('drain', resolve));
    if (onProgress) onProgress(bytes);
  }
  await new Promise((resolve, reject) => stream.end(error => error ? reject(error) : resolve()));
}

async function transcribe(req, res) {
  const status = engineStatus();
  if (!status.ready) return json(res, 503, { error: 'engine_missing', status });
  if (transcriptionState.running) return json(res, 409, { error: 'transcription_busy', message: '已有一个视频正在识别，请等待完成' });
  const jobDir = path.join(jobsRoot, crypto.randomBytes(8).toString('hex'));
  const rawName = decodeURIComponent(req.headers['x-file-name'] || '');
  const safeExt = path.extname(rawName).toLowerCase().replace(/[^.a-z0-9]/g, '') || '.mp4';
  const videoFile = path.join(jobDir, `input${safeExt}`);
  const audioFile = path.join(jobDir, 'audio.wav');
  const outputBase = path.join(jobDir, 'result');
  try {
    const totalBytes = Number(req.headers['content-length']) || 0;
    transcriptionState = { running: true, stage: 'uploading', label: '正在读取视频文件', progress: 1, error: null, startedAt: Date.now() };
    await receiveFile(req, videoFile, bytes => {
      transcriptionState.progress = totalBytes ? Math.max(1, Math.min(8, Math.round(bytes / totalBytes * 8))) : 2;
    });
    transcriptionState = { ...transcriptionState, stage: 'audio', label: '正在提取音频', progress: 9 };
    await run(ffmpeg, ['-y', '-i', videoFile, '-vn', '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', audioFile]);
    transcriptionState = { ...transcriptionState, stage: 'recognizing', label: '正在识别英文语音', progress: 12 };
    await run(whisper, ['-m', model, '-f', audioFile, '-l', 'en', '-osrt', '-of', outputBase, '-ml', '90', '-sow', '-np'], output => {
      const matches = [...output.matchAll(/progress\s*=\s*(\d+)%/gi)];
      if (matches.length) transcriptionState.progress = Math.max(12, Math.min(84, 12 + Math.round(Number(matches.at(-1)[1]) * 0.72)));
    });
    const segments = parseSrt(await fsp.readFile(`${outputBase}.srt`, 'utf8'));
    transcriptionState = { ...transcriptionState, stage: 'translating', label: '正在生成中文字幕', progress: 85 };
    await translateSegments(segments, progress => { transcriptionState.progress = 85 + Math.round(progress * 0.14); });
    transcriptionState = { ...transcriptionState, running: false, stage: 'complete', label: `已生成 ${segments.length} 句双语字幕`, progress: 100, error: null };
    json(res, 200, { segments, language: 'en', translation: 'zh-CN' });
  } catch (error) {
    transcriptionState = { ...transcriptionState, running: false, stage: 'error', label: '字幕生成失败', error: error.message };
    json(res, 500, { error: 'transcription_failed', message: error.message });
  } finally {
    if (jobDir.startsWith(jobsRoot + path.sep)) fsp.rm(jobDir, { recursive: true, force: true }).catch(() => {});
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://127.0.0.1');
  if (url.pathname === '/api/version' && req.method === 'GET') return json(res, 200, { version: '0.5.0', installApi: true, bundledRuntime: true, offlineTranslation: true, subtitleFirst: true });
  if (url.pathname === '/api/status' && req.method === 'GET') return json(res, 200, engineStatus());
  if (url.pathname === '/api/install/status' && req.method === 'GET') return json(res, 200, { ...installState, engine: engineStatus() });
  if (url.pathname === '/api/transcribe/status' && req.method === 'GET') return json(res, 200, transcriptionState);
  if (url.pathname === '/api/install' && req.method === 'POST') {
    installComponents();
    return json(res, 202, installState);
  }
  if (url.pathname === '/api/transcribe' && req.method === 'POST') return transcribe(req, res);
  const target = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
  const file = path.normalize(path.join(publicRoot, target));
  if (!file.startsWith(publicRoot)) return res.writeHead(403).end('Forbidden');
  fs.readFile(file, (error, content) => {
    if (error) return res.writeHead(error.code === 'ENOENT' ? 404 : 500).end('Not found');
    res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(content);
  });
});

function startServer(candidate, remaining = 10) {
  const onError = error => {
    server.removeListener('listening', onListening);
    if (error.code === 'EADDRINUSE' && remaining > 0) {
      console.log(`Port ${candidate} is busy, trying ${candidate + 1}...`);
      startServer(candidate + 1, remaining - 1);
      return;
    }
    throw error;
  };
  const onListening = () => {
    server.removeListener('error', onError);
    const url = `http://127.0.0.1:${candidate}`;
    console.log(`Lingua Player is ready at ${url}`);
    console.log(engineStatus().ready ? 'Local transcription engine: ready' : 'Local transcription engine: not installed');
    if (process.env.LINGUA_AUTO_OPEN === '1') {
      const opener = spawn('cmd.exe', ['/c', 'start', '', url], { detached: true, stdio: 'ignore', windowsHide: true });
      opener.unref();
    }
  };
  server.once('error', onError);
  server.once('listening', onListening);
  server.listen(candidate, '127.0.0.1');
}

fsp.mkdir(jobsRoot, { recursive: true }).then(() => startServer(preferredPort));
