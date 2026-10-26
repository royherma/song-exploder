"""Auto-tune a vocal (a recorded take, or one chunk of the song's own vocals stem) to the song.

Notes snap to the song's key, except where the chord playing at that moment has a tone
outside the key (a C major chord in F minor wants E, not Eb): that tone replaces its neighbour.
Prints one JSON line: in-tune share before/after, key, seconds.
"""
import argparse, json, re, sys, time, warnings
warnings.filterwarnings("ignore")
import numpy as np, soundfile as sf, pyworld as pw

NN = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
FLAT = {"Db": "C#", "Eb": "D#", "Gb": "F#", "Ab": "G#", "Bb": "A#"}
MAJOR, MINOR = [0, 2, 4, 5, 7, 9, 11], [0, 2, 3, 5, 7, 8, 10]
FRAME_MS = 5.0
IN_TUNE_CENTS = 20


def pc(name):
    return NN.index(FLAT.get(name, name))


def chord_tones(label):
    """{tone: the scale note it pushes out} for the chord's root, third and fifth."""
    m = re.match(r"^([A-G][#b]?)(m(?!aj))?", label or "")
    if not m:
        return None
    root, minor = pc(m.group(1)), bool(m.group(2))
    third = (root + (3 if minor else 4)) % 12
    return {root: (root + 1) % 12, (root + 7) % 12: (root + 6) % 12, third: (third + 1 if minor else third - 1) % 12}


def allowed_at(times, harmony):
    key = pc(harmony.get("key") or "C")
    scale = {(key + s) % 12 for s in (MINOR if harmony.get("mode") == "minor" else MAJOR)}
    chords = harmony.get("chords") or []
    starts = np.array([c["start"] for c in chords]) if chords else np.array([])
    cache, out = {}, []
    for t in times:
        i = int(np.searchsorted(starts, t, side="right")) - 1
        label = chords[i]["chord"] if i >= 0 and t < chords[i]["end"] else None
        if label not in cache:
            notes, tones = set(scale), chord_tones(label) or {}
            for tone, pushed in tones.items():
                if tone not in scale:
                    notes.discard(pushed if pushed not in tones else None)
                    notes.add(tone)
            cache[label] = np.array(sorted(notes))
        out.append(cache[label])
    return out


def nearest(m, notes):
    base = np.floor(m)
    cands = np.array([base + d for d in range(-2, 3)])
    cands = cands[np.isin(cands % 12, notes)]
    return cands[np.argmin(np.abs(cands - m))]


def runs(voiced):
    i, n = 0, len(voiced)
    while i < n:
        if not voiced[i]:
            i += 1
            continue
        j = i
        while j < n and voiced[j]:
            j += 1
        yield i, j
        i = j


def hold_notes(target, hold):
    """Notes shorter than `hold` frames take the note before them, so slides do not stair-step."""
    if hold <= 1 or len(target) == 0:
        return target
    edges = np.flatnonzero(np.diff(target)) + 1
    starts, ends = np.r_[0, edges], np.r_[edges, len(target)]
    out = target.copy()
    for i, (s0, s1) in enumerate(zip(starts, ends)):
        if s1 - s0 < hold:
            out[s0:s1] = out[s0 - 1] if s0 > 0 else target[s1] if s1 < len(target) else target[s0]
    return out


def retune(midi, voiced, allowed, strength=1.0, speed_ms=0.0, vibrato=0.0, hold_ms=60.0):
    out = midi.copy()
    hold = int(round(hold_ms / FRAME_MS))
    alpha = 1 - np.exp(-FRAME_MS / speed_ms) if speed_ms > 0 else 1.0
    for a, b in runs(voiced):
        seg = midi[a:b]
        k = 31
        pad = np.pad(seg, k // 2, mode="edge")
        center = np.convolve(pad, np.ones(k) / k, mode="valid")[: len(seg)]
        target, prev = np.empty_like(seg), None
        for i, c in enumerate(center):
            if prev is not None and abs(c - prev) < 0.7 and np.isin(prev % 12, allowed[a + i]):
                target[i] = prev
            else:
                target[i] = prev = nearest(c, allowed[a + i])
        target = hold_notes(target, hold)
        want = target + vibrato * (seg - center) - seg
        corr, c = np.empty_like(seg), want[0]
        for i in range(len(seg)):
            c += alpha * (want[i] - c)
            corr[i] = c
        out[a:b] = seg + strength * corr
    return out


def shift_formants(sp, semis):
    """Moves the voice's resonances up or down without touching pitch (deeper/brighter voice)."""
    n = sp.shape[1]
    idx = np.clip(np.arange(n) / 2 ** (semis / 12), 0, n - 1)
    i0 = np.floor(idx).astype(int)
    i1, fr = np.minimum(i0 + 1, n - 1), idx - i0
    return np.ascontiguousarray(sp[:, i0] * (1 - fr) + sp[:, i1] * fr)


def in_tune(f0, sr_times, allowed):
    v = f0 > 0
    if not v.any():
        return 0.0, 0.0
    m = 69 + 12 * np.log2(f0[v] / 440.0)
    al = [allowed[i] for i in np.flatnonzero(v)]
    off = np.array([abs(x - nearest(x, a)) for x, a in zip(m, al)]) * 100
    return round(float(np.mean(off < IN_TUNE_CENTS)) * 100, 1), round(float(np.median(off)), 1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    ap.add_argument("out", help=".wav")
    ap.add_argument("--report", required=True)
    ap.add_argument("--at", type=float, default=0.0, help="song time (s) where src starts")
    ap.add_argument("--start", type=float, default=0.0, help="only this part of src (s)")
    ap.add_argument("--dur", type=float, default=0.0)
    ap.add_argument("--strength", type=float, default=100, help="0-100: how far each note moves to the right note")
    ap.add_argument("--speed", type=float, default=0, help="ms to glide to the note; 0 = instant robot snap")
    ap.add_argument("--vibrato", type=float, default=0, help="0-100: how much of the singer's own wobble survives")
    ap.add_argument("--hold", type=float, default=60, help="ms a note must last before the tune follows a new one")
    ap.add_argument("--formant", type=float, default=0, help="semitones to move the voice's character (-6 deeper .. +6 brighter)")
    a = ap.parse_args()
    t0 = time.time()
    harmony = json.load(open(a.report)).get("harmony") or {}

    info = sf.info(a.src)
    sr, pad = info.samplerate, int(0.3 * info.samplerate)
    s0 = int(a.start * sr)
    s1 = min(info.frames, s0 + int(a.dur * sr)) if a.dur else info.frames
    r0, r1 = max(0, s0 - pad), min(info.frames, s1 + pad)
    y, _ = sf.read(a.src, start=r0, stop=r1, dtype="float64", always_2d=True)
    y = np.ascontiguousarray(y.mean(axis=1))
    at = a.at + r0 / sr

    f0, t = pw.harvest(y, sr, f0_floor=65, f0_ceil=1100, frame_period=FRAME_MS)
    allowed = allowed_at(t + at, harmony)
    before, cents_before = in_tune(f0, t, allowed)
    sp = pw.cheaptrick(y, f0, t, sr)
    apd = pw.d4c(y, f0, t, sr)
    voiced = f0 > 0
    midi = np.zeros_like(f0)
    midi[voiced] = 69 + 12 * np.log2(f0[voiced] / 440.0)
    new = retune(midi, voiced, allowed, a.strength / 100, a.speed, a.vibrato / 100, a.hold)
    if a.formant:
        sp = shift_formants(sp, a.formant)
    new_f0 = np.where(voiced, 440.0 * 2 ** ((new - 69) / 12), 0.0)
    out = pw.synthesize(new_f0, sp, apd, sr, frame_period=FRAME_MS)[: len(y)]
    f1, t1 = pw.dio(out, sr, f0_floor=65, f0_ceil=1100, frame_period=FRAME_MS)
    f1 = pw.stonemask(out, f1, t1, sr)
    after, cents_after = in_tune(f1, t1, allowed_at(t1 + at, harmony))

    sf.write(a.out, out[s0 - r0: s1 - r0].astype(np.float32), sr, subtype="PCM_16")
    print(json.dumps({"key": f"{harmony.get('key')} {harmony.get('mode')}", "voiced": int(voiced.sum()),
                      "in_tune_before": before, "in_tune_after": after,
                      "cents_before": cents_before, "cents_after": cents_after, "secs": round(time.time() - t0, 2)}))


if __name__ == "__main__":
    sys.exit(main())
