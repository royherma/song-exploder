"""Join vocal chunks, add an effect chain, pad to song time, write an MP3. Prints {"peaks": [...]}."""
import argparse, json, subprocess, sys, warnings
warnings.filterwarnings("ignore")
import numpy as np, soundfile as sf
from pedalboard import (Pedalboard, Chorus, Compressor, Delay, Distortion, Gain, HighpassFilter,
                        LowpassFilter, Limiter, Reverb)


def chain(name, bpm):
    beat = 60.0 / (bpm or 100)
    if name == "studio":
        return [HighpassFilter(90), Compressor(threshold_db=-20, ratio=3.5, attack_ms=5, release_ms=80),
                Reverb(room_size=0.3, damping=0.6, wet_level=0.12, dry_level=0.9)]
    if name == "big":
        return [HighpassFilter(110), Compressor(threshold_db=-22, ratio=4, attack_ms=3, release_ms=90),
                Chorus(rate_hz=0.7, depth=0.18, mix=0.22), Delay(delay_seconds=beat * 0.75, feedback=0.3, mix=0.18),
                Reverb(room_size=0.65, damping=0.4, wet_level=0.24, dry_level=0.85)]
    if name == "phone":
        return [HighpassFilter(450), LowpassFilter(3200), Distortion(drive_db=10),
                Compressor(threshold_db=-18, ratio=6), Gain(-4)]
    return []


def peaks(y, n=800):
    h = max(1, len(y) // n)
    p = np.abs(y[: h * n]).reshape(-1, h).max(axis=1) if len(y) >= n else np.abs(y)
    return [round(float(v), 3) for v in np.minimum(1, p / max(p.max(), 0.05))]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("out")
    ap.add_argument("inputs", nargs="+")
    ap.add_argument("--fx", choices=["dry", "studio", "big", "phone"], default="dry")
    ap.add_argument("--bpm", type=float, default=0)
    ap.add_argument("--mix", type=float, default=100, help="0-100: how much of the effect you hear")
    ap.add_argument("--at", type=float, default=0.0, help="silence before the audio, so it lines up with the song")
    ap.add_argument("--total", type=float, default=0.0, help="song length (s); peaks span this so the row lines up")
    a = ap.parse_args()
    parts, sr = [], None
    for f in a.inputs:
        y, sr = sf.read(f, dtype="float32", always_2d=True)
        parts.append(y.mean(axis=1))
    y = np.concatenate(parts)
    wet = Pedalboard(chain(a.fx, a.bpm))(y[None, :], sr)[0]
    m = a.mix / 100
    y = Pedalboard([Limiter(-1)])(((1 - m) * y + m * wet)[None, :], sr)[0]
    y = np.concatenate([np.zeros(int(a.at * sr), np.float32), y])
    wav = a.out + ".tmp.wav"
    sf.write(wav, y, sr, subtype="PCM_16")
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", wav, "-b:a", "192k", "-f", "mp3", a.out], check=True)
    subprocess.run(["rm", "-f", wav])
    full = np.concatenate([y, np.zeros(max(0, int(a.total * sr) - len(y)), np.float32)])
    print(json.dumps({"peaks": peaks(full)}))


if __name__ == "__main__":
    sys.exit(main())
