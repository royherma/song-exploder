"""Write one part of a run as a named file: export.py <slug> <run> <part> <orig|ours|midi> <wav|mp3|mid> -> prints the file path."""
import json, re, subprocess, sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
DRUMS = ['kick', 'snare', 'toms', 'hh', 'ride', 'crash']
GM_DRUM = {'kick': 36, 'snare': 38, 'toms': 45, 'hh': 42, 'ride': 51, 'crash': 49}
LABEL = {'orig': 'original', 'ours': 'rebuild', 'midi': 'MIDI'}


def nice_title(t):
    t = re.sub(r'\s*[\[(][^\])]*[\])]', '', t)
    t = re.sub(r'\s+(ft\.?|feat\.?)\s.*$', '', t, flags=re.I)
    return re.sub(r'[\\/:*?"<>|]', '', t).strip() or 'song'


def load(f):
    import librosa
    return librosa.load(f, sr=44100, mono=False)[0]


def save(y, out, fmt):
    import soundfile as sf
    y = np.atleast_2d(y).T
    if fmt == 'wav':
        sf.write(out, np.clip(y, -1, 1), 44100, subtype='PCM_24')
        return
    tmp = out.with_suffix('.tmp.wav')
    sf.write(tmp, np.clip(y, -1, 1), 44100, subtype='PCM_24')
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', str(tmp), '-b:a', '320k', str(out)], check=True)
    tmp.unlink()


def mix(files):
    ys = [load(f) for f in files]
    n = max(y.shape[-1] for y in ys)
    ys = [np.atleast_2d(y) for y in ys]
    ch = max(y.shape[0] for y in ys)
    out = np.zeros((ch, n), np.float32)
    for y in ys:
        out[:, :y.shape[-1]] += y if y.shape[0] == ch else np.repeat(y, ch, 0)
    return out


def main(slug, run, part, kind, fmt):
    song, rdir = ROOT / 'songs' / slug, ROOT / 'songs' / slug / 'runs' / run
    rep = json.loads((rdir / 'report.json').read_text())
    bpm, h = rep.get('rhythm', {}).get('bpm'), rep.get('harmony', {})
    tag = ' '.join(x for x in [f'{bpm:g} BPM' if bpm else '', f"{h.get('key', '')} {h.get('mode', '')}".strip()] if x)
    who = 'full song' if part == 'all' else part
    name = f"{nice_title(rep.get('title', slug))} - {who} - {LABEL[kind]}{f' ({tag})' if tag else ''}.{fmt}"
    out = rdir / 'export' / name
    if out.exists():
        print(out)
        return
    out.parent.mkdir(exist_ok=True)
    if kind == 'midi':
        import pretty_midi
        pm = pretty_midi.PrettyMIDI(str(rdir / 'song.mid'))
        if part in DRUMS:
            pm.instruments = [i for i in pm.instruments if i.is_drum]
            for i in pm.instruments:
                i.name, i.notes = part, [n for n in i.notes if n.pitch == GM_DRUM[part]]
        elif part != 'all':
            pm.instruments = [i for i in pm.instruments if i.name == part]
        if not any(i.notes for i in pm.instruments):
            sys.exit(f'no notes for {part}')
        pm.write(str(out))
    elif kind == 'orig':
        src = song / 'mix.wav' if part == 'all' else song / ('drums' if part in DRUMS else 'stems') / f'{part}.wav'
        save(load(src), out, fmt)
    else:
        web, parts = rdir / 'web', rep.get('rebuild', {}).get('parts', {})
        if part == 'all':
            files = [web / 'rebuild.mp3']
        elif part == 'drums':
            files = [web / f'rebuild_{d}.mp3' for d in DRUMS if d in parts]
        else:
            files = [web / f'rebuild_{part}.mp3'] if part in parts else []
        if not files or not all(f.exists() for f in files):
            sys.exit(f'no rebuild for {part}')
        save(mix(files), out, fmt)
    print(out)


if __name__ == '__main__':
    main(*sys.argv[1:6])
