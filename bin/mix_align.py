"""Find how far B's drums sit from A's: mix_align.py A_DRUMS B_DRUMS OFFSET_SEC BEAT_SEC -> JSON {shift_ms, steady_pct}."""
import json
import sys

import librosa
import numpy as np

SR, HOP, WIN = 22050, 256, 12.0


def onsets(path, pad=0.0):
    y, _ = librosa.load(path, sr=SR, mono=True)
    n = int(round(pad * SR))
    y = np.concatenate([np.zeros(n), y]) if n >= 0 else y[-n:]
    return librosa.onset.onset_strength(y=y, sr=SR, hop_length=HOP)


def z(x):
    return (x - x.mean()) / (x.std() + 1e-9)


def best_lag(a, b, start, end, max_lag):
    seg = z(a[start:end])
    return max(range(-max_lag, max_lag + 1), key=lambda k: float(np.dot(seg, z(b[start + k:end + k]))))


def main():
    a_path, b_path, off, beat = sys.argv[1], sys.argv[2], float(sys.argv[3]), float(sys.argv[4])
    oa, ob = onsets(a_path), onsets(b_path, off)
    fps = SR / HOP
    max_lag = int(0.75 * beat * fps)
    n = min(len(oa), len(ob)) - max_lag
    start = max(max_lag, int(off * fps) + max_lag)
    if n - start < fps * 8:
        print(json.dumps({"shift_ms": 0, "steady_pct": 0, "note": "songs barely overlap"}))
        return
    lag = best_lag(oa, ob, start, n, max_lag)
    w = int(WIN * fps)
    wins = [best_lag(oa, ob, s, s + w, max_lag) for s in range(start, n - w, w)]
    steady = sum(abs(k - lag) <= 0.03 * fps for k in wins) / max(1, len(wins))
    print(json.dumps({"shift_ms": round(-lag / fps * 1000), "steady_pct": round(steady * 100), "windows": len(wins)}))


main()
