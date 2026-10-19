import numpy as np
import librosa

SR = 22050


def mono_samples(y, notes, n=4):
    """Note samples only from moments where exactly one note sounds; root pitch measured, not assumed."""
    arr = np.array(notes)
    cands = []
    for s, e, p, v in notes:
        dur = e - s
        if dur < 0.25:
            continue
        overlap = np.sum((arr[:, 0] < e) & (arr[:, 1] > s)) - 1
        if overlap:
            continue
        seg = y[int(s * SR):int(min(e, s + 1.5) * SR)]
        if len(seg) < SR * 0.2:
            continue
        f0 = librosa.yin(seg, fmin=40, fmax=2000, sr=SR, frame_length=2048)
        root = float(np.median(librosa.hz_to_midi(f0)))
        if abs(root - p) > 0.6:
            continue
        cands.append((v * min(dur, 1.0), root, seg))
    cands.sort(key=lambda c: -c[0])
    top = cands[:24]
    if not top:
        return []
    order = np.argsort([c[1] for c in top])
    out = []
    for g in np.array_split(order, min(n, len(top))):
        _, root, seg = max((top[i] for i in g), key=lambda c: c[0])
        seg = seg.copy()
        f = min(int(0.02 * SR), len(seg))
        seg[-f:] *= np.linspace(1, 0, f)
        out.append((root, seg / (np.abs(seg).max() + 1e-9)))
    return out


def sampler(notes, n, samples, loop_sustain=False):
    out = np.zeros(n, np.float32)
    roots = np.array([r for r, _ in samples])
    for s, e, p, v in notes:
        root, seg = samples[int(np.argmin(np.abs(roots - p)))]
        ratio = 2 ** ((p - root) / 12)
        i0 = int(s * SR)
        L = min(int((max(e - s, 0.05) + 0.06) * SR), n - i0)
        if L <= 0:
            continue
        idx = np.arange(L) * ratio
        if loop_sustain and idx[-1] >= len(seg) - 1:
            a, b = int(len(seg) * 0.3), int(len(seg) * 0.8)
            over = idx >= b
            idx[over] = a + (idx[over] - a) % (b - a)
        w = np.interp(idx, np.arange(len(seg)), seg, right=0)
        r = min(int(0.04 * SR), L)
        w[-r:] *= np.linspace(1, 0, r)
        w[:64] *= np.linspace(0, 1, min(64, L))
        out[i0:i0 + L] += (w * v).astype(np.float32)
    return out


def drawbars(y, notes, k=12):
    S = np.abs(librosa.stft(y, n_fft=4096, hop_length=1024))
    f = librosa.fft_frequencies(sr=SR, n_fft=4096)
    acc = np.zeros(k)
    arr = np.array(notes)
    for s, e, p, v in notes[::max(1, len(notes) // 300)]:
        if np.sum((arr[:, 0] < e) & (arr[:, 1] > s)) > 1:
            continue
        fr = librosa.time_to_frames((s + e) / 2, sr=SR, hop_length=1024)
        if fr >= S.shape[1]:
            continue
        f0 = librosa.midi_to_hz(p)
        amps = [S[np.argmin(np.abs(f - f0 * h)), fr] if f0 * h < SR / 2 else 0 for h in range(1, k + 1)]
        acc += np.array(amps) / (max(amps) + 1e-9)
    return acc / (acc.max() + 1e-9)


def organ(notes, n, weights, leslie=6.3, depth=0.004):
    out = np.zeros(n, np.float32)
    for s, e, p, v in notes:
        f0 = librosa.midi_to_hz(p)
        i0 = int(s * SR)
        L = min(int((max(e - s, 0.05) + 0.04) * SR), n - i0)
        if L <= 0:
            continue
        t = (np.arange(L) + i0) / SR
        ph = 2 * np.pi * f0 * (t + depth / (2 * np.pi * leslie) * np.sin(2 * np.pi * leslie * t))
        w = sum(a * np.sin(ph * (h + 1)) for h, a in enumerate(weights) if a > 0.02 and f0 * (h + 1) < SR / 2)
        am = 1 + 0.15 * np.sin(2 * np.pi * leslie * t)
        env = np.minimum(1, np.arange(L) / (0.004 * SR)) * np.clip((L - np.arange(L)) / (0.03 * SR), 0, 1)
        out[i0:i0 + L] += (w * am * env * v).astype(np.float32)
    return out


def loop_replay(y, downs, bars_per_unit=1, thresh=0.9, hop=512):
    """Find repeating bars, replace every bar by the most typical bar of its group (the 'loop'), crossfaded on the grid."""
    n = len(y)
    L = float(np.median(np.diff(downs))) * bars_per_unit
    starts = [float(s) for s in downs[::bars_per_unit] if s + L <= n / SR]
    ch = librosa.feature.chroma_cqt(y=y, sr=SR, hop_length=hop)
    mel = librosa.power_to_db(librosa.feature.melspectrogram(y=y, sr=SR, hop_length=hop, n_mels=48))
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
    out[:first] = y[:first] * 0
    return out, {'units': len(starts), 'groups': len(groups), 'unit_s': round(L, 3)}
