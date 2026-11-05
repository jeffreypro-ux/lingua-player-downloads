const demoSegments = [
  { start: 0, end: 5.4, en: 'Learning a language is not about being perfect.', zh: '学习一门语言，并不意味着必须做到完美。' },
  { start: 5.4, end: 10.8, en: 'It is about noticing the small details that make an idea come alive.', zh: '而是留意那些让想法鲜活起来的细节。' },
  { start: 10.8, end: 16.1, en: 'A familiar word can suddenly carry a different meaning.', zh: '一个熟悉的词，也可能突然呈现出不同的含义。' },
  { start: 16.1, end: 21.9, en: 'When you listen with curiosity, every sentence becomes a discovery.', zh: '当你带着好奇心倾听，每个句子都会成为一次发现。' },
  { start: 21.9, end: 27.6, en: 'So slow down, stay present, and let the rhythm guide you.', zh: '所以慢下来，专注当下，让语言的节奏引导你。' },
  { start: 27.6, end: 33, en: 'Progress grows quietly through consistent practice.', zh: '进步会在持续练习中悄然发生。' },
];

const vocabulary = {
  perfect: { level: 'cet4', meaning: 'adj. 完美的；理想的' },
  detail: { level: 'cet4', meaning: 'n. 细节；详情' },
  familiar: { level: 'cet4', meaning: 'adj. 熟悉的；常见的' },
  meaning: { level: 'cet4', meaning: 'n. 含义；意义' },
  curiosity: { level: 'cet6', meaning: 'n. 好奇心；求知欲' },
  discovery: { level: 'cet6', meaning: 'n. 发现；被发现的事物' },
  rhythm: { level: 'cet6', meaning: 'n. 节奏；韵律' },
  consistent: { level: 'ielts', meaning: 'adj. 持续一致的；连贯的' },
  progress: { level: 'ielts', meaning: 'n. 进步；进展' },
  practice: { level: 'cet4', meaning: 'n. 练习；实践' },
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const els = {
  welcome: $('#welcome'), studio: $('#studio'), video: $('#video'), backdrop: $('#backdropVideo'),
  demoVisual: $('#demoVisual'), title: $('#videoTitle'), transcript: $('#transcript'), wordList: $('#wordList'),
  en: $('#englishCaption'), zh: $('#chineseCaption'), progress: $('#progress'), current: $('#currentTime'),
  duration: $('#duration'), play: $('#playButton'), centerPlay: $('#centerPlay'), count: $('#segmentCount'),
  wordCount: $('#wordCount'), toast: $('#toast'), processing: $('#processingBadge'),
};

let segments = [...demoSegments];
let currentIndex = 0;
let isDemo = true;
let demoTime = 0;
let demoPlaying = false;
let demoFrame = null;
let demoStarted = 0;
let demoStartTime = 0;
let objectUrl = null;
let importedSegments = null;
const activeLevels = new Set(['cet4', 'cet6', 'ielts']);
let engineState = { ready: false, parts: {} };

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => els.toast.classList.remove('show'), 2400);
}

function openSettings() { $('#settingsModal').classList.remove('hidden'); }
function closeSettings() { $('#settingsModal').classList.add('hidden'); }

async function refreshEngineStatus() {
  try { engineState = await fetch('/api/status').then(response => response.json()); }
  catch { engineState = { ready: false, parts: {} }; }
  $('#enginePill').classList.toggle('missing', !engineState.ready);
  $('#enginePill span').textContent = engineState.ready ? '离线识别已就绪' : '首次设置';
  $$('#engineChecklist > div').forEach(row => {
    const ready = Boolean(engineState.parts?.[row.dataset.part]);
    row.classList.toggle('ready', ready);
    row.querySelector('b').textContent = ready ? '已就绪' : '待准备';
  });
  $('#prepareEngine').textContent = engineState.ready ? '离线识别与翻译已准备完成' : '一键下载并安装（约 1GB）';
  return engineState;
}

function renderInstallProgress(state) {
  const box = $('#installProgress');
  if (state.stage === 'idle' && !state.running) return;
  box.classList.remove('hidden');
  $('#installLabel').textContent = state.error || state.label || '正在准备下载';
  $('#installPercent').textContent = state.stage === 'error' ? '失败' : `${state.progress || 0}%`;
  $('#installBar').style.width = `${state.progress || 0}%`;
  $('#installBar').style.background = state.stage === 'error' ? '#b85643' : '';
  $('#prepareEngine').disabled = Boolean(state.running);
  if (state.running) $('#prepareEngine').textContent = '正在下载，请稍候…';
}

async function pollInstall() {
  try {
    const state = await fetch('/api/install/status').then(response => response.json());
    renderInstallProgress(state);
    if (state.running) {
      setTimeout(pollInstall, 800);
      return;
    }
    $('#prepareEngine').disabled = false;
    if (state.stage === 'complete' || state.engine?.ready) {
      await refreshEngineStatus();
      $('#prepareEngine').textContent = '离线识别与翻译已准备完成';
      showToast('下载完成，中英双语字幕已经可以使用');
    } else if (state.stage === 'error') {
      $('#prepareEngine').textContent = '重新尝试一键安装';
      $('#installGuide').classList.remove('hidden');
      $('#manualGuideButton').textContent = '收起手动安装说明';
    }
  } catch {
    $('#prepareEngine').disabled = false;
    showToast('无法读取下载进度，请重新打开应用');
  }
}

function formatTime(seconds) {
  const safe = Math.max(0, Number(seconds) || 0);
  return `${String(Math.floor(safe / 60)).padStart(2, '0')}:${String(Math.floor(safe % 60)).padStart(2, '0')}`;
}

function totalDuration() {
  return isDemo ? segments.at(-1)?.end || 0 : els.video.duration || segments.at(-1)?.end || 0;
}

function getTime() { return isDemo ? demoTime : els.video.currentTime; }

function findSegment(time) {
  const exact = segments.findIndex(s => time >= s.start && time < s.end);
  if (exact >= 0) return exact;
  if (time >= (segments.at(-1)?.end || 0)) return segments.length - 1;
  return 0;
}

function tokenize(segment, time) {
  const words = segment.en.match(/[A-Za-z]+(?:'[A-Za-z]+)?|[^A-Za-z]+/g) || [segment.en];
  const spokenRatio = Math.min(1, Math.max(0, (time - segment.start) / Math.max(.1, segment.end - segment.start)));
  let wordNumber = 0;
  const totalWords = words.filter(w => /^[A-Za-z]/.test(w)).length;
  return words.map(token => {
    if (!/^[A-Za-z]/.test(token)) return token;
    const normalized = token.toLowerCase();
    const spoken = wordNumber / totalWords < spokenRatio;
    wordNumber += 1;
    const classes = [spoken ? 'spoken' : '', vocabulary[normalized] && activeLevels.has(vocabulary[normalized].level) ? 'keyword' : ''].filter(Boolean).join(' ');
    return `<span class="${classes}">${token}</span>`;
  }).join('');
}

function renderCaption(time = getTime()) {
  if (!segments.length) return;
  const nextIndex = findSegment(time);
  if (nextIndex !== currentIndex) {
    currentIndex = nextIndex;
    syncActiveSentence();
  }
  const segment = segments[currentIndex];
  els.en.innerHTML = tokenize(segment, time);
  els.zh.textContent = segment.zh || '';
  els.count.textContent = `第 ${currentIndex + 1} / ${segments.length} 句`;
}

function renderTranscript() {
  els.transcript.innerHTML = segments.map((segment, index) => `
    <button class="sentence ${index === currentIndex ? 'active' : ''}" data-index="${index}">
      <time>${formatTime(segment.start)}</time>
      <span class="en">${escapeHtml(segment.en)}</span>
      <span class="zh">${escapeHtml(segment.zh || '等待生成中文翻译')}</span>
    </button>`).join('');
  $$('.sentence').forEach(button => button.addEventListener('click', () => jumpToSegment(Number(button.dataset.index), true)));
}

function getDetectedWords() {
  const found = new Map();
  segments.forEach((segment, segmentIndex) => {
    (segment.en.toLowerCase().match(/[a-z]+(?:'[a-z]+)?/g) || []).forEach(word => {
      if (vocabulary[word] && !found.has(word)) found.set(word, { word, segmentIndex, ...vocabulary[word] });
    });
  });
  return [...found.values()];
}

function renderWords() {
  const all = getDetectedWords();
  const visible = all.filter(item => activeLevels.has(item.level));
  els.wordCount.textContent = all.length;
  els.wordList.innerHTML = visible.length ? visible.map(item => `
    <div class="word-card" data-segment="${item.segmentIndex}">
      <div class="word-head"><strong>${item.word}</strong><span class="badge ${item.level}">${levelName(item.level)}</span></div>
      <div class="meaning">${item.meaning}</div>
      <div class="context">“${escapeHtml(segments[item.segmentIndex].en)}”</div>
    </div>`).join('') : '<div class="empty">当前字幕里没有匹配到所选等级的关键词。<br>可以切换词汇等级后再查看。</div>';
  $$('.word-card').forEach(card => card.addEventListener('click', () => jumpToSegment(Number(card.dataset.segment), true)));
}

function levelName(level) { return ({ cet4: '四级', cet6: '六级', ielts: '雅思' })[level] || level; }
function escapeHtml(value) { return String(value).replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char])); }

function syncActiveSentence() {
  $$('.sentence').forEach((node, index) => node.classList.toggle('active', index === currentIndex));
  const active = $(`.sentence[data-index="${currentIndex}"]`);
  active?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function updateProgress(time = getTime()) {
  const duration = totalDuration();
  const value = duration ? Math.min(1000, time / duration * 1000) : 0;
  els.progress.value = value;
  els.progress.style.setProperty('--value', `${value / 10}%`);
  els.current.textContent = formatTime(time);
  els.duration.textContent = formatTime(duration);
  renderCaption(time);
}

function setPlayingUI(playing) {
  els.play.textContent = playing ? 'Ⅱ' : '▶';
  els.centerPlay.textContent = playing ? 'Ⅱ' : '▶';
  els.centerPlay.classList.toggle('playing', playing);
}

function tickDemo(timestamp) {
  if (!demoPlaying) return;
  demoTime = demoStartTime + (timestamp - demoStarted) / 1000;
  if (demoTime >= totalDuration()) {
    demoTime = totalDuration(); demoPlaying = false; setPlayingUI(false);
  }
  updateProgress(demoTime);
  if (demoPlaying) demoFrame = requestAnimationFrame(tickDemo);
}

function togglePlay() {
  if (isDemo) {
    demoPlaying = !demoPlaying;
    if (demoPlaying) {
      if (demoTime >= totalDuration()) demoTime = 0;
      demoStartTime = demoTime; demoStarted = performance.now(); demoFrame = requestAnimationFrame(tickDemo);
    } else cancelAnimationFrame(demoFrame);
    setPlayingUI(demoPlaying);
    return;
  }
  if (!els.video.src) return;
  els.video.paused ? els.video.play() : els.video.pause();
}

function jumpToSegment(index, autoplay = false) {
  if (!segments.length) return;
  currentIndex = Math.min(segments.length - 1, Math.max(0, index));
  const time = segments[currentIndex].start + .01;
  if (isDemo) {
    demoTime = time;
    if (demoPlaying) { demoStartTime = time; demoStarted = performance.now(); }
  } else {
    els.video.currentTime = time;
  }
  updateProgress(time);
  syncActiveSentence();
  if (autoplay && (isDemo ? !demoPlaying : els.video.paused)) togglePlay();
}

function showStudio(title = 'A quiet way to learn') {
  els.welcome.classList.add('hidden');
  els.studio.classList.remove('hidden');
  els.title.textContent = title;
  currentIndex = 0;
  renderTranscript(); renderWords(); updateProgress(0);
}

async function loadVideo(file) {
  if (!file) return;
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = URL.createObjectURL(file);
  isDemo = false; demoPlaying = false; cancelAnimationFrame(demoFrame);
  els.video.src = objectUrl; els.backdrop.src = objectUrl;
  els.video.muted = false; els.backdrop.muted = true;
  els.demoVisual.classList.add('hidden');
  segments = importedSegments || [{ start: 0, end: 99999, en: '正在等待本地识别引擎生成字幕…', zh: '也可以先导入 SRT 字幕进行体验。' }];
  showStudio(file.name.replace(/\.[^.]+$/, ''));
  if (importedSegments) showToast('视频已载入，并应用导入的字幕');
  else await autoTranscribe(file);
}

async function autoTranscribe(file) {
  try {
    const status = await refreshEngineStatus();
    if (!status.ready) {
      showToast('播放器已就绪；本地识别引擎尚未安装');
      openSettings();
      return;
    }
    els.processing.classList.remove('hidden');
    els.processing.querySelector('span').textContent = '正在生成英文字幕';
    const response = await fetch('/api/transcribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name) },
      body: file,
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || '识别失败');
    if (!result.segments?.length) throw new Error('没有识别到语音');
    segments = result.segments;
    currentIndex = 0;
    renderTranscript(); renderWords(); updateProgress(0);
    showToast(`已生成 ${segments.length} 句英文字幕`);
  } catch (error) {
    showToast(error.message || '本地识别失败，可以先导入 SRT 字幕');
  } finally {
    els.processing.classList.add('hidden');
  }
}

function parseTimestamp(value) {
  const parts = value.trim().replace(',', '.').split(':').map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return parts[0] * 60 + parts[1];
}

function parseSubtitles(text) {
  const normalized = text.replace(/^WEBVTT[^\n]*\n/, '').replace(/\r/g, '').trim();
  const blocks = normalized.split(/\n{2,}/);
  return blocks.map(block => {
    const lines = block.split('\n').filter(Boolean);
    const timelineIndex = lines.findIndex(line => line.includes('-->'));
    if (timelineIndex < 0) return null;
    const [from, to] = lines[timelineIndex].split('-->').map(v => v.trim().split(' ')[0]);
    const content = lines.slice(timelineIndex + 1).map(line => line.replace(/<[^>]+>/g, '')).filter(Boolean);
    const en = content.find(line => /[A-Za-z]/.test(line)) || content[0] || '';
    const zh = content.find(line => /[\u3400-\u9fff]/.test(line)) || '';
    return { start: parseTimestamp(from), end: parseTimestamp(to), en, zh };
  }).filter(Boolean);
}

async function importSrt(file) {
  if (!file) return;
  try {
    const parsed = parseSubtitles(await file.text());
    if (!parsed.length) throw new Error('empty');
    importedSegments = parsed;
    segments = parsed;
    showToast(`已导入 ${parsed.length} 句字幕`);
    if (!els.studio.classList.contains('hidden')) {
      renderTranscript(); renderWords(); updateProgress(getTime());
    } else {
      showStudio(file.name.replace(/\.(srt|vtt)$/i, ''));
    }
  } catch { showToast('没有识别到有效的 SRT / VTT 字幕'); }
}

function bindFileInput(selector) { $(selector).addEventListener('change', event => loadVideo(event.target.files[0])); }
bindFileInput('#videoInput'); bindFileInput('#replaceInput');
$('#srtInput').addEventListener('change', event => importSrt(event.target.files[0]));
$('#demoButton').addEventListener('click', () => {
  isDemo = true; segments = [...demoSegments]; els.demoVisual.classList.remove('hidden'); showStudio();
});
$('#backButton').addEventListener('click', () => {
  if (isDemo) { demoPlaying = false; cancelAnimationFrame(demoFrame); }
  else els.video.pause();
  setPlayingUI(false); els.studio.classList.add('hidden'); els.welcome.classList.remove('hidden');
});

['#playButton', '#centerPlay'].forEach(selector => $(selector).addEventListener('click', togglePlay));
$('#prevButton').addEventListener('click', () => jumpToSegment(currentIndex - 1, true));
$('#nextButton').addEventListener('click', () => jumpToSegment(currentIndex + 1, true));

els.video.addEventListener('play', () => { els.backdrop.currentTime = els.video.currentTime; els.backdrop.play(); setPlayingUI(true); });
els.video.addEventListener('pause', () => { els.backdrop.pause(); setPlayingUI(false); });
els.video.addEventListener('timeupdate', () => { if (Math.abs(els.backdrop.currentTime - els.video.currentTime) > .3) els.backdrop.currentTime = els.video.currentTime; updateProgress(); });
els.video.addEventListener('loadedmetadata', () => { if (segments.length === 1 && segments[0].end === 99999) segments[0].end = els.video.duration; updateProgress(); });
els.video.addEventListener('ended', () => setPlayingUI(false));

els.progress.addEventListener('input', () => {
  const time = Number(els.progress.value) / 1000 * totalDuration();
  if (isDemo) {
    demoTime = time; if (demoPlaying) { demoStartTime = time; demoStarted = performance.now(); }
  } else els.video.currentTime = time;
  updateProgress(time);
});

$$('.tab').forEach(tab => tab.addEventListener('click', () => {
  $$('.tab').forEach(t => t.classList.toggle('active', t === tab));
  $$('.tab-content').forEach(content => content.classList.remove('active'));
  $(`#${tab.dataset.tab}Tab`).classList.add('active');
}));

$$('.level').forEach(level => level.addEventListener('click', () => {
  const name = level.dataset.level;
  activeLevels.has(name) ? activeLevels.delete(name) : activeLevels.add(name);
  level.classList.toggle('active', activeLevels.has(name));
  renderWords(); renderCaption();
}));

document.addEventListener('keydown', event => {
  const editing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
  if (editing || els.studio.classList.contains('hidden')) return;
  if (event.code === 'Space') { event.preventDefault(); togglePlay(); }
  if (event.code === 'ArrowLeft') { event.preventDefault(); jumpToSegment(currentIndex - 1, true); }
  if (event.code === 'ArrowRight') { event.preventDefault(); jumpToSegment(currentIndex + 1, true); }
});

const dropZone = $('#dropZone');
['dragenter', 'dragover'].forEach(name => dropZone.addEventListener(name, event => { event.preventDefault(); dropZone.classList.add('dragging'); }));
['dragleave', 'drop'].forEach(name => dropZone.addEventListener(name, event => { event.preventDefault(); dropZone.classList.remove('dragging'); }));
dropZone.addEventListener('drop', event => loadVideo([...event.dataTransfer.files].find(file => file.type.startsWith('video/'))));

$('#settingsButton').addEventListener('click', openSettings);
$('#enginePill').addEventListener('click', openSettings);
$('#closeSettings').addEventListener('click', closeSettings);
$('#laterButton').addEventListener('click', closeSettings);
$('#settingsModal').addEventListener('click', event => { if (event.target.id === 'settingsModal') closeSettings(); });
$('#prepareEngine').addEventListener('click', () => {
  if (engineState.ready) {
    showToast('离线识别组件已经准备完成');
    return;
  }
  fetch('/api/install', { method: 'POST' })
    .then(() => pollInstall())
    .catch(() => showToast('无法开始下载，请查看手动安装说明'));
});
$('#manualGuideButton').addEventListener('click', () => {
  $('#installGuide').classList.toggle('hidden');
  $('#manualGuideButton').textContent = $('#installGuide').classList.contains('hidden') ? '下载遇到问题？查看手动安装' : '收起手动安装说明';
});
$('#recheckEngine').addEventListener('click', async () => {
  const status = await refreshEngineStatus();
  showToast(status.ready ? '安装成功，离线识别已就绪' : '仍有组件未放到指定位置');
});
document.addEventListener('keydown', event => { if (event.code === 'Escape') closeSettings(); });
refreshEngineStatus();
fetch('/api/install/status').then(response => response.json()).then(state => {
  if (state.running || state.stage !== 'idle') { renderInstallProgress(state); if (state.running) pollInstall(); }
}).catch(() => {});
