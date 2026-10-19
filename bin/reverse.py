"""Song in -> stems, drum parts, tempo, key, chords, notes, drum hits, instrument names, a rebuilt beat and its grade."""
import argparse, json, os, re, shutil, subprocess, sys, threading, time, warnings
from collections import Counter
from contextlib import contextmanager
from pathlib import Path

import numpy as np
import soundfile as sf
import librosa

warnings.filterwarnings('ignore')
ROOT = Path(__file__).resolve().parent.parent
SONGS = ROOT / 'songs'
MODELS = ROOT / 'models'
BIN = Path(sys.executable).parent
MLX_SEP = ROOT / '.venv-mlx' / 'bin' / 'mlx-audio-separator'
VERSION = 'v7'
SEPARATOR = 'BS-Roformer-SW.ckpt'
CLAP = 'laion/clap-htsat-unfused'
SR = 22050
LIKE_FLOOR, LIKE_CEIL = 0.55, 0.92
STEMS = ['vocals', 'drums', 'bass', 'guitar', 'piano', 'other']
DRUMS = ['kick', 'snare', 'toms', 'hh', 'ride', 'crash']
MELODIC = ['bass', 'guitar', 'piano', 'other']
NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
MAJOR = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
MINOR = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])
GM_DRUM = {'kick': 36, 'snare': 38, 'toms': 45, 'hh': 42, 'ride': 51, 'crash': 49}
GM_PROGRAM = {'bass': 38, 'guitar': 25, 'piano': 0, 'other': 81, 'vocals': 54}
TAG_LABELS = ['808 bass', 'electric bass', 'synth bass', 'kick drum', 'snare drum', 'hand clap', 'hi-hat', 'rap vocals',
              'singing vocals', 'vocal chops', 'choir', 'piano', 'electric piano', 'rhodes', 'harpsichord', 'church organ',
              'pipe organ', 'hammond organ', 'clavinet', 'acoustic guitar', 'electric guitar', 'synth pad', 'synth lead',
              'synth pluck', 'bells', 'music box', 'marimba', 'strings', 'violin', 'brass', 'trumpet', 'flute', 'saxophone',
              'harp', 'sound effects']
DRUM_LABELS = ['kick drum', '808 kick', 'snare drum', 'hand clap', 'rimshot', 'closed hi-hat', 'open hi-hat', 'crash cymbal',
               'ride cymbal', 'tom drum', 'shaker', 'tambourine', 'cowbell', 'finger snap']
DEFAULT_RECIPE = {'gain': 'peak', 'timbre': 'sine', 'drum_sample': 'best', 'hit_gate': 0.1, 'onset_delta': 0.07,
                  'quantize': False, 'note_onset': 0.5, 'note_frame': 0.3, 'bass_decay': 0.6, 'voice': 'synth',
                  'loop_bars': 2, 'loop_thresh': 0.92}
TUNE_STEPS = [
    ('Match each part loudness to its stem', {'gain': 'global'}),
    ('Follow each stem loudness curve over time', {'gain': 'env'}),
    ('Copy each instrument tone (harmonics) from its stem', {'timbre': 'match'}),
    ('Play notes with a sample cut from each stem', {'voice': 'sampled'}),
    ('Find each part\'s repeating loop and replay its phrases', {'voice': 'loop'}),
    ('Loop unit of 1 bar instead of 2', {'loop_bars': 1}),
    ('Merge near-identical phrases (fewer distinct)', {'loop_thresh': 0.85}),
    ('Average several drum hits into one sample', {'drum_sample': 'mean'}),
    ('Catch quieter drum hits', {'hit_gate': 0.05}),
    ('More sensitive hit detection', {'onset_delta': 0.03}),
    ('Less sensitive hit detection', {'onset_delta': 0.15}),
    ('Snap drum hits to the 16th-note grid', {'quantize': True}),
    ('More notes (lower note threshold)', {'note_onset': 0.35, 'note_frame': 0.2}),
    ('Longer 808 tail', {'bass_decay': 1.4}),
]
DRUM_KEYS = ('onset_delta', 'hit_gate', 'quantize', 'drum_sample', 'gain')


class Run:
    def __init__(self, slug, run):
        self.song = SONGS / slug
        self.dir = self.song / 'runs' / run
        self.web = self.song / 'web'
        for d in (self.dir, self.web, self.song / 'cache'):
            d.mkdir(parents=True, exist_ok=True)
        self.ev = open(self.dir / 'events.jsonl', 'a')
        meta = json.loads((self.song / 'song.json').read_text())
        self.report = {'slug': slug, 'run': run, 'title': meta.get('title', slug), 'version': VERSION,
                       'started': time.strftime('%Y-%m-%dT%H:%M:%S%z')}
        self.source = self.song / meta['source']
        self._last_pct = {}
        self.memo = {}
        self.lock = threading.RLock()

    def emit(self, stage, status, **kw):
        if status == 'progress':
            pct = kw.get('pct', 0)
            if abs(pct - self._last_pct.get(stage, -99)) < 2 and 'data' not in kw:
                return
            self._last_pct[stage] = pct
        with self.lock:
            self.ev.write(json.dumps({'t': round(time.time(), 3), 'stage': stage, 'status': status, **kw}, separators=(',', ':')) + '\n')
            self.ev.flush()
        if status != 'progress':
            print(f'[{stage}] {status} {kw.get("msg", "")}', flush=True)

    def save(self):
        with self.lock:
            tmp = self.dir / 'report.json.tmp'
            tmp.write_text(json.dumps(self.report, separators=(',', ':')))
            tmp.replace(self.dir / 'report.json')

    @contextmanager
    def stage(self, name):
        t0 = time.time()
        box = {'msg': ''}
        self.emit(name, 'start')
        try:
            yield box
        except Exception as e:
            self.emit(name, 'fail', msg=f'{type(e).__name__}: {e}'[:300], secs=round(time.time() - t0, 1))
            raise
        self.save()
        self.emit(name, 'skip' if box.get('skip') else 'done', msg=box['msg'], secs=round(time.time() - t0, 1))


def load(p, sr=SR):
    y, _ = librosa.load(str(p), sr=sr, mono=True)
    return y.astype(np.float32)


def rms(x):
    return float(np.sqrt(np.mean(x ** 2)) + 1e-12)


def peaks(y, ref, n=800):
    hop = max(1, len(y) // n)
    m = np.abs(y[:hop * n]).reshape(n, hop).max(axis=1)
    return [round(float(v), 3) for v in np.clip(m / (ref + 1e-9), 0, 1)]


def active_pct(y):
    frames = librosa.feature.rms(y=y, frame_length=2048, hop_length=1024)[0]
    return round(100 * float(np.mean(frames > 10 ** (-45 / 20))), 1)


def encode(src, dst, y=None):
    if y is not None:
        tmp = dst.with_suffix('.tmp.wav')
        sf.write(tmp, y, SR)
        src = tmp
    subprocess.run(['ffmpeg', '-y', '-v', 'error', '-i', str(src), '-ac', '1', '-ar', '32000', '-b:a', '96k', str(dst)], check=True)
    if y is not None:
        tmp.unlink()


def split(R, stage, src, model, out):
    """MLX on Apple Silicon (~4x faster, same SDR on MUSDB), PyTorch audio-separator if that is missing or fails."""
    if MLX_SEP.exists():
        try:
            return run_with_progress(R, stage, [str(MLX_SEP), str(src), '-m', model, '--model_file_dir', str(MODELS), '--output_dir', str(out),
                                                '--output_format', 'WAV', '--save_converted_safetensors'])
        except RuntimeError as e:
            R.emit(stage, 'progress', pct=0, msg=f'MLX split failed ({str(e)[:80]}), using PyTorch')
    run_with_progress(R, stage, [str(BIN / 'audio-separator'), str(src), '-m', model, '--model_file_dir', str(MODELS), '--output_dir', str(out),
                                 '--output_format', 'WAV', '--use_autocast'], env={'PYTORCH_ENABLE_MPS_FALLBACK': '1'})


def run_with_progress(R, stage, cmd, lo=0, hi=100, env=None):
    p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, env={**os.environ, **(env or {})})
    buf, tail = b'', []
    while True:
        c = p.stdout.read(256)
        if not c:
            break
        buf += c
        parts = re.split(rb'[\r\n]', buf)
        buf = parts.pop()
        for line in parts:
            s = line.decode('utf8', 'replace')
            tail = (tail + [s])[-20:]
            m = re.search(r'(\d{1,3})%\|', s)
            if m:
                R.emit(stage, 'progress', pct=round(lo + (hi - lo) * int(m.group(1)) / 100, 1))
    if p.wait() != 0:
        raise RuntimeError(' | '.join(t for t in tail if t.strip())[-400:])


def stage_load(R, box):
    mix = R.song / 'mix.wav'
    if not mix.exists():
        subprocess.run(['ffmpeg', '-y', '-v', 'error', '-i', str(R.source), '-ac', '2', '-ar', '44100', str(mix)], check=True)
    y = load(mix)
    R.mix = y
    R.ref = float(np.abs(y).max())
    R.report['duration'] = round(len(y) / SR, 2)
    if not (R.web / 'original.mp3').exists():
        encode(mix, R.web / 'original.mp3')
    R.report['original'] = {'web': f'/songs/{R.report["slug"]}/web/original.mp3', 'peaks': peaks(y, R.ref)}
    box['msg'] = f'{len(y) / SR:.0f}s, {R.source.suffix[1:]}'


def separate_roformer(R, out):
    tmp = R.song / 'cache' / 'roformer'
    shutil.rmtree(tmp, ignore_errors=True)
    tmp.mkdir(parents=True)
    split(R, 'stems', R.song / 'mix.wav', SEPARATOR, tmp)
    out.mkdir(exist_ok=True)
    for f in tmp.glob('*.wav'):
        m = re.search(r'\((\w+)\)', f.name)
        if m and m.group(1).lower() in STEMS:
            shutil.move(str(f), out / f'{m.group(1).lower()}.wav')
    shutil.rmtree(tmp, ignore_errors=True)
    missing = [s for s in STEMS if not (out / f'{s}.wav').exists()]
    if missing:
        raise RuntimeError(f'missing {missing}')
    return SEPARATOR.replace('.ckpt', '')


def separate_demucs(R, out):
    tmp = R.song / 'cache' / 'demucs'
    cmd = [str(BIN / 'python'), '-m', 'demucs', '-n', 'htdemucs_6s', '-d', 'mps', '-o', str(tmp),
           '--filename', '{stem}.{ext}', str(R.song / 'mix.wav')]
    try:
        run_with_progress(R, 'stems', cmd, env={'PYTORCH_ENABLE_MPS_FALLBACK': '1'})
    except RuntimeError:
        run_with_progress(R, 'stems', [c if c != 'mps' else 'cpu' for c in cmd])
    out.mkdir(exist_ok=True)
    for s in STEMS:
        shutil.move(str(tmp / 'htdemucs_6s' / f'{s}.wav'), out / f'{s}.wav')
    shutil.rmtree(tmp, ignore_errors=True)
    return 'htdemucs_6s'


def stage_stems(R, box, fresh):
    out = R.song / 'stems'
    if fresh and out.exists():
        shutil.rmtree(out)
    if not all((out / f'{s}.wav').exists() for s in STEMS):
        try:
            model = separate_roformer(R, out)
        except RuntimeError as e:
            R.emit('stems', 'progress', pct=0, msg=f'{SEPARATOR} failed ({str(e)[:80]}), using htdemucs_6s')
            model = separate_demucs(R, out)
        (out / 'model.txt').write_text(model)
        box['msg'] = f'6 stems ({model})'
    else:
        box['msg'] = f'6 stems (cached, {(out / "model.txt").read_text() if (out / "model.txt").exists() else "htdemucs_6s"})'
    R.stems = {s: load(out / f'{s}.wav') for s in STEMS}
    rows = []
    for s in STEMS:
        if not (R.web / f'{s}.mp3').exists():
            encode(out / f'{s}.wav', R.web / f'{s}.mp3')
        y = R.stems[s]
        rows.append({'name': s, 'kind': 'stem', 'web': f'/songs/{R.report["slug"]}/web/{s}.mp3', 'peaks': peaks(y, R.ref),
                     'active_pct': active_pct(y), 'rms_db': round(20 * np.log10(rms(y)), 1)})
    R.report['stems'] = rows
    inst = sum(R.stems[s] for s in STEMS if s != 'vocals')
    R.inst = inst
    if not (R.web / 'instrumental.mp3').exists():
        encode(None, R.web / 'instrumental.mp3', inst)
    R.report['instrumental'] = {'web': f'/songs/{R.report["slug"]}/web/instrumental.mp3', 'peaks': peaks(inst, R.ref)}
    full = load(R.song / 'mix.wav')
    total = sum(R.stems.values())
    n = min(len(full), len(total))
    R.sep_snr = round(10 * np.log10(np.sum(full[:n] ** 2) / (np.sum((full[:n] - total[:n]) ** 2) + 1e-12)), 1)
    box['msg'] += f', sum = original within {R.sep_snr} dB'


def stage_drums(R, box, fresh):
    out = R.song / 'drums'
    if fresh and out.exists():
        shutil.rmtree(out)
    if not all((out / f'{d}.wav').exists() for d in DRUMS):
        tmp = R.song / 'cache' / 'drumsep'
        shutil.rmtree(tmp, ignore_errors=True)
        tmp.mkdir(parents=True)
        split(R, 'drums', R.song / 'stems' / 'drums.wav', 'MDX23C-DrumSep-aufr33-jarredou.ckpt', tmp)
        out.mkdir(exist_ok=True)
        for f in tmp.glob('*.wav'):
            m = re.search(r'\((\w+)\)', f.name)
            if m and m.group(1).lower() in DRUMS:
                shutil.move(str(f), out / f'{m.group(1).lower()}.wav')
        shutil.rmtree(tmp, ignore_errors=True)
        missing = [d for d in DRUMS if not (out / f'{d}.wav').exists()]
        if missing:
            raise RuntimeError(f'drum split missing {missing}')
        box['msg'] = '6 drum parts (MDX23C DrumSep)'
    else:
        box['msg'] = '6 drum parts (cached)'
    R.drums = {d: load(out / f'{d}.wav') for d in DRUMS}
    dref = float(max(np.abs(R.stems['drums']).max(), 1e-6))
    for d in DRUMS:
        if not (R.web / f'{d}.mp3').exists():
            encode(out / f'{d}.wav', R.web / f'{d}.mp3')
        y = R.drums[d]
        R.report['stems'].append({'name': d, 'kind': 'drum', 'web': f'/songs/{R.report["slug"]}/web/{d}.mp3', 'peaks': peaks(y, dref),
                                  'active_pct': active_pct(y), 'rms_db': round(20 * np.log10(rms(y)), 1)})
    live = [d for d in DRUMS if next(s for s in R.report['stems'] if s['name'] == d)['active_pct'] >= 2]
    box['msg'] += f', playing: {", ".join(live) or "none"}'


def loop_period(y):
    """Looper period in samples (float) if one exact repeat length holds across the song, else None."""
    import scipy.signal as ss
    hop = 256
    env = librosa.onset.onset_strength(y=y, sr=SR, hop_length=hop)
    env = env - env.mean()
    ac = np.correlate(env, env, 'full')[len(env) - 1:]
    lo, hi = int(2 * SR / hop), min(int(30 * SR / hop), len(env) // 3)
    if hi <= lo:
        return None
    c = (lo + int(np.argmax(ac[lo:hi]))) * hop
    n, r = 8 * SR, int(0.03 * SR)
    lags = []
    for a in range(20 * SR, len(y) - c - n - r, 20 * SR):
        x, seg = y[a + c:a + c + n], y[a - r:a + n + r]
        cc = ss.correlate(seg, x, 'valid', method='fft')
        cc = cc / (np.sqrt(ss.correlate(seg ** 2, np.ones(n), 'valid', method='fft') * (x ** 2).sum()) + 1e-12)
        i = int(np.argmax(cc))
        if cc[i] < 0.5 or not 0 < i < len(cc) - 1:
            continue
        lags.append(c + r - (i + 0.5 * (cc[i - 1] - cc[i + 1]) / (cc[i - 1] - 2 * cc[i] + cc[i + 1])))
    if len(lags) < 3:
        return None
    med = float(np.median(lags))
    return med if np.mean(np.abs(np.array(lags) - med) < 1) >= 0.6 else None


def frac_shift(x, d):
    N = 1 << int(np.ceil(np.log2(len(x) + int(d) + 2)))
    X = np.fft.rfft(x, N)
    out = np.fft.irfft(X * np.exp(-2j * np.pi * np.fft.rfftfreq(N) * d), N)[:len(x)].astype(np.float32)
    out[:int(np.ceil(d))] = 0
    return out


def stage_layers(R, box):
    """Looper songs: subtract the previous loop pass (magnitudes) from mix-minus-vocals; a ~4-chunk quiet run = a new layer being recorded."""
    R.layers = {}
    R.report['stems'] = [r for r in R.report['stems'] if r['kind'] != 'layer']
    R.report.pop('layers', None)
    mix = load(R.song / 'mix.wav')
    n = min(len(mix), len(R.stems['vocals']))
    inst = mix[:n] - R.stems['vocals'][:n]
    L = loop_period(inst)
    if L is None:
        box['skip'], box['msg'] = True, 'no looper (no exact repeat length)'
        return
    C, chunk = int(round(L)), L / 4
    Y = librosa.stft(inst, n_fft=2048, hop_length=512)
    P = librosa.stft(frac_shift(inst, L), n_fft=2048, hop_length=512)
    A = np.abs(Y)
    new = librosa.istft(Y * np.clip((A - np.abs(P)) / (A + 1e-9), 0, 1), hop_length=512, length=n)
    db = []
    for k in range(int(n / chunk)):
        a, b = int(k * chunk), int((k + 1) * chunk)
        ex = float((inst[a:b] ** 2).mean())
        db.append(None if k < 4 or ex < 1e-7 else 10 * np.log10(ex / (float((new[a:b] ** 2).mean()) + 1e-12)))
    got = [d for d in db if d is not None]
    removed = round(float(np.median(got)), 1) if got else 0.0
    if removed < 6:
        box['skip'], box['msg'] = True, f'repeats every {L / SR:.2f}s but too loosely to split ({removed} dB)'
        return
    start = next((k for k, d in enumerate(db) if d is not None and d >= 5), 4)
    base_at = max(0, int(start * chunk) - C)
    passes = [10 * np.log10((inst[s:s + C] ** 2).mean() + 1e-12) for s in range(base_at, n - C, C)]
    if passes:
        loud = float(np.median(passes))
        quiet = next((i for i, p in enumerate(passes) if p > loud - 20), 0)
        base_at, passes = base_at + quiet * C, passes[quiet:]
    build = round(float(np.median(passes) - passes[0]), 1) if passes else 0.0
    if build < 3:
        box['skip'], box['msg'] = True, f'repeats every {L / SR:.2f}s but full from the first pass (+{build} dB build) - a produced beat, not a looper'
        return
    body = np.array(passes[:max(1, int(len(passes) * 0.9))])
    fall = round(float((np.maximum.accumulate(body) - body).max()), 1)
    if fall > 9:
        box['skip'], box['msg'] = True, f'repeats every {L / SR:.2f}s but parts drop out again (-{fall} dB) - an arranged song, not a looper'
        return
    end, entries, k = n, [], 4
    while k < len(db):
        j = k
        while j < len(db) and db[j] is not None and db[j] < 5:
            j += 1
        if j - k >= 3:
            s = int(k * chunk)
            if s + 2 * C > n:
                break
            grow = 10 * np.log10((inst[s + C:s + 2 * C] ** 2).sum() / ((inst[s - C:s] ** 2).sum() + 1e-12))
            if grow < -6:
                end = s
                break
            if grow > 0.5:
                entries.append((s, round(float(grow), 1)))
        k = max(j, k + 1)
    fade = int(0.01 * SR)
    win = np.ones(C, np.float32)
    win[:fade], win[-fade:] = np.linspace(0, 1, fade), np.linspace(1, 0, fade)

    def repeat(src, at):
        out = np.zeros(n, np.float32)
        piece = src[at:at + C] * win[:len(src[at:at + C])]
        j = 0
        while True:
            dst = int(round(at + j * L))
            if dst >= end:
                break
            m = min(len(piece), end - dst)
            out[dst:dst + m] += piece[:m]
            j += 1
        return out
    live = new.copy()
    for s, _ in entries:
        live[s:s + C] = 0
    tracks = [('base loop', repeat(inst, base_at), base_at)] + [(f'layer {i}', repeat(new, s), s) for i, (s, _) in enumerate(entries, 1)]
    tracks.append(('live parts', live, None))
    slug = R.report['slug']
    for name, y, at in tracks:
        R.layers[name] = y
        f = name.replace(' ', '-')
        encode(None, R.web / f'layer-{f}.mp3', y)
        R.report['stems'].append({'name': name, 'kind': 'layer', 'web': f'/songs/{slug}/web/layer-{f}.mp3', 'peaks': peaks(y, R.ref),
                                  'active_pct': active_pct(y), 'rms_db': round(20 * np.log10(rms(y)), 1),
                                  'at': None if at is None else round(at / SR, 2), 'until': round(end / SR, 2)})
    R.report['layers'] = {'loop_s': round(L / SR, 5), 'removed_db': removed, 'base_at': round(base_at / SR, 2), 'end_at': round(end / SR, 2),
                          'entries': [{'at': round(s / SR, 2), 'grow_db': g} for s, g in entries]}
    box['msg'] = f'{L / SR:.3f}s loop, base + {len(entries)} layers, loop removed {removed} dB'


def section_names(feats, energy):
    letters, out, protos = 'ABCDEFGH', [], []
    for f in feats:
        sims = [float(f @ p / (np.linalg.norm(f) * np.linalg.norm(p) + 1e-9)) for p in protos]
        if sims and max(sims) > 0.93:
            out.append(letters[int(np.argmax(sims))])
        else:
            protos.append(f)
            out.append(letters[min(len(protos) - 1, 7)])
    names = [f'Part {l}' for l in out]
    if len(names) > 2 and energy[0] < 0.6 * np.median(energy):
        names[0] = 'Intro'
    if len(names) > 2 and energy[-1] < 0.6 * np.median(energy):
        names[-1] = 'Outro'
    return names


def sixteenths(beats):
    g = [a + (b - a) * k / 4 for a, b in zip(beats[:-1], beats[1:]) for k in range(4)]
    return np.array(g + [beats[-1]]) if len(beats) else np.array([])


def on_grid(beats, onsets):
    g = sixteenths(beats)
    if not len(g) or not len(onsets):
        return 0.0, 0.0
    signed = np.array([t - g[np.argmin(np.abs(g - t))] for t in onsets])
    return float(np.mean(np.abs(signed) < 0.025)), float(np.median(signed))


def snap_offset(beats, onsets):
    for _ in range(3):
        beats = beats + on_grid(beats, onsets)[1]
    return beats


def refine_steady(beats, hits, duration):
    for _ in range(3):
        if len(beats) < 2 or len(hits) < 8:
            return beats
        step = (beats[1] - beats[0]) / 4
        idx = np.round((hits - beats[0]) / step)
        res = hits - (beats[0] + idx * step)
        keep = np.abs(res) < 0.04
        if keep.sum() < 8:
            return beats
        step, t0 = np.polyfit(idx[keep], hits[keep], 1)
        first = t0 - 4 * step * np.floor(t0 / (4 * step))
        beats = np.arange(first, duration, 4 * step)
    return beats


def steady_grid(env, hop, period, duration):
    t_env = librosa.times_like(env, sr=SR, hop_length=hop)
    best = (-1, period, 0)
    for p in np.linspace(period * 0.98, period * 1.02, 81):
        phases = np.linspace(0, p, 64, endpoint=False)
        g = phases[:, None] + p * np.arange(int(duration / p) + 1)
        s = (np.interp(g, t_env, env).sum(1) + 0.5 * np.interp(g + p / 2, t_env, env).sum(1)) * p
        i = int(np.argmax(s))
        if s[i] > best[0]:
            best = (s[i], p, phases[i])
    _, p, ph = best
    return np.arange(ph, duration, p)


def best_grid(R):
    """Tracker beats vs fixed tempos at 2/3..2x the tracker's; most hits on a 16th wins, beat kept within 70-180 BPM."""
    drums_on = rms(R.stems['drums']) > 3e-3
    src = R.stems['drums'] if drums_on else R.mix
    env = librosa.onset.onset_strength(y=src, sr=SR, hop_length=128)
    _, beats = librosa.beat.beat_track(onset_envelope=env, sr=SR, hop_length=128)
    tracked = librosa.frames_to_time(beats, sr=SR, hop_length=128)
    hits = []
    for y in ([R.drums[d] for d in ('kick', 'snare', 'hh')] if drums_on else [R.mix]):
        e = librosa.onset.onset_strength(y=y, sr=SR, hop_length=256)
        hits += list(librosa.onset.onset_detect(onset_envelope=e, sr=SR, hop_length=256, units='time', delta=0.07, wait=7))
    hits = np.array(sorted(hits))
    if len(tracked) < 8:
        bpm = float(np.atleast_1d(librosa.feature.tempo(onset_envelope=env, sr=SR, hop_length=128))[0]) or 100.0
        tracked = np.arange(0, R.report['duration'], 60 / bpm)
    period = float(np.median(np.diff(tracked)))
    cands = [(refine_steady(steady_grid(env, 128, period / f, R.report['duration']), hits, R.report['duration']), True)
             for f in (1, 1.5, 4 / 3, 2, 0.5, 2 / 3, 0.75) if 70 <= 60 * f / period <= 180]
    cands.append((snap_offset(tracked, hits), False))
    scored = [(on_grid(b[b >= 0], hits)[0], b[b >= 0], st) for b, st in cands]
    fit, beats, steady = max(scored, key=lambda x: round(x[0], 2))
    return beats, steady, fit


def stage_rhythm(R, box):
    hop = 512
    bt, steady, _ = best_grid(R)
    env = librosa.onset.onset_strength(y=R.stems['drums'] if rms(R.stems['drums']) > 3e-3 else R.mix, sr=SR, hop_length=hop)
    bpm = 60 / float(np.median(np.diff(bt)))
    beats = librosa.time_to_frames(bt, sr=SR, hop_length=hop)
    kick_env = librosa.onset.onset_strength(y=R.drums['kick'], sr=SR, hop_length=hop) if hasattr(R, 'drums') else env
    strength = [float(sum(kick_env[min(b, len(kick_env) - 1)] for b in beats[i::4])) for i in range(4)]
    phase = int(np.argmax(strength))
    downs = bt[phase::4]
    R.beats, R.downbeats, R.bpm = bt, downs, bpm
    chroma = librosa.feature.chroma_cqt(y=R.mix, sr=SR, hop_length=hop)
    mfcc = librosa.feature.mfcc(y=R.mix, sr=SR, hop_length=hop, n_mfcc=13)
    db_frames = librosa.time_to_frames(downs, sr=SR, hop_length=hop)
    feat = np.vstack([librosa.util.normalize(chroma, axis=1), librosa.util.normalize(mfcc, axis=1)])
    bar_feat = librosa.util.sync(feat, db_frames, aggregate=np.mean)
    k = int(np.clip(R.report['duration'] / 22, 3, 10))
    bounds = sorted(set(librosa.segment.agglomerative(bar_feat, min(k, bar_feat.shape[1]))) | {0})
    times = [0.0] + [float(downs[b - 1]) if 0 < b <= len(downs) else 0.0 for b in bounds[1:]]
    times = sorted(set(round(t, 2) for t in times))
    energy_curve = librosa.feature.rms(y=R.mix, hop_length=hop)[0]
    secs, feats, energies = [], [], []
    for i, s in enumerate(times):
        e = times[i + 1] if i + 1 < len(times) else R.report['duration']
        a, b = librosa.time_to_frames([s, e], sr=SR, hop_length=hop)
        feats.append(feat[:, a:b].mean(axis=1))
        energies.append(float(energy_curve[a:b].mean()))
        secs.append({'start': s, 'end': round(e, 2)})
    for s, n in zip(secs, section_names(feats, np.array(energies))):
        s['name'] = n
    R.sections = secs
    alt = bpm * 2 if bpm < 100 else bpm / 2
    R.report['rhythm'] = {'bpm': round(bpm, 1), 'bpm_alt': round(alt, 1), 'beats': [round(float(t), 3) for t in bt],
                          'downbeats': [round(float(t), 3) for t in downs], 'sections': secs, 'steady': steady}
    box['msg'] = f'{bpm:.1f} BPM (or {alt:.0f}){" steady" if steady else " drifting"}, {len(downs)} bars, {len(secs)} sections: {" ".join(s["name"].replace("Part ", "") for s in secs)}'


def chord_templates():
    out = {}
    for root in range(12):
        for name, steps in (('', (0, 4, 7)), ('m', (0, 3, 7))):
            v = np.zeros(12)
            v[[(root + s) % 12 for s in steps]] = 1
            out[NAMES[root] + name] = v / np.linalg.norm(v)
    return out


def stage_harmony(R, box):
    harm = sum(R.stems[s] for s in MELODIC)
    chroma = librosa.feature.chroma_cqt(y=harm, sr=SR, hop_length=512)
    avg = chroma.mean(axis=1)
    fit, root, mode = max((float(np.corrcoef(np.roll(p, i), avg)[0, 1]), i, m)
                          for i in range(12) for p, m in ((MAJOR, 'major'), (MINOR, 'minor')))
    t = librosa.times_like(chroma[0], sr=SR, hop_length=512)
    tpl = chord_templates()
    level = librosa.feature.rms(y=harm, hop_length=512)[0]
    floor = np.percentile(level, 90) * 0.08
    edges = list(R.downbeats) + [R.report['duration']]
    chords = []
    for i in range(len(edges) - 1):
        s, e = edges[i], edges[i + 1]
        sel = (t >= s) & (t < e)
        if not sel.any():
            continue
        if level[sel[:len(level)]].mean() < floor:
            name = 'N'
        else:
            c = chroma[:, sel].mean(axis=1)
            name = max(tpl, key=lambda k: float(tpl[k] @ (c / (np.linalg.norm(c) + 1e-9))))
        if chords and chords[-1]['chord'] == name:
            chords[-1]['end'] = round(float(e), 2)
        else:
            chords.append({'start': round(float(s), 2), 'end': round(float(e), 2), 'chord': name})
    R.report['harmony'] = {'key': NAMES[root], 'mode': mode, 'fit': round(fit, 2), 'chords': chords}
    common = [c for c, _ in Counter(c['chord'] for c in chords if c['chord'] != 'N').most_common(4)]
    box['msg'] = f'{NAMES[root]} {mode} (fit {fit:.2f}), main chords {" ".join(common)}'


def bp_model():
    from basic_pitch import ICASSP_2022_MODEL_PATH
    from basic_pitch.inference import Model
    return Model(Path(str(ICASSP_2022_MODEL_PATH) + '.onnx'))


def stage_notes(R, box, fresh):
    from basic_pitch.inference import run_inference
    model = None
    R.bp = {}
    parts = [s for s in MELODIC + ['vocals'] if next(r for r in R.report['stems'] if r['name'] == s)['active_pct'] >= 2]
    for i, s in enumerate(parts):
        cache = R.song / 'cache' / f'bp_{s}.npz'
        if cache.exists() and not fresh:
            R.bp[s] = dict(np.load(cache))
        else:
            model = model or bp_model()
            out = run_inference(str(R.song / 'stems' / f'{s}.wav'), model)
            np.savez_compressed(cache, **out)
            R.bp[s] = out
        R.emit('notes', 'progress', pct=round(100 * (i + 1) / len(parts)), msg=f'{s} done')
    box['msg'] = f'note maps for {", ".join(parts)}'


def notes_for(R, s, recipe):
    from basic_pitch.note_creation import model_output_to_notes
    key = ('notes', s, recipe['note_onset'], recipe['note_frame'])
    if key not in R.memo:
        _, ev = model_output_to_notes(R.bp[s], recipe['note_onset'], recipe['note_frame'], min_note_len=11,
                                      max_freq=330 if s == 'bass' else None, include_pitch_bends=False, melodia_trick=True)
        R.memo[key] = sorted([[round(float(a), 3), round(float(b), 3), int(p), round(float(v), 2)] for a, b, p, v, *_ in ev])
    return R.memo[key]


def grid16(R):
    pts = []
    for a, b in zip(R.beats[:-1], R.beats[1:]):
        pts += [a + (b - a) * k / 4 for k in range(4)]
    return np.array(pts + [R.beats[-1]]) if len(R.beats) else np.array([])


def detect_hits(R, d, recipe):
    key = ('hits', d, recipe['onset_delta'], recipe['hit_gate'], recipe['quantize'])
    if key not in R.memo:
        R.memo[key] = _detect_hits(R, d, recipe)
    return R.memo[key]


def _detect_hits(R, d, recipe):
    y = R.drums[d]
    hop = 256
    if ('env', d) not in R.memo:
        R.memo[('env', d)] = librosa.onset.onset_strength(y=y, sr=SR, hop_length=hop)
    env = R.memo[('env', d)]
    on = librosa.onset.onset_detect(onset_envelope=env, sr=SR, hop_length=hop, units='samples', delta=recipe['onset_delta'],
                                    wait=int(0.045 * SR / hop), backtrack=False)
    if not len(on):
        return []
    w = int(0.03 * SR)
    vel = np.array([np.sqrt(np.mean(y[i:i + w] ** 2)) for i in on])
    top = vel.max() + 1e-9
    keep = vel / top >= recipe['hit_gate']
    hits = [[float(i / SR), float(v / top)] for i, v, k in zip(on, vel, keep) if k]
    if recipe['quantize']:
        g = R.grid
        for h in hits:
            j = int(np.argmin(np.abs(g - h[0])))
            if abs(g[j] - h[0]) < 0.04:
                h[0] = float(g[j])
    return [[round(t, 3), round(v, 2)] for t, v in hits]


def bars_from_hits(R, hits):
    edges = list(R.downbeats) + [R.downbeats[-1] + 4 * 60 / max(R.bpm, 1)] if len(R.downbeats) else []
    bars = []
    for i in range(len(edges) - 1):
        s, e = edges[i], edges[i + 1]
        step = (e - s) / 16
        grid = {}
        for d, hs in hits.items():
            row = ['-'] * 16
            for t, v in hs:
                k = int(round((t - s) / step))
                if s - step / 2 <= t < e - step / 2 and 0 <= k < 16:
                    row[k] = 'x'
            grid[d] = ''.join(row)
        sec = next((x['name'] for x in R.sections if x['start'] <= s < x['end']), '')
        bars.append({'start': round(float(s), 3), 'end': round(float(e), 3), 'section': sec, 'grid': grid})
    main = {}
    for d in hits:
        rows = [b['grid'][d] for b in bars if 'x' in b['grid'][d]]
        main[d] = Counter(rows).most_common(1)[0][0] if rows else '-' * 16
    return bars, main


def stage_hits(R, box, recipe):
    R.grid = grid16(R)
    live = [d for d in DRUMS if next(r for r in R.report['stems'] if r['name'] == d)['active_pct'] >= 2]
    hits = {d: detect_hits(R, d, recipe) for d in live}
    bars, main = bars_from_hits(R, hits)
    all_t = np.array([t for hs in hits.values() for t, _ in hs])
    tight = round(100 * float(np.mean([np.min(np.abs(R.grid - t)) < 0.025 for t in all_t])), 1) if len(all_t) and len(R.grid) else 0
    R.report['drums'] = {'parts': live, 'hits': hits, 'bars': bars, 'main': main}
    R.report['rhythm']['tightness_pct'] = tight
    R.report['notes'] = {s: notes_for(R, s, recipe) for s in R.bp}
    counts = ', '.join(f'{d} {len(hits[d])}' for d in live)
    box['msg'] = (f'{counts}; {tight}% on the 16th grid; notes: ' if live else 'no drums; notes: ') + ', '.join(f'{s} {len(n)}' for s, n in R.report['notes'].items())


def stage_tags(R, box):
    try:
        import torch
        from transformers import ClapModel, ClapProcessor
        try:
            model = ClapModel.from_pretrained(CLAP, local_files_only=True).eval()
            proc = ClapProcessor.from_pretrained(CLAP, local_files_only=True)
        except OSError:
            model = ClapModel.from_pretrained(CLAP).eval()
            proc = ClapProcessor.from_pretrained(CLAP)
        R.clap = (model, proc)
    except Exception as e:
        box['skip'] = True
        box['msg'] = f'instrument model unavailable: {e}'[:200]
        return

    def feats(x):
        return x.pooler_output if hasattr(x, 'pooler_output') else x

    with torch.no_grad():
        def text(labels):
            ti = proc(text=[f'a recording of {l}' for l in labels], return_tensors='pt', padding=True)
            return torch.nn.functional.normalize(feats(model.get_text_features(**ti)), dim=-1)
        te_all, te_drum = text(TAG_LABELS), text(DRUM_LABELS)
        rows = [r for r in R.report['stems'] if r['active_pct'] >= 2]
        for i, r in enumerate(rows):
            y = {**R.stems, **getattr(R, 'drums', {}), **getattr(R, 'layers', {})}.get(r['name'])
            if y is None:
                continue
            frame = librosa.feature.rms(y=y, frame_length=SR * 7, hop_length=SR * 7)[0]
            idx = np.argsort(frame)[::-1][:4]
            clips = [librosa.resample(y[j * SR * 7:(j + 1) * SR * 7], orig_sr=SR, target_sr=48000) for j in sorted(idx)]
            clips = [c / (np.abs(c).max() + 1e-9) * 0.8 for c in clips if len(c) > 48000]
            if not clips:
                continue
            ai = proc(audio=clips, sampling_rate=48000, return_tensors='pt')
            ae = torch.nn.functional.normalize(feats(model.get_audio_features(**ai)), dim=-1).mean(0)
            labels, te = (DRUM_LABELS, te_drum) if r['kind'] == 'drum' else (TAG_LABELS, te_all)
            p = torch.softmax((ae @ te.T) * 30, dim=-1).numpy()
            order = np.argsort(p)[::-1][:3]
            r['tag'] = {'label': labels[order[0]], 'conf': round(float(p[order[0]]), 2),
                        'top': [[labels[j], round(float(p[j]), 2)] for j in order]}
            R.emit('tags', 'progress', pct=round(100 * (i + 1) / len(rows)), msg=f'{r["name"]}: {r["tag"]["label"]}')
    box['msg'] = ', '.join(f'{r["name"]}={r["tag"]["label"]}' for r in R.report['stems'] if 'tag' in r)


def one_shot(y, hits, mode):
    if not hits:
        return None
    times = sorted(t for t, _ in hits)
    gaps = np.diff(times) if len(times) > 1 else np.array([0.5])
    L = int(np.clip(np.median(gaps), 0.08, 0.6) * SR)
    cands = sorted(hits, key=lambda h: -h[1])[:24]
    segs = []
    for t, v in cands:
        i = int(t * SR)
        seg = y[i:i + L]
        if len(seg) < L:
            seg = np.pad(seg, (0, L - len(seg)))
        pre = y[max(0, i - int(0.03 * SR)):i]
        iso = rms(seg[:int(0.05 * SR)]) / (rms(pre) if len(pre) else 1e-6)
        segs.append((iso, seg / (v + 1e-6)))
    segs.sort(key=lambda s: -s[0])
    out = segs[0][1].copy() if mode == 'best' else np.mean([s for _, s in segs[:8]], axis=0)
    fade = int(0.02 * SR)
    out[-fade:] *= np.linspace(1, 0, fade)
    return out


def harmonic_weights(y, notes, n=8):
    if not notes:
        return np.array([1.0])
    S = np.abs(librosa.stft(y, n_fft=4096, hop_length=1024))
    f = librosa.fft_frequencies(sr=SR, n_fft=4096)
    acc = np.zeros(n)
    for s, e, p, v in notes[:: max(1, len(notes) // 200)]:
        fr = librosa.time_to_frames((s + e) / 2, sr=SR, hop_length=1024)
        if fr >= S.shape[1]:
            continue
        f0 = librosa.midi_to_hz(p)
        amps = [S[np.argmin(np.abs(f - f0 * k)), fr] if f0 * k < SR / 2 else 0 for k in range(1, n + 1)]
        acc += np.array(amps) / (max(amps) + 1e-9)
    return acc / (acc.max() + 1e-9)


def synth(notes, n, weights, decay, bass):
    out = np.zeros(n, np.float32)
    for s, e, p, v in notes:
        f0 = librosa.midi_to_hz(p)
        i0 = int(s * SR)
        if i0 >= n:
            continue
        dur = max(e - s, 0.03)
        L = min(int((dur + 0.06) * SR), n - i0)
        t = np.arange(L) / SR
        wave = sum(w * np.sin(2 * np.pi * f0 * (k + 1) * t) for k, w in enumerate(weights) if f0 * (k + 1) < SR / 2 and w > 0.02)
        env = np.minimum(1, t / 0.005) * (np.exp(-t / decay) if bass else np.exp(-t / max(dur, 0.1) * 0.7))
        env *= np.clip((dur + 0.06 - t) / 0.06, 0, 1)
        out[i0:i0 + L] += (wave * env * v).astype(np.float32)
    return out


def note_samples(y, notes, n=3):
    starts = np.array([nt[0] for nt in notes])
    cands = []
    for s, e, p, v in notes:
        dur = e - s
        if dur >= 0.2 and not np.any((starts > s + 0.01) & (starts < s + min(dur, 0.4))):
            cands.append((v * min(dur, 1.0), s, e, p))
    if not cands:
        return []
    top = sorted(cands, reverse=True)[:24]
    pitches = np.array([c[3] for c in top])
    out = []
    for group in np.array_split(np.argsort(pitches), min(n, len(top))):
        _, s, e, p = max(top[i] for i in group)
        i0 = max(0, int((s - 0.005) * SR))
        seg = y[i0:i0 + int(min(e - s + 0.3, 1.5) * SR)].copy()
        fade = min(int(0.03 * SR), len(seg))
        seg[-fade:] *= np.linspace(1, 0, fade)
        out.append((p, seg / (np.abs(seg).max() + 1e-9)))
    return out


def sampled(notes, n, samples):
    out = np.zeros(n, np.float32)
    roots = np.array([p for p, _ in samples])
    for s, e, p, v in notes:
        root, seg = samples[int(np.argmin(np.abs(roots - p)))]
        ratio = 2 ** ((p - root) / 12)
        i0 = int(s * SR)
        L = min(int((max(e - s, 0.05) + 0.08) * SR), int(len(seg) / ratio) - 1, n - i0)
        if L <= 0:
            continue
        w = np.interp(np.arange(L) * ratio, np.arange(len(seg)), seg)
        rel = min(int(0.06 * SR), L)
        w[-rel:] *= np.linspace(1, 0, rel)
        out[i0:i0 + L] += (w * v).astype(np.float32)
    return out


def loop_feats(y, hop=512):
    return (librosa.feature.chroma_cqt(y=y, sr=SR, hop_length=hop),
            librosa.power_to_db(librosa.feature.melspectrogram(y=y, sr=SR, hop_length=hop, n_mels=48)))


def loop_replay(y, downs, bars_per_unit=1, thresh=0.9, hop=512, feats=None):
    """Find repeating bars, replace every bar by the most typical bar of its group (the 'loop'), crossfaded on the grid."""
    n = len(y)
    L = float(np.median(np.diff(downs))) * bars_per_unit
    pre = list(np.arange(float(downs[0]) - L, -1e-6, -L)[::-1])
    starts = [float(s) for s in pre + list(downs[::bars_per_unit]) if s + L <= n / SR]
    ch, mel = feats or loop_feats(y, hop)
    F = []
    for s in starts:
        a, b = librosa.time_to_frames([s, s + L], sr=SR, hop_length=hop)
        F.append(np.vstack([ch[:, a:b], (mel[:, a:b] + 80) / 80]))
    m = min(f.shape[1] for f in F)
    X = np.array([f[:, :m].ravel() for f in F])
    X = X - X.mean(1, keepdims=True)
    X /= np.linalg.norm(X, axis=1, keepdims=True) + 1e-9
    S = X @ X.T
    groups, label = [], -np.ones(len(starts), int)
    for i in np.argsort(-S.sum(1)):
        if label[i] >= 0:
            continue
        members = [j for j in range(len(starts)) if label[j] < 0 and S[i, j] >= thresh]
        for j in members:
            label[j] = len(groups)
        groups.append(members)
    medoid = [g[int(np.argmax(S[np.ix_(g, g)].sum(1)))] for g in groups]
    out = np.zeros(n, np.float32)
    seg_n = int(L * SR)
    fade = int(0.01 * SR)
    win = np.ones(seg_n + fade)
    win[:fade] = np.linspace(0, 1, fade)
    win[-fade:] = np.linspace(1, 0, fade)
    for i, s in enumerate(starts):
        src = int(starts[medoid[label[i]]] * SR)
        dst = int(s * SR)
        piece = y[src:src + seg_n + fade]
        k = min(len(piece), n - dst)
        out[dst:dst + k] += piece[:k] * win[:k]
    first = int(starts[0] * SR)
    out[:first] = y[:first]
    return out, {'units': len(starts), 'groups': len(groups), 'unit_s': round(L, 3)}


def apply_gain(part, stem, mode):
    if mode == 'peak':
        return part * (0.3 / (np.abs(part).max() + 1e-9))
    g = rms(stem) / rms(part)
    part = part * g
    if mode == 'env':
        hop = SR // 4
        a = librosa.feature.rms(y=stem, frame_length=hop * 2, hop_length=hop)[0]
        b = librosa.feature.rms(y=part, frame_length=hop * 2, hop_length=hop)[0]
        k = np.clip(a / (b + 1e-6), 0, 6)
        k[b < 1e-5] = 1
        curve = np.interp(np.arange(len(part)), np.arange(len(k)) * hop, np.convolve(k, np.ones(3) / 3, 'same'))
        part = part * curve.astype(np.float32)
    return part


def part_key(s, recipe, loop):
    if s in DRUMS:
        keys = DRUM_KEYS
    elif loop:
        keys = ('voice', 'note_onset', 'note_frame', 'loop_bars', 'loop_thresh')
    else:
        keys = ('voice', 'note_onset', 'note_frame', 'timbre', 'gain') + (('bass_decay',) if s == 'bass' else ())
    return (s,) + tuple(recipe.get(k) for k in keys)


def drum_part(R, d, hs, recipe, n):
    shot = one_shot(R.drums[d], hs, recipe['drum_sample'])
    if shot is None:
        return None, None
    out = np.zeros(n + len(shot), np.float32)
    for t, v in hs:
        i = int(t * SR)
        out[i:i + len(shot)] += shot * v
    return apply_gain(out[:n], R.drums[d], recipe['gain']), None


def melodic_part(R, s, notes, recipe, n, loop):
    if loop:
        if ('loopfeat', s) not in R.memo:
            R.memo[('loopfeat', s)] = loop_feats(R.stems[s])
        return loop_replay(R.stems[s], R.downbeats, recipe.get('loop_bars', 2), recipe.get('loop_thresh', 0.92), feats=R.memo[('loopfeat', s)])
    samples = note_samples(R.stems[s], notes) if recipe.get('voice') == 'sampled' else []
    if samples:
        raw = sampled(notes, n, samples)
    else:
        w = harmonic_weights(R.stems[s], notes) if recipe['timbre'] == 'match' else np.array([1.0])
        raw = synth(notes, n, w, recipe['bass_decay'], s == 'bass')
    return apply_gain(raw, R.stems[s], recipe['gain']), None


def rebuild(R, recipe, cache=None):
    """cache: part_key -> (audio, loop info); only parts whose recipe keys changed get rebuilt."""
    cache = {} if cache is None else cache
    n = len(R.mix)
    R.loops = {}
    parts, keys = {}, {}
    hits = {d: detect_hits(R, d, recipe) for d in R.report['drums']['parts']}
    notes = {s: notes_for(R, s, recipe) for s in R.bp}
    loop = recipe.get('voice') == 'loop' and len(R.downbeats) > 4
    jobs = [(d, lambda d=d: drum_part(R, d, hits[d], recipe, n)) for d in hits]
    jobs += [(s, lambda s=s: melodic_part(R, s, notes[s], recipe, n, loop)) for s in MELODIC if notes.get(s)]
    for p, make in jobs:
        k = part_key(p, recipe, loop)
        if k not in cache:
            cache[k] = make()
        y, info = cache[k]
        if y is None:
            continue
        parts[p], keys[p] = y, k
        if info:
            R.loops[p] = info
    total = sum(parts.values()) if parts else np.zeros(n, np.float32)
    return total, parts, hits, notes, keys


def logmel(y):
    M = librosa.feature.melspectrogram(y=y, sr=SR, n_fft=2048, hop_length=1024, n_mels=64)
    return np.clip(10 * np.log10(M + 1e-10), -80, None)


def spec_score(a, b):
    act = (a.max(axis=0) > -60) | (b.max(axis=0) > -60)
    if not act.any():
        return 0.0
    d = np.abs(a[:, act] - b[:, act]).mean()
    return float(np.clip(100 * (1 - d / 40), 0, 100))


class Likeness:
    """Does each rebuilt part sound like the same instrument as its stem? CLAP embedding similarity on the stem's loudest moments."""
    def __init__(self, R, names):
        import torch
        self.torch = torch
        self.model, self.proc = R.clap
        self.win = {}
        self.ref = {}
        self.weight = {}
        for p in names:
            y = R.drums[p] if p in R.drums else R.stems[p]
            w = SR * 6
            lv = np.array([np.sqrt(np.mean(y[i:i + w] ** 2)) for i in range(0, len(y) - w, w)])
            if not len(lv) or lv.max() < 1e-4:
                continue
            self.win[p] = sorted(np.argsort(lv)[::-1][:3])
            self.ref[p] = self.embed(y, self.win[p])
            self.weight[p] = float(np.mean(y ** 2))
        tot = sum(self.weight.values()) or 1
        self.weight = {k: v / tot for k, v in self.weight.items()}

    def embed(self, y, idx):
        w = SR * 6
        clips = [librosa.resample(y[i * w:(i + 1) * w], orig_sr=SR, target_sr=48000) for i in idx]
        clips = [c / (np.abs(c).max() + 1e-9) * 0.8 for c in clips]
        with self.torch.no_grad():
            out = self.model.get_audio_features(**self.proc(audio=clips, sampling_rate=48000, return_tensors='pt'))
        e = (out.pooler_output if hasattr(out, 'pooler_output') else out).mean(0).numpy()
        return e / (np.linalg.norm(e) + 1e-9)

    def score(self, p, y):
        cos = float(self.embed(y, self.win[p]) @ self.ref[p])
        return round(float(np.clip((cos - LIKE_FLOOR) / (LIKE_CEIL - LIKE_FLOOR), 0, 1) * 100), 1)


def silent_gaps(ref, ours, min_s=1.0):
    """Stretches where the stem plays and our part is silent: (gap list [start, end] s, share of the stem's playing time covered)."""
    fps = SR / 1024
    rl, ol = ref.max(axis=0), ours.max(axis=0)
    plays = rl > max(-60, rl.max() - 40)
    miss = plays & (ol < -60)
    gaps, i, n = [], 0, len(miss)
    while i < n:
        if miss[i]:
            j = i
            while j < n and (miss[j] or not plays[j]) and ol[j] < -60:
                j += 1
            if miss[i:j].sum() / fps >= min_s:
                gaps.append([round(i / fps, 1), round(j / fps, 1), round(miss[i:j].sum() / fps, 1)])
            i = j
        else:
            i += 1
    played = plays.sum() / fps
    lost = sum(g[2] for g in gaps)
    return {'gaps': [g[:2] for g in gaps], 'silent_s': round(lost, 1), 'plays_s': round(played, 1),
            'coverage': round(1 - lost / played, 3) if played else 1.0}


def part_why(spec, like, cov, scored=True):
    s = f'sound match {spec:.0f}' + (f' + same instrument {like:.0f}, averaged' if like is not None else '')
    if not cov['gaps']:
        return s + ' · plays everywhere the stem plays'
    where = ', '.join(f'{mmss(a)}-{mmss(b)}' for a, b in cov['gaps'][:3]) + (f' +{len(cov["gaps"]) - 3} more' if len(cov['gaps']) > 3 else '')
    lead = f' · x{cov["coverage"]:.2f}: silent' if scored else ' · not scored: quiet'
    return s + f'{lead} {cov["silent_s"]:.0f}s of the {cov["plays_s"]:.0f}s the stem plays ({where})'


def mmss(t):
    return f'{int(t // 60)}:{int(t % 60):02d}'


class Grader:
    def __init__(self, R):
        self.R = R
        t = R.inst
        self.on = librosa.onset.onset_strength(y=t, sr=SR, hop_length=512)
        self.chroma = librosa.feature.chroma_cqt(y=t, sr=SR, hop_length=2048)
        lvl = librosa.feature.rms(y=t, hop_length=2048)[0]
        self.harm_act = lvl > lvl.max() * 10 ** (-35 / 20)
        self.mel = logmel(t)
        S = np.abs(librosa.stft(t, n_fft=4096, hop_length=1024))
        self.lowbins = librosa.fft_frequencies(sr=SR, n_fft=4096) < 250
        self.low = np.clip(20 * np.log10(S[self.lowbins] + 1e-9), -80, None)
        self.part_mel = {d: logmel(R.drums[d]) for d in R.drums} | {s: logmel(R.stems[s]) for s in MELODIC}
        self.like = Likeness(R, [d for d in R.report['drums']['parts']] + MELODIC) if getattr(R, 'clap', None) else None
        self.memo = {}

    def part(self, p, y):
        pm = logmel(y)
        ref = self.part_mel[p]
        k = min(pm.shape[1], ref.shape[1])
        spec = spec_score(ref[:, :k], pm[:, :k])
        return spec, self.like.score(p, y) if self.like and p in self.like.ref else None, silent_gaps(ref[:, :k], pm[:, :k])

    def __call__(self, total, parts, keys=None):
        on = librosa.onset.onset_strength(y=total, sr=SR, hop_length=512)
        n = min(len(on), len(self.on))
        groove = max(0.0, float(np.corrcoef(on[:n], self.on[:n])[0, 1])) * 100 if np.std(on[:n]) > 0 else 0.0
        noise = np.random.default_rng(0).standard_normal(len(total)).astype(np.float32)
        ch = librosa.feature.chroma_cqt(y=total + 1e-6 * noise, sr=SR, hop_length=2048)
        m = min(ch.shape[1], self.chroma.shape[1])
        a, b, act = ch[:, :m], self.chroma[:, :m], self.harm_act[:m]
        cos = (a * b).sum(0) / (np.linalg.norm(a, axis=0) * np.linalg.norm(b, axis=0) + 1e-9)
        harmony = float(np.clip((cos[act].mean() - 0.5) / 0.5, 0, 1) * 100) if act.any() else 0.0
        S = np.abs(librosa.stft(total, n_fft=4096, hop_length=1024))
        low = np.clip(20 * np.log10(S[self.lowbins] + 1e-9), -80, None)
        k = min(low.shape[1], self.low.shape[1])
        bass = spec_score(self.low[:, :k], low[:, :k])
        mel = logmel(total)
        k = min(mel.shape[1], self.mel.shape[1])
        timbre = spec_score(self.mel[:, :k], mel[:, :k])
        comp = {'groove': round(groove, 1), 'harmony': round(harmony, 1), 'bass': round(bass, 1), 'timbre': round(timbre, 1)}
        spec, like, cover = {}, {}, {}
        for p, y in parts.items():
            k = (keys or {}).get(p)
            got = self.memo.get(k) if k else None
            if got is None:
                got = self.part(p, y)
                if k:
                    self.memo[k] = got
            spec[p] = got[0]
            if got[1] is not None:
                like[p] = got[1]
            cover[p] = got[2]
        if self.like:
            missing = [p for p in self.like.weight if p not in parts]
            like.update({p: 0.0 for p in missing})
            comp['likeness'] = round(sum(self.like.weight[p] * like.get(p, 0) for p in self.like.weight), 1)
            overall = round(0.25 * groove + 0.2 * harmony + 0.15 * bass + 0.2 * timbre + 0.2 * comp['likeness'], 1)
        else:
            overall = round(0.3 * groove + 0.25 * harmony + 0.2 * bass + 0.25 * timbre, 1)
        mult = {p: cover[p]['coverage'] if p in MELODIC else 1.0 for p in spec}
        part_scores = {p: round(((spec[p] + like[p]) / 2 if p in like else spec[p]) * mult[p], 1) for p in spec}
        self.last_like = like
        self.last_why = {p: part_why(spec[p], like.get(p), cover[p], p in MELODIC) for p in spec}
        return overall, comp, part_scores


def write_rebuild(R, total, parts):
    slug, run = R.report['slug'], R.report['run']
    rdir = R.dir / 'web'
    rdir.mkdir(exist_ok=True)
    encode(None, rdir / 'rebuild.mp3', np.clip(total, -1, 1))
    urls = {}
    for p, y in parts.items():
        encode(None, rdir / f'rebuild_{p}.mp3', np.clip(y, -1, 1))
        urls[p] = f'/songs/{slug}/runs/{run}/web/rebuild_{p}.mp3'
    R.report['rebuild'] = {'web': f'/songs/{slug}/runs/{run}/web/rebuild.mp3', 'peaks': peaks(total, R.ref), 'parts': urls}


def write_midi(R, notes, hits):
    import pretty_midi
    pm = pretty_midi.PrettyMIDI(initial_tempo=R.bpm or 120)
    for s, ns in notes.items():
        inst = pretty_midi.Instrument(program=GM_PROGRAM.get(s, 0), name=s)
        inst.notes = [pretty_midi.Note(velocity=int(np.clip(v * 127, 20, 127)), pitch=p, start=a, end=max(b, a + 0.03)) for a, b, p, v in ns]
        pm.instruments.append(inst)
    dr = pretty_midi.Instrument(program=0, is_drum=True, name='drums')
    dr.notes = [pretty_midi.Note(velocity=int(np.clip(v * 127, 20, 127)), pitch=GM_DRUM[d], start=t, end=t + 0.05) for d, hs in hits.items() for t, v in hs]
    pm.instruments.append(dr)
    pm.write(str(R.dir / 'song.mid'))
    R.report['midi'] = f'/songs/{R.report["slug"]}/runs/{R.report["run"]}/song.mid'


def apply_result(R, recipe, total, parts, hits, notes, overall, comp, part_scores):
    R.report['recipe'] = recipe
    R.report['loops'] = dict(getattr(R, 'loops', {}))
    bars, main = bars_from_hits(R, hits)
    R.report['drums'].update({'hits': hits, 'bars': bars, 'main': main})
    R.report['notes'] = notes
    worst = min(part_scores.items(), key=lambda kv: kv[1]) if part_scores else (None, None)
    R.report['grade'] = {'overall': overall, 'components': comp, 'parts': part_scores, 'sep_snr_db': R.sep_snr,
                         'likeness': getattr(getattr(R, 'grader', None), 'last_like', {}),
                         'why': getattr(getattr(R, 'grader', None), 'last_why', {}),
                         'bottleneck': {'part': worst[0], 'score': worst[1]}}


def stage_rebuild(R, box, recipe):
    R.part_cache = {}
    total, parts, hits, notes, R.part_keys = rebuild(R, recipe, R.part_cache)
    R.current = (recipe, total, parts, hits, notes)
    write_rebuild(R, total, parts)
    box['msg'] = f'{len(parts)} parts rebuilt: ' + ', '.join(parts)


def stage_grade(R, box):
    R.grader = Grader(R)
    recipe, total, parts, hits, notes = R.current
    overall, comp, ps = R.grader(total, parts, R.part_keys)
    apply_result(R, recipe, total, parts, hits, notes, overall, comp, ps)
    R.report['tune'] = [{'iter': 0, 'change': 'Starting recipe', 'overall': overall, 'kept': True, 'components': comp}]
    R.emit('tune', 'progress', pct=0, data=R.report['tune'][0])
    worst = R.report['grade']['bottleneck']
    box['msg'] = f'{overall}/100 (groove {comp["groove"]}, harmony {comp["harmony"]}, bass {comp["bass"]}, sound {comp["timbre"]}); weakest part: {worst["part"]} {worst["score"]}'


def stage_tune(R, box):
    recipe, total, parts, hits, notes = R.current
    cache, keys = R.part_cache, R.part_keys
    best = R.report['grade']['overall']
    start = best
    for i, (label, change) in enumerate(TUNE_STEPS, 1):
        cand = {**recipe, **change}
        if cand == recipe:
            cand = {**recipe, **{k: DEFAULT_RECIPE[k] for k in change}}
            label = 'Undo: ' + label[0].lower() + label[1:]
        if cand == recipe:
            row = {'iter': i, 'change': label + ' (nothing to try)', 'overall': best, 'kept': False, 'components': R.report['grade']['components']}
        else:
            t2, p2, h2, n2, k2 = rebuild(R, cand, cache)
            overall, comp, ps = R.grader(t2, p2, k2)
            kept = overall > best + 0.05
            row = {'iter': i, 'change': label, 'overall': overall, 'kept': kept, 'components': comp}
            if kept:
                best, recipe, keys = overall, cand, k2
                total, parts, hits, notes = t2, p2, h2, n2
                apply_result(R, recipe, total, parts, hits, notes, overall, comp, ps)
            live = set(keys.values())
            for k in [k for k in cache if k not in live]:
                del cache[k]
        R.report['tune'].append(row)
        R.save()
        R.emit('tune', 'progress', pct=round(100 * i / len(TUNE_STEPS)), msg=f'{label}: {row["overall"]} {"kept" if row["kept"] else "rejected"}', data=row)
    write_rebuild(R, total, parts)
    R.current = (recipe, total, parts, hits, notes)
    (R.song / 'best_recipe.json').write_text(json.dumps(recipe, indent=2))
    kept = sum(1 for r in R.report['tune'][1:] if r['kept'])
    box['msg'] = f'{start} -> {best} ({kept} of {len(TUNE_STEPS)} changes kept)'


def append_history(R):
    hist_p = R.song / 'history.json'
    hist = json.loads(hist_p.read_text()) if hist_p.exists() else []
    g = R.report['grade']
    hist = [h for h in hist if h['run'] != R.report['run']] + [{
        'run': R.report['run'], 'at': R.report['started'], 'version': VERSION, 'overall': g['overall'],
        'components': g['components'], 'parts': g['parts'], 'sep_snr_db': g['sep_snr_db'],
        'tune': [{k: r[k] for k in ('iter', 'change', 'overall', 'kept')} for r in R.report.get('tune', [])]}]
    hist_p.write_text(json.dumps(hist, indent=1))


def add_song(path, slug=None):
    src = Path(path).expanduser()
    slug = slug or re.sub(r'[^a-z0-9]+', '-', re.sub(r'y2mate\.is\s*-\s*|official (music )?(video|audio)', '', src.stem.lower())).strip('-')[:48]
    d = SONGS / slug
    d.mkdir(parents=True, exist_ok=True)
    dest = d / ('source' + src.suffix)
    if not dest.exists():
        shutil.copy(src, dest)
    meta_p = d / 'song.json'
    meta = json.loads(meta_p.read_text()) if meta_p.exists() else {}
    meta_p.write_text(json.dumps({**meta, 'title': meta.get('title', src.stem), 'source': dest.name, 'from': str(src)}, indent=2))
    return slug


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('path', nargs='?', help='song file to add (otherwise --slug)')
    ap.add_argument('--slug')
    ap.add_argument('--run', default=time.strftime('r%Y%m%d-%H%M%S'))
    ap.add_argument('--fresh', action='store_true', help='redo stems, drum split and note maps')
    ap.add_argument('--no-tune', action='store_true')
    a = ap.parse_args()
    slug = add_song(a.path, a.slug) if a.path else a.slug
    R = Run(slug, a.run)
    print(f'run folder: {R.dir}', flush=True)
    marker = R.song / 'stems' / 'model.txt'
    if (R.song / 'stems').exists() and (not marker.exists() or marker.read_text() != SEPARATOR.replace('.ckpt', '')):
        a.fresh = True
    if a.fresh:
        for f in [R.web / f'{n}.mp3' for n in STEMS + DRUMS + ['instrumental']] + list((R.song / 'cache').glob('bp_*.npz')):
            f.unlink(missing_ok=True)
    best_p = R.song / 'best_recipe.json'
    recipe = {**DEFAULT_RECIPE, **(json.loads(best_p.read_text()) if best_p.exists() else {})}
    R.emit('run', 'start', msg=f'{R.report["title"]} - {a.run}')
    threading.Thread(target=lambda: __import__('transformers', fromlist=['ClapModel']).ClapModel, daemon=True).start()
    t0 = time.time()
    try:
        with R.stage('load') as b: stage_load(R, b)
        with R.stage('stems') as b: stage_stems(R, b, a.fresh)
        drum_err = []

        def drums():
            try:
                with R.stage('drums') as b: stage_drums(R, b, a.fresh)
            except Exception as e:
                drum_err.append(e)
        split = threading.Thread(target=drums)
        split.start()
        with R.stage('notes') as b: stage_notes(R, b, a.fresh)
        split.join()
        if drum_err:
            raise drum_err[0]
        with R.stage('layers') as b: stage_layers(R, b)
        with R.stage('rhythm') as b: stage_rhythm(R, b)
        with R.stage('harmony') as b: stage_harmony(R, b)
        with R.stage('hits') as b: stage_hits(R, b, recipe)
        with R.stage('tags') as b: stage_tags(R, b)
        with R.stage('rebuild') as b: stage_rebuild(R, b, recipe)
        with R.stage('grade') as b: stage_grade(R, b)
        if a.no_tune:
            R.emit('tune', 'skip', msg='--no-tune')
        else:
            with R.stage('tune') as b: stage_tune(R, b)
        write_midi(R, R.report['notes'], R.report['drums']['hits'])
        append_history(R)
        R.save()
    except Exception as e:
        R.emit('run', 'fail', msg=f'{type(e).__name__}: {e}'[:300])
        raise
    R.emit('run', 'done', msg=f'grade {R.report["grade"]["overall"]}/100 in {time.time() - t0:.0f}s', secs=round(time.time() - t0, 1))


if __name__ == '__main__':
    main()
