import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const SONGS = path.join(ROOT, 'songs');
const PY = path.join(ROOT, '.venv/bin/python');
const YTDLP = fs.existsSync(path.join(ROOT, '.venv/bin/yt-dlp')) ? path.join(ROOT, '.venv/bin/yt-dlp') : 'yt-dlp';
const PORT = Number(process.env.PORT || 4843);
const running = new Map();
const SF_DIR = path.join(ROOT, 'models/soundfonts');
const SF_RE = /^\/sf\/(MusyngKite|FluidR3_GM)\/([a-z0-9_]+-(?:ogg|mp3)\.js)$/;
// The TG Tools site may drive this server from the browser; every other site is refused.
const WEB_ORIGINS = new Set(['https://tools.techguyverlabs.org', 'http://localhost:4920', 'http://127.0.0.1:4920']);
const LOCAL_HOST = /^(([\w-]+\.)*localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
const PKG_VERSION = 2;

function guard(req, res) {
  if (!LOCAL_HOST.test(req.headers.host || '')) return res.writeHead(403).end('bad host'), false;
  const o = req.headers.origin;
  if (!o) return true;
  if (!WEB_ORIGINS.has(o) && !LOCAL_HOST.test(o.replace(/^https?:\/\//, ''))) return res.writeHead(403).end('origin not allowed'), false;
  res.setHeader('Access-Control-Allow-Origin', o);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
  res.setHeader('Access-Control-Allow-Headers', 'content-type, range');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');
  if (req.method === 'OPTIONS') return res.writeHead(204).end(), false;
  return true;
}
const DM_DIR = path.join(ROOT, 'models/drum-machines');
const DM_RE = /^\/dm\/([\w-]+)\/((?:[\w-]+\/)?[\w-]+\.(?:json|ogg|m4a))$/;
const mirrors = new Map();

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4', '.mp4': 'video/mp4', '.wav': 'audio/wav', '.mid': 'audio/midi', '.png': 'image/png', '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8' };

const readJSON = (p, d) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return d; } };
const slugify = s => s.toLowerCase().replace(/y2mate\.is\s*-\s*/g, '').replace(/\.[a-z0-9]+$/, '').replace(/official (music )?(video|audio)/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'song';
const runId = () => { const d = new Date(), p = n => String(n).padStart(2, '0');
  return `r${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`; };

function songList() {
  if (!fs.existsSync(SONGS)) return [];
  return fs.readdirSync(SONGS).filter(s => fs.existsSync(path.join(SONGS, s, 'song.json'))).map(slug => {
    const meta = readJSON(path.join(SONGS, slug, 'song.json'), {});
    const runsDir = path.join(SONGS, slug, 'runs');
    const runs = fs.existsSync(runsDir) ? fs.readdirSync(runsDir).filter(r => r.startsWith('r')).sort() : [];
    const last = runs[runs.length - 1];
    let live = running.get(slug)?.run || null;
    if (!live && last) {
      const ev = path.join(runsDir, last, 'events.jsonl');
      if (fs.existsSync(ev) && Date.now() - fs.statSync(ev).mtimeMs < 90000 && !/"stage":\s*"run",\s*"status":\s*"(done|fail)"/.test(fs.readFileSync(ev, 'utf8'))) live = last;
    }
    return { slug, title: meta.title || slug, runs, running: live, thumb: meta.thumb || null, author: meta.author || null, fetching: !!running.get(slug)?.fetching,
      video: meta.video ? `/songs/${slug}/${meta.video}` : null, video_offset: meta.video_offset || 0,
      history: readJSON(path.join(SONGS, slug, 'history.json'), []) };
  });
}

function startRun(slug, opts = {}) {
  if (running.has(slug)) return { error: `already running ${running.get(slug).run}` };
  const run = opts.run || runId();
  const dir = path.join(SONGS, slug, 'runs', run);
  fs.mkdirSync(dir, { recursive: true });
  const args = [path.join(ROOT, 'bin/reverse.py'), '--slug', slug, '--run', run];
  if (opts.fresh) args.push('--fresh');
  if (opts.tune === false) args.push('--no-tune');
  const log = fs.openSync(path.join(dir, 'log.txt'), 'a');
  const child = spawn(PY, ['-u', ...args], { cwd: ROOT, stdio: ['ignore', log, log], detached: true,
    env: { ...process.env, PYTORCH_ENABLE_MPS_FALLBACK: '1', TOKENIZERS_PARALLELISM: 'false' } });
  running.set(slug, { run, child });
  attachWhenLoaded(slug, run);
  child.on('exit', code => {
    if (running.get(slug)?.run === run) running.delete(slug);
    const ev = path.join(dir, 'events.jsonl');
    if (!fs.existsSync(dir)) return;
    const txt = fs.existsSync(ev) ? fs.readFileSync(ev, 'utf8') : '';
    if (!/"stage":\s*"run",\s*"status":\s*"(done|fail)"/.test(txt))
      fs.appendFileSync(ev, JSON.stringify({ t: Date.now() / 1000, stage: 'run', status: 'fail', msg: `pipeline exited ${code} - see log.txt` }) + '\n');
  });
  return { slug, run };
}

function addSong(src, title, from = src) {
  const slug = slugify(title || path.basename(src));
  const dir = path.join(SONGS, slug);
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, 'source' + (path.extname(src) || '.mp3'));
  if (!fs.existsSync(dest)) fs.copyFileSync(src, dest);
  const meta = readJSON(path.join(dir, 'song.json'), {});
  fs.writeFileSync(path.join(dir, 'song.json'), JSON.stringify({ ...meta, title: meta.title || title || slug, source: path.basename(dest), from }, null, 2));
  return slug;
}

const sh = (cmd, args) => new Promise((ok, fail) => {
  const c = spawn(cmd, args, { cwd: ROOT });
  let o = '', e = '';
  c.stdout.on('data', d => o += d); c.stderr.on('data', d => e += d);
  c.on('exit', code => code === 0 ? ok(o) : fail(new Error(e.trim().split('\n').pop() || `${cmd} exit ${code}`)));
});

const ytId = link => (/(?:youtu\.be\/|[?&]v=|\/shorts\/|\/embed\/|\/live\/)([\w-]{11})/.exec(link) || [])[1] || null;
const ytThumb = id => id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : null;

async function linkInfo(link) {
  const id = ytId(link);
  try {
    const r = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(link)}&format=json`, { signal: AbortSignal.timeout(2500) });
    if (r.ok) { const o = await r.json(); return { id, title: o.title, author: o.author_name, thumb: ytThumb(id) || o.thumbnail_url }; }
  } catch {}
  return { id, title: null, author: null, thumb: ytThumb(id) };
}

function findByLink(link, id) {
  if (!fs.existsSync(SONGS)) return null;
  for (const slug of fs.readdirSync(SONGS)) {
    const from = readJSON(path.join(SONGS, slug, 'song.json'), {}).from || '';
    if (from === link || (id && ytId(from) === id)) return slug;
  }
  return null;
}

const MB = b => (b / 1048576).toFixed(b < 10485760 ? 1 : 0);

function download(slug, link, emit) {
  const tmp = path.join(SONGS, '.incoming');
  fs.mkdirSync(tmp, { recursive: true });
  return new Promise((ok, fail) => {
    const c = spawn(YTDLP, ['--no-playlist', '--no-warnings', '--newline', '--progress', '--no-quiet',
      '-f', 'bv*[height<=1080][vcodec^=avc1]+ba[ext=m4a]/b[height<=1080]/ba/b', '--merge-output-format', 'mp4',
      '-o', path.join(tmp, '%(id)s.%(ext)s'), '--no-simulate',
      '--print', 'before_dl:SRMETA %(title)s|%(requested_formats.0.filesize,requested_formats.0.filesize_approx)s|%(requested_formats.1.filesize,requested_formats.1.filesize_approx)s|%(filesize,filesize_approx)s',
      '--print', 'after_move:SRFILE %(vcodec)s|%(filepath)s',
      '--progress-template', 'download:SRDL %(progress.downloaded_bytes)s|%(progress.total_bytes,progress.total_bytes_estimate)s|%(progress.speed)s|%(info.format_id)s|%(info.vcodec)s',
      link], { cwd: ROOT, detached: true });
    running.get(slug).child = c;
    const got = { title: null, file: null, vcodec: null, bytes: 0 };
    let sizes = [], part = -1, partId = null, last = 0, err = '';
    const onLine = l => {
      let m;
      if ((m = /^SRMETA (.*)\|(\w+)\|(\w+)\|(\w+)$/.exec(l))) {
        got.title = m[1];
        sizes = [+m[2], +m[3]].every(n => n > 0) ? [+m[2], +m[3]] : +m[4] > 0 ? [+m[4]] : [];
      } else if ((m = /^SRDL (\w+)\|(\w+)\|([\w.]+)\|([^|]*)\|(.*)$/.exec(l))) {
        const done = +m[1] || 0, partTotal = +m[2] || 0, speed = +m[3] || 0;
        if (m[4] !== partId) { partId = m[4]; part++; }
        if (sizes.length <= part) sizes[part] = partTotal;
        else if (partTotal) sizes[part] = partTotal;
        const before = sizes.slice(0, part).reduce((a, b) => a + b, 0), total = sizes.reduce((a, b) => a + b, 0) || partTotal;
        const have = before + done;
        got.bytes = Math.max(got.bytes, have);
        const now = Date.now();
        if (now - last < 250 && done < partTotal) return;
        last = now;
        const kind = m[5] && m[5] !== 'none' && m[5] !== 'NA' ? 'video' : 'audio';
        emit({ stage: 'fetch', status: 'progress', pct: total ? Math.min(95, +(95 * have / total).toFixed(1)) : 0,
          msg: `Downloading ${kind} · ${MB(have)} of ${MB(total)} MB${speed ? ` · ${MB(speed)} MB/s` : ''}`,
          data: { phase: kind, have, total, speed, eta: speed && total ? Math.max(0, (total - have) / speed) : null } });
      } else if ((m = /^SRFILE ([^|]*)\|(.*)$/.exec(l))) {
        got.vcodec = m[1]; got.file = m[2];
      } else if ((m = /^\[(youtube|info|generic)[^\]]*\] (?:[\w-]+: )?(.*)$/.exec(l))) {
        const say = /^Extracting/.test(m[2]) ? 'Opening the link' : /webpage/.test(m[2]) ? 'Reading the page'
          : /format\(s\)/.test(m[2]) ? 'Picked the best video + audio' : /challenge|player|JSON|m3u8|manifest/i.test(m[2]) ? 'Finding the best quality' : null;
        if (say) emit({ stage: 'fetch', status: 'progress', pct: 0, msg: say });
      } else if (/^\[Merger\]/.test(l)) {
        emit({ stage: 'fetch', status: 'progress', pct: 96, msg: 'Joining video + audio' });
      } else if (/^ERROR:/.test(l)) err = l.replace(/^ERROR:\s*(\[[^\]]+\]\s*)?([\w-]+:\s*)?/, '');
    };
    readline.createInterface({ input: c.stdout }).on('line', onLine);
    readline.createInterface({ input: c.stderr }).on('line', onLine);
    c.on('error', e => fail(e));
    c.on('exit', code => code === 0 && got.file ? ok(got) : fail(new Error(err || `yt-dlp exit ${code}`)));
  });
}

async function addLink(link) {
  const info = await linkInfo(link);
  const known = findByLink(link, info.id);
  const knownMeta = known ? readJSON(path.join(SONGS, known, 'song.json'), {}) : {};
  if (known && knownMeta.source && fs.existsSync(path.join(SONGS, known, knownMeta.source))) return startRun(known);
  let slug = known || slugify(info.title || info.id || new URL(link).hostname);
  if (!known && fs.existsSync(path.join(SONGS, slug))) slug = slugify(`${slug.slice(0, 36)}-${info.id || Date.now().toString(36)}`);
  if (running.has(slug)) return { error: `already running ${running.get(slug).run}` };
  const dir = path.join(SONGS, slug), songFile = path.join(dir, 'song.json');
  fs.mkdirSync(dir, { recursive: true });
  const title = knownMeta.title || info.title || slug;
  fs.writeFileSync(songFile, JSON.stringify({ ...knownMeta, title, from: link, thumb: info.thumb, author: info.author }, null, 2));
  const run = runId(), t0 = Date.now();
  fs.mkdirSync(path.join(dir, 'runs', run), { recursive: true });
  const ev = path.join(dir, 'runs', run, 'events.jsonl');
  const emit = o => { if (fs.existsSync(path.dirname(ev))) fs.appendFileSync(ev, JSON.stringify({ t: Date.now() / 1000, ...o }) + '\n'); };
  const job = { run, child: null, fetching: true };
  running.set(slug, job);
  emit({ stage: 'run', status: 'start', msg: `${title} - ${run}` });
  emit({ stage: 'fetch', status: 'start', msg: 'Reaching the site' });
  (async () => {
    const got = await download(slug, link, emit);
    if (job.cancelled) return fs.rmSync(got.file, { force: true });
    const hasVideo = got.vcodec && got.vcodec !== 'none';
    let source = 'source' + path.extname(got.file);
    if (hasVideo) {
      emit({ stage: 'fetch', status: 'progress', pct: 98, msg: 'Pulling the audio out of the video' });
      source = 'source.m4a';
      await sh('ffmpeg', ['-y', '-v', 'error', '-i', got.file, '-vn', '-c:a', 'copy', path.join(dir, source)]);
    } else fs.renameSync(got.file, path.join(dir, source));
    const meta = readJSON(songFile, {});
    if (hasVideo && meta.video) fs.rmSync(got.file, { force: true });
    fs.writeFileSync(songFile, JSON.stringify({ ...meta, title: info.title ? meta.title : got.title || meta.title, source,
      ...(hasVideo && !meta.video ? { video_pending: got.file } : {}) }, null, 2));
    const secs = (Date.now() - t0) / 1000;
    emit({ stage: 'fetch', status: 'done', secs: +secs.toFixed(1), msg: `${MB(got.bytes)} MB ${hasVideo ? 'song + video' : 'audio'}` });
    if (job.cancelled) return;
    running.delete(slug);
    const r = startRun(slug, { run });
    if (r.error) throw new Error(r.error);
  })().catch(e => {
    if (job.cancelled) return;
    running.delete(slug);
    emit({ stage: 'fetch', status: 'fail', msg: String(e.message || e).slice(0, 200) });
    emit({ stage: 'run', status: 'fail', msg: `could not get the link: ${String(e.message || e).slice(0, 200)}` });
  });
  return { slug, run };
}

function cancelRun(slug, run) {
  const job = running.get(slug);
  run = job?.run || run;
  if (job) {
    job.cancelled = true;
    running.delete(slug);
    if (job.child) try { process.kill(-job.child.pid, 'SIGTERM'); } catch { try { job.child.kill('SIGTERM'); } catch {} }
  }
  if (run) spawn('pkill', ['-f', `reverse.py --slug ${slug} --run ${run}`]);
  const dir = path.join(SONGS, slug), runsDir = path.join(dir, 'runs');
  if (!fs.existsSync(dir)) return { ok: true, removed: 'nothing' };
  const trash = path.join(SONGS, '.trash'), stamp = Date.now().toString(36);
  fs.mkdirSync(trash, { recursive: true });
  const kept = fs.existsSync(runsDir) ? fs.readdirSync(runsDir).filter(r => r !== run && fs.existsSync(path.join(runsDir, r, 'report.json'))) : [];
  if (!kept.length) { fs.renameSync(dir, path.join(trash, `${slug}-${stamp}`)); return { ok: true, removed: 'song' }; }
  if (run && fs.existsSync(path.join(runsDir, run))) fs.renameSync(path.join(runsDir, run), path.join(trash, `${slug}-${run}-${stamp}`));
  return { ok: true, removed: 'run' };
}

let stageCache = { at: 0, v: {} };
function stageTimes() {
  if (Date.now() - stageCache.at < 60000) return stageCache.v;
  const runs = [];
  if (fs.existsSync(SONGS)) for (const slug of fs.readdirSync(SONGS)) {
    const rd = path.join(SONGS, slug, 'runs');
    if (!fs.existsSync(rd)) continue;
    for (const r of fs.readdirSync(rd)) {
      const ev = path.join(rd, r, 'events.jsonl');
      if (!fs.existsSync(ev)) continue;
      const done = {};
      for (const l of fs.readFileSync(ev, 'utf8').split('\n')) {
        try { const e = JSON.parse(l); if (e.status === 'done' && typeof e.secs === 'number') done[e.stage] = e.secs; } catch {}
      }
      if (done.run) runs.push({ r, done });
    }
  }
  const recent = runs.sort((a, b) => a.r.localeCompare(b.r)).slice(-30), v = {};
  for (const stage of new Set(recent.flatMap(x => Object.keys(x.done)))) {
    const xs = recent.map(x => x.done[stage]).filter(n => n != null).sort((a, b) => a - b);
    v[stage] = { median: xs[xs.length >> 1], share: xs.length / recent.length, n: xs.length };
  }
  if (v.fetch) v.fetch.share = 1;
  stageCache = { at: Date.now(), v };
  return v;
}

function attachWhenLoaded(slug, run) {
  const meta = readJSON(path.join(SONGS, slug, 'song.json'), {});
  if (!meta.video_pending || meta.video) return;
  const ev = path.join(SONGS, slug, 'runs', run, 'events.jsonl');
  const iv = setInterval(async () => {
    if (!fs.existsSync(path.dirname(ev))) return clearInterval(iv);
    const txt = fs.existsSync(ev) ? fs.readFileSync(ev, 'utf8') : '';
    if (/"stage":\s*"run",\s*"status":\s*"fail"/.test(txt)) return clearInterval(iv);
    if (!/"stage":\s*"load",\s*"status":\s*"done"/.test(txt)) return;
    clearInterval(iv);
    try {
      await sh(PY, [path.join(ROOT, 'bin/attach_video.py'), slug, meta.video_pending]);
      const m = readJSON(path.join(SONGS, slug, 'song.json'), {});
      delete m.video_pending;
      fs.writeFileSync(path.join(SONGS, slug, 'song.json'), JSON.stringify(m, null, 2));
      fs.rmSync(meta.video_pending, { force: true });
    } catch (e) { console.error(`attach video ${slug}: ${e.message}`); }
  }, 1000);
}

function sendFile(req, res, file) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end('not found'); }
  const size = fs.statSync(file).size;
  const type = TYPES[path.extname(file)] || 'application/octet-stream';
  const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
  if (range) {
    const start = range[1] ? +range[1] : 0, end = range[2] ? +range[2] : size - 1;
    res.writeHead(206, { 'Content-Type': type, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1 });
    return fs.createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': size, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
}

function exportPart(res, slug, run, part, kind, fmt) {
  const c = spawn(PY, ['-I', path.join(ROOT, 'bin/export.py'), slug, run, part, kind, fmt], { cwd: ROOT });
  let out = '', err = '';
  c.stdout.on('data', d => (out += d));
  c.stderr.on('data', d => (err += d));
  c.on('close', code => {
    const file = out.trim().split('\n').pop();
    if (code || !file || !fs.existsSync(file)) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end(err.trim().split('\n').pop() || 'export failed'); }
    const name = path.basename(file);
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Content-Length': fs.statSync(file).size,
      'Content-Disposition': `attachment; filename="${name.replace(/[^\x20-\x7e]|"/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}` });
    fs.createReadStream(file).pipe(res);
  });
}

function mirror(url, dest) {
  if (fs.existsSync(dest)) return Promise.resolve(dest);
  if (!mirrors.has(dest)) mirrors.set(dest, (async () => {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest + '.part', Buffer.from(await r.arrayBuffer()));
    fs.renameSync(dest + '.part', dest);
    return dest;
  })().finally(() => mirrors.delete(dest)));
  return mirrors.get(dest);
}
const soundfont = (kit, file) => mirror(`https://gleitz.github.io/midi-js-soundfonts/${kit}/${file}`, path.join(SF_DIR, kit, file));
const drumFile = (dir, file) => mirror(`https://smpldsnds.github.io/drum-machines/${dir}/${file}`, path.join(DM_DIR, dir, file));

async function drain(jobs) {
  const worker = async () => { while (jobs.length) await jobs.shift()().catch(e => console.error(e.message)); };
  await Promise.all(Array.from({ length: 4 }, worker));
}

async function warmAudio({ kit = 'MusyngKite', files = [], drums = [], drumFormat = 'ogg' }) {
  await drain(files.filter(f => SF_RE.test(`/sf/${kit}/${f}`)).map(f => () => soundfont(kit, f)));
  for (const dir of drums.filter(d => /^[\w-]+$/.test(d))) {
    const dm = await drumFile(dir, 'dm.json').then(f => readJSON(f, { samples: [] })).catch(() => ({ samples: [] }));
    await drain(dm.samples.map(s => `${s}.${drumFormat}`).filter(f => DM_RE.test(`/dm/${dir}/${f}`)).map(f => () => drumFile(dir, f)));
  }
}

function sendCached(res, file) {
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Content-Length': fs.statSync(file).size, 'Cache-Control': 'public, max-age=31536000, immutable' });
  fs.createReadStream(file).pipe(res);
}

function streamEvents(req, res, slug, run) {
  const file = path.join(SONGS, slug, 'runs', run, 'events.jsonl');
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  let pos = 0, buf = '';
  const tick = () => {
    if (!fs.existsSync(file)) return;
    const size = fs.statSync(file).size;
    if (size <= pos) return;
    const fd = fs.openSync(file, 'r');
    const chunk = Buffer.alloc(size - pos);
    fs.readSync(fd, chunk, 0, chunk.length, pos);
    fs.closeSync(fd);
    pos = size;
    buf += chunk.toString('utf8');
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const l of lines) if (l.trim()) res.write(`data: ${l}\n\n`);
  };
  tick();
  const iv = setInterval(() => { tick(); res.write(': ping\n\n'); }, 400);
  req.on('close', () => clearInterval(iv));
}

const MIX_STEMS = ['vocals', 'drums', 'bass', 'guitar', 'piano', 'other'];

function latestReport(slug) {
  const rd = path.join(SONGS, slug, 'runs');
  if (!fs.existsSync(rd)) return null;
  const run = fs.readdirSync(rd).filter(r => r.startsWith('r') && fs.existsSync(path.join(rd, r, 'report.json'))).sort().pop();
  return run ? readJSON(path.join(rd, run, 'report.json'), null) : null;
}

function mixSongs() {
  if (!fs.existsSync(SONGS)) return [];
  return fs.readdirSync(SONGS).filter(s => !s.startsWith('.') && MIX_STEMS.every(n => fs.existsSync(path.join(SONGS, s, 'stems', `${n}.wav`))))
    .map(slug => {
      const meta = readJSON(path.join(SONGS, slug, 'song.json'), {}), r = latestReport(slug);
      return r && { slug, title: meta.title || slug, author: meta.author || null, thumb: meta.thumb || null, bpm: r.rhythm?.bpm, key: r.harmony?.key, mode: r.harmony?.mode };
    }).filter(Boolean).sort((a, b) => a.title.localeCompare(b.title));
}

function mixSong(slug) {
  const r = latestReport(slug);
  if (!r) return null;
  const meta = readJSON(path.join(SONGS, slug, 'song.json'), {});
  const rh = r.rhythm || {}, h = r.harmony || {};
  return { slug, title: meta.title || slug, author: meta.author || null, thumb: meta.thumb || null, duration: r.duration,
    bpm: rh.bpm, bpm_alt: rh.bpm_alt, beats: rh.beats || [], downbeats: rh.downbeats || [], sections: rh.sections || [],
    key: h.key, mode: h.mode, stems: (r.stems || []).filter(s => MIX_STEMS.includes(s.name)).map(s => ({ name: s.name, web: s.web, peaks: s.peaks, tag: s.tag?.label ? `${s.tag.label}${s.tag.conf ? ' ' + Math.round(s.tag.conf * 100) + '%' : ''}` : '' })) };
}

const stretching = new Map();
let stretchSlots = 4;
const stretchQueue = [];
async function limited(fn) {
  if (stretchSlots > 0) stretchSlots--; else await new Promise(r => stretchQueue.push(r));
  try { return await fn(); } finally { const next = stretchQueue.shift(); if (next) next(); else stretchSlots++; }
}
function stretchFile(slug, rel, tempo, semis) {
  const base = /^web\/([\w-]+)\.mp3$/.exec(rel)?.[1] || rel.replace(/\.\w+$/, '').replace(/[^\w-]+/g, '_');
  const name = `${base}-t${tempo.toFixed(4)}-p${semis}.mp3`;
  const out = path.join(SONGS, slug, 'cache', 'mix', name), url = `/songs/${slug}/cache/mix/${name}`;
  if (fs.existsSync(out)) return Promise.resolve(url);
  if (!stretching.has(out)) stretching.set(out, (async () => {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    const wav = out.replace(/\.mp3$/, '.tmp.wav'), dec = out.replace(/\.mp3$/, '.src.wav');
    let src = ['stems', 'drums'].map(d => path.join(SONGS, slug, d, `${base}.wav`)).find(f => fs.existsSync(f));
    if (!src) { await sh('ffmpeg', ['-y', '-v', 'error', '-i', path.join(SONGS, slug, rel), dec]); src = dec; }
    await limited(() => sh('rubberband', ['-q', '-2', '-T', String(tempo), '-p', String(semis), ...(/vocals/.test(base) ? ['-F'] : []), src, wav]));
    await sh('ffmpeg', ['-y', '-v', 'error', '-i', wav, '-b:a', '192k', '-f', 'mp3', out + '.part']);
    fs.renameSync(out + '.part', out);
    fs.rmSync(wav, { force: true }); fs.rmSync(dec, { force: true });
    return url;
  })().finally(() => stretching.delete(out)));
  return stretching.get(out);
}

const body = req => new Promise(r => { const c = []; req.on('data', d => c.push(d)); req.on('end', () => r(Buffer.concat(c))); });

const VOICE_FX = ['dry', 'studio', 'big', 'phone'], VOICE_CHUNK = 8;
const VOICE_KNOBS = { str: [0, 100], spd: [0, 200], vib: [0, 100], hold: [0, 200], fmt: [-6, 6], mix: [0, 100] };
const voiceDir = (slug, id) => path.join(SONGS, slug, 'voice', id || '');
const wavSecs = f => { const h = Buffer.alloc(44), fd = fs.openSync(f, 'r'); fs.readSync(fd, h, 0, 44, 0); fs.closeSync(fd);
  return (fs.statSync(f).size - 44) / h.readUInt32LE(28); };
function voiceTakes(slug) {
  const d = voiceDir(slug);
  if (!fs.existsSync(d)) return [];
  const ids = fs.readdirSync(d).filter(id => /^t[\d-]+$/.test(id) && fs.existsSync(path.join(d, id, 'take.json'))).sort();
  return ids.map((id, i) => ({ id, name: `take ${i + 1}`, ...readJSON(path.join(d, id, 'take.json'), {}) }));
}
const reportPath = slug => {
  const rd = path.join(SONGS, slug, 'runs');
  return path.join(rd, fs.readdirSync(rd).filter(r => fs.existsSync(path.join(rd, r, 'report.json'))).sort().pop(), 'report.json');
};
let tuneSlots = 4;
const tuneQueue = [];
async function tuneLimited(fn) {
  if (tuneSlots > 0) tuneSlots--; else await new Promise(r => tuneQueue.push(r));
  try { return await fn(); } finally { const next = tuneQueue.shift(); if (next) next(); else tuneSlots++; }
}
async function tuneChunk(src, out, args) {
  if (fs.existsSync(out) && fs.existsSync(out + '.json')) return readJSON(out + '.json', {});
  return tuneLimited(async () => {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    const o = await sh(PY, ['-I', path.join(ROOT, 'bin/tune.py'), src, out + '.part.wav', ...args]);
    fs.renameSync(out + '.part.wav', out);
    fs.writeFileSync(out + '.json', o.trim().split('\n').pop());
    return readJSON(out + '.json', {});
  });
}
const renders = new Map();
function voiceRender(slug, track, k, fx) {
  const tuned = k.str > 0 || k.fmt !== 0, sig = `s${k.str}-r${k.spd}-v${k.vib}-h${k.hold}-f${k.fmt}`, mode = tuned ? sig : 'off';
  const r = latestReport(slug), take = track === 'vocals' ? null : voiceTakes(slug).find(t => t.id === track);
  const src = take ? path.join(voiceDir(slug, track), 'raw.wav') : path.join(SONGS, slug, 'stems/vocals.wav');
  const dir = voiceDir(slug, track === 'vocals' ? 'singer' : track), name = `${mode}-${fx}-m${k.mix}.mp3`, out = path.join(dir, 'render', name);
  const done = () => ({ state: 'done', url: `/songs/${slug}/voice/${track === 'vocals' ? 'singer' : track}/render/${name}`, ...readJSON(out + '.json', {}) });
  if (fs.existsSync(out) && fs.existsSync(out + '.json')) return done();
  if (renders.has(out)) return renders.get(out).state;
  const job = { state: { state: 'busy', pct: 0 } };
  renders.set(out, job);
  (async () => {
    const at = take ? take.at : 0, secs = take ? wavSecs(src) : r.duration, n = Math.max(1, Math.ceil(secs / VOICE_CHUNK));
    let inputs = [src], stats = {};
    if (tuned) {
      let got = 0;
      const res = await Promise.all(Array.from({ length: n }, (_, i) => tuneChunk(src, path.join(dir, mode, `c${i}.wav`),
        ['--report', reportPath(slug), '--at', String(at), '--start', String(i * VOICE_CHUNK), '--dur', String(VOICE_CHUNK), '--strength', String(k.str), '--speed', String(k.spd), '--vibrato', String(k.vib), '--hold', String(k.hold), '--formant', String(k.fmt)])
        .then(s => { job.state = { state: 'busy', pct: Math.round(++got / n * 95) }; return s; })));
      inputs = res.map((_, i) => path.join(dir, mode, `c${i}.wav`));
      const w = res.reduce((a, s) => a + (s.voiced || 0), 0) || 1, avg = k => +(res.reduce((a, s) => a + (s[k] || 0) * (s.voiced || 0), 0) / w).toFixed(1);
      stats = { in_tune_before: avg('in_tune_before'), in_tune_after: avg('in_tune_after'), cents_before: avg('cents_before'), cents_after: avg('cents_after') };
    }
    fs.mkdirSync(path.dirname(out), { recursive: true });
    const o = await sh(PY, ['-I', path.join(ROOT, 'bin/voicefx.py'), out + '.part', ...inputs, '--fx', fx, '--mix', String(k.mix), '--bpm', String(r.rhythm?.bpm || 0),
      '--at', String(at), '--total', String(r.duration || 0)]);
    fs.renameSync(out + '.part', out);
    fs.writeFileSync(out + '.json', JSON.stringify({ ...JSON.parse(o.trim().split('\n').pop()), ...stats }));
  })().catch(e => { const m = String(e.message || e); job.state = { state: 'fail', error: /No module named '(pyworld|pedalboard)'/.test(m) ? 'Auto-tune needs one more install step: run the setup command in Terminal again, then reload this page' : m.slice(0, 200) }; })
    .finally(() => { if (job.state.state !== 'fail') renders.delete(out); else setTimeout(() => renders.delete(out), 10000); });
  return job.state;
}

http.createServer(async (req, res) => {
  if (!guard(req, res)) return;
  const url = new URL(req.url, 'http://x');
  const p = decodeURIComponent(url.pathname);
  const json = (o, code = 200) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
  try {
    if (p === '/api/hello') return json({ app: 'song-exploder', version: PKG_VERSION });
    if (p === '/') return sendFile(req, res, path.join(ROOT, 'public/index.html'));
    if (p.startsWith('/public/')) return sendFile(req, res, path.join(ROOT, path.normalize(p).replace(/^\/+/, '')));
    if (p.startsWith('/songs/')) return sendFile(req, res, path.join(SONGS, path.normalize(p.slice(7))));
    if (p === '/api/songs') return json(songList());
    if (p === '/api/mix/songs') return json(mixSongs());
    if (p === '/api/mix/song') {
      const slug = url.searchParams.get('slug') || '';
      const s = /^[\w-]+$/.test(slug) && mixSong(slug);
      return s ? json(s) : json({ error: 'no finished run for that song' }, 404);
    }
    if (p === '/api/mix/stretch') {
      const slug = url.searchParams.get('slug') || '', stem = url.searchParams.get('stem');
      const tempo = +url.searchParams.get('tempo'), semis = Math.round(+url.searchParams.get('semis') || 0);
      const src = (url.searchParams.get('src') || '').split('?')[0];
      const rel = stem ? `web/${stem}.mp3` : src.startsWith(`/songs/${slug}/`) ? path.normalize(src.slice(slug.length + 8)) : '';
      if (!/^[\w-]+$/.test(slug) || !rel || rel.startsWith('..') || !fs.existsSync(path.join(SONGS, slug, rel)) || !(tempo >= 0.5 && tempo <= 2) || Math.abs(semis) > 12)
        return json({ error: 'need slug, src (a file of that song), tempo 0.5-2, semis -12..12' }, 400);
      const t0 = Date.now();
      return json({ url: await stretchFile(slug, rel, tempo, semis), secs: +((Date.now() - t0) / 1000).toFixed(1) });
    }
    if (p === '/api/mix/align') {
      const q = Object.fromEntries(url.searchParams);
      const tempo = +q.tempo, semis = Math.round(+q.semis || 0), off = +q.off, beat = +q.beat;
      if (![q.a, q.b].every(s => /^[\w-]+$/.test(s || '')) || !(tempo >= 0.5 && tempo <= 2) || !isFinite(off) || !(beat > 0.1 && beat < 2))
        return json({ error: 'need a, b, tempo, semis, off, beat' }, 400);
      const bUrl = Math.abs(tempo - 1) < 0.00005 && !semis ? `/songs/${q.b}/stems/drums.wav` : await stretchFile(q.b, 'web/drums.mp3', tempo, semis);
      const out = await sh(PY, ['-I', path.join(ROOT, 'bin/mix_align.py'), path.join(SONGS, q.a, 'stems/drums.wav'),
        path.join(SONGS, bUrl.replace(/^\/songs\//, '')), String(off), String(beat)]);
      return json(JSON.parse(out.trim().split('\n').pop()));
    }
    if (p === '/api/stage-times') return json(stageTimes());
    if (p.startsWith('/api/voice/')) {
      const q = Object.fromEntries(url.searchParams);
      if (!/^[\w-]+$/.test(q.slug || '') || !latestReport(q.slug)) return json({ error: 'open a song that has finished loading first' }, 400);
      if (p === '/api/voice/takes') return json(voiceTakes(q.slug));
      if (p === '/api/voice/take' && req.method === 'POST') {
        const at = +q.at;
        if (!(at >= 0)) return json({ error: 'need at (song seconds)' }, 400);
        const id = runId().replace(/^r/, 't'), dir = voiceDir(q.slug, id);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'raw.wav'), await body(req));
        fs.writeFileSync(path.join(dir, 'take.json'), JSON.stringify({ at: +at.toFixed(3), made: new Date().toISOString() }));
        return json(voiceTakes(q.slug).find(t => t.id === id));
      }
      if (p === '/api/voice/render') {
        const k = Object.fromEntries(Object.entries(VOICE_KNOBS).map(([n, [lo, hi]]) => [n, Math.round(Math.min(hi, Math.max(lo, +q[n] || 0)))]));
        if (!(q.track === 'vocals' || voiceTakes(q.slug).some(t => t.id === q.track)) || !VOICE_FX.includes(q.fx))
          return json({ error: `need track (vocals or a take id), fx (${VOICE_FX}), knobs ${Object.keys(VOICE_KNOBS)}` }, 400);
        return json(voiceRender(q.slug, q.track, k, q.fx));
      }
      if (p === '/api/voice/delete' && req.method === 'POST' && /^t[\d-]+$/.test(q.id || '') && fs.existsSync(voiceDir(q.slug, q.id))) {
        fs.mkdirSync(path.join(SONGS, '.trash'), { recursive: true });
        fs.renameSync(voiceDir(q.slug, q.id), path.join(SONGS, '.trash', `${q.slug}-${q.id}-${Date.now().toString(36)}`));
        return json({ ok: true });
      }
    }
    let sf;
    if ((sf = SF_RE.exec(p))) return sendCached(res, await soundfont(sf[1], sf[2]));
    if ((sf = DM_RE.exec(p))) return sendCached(res, await drumFile(sf[1], sf[2]));
    if (p === '/api/audio-warm' && req.method === 'POST') {
      warmAudio(JSON.parse((await body(req)).toString() || '{}'));
      return json({ ok: true });
    }
    let m;
    if ((m = /^\/api\/events\/([\w-]+)\/([\w-]+)$/.exec(p))) return streamEvents(req, res, m[1], m[2]);
    if ((m = /^\/api\/export\/([\w-]+)\/([\w-]+)\/([\w-]+)\/(orig|ours|midi)\.(wav|mp3|mid)$/.exec(p))) return exportPart(res, ...m.slice(1));
    if (p === '/api/run' && req.method === 'POST') {
      const o = JSON.parse((await body(req)).toString() || '{}');
      let slug = o.slug;
      if (/^https?:\/\//.test(o.path || '')) { const r = await addLink(o.path.trim()); return json(r, r.error ? 409 : 200); }
      if (o.path) slug = addSong(o.path.replace(/^~/, process.env.HOME), o.title);
      if (!slug) return json({ error: 'need slug or path' }, 400);
      const r = startRun(slug, o);
      return json(r, r.error ? 409 : 200);
    }
    if (p === '/api/cancel' && req.method === 'POST') {
      const o = JSON.parse((await body(req)).toString() || '{}');
      if (!/^[\w-]+$/.test(o.slug || '') || (o.run && !/^[\w-]+$/.test(o.run))) return json({ error: 'bad slug or run' }, 400);
      return json(cancelRun(o.slug, o.run));
    }
    if (p === '/api/video' && req.method === 'POST') {
      const slug = url.searchParams.get('slug');
      if (!slug || !fs.existsSync(path.join(SONGS, slug, 'mix.wav'))) return json({ error: 'open a song that has finished loading first' }, 400);
      let src = url.searchParams.get('path');
      if (!src) {
        const tmp = path.join(SONGS, '.incoming');
        fs.mkdirSync(tmp, { recursive: true });
        src = path.join(tmp, path.basename(url.searchParams.get('name') || 'video.mp4'));
        fs.writeFileSync(src, await body(req));
      }
      const out = await new Promise(r => {
        const c = spawn(PY, [path.join(ROOT, 'bin/attach_video.py'), slug, src.replace(/^~/, process.env.HOME)], { cwd: ROOT });
        let o = '', e = '';
        c.stdout.on('data', d => o += d); c.stderr.on('data', d => e += d);
        c.on('exit', code => r(code === 0 ? JSON.parse(o.trim().split('\n').pop()) : { error: e.trim().split('\n').pop() || `exit ${code}` }));
      });
      if (out.error || out.attached || url.searchParams.get('path')) return json(out, out.error ? 500 : 200);
      const name = path.basename(src).replace(/\.[^.]+$/, '');
      const newSlug = addSong(src, name);
      const metaFile = path.join(SONGS, newSlug, 'song.json');
      const meta = readJSON(metaFile, {});
      if (!meta.video) fs.writeFileSync(metaFile, JSON.stringify({ ...meta, video_pending: src }, null, 2));
      const r = startRun(newSlug);
      return json({ ...r, match: out.match, newSong: true }, r.error ? 409 : 200);
    }
    if (p === '/api/upload' && req.method === 'POST') {
      const name = url.searchParams.get('name') || 'upload.mp3';
      const tmp = path.join(ROOT, 'songs', '.incoming');
      fs.mkdirSync(tmp, { recursive: true });
      const f = path.join(tmp, path.basename(name));
      fs.writeFileSync(f, await body(req));
      const slug = addSong(f, name.replace(/\.[^.]+$/, ''));
      const metaFile = path.join(SONGS, slug, 'song.json'), meta = readJSON(metaFile, {});
      if (/\.(mp4|mov|m4v|webm|mkv)$/i.test(name) && !meta.video) fs.writeFileSync(metaFile, JSON.stringify({ ...meta, video_pending: f }, null, 2));
      return json(startRun(slug));
    }
    res.writeHead(404); res.end('not found');
  } catch (e) { json({ error: String(e) }, 500); }
}).listen(PORT, () => console.log(`song-exploder on http://song-exploder.localhost:${PORT}`));
