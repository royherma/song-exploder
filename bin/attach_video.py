"""Attach a video to a song: browser-playable copy + where the song starts inside the video (audio cross-correlation)."""
import json, subprocess, sys
from pathlib import Path

import numpy as np
import librosa

ROOT = Path(__file__).resolve().parent.parent
SR, HOP = 11025, 128
MIN_MATCH = 0.3


def onset_env(path, seconds=None):
    y, _ = librosa.load(str(path), sr=SR, mono=True, duration=seconds)
    e = librosa.onset.onset_strength(y=y, sr=SR, hop_length=HOP)
    return (e - e.mean()) / (e.std() + 1e-9)


def find_offset(video, mix):
    """Seconds into the video where the song's 0:00 sits (negative = video starts after the song)."""
    v, m = onset_env(video), onset_env(mix)
    n = 1 << int(np.ceil(np.log2(len(v) + len(m))))
    corr = np.fft.irfft(np.fft.rfft(v, n) * np.conj(np.fft.rfft(m, n)), n)
    lag = int(np.argmax(corr))
    if lag > n // 2:
        lag -= n
    peak = corr.max() / (np.sqrt((v ** 2).sum() * (m ** 2).sum()) + 1e-9)
    return lag * HOP / SR, float(peak)


def main():
    slug, src = sys.argv[1], Path(sys.argv[2]).expanduser()
    force = '--force' in sys.argv[3:]
    song = ROOT / 'songs' / slug
    out = song / 'video.mp4'
    offset, match = find_offset(src, song / 'mix.wav')
    if match < MIN_MATCH and not force:
        print(json.dumps({'slug': slug, 'attached': False, 'match': round(match, 3)}))
        return
    codec = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name',
                            '-of', 'csv=p=0', str(src)], capture_output=True, text=True).stdout.strip()
    vcodec = ['-c:v', 'copy'] if codec == 'h264' else ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22']
    subprocess.run(['ffmpeg', '-y', '-v', 'error', '-i', str(src), *vcodec, '-an', '-movflags', '+faststart', str(out)], check=True)
    meta_p = song / 'song.json'
    meta = json.loads(meta_p.read_text())
    meta.update({'video': 'video.mp4', 'video_offset': round(offset, 3), 'video_match': round(match, 3), 'video_from': str(src)})
    meta_p.write_text(json.dumps(meta, indent=2))
    print(json.dumps({'slug': slug, 'attached': True, 'video': f'/songs/{slug}/video.mp4', 'offset': round(offset, 3), 'match': round(match, 3), 'codec': codec}))


if __name__ == '__main__':
    main()
