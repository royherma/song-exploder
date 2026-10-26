# Song Exploder (folder: song-reverse)

Song in, everything it is made of out: stems, drum parts, tempo, key, chords, notes, drum patterns,
instrument names, a MIDI file - then it rebuilds the beat from what it learned and grades the rebuild
against the original, so every change to the pipeline shows up as a number that goes up or down.

```
song.mp3
  └─ load ─► stems (htdemucs_6s: vocals drums bass guitar piano other)
               └─ drums (MDX23C DrumSep: kick snare toms hh ride crash)
                    └─ tempo + beats + sections ─► key + chords ─► notes (Basic Pitch)
                         └─ drum hits + 16-step patterns ─► instrument names (CLAP)
                              └─ rebuild the beat ─► grade vs original beat ─► tune: try changes, keep what scores higher
```

## Run

```sh
node server.mjs                                   # http://song-exploder.localhost:4843 - watch runs live, drop a song on the page
.venv/bin/python bin/reverse.py ~/Downloads/x.mp3 # same pipeline from the terminal (shows up in the page too)
.venv/bin/python bin/reverse.py --slug gunna-pop-it --fresh   # redo stems / drum split / note maps
```

## Listening

Every stem row has a play button (just that stem). The transport has Stems / Original / Beat only / Rebuild /
Vocals + Rebuild; press A to flip between Original and Vocals + Rebuild at the same spot - the ear test.

## Song B

`+ Song B` in the top bar puts a full copy of the middle section (player, stem mixer, drum hits, chords) for a second
song next to the first. The left (pipeline) and right (grade) columns stay; the small ‹ › handle on each hides it to a thin strip, click the strip to bring it back (remembered). Both sides
share one audio clock and one play button. B follows A: every part B plays is re-timed and re-pitched to A's tempo
and key with `rubberband` (`/api/mix/stretch`, cached in `songs/<b>/cache/mix/`, 4 at a time), then shifted so B's
drum hits land on A's (`bin/mix_align.py`; the beat tracker alone was half a beat off on Gunna x Drake). B runs in
an iframe of this page (`/?frame=b&song=<slug>`, wired in `public/songb.js`). Export mix renders A + B as one WAV.
B's MIDI instrument swaps are not played (they would not follow the re-timing).

## Your voice + auto-tune

`Record` in the top bar sings over the song from the playhead (▾ picks the mic; wear headphones). The take lands
as its own mixer row, lined up with the song. Hover the vocals row or a take row and press `TUNE`: Off / Natural /
Hard, plus Dry / Studio / Big / Phone effects; `Advanced` has strength, speed, vibrato, note hold, voice and FX amount.
Notes snap to the song's key and to the chord playing at that moment (`bin/tune.py`, WORLD vocoder, 8 s chunks, 4 at
a time); effects are `bin/voicefx.py` (pedalboard). Results are cached under `songs/<song>/voice/`.

## What the grade means

The rebuild is synthesized only from what the pipeline extracted (drum hits played with one-shots cut from
each drum stem, notes played by a simple synth). It is compared to the original song minus vocals:

| Part | Measures | Weight |
| --- | --- | --- |
| Groove | do hits land at the same moments (onset curve correlation) | 30% |
| Harmony | same notes sounding at the same time (chroma similarity) | 25% |
| Bass | low end under 250 Hz (dB difference) | 20% |
| Sound | whole spectrum, 64 bands (dB difference) | 25% |

Per-part scores (kick vs kick stem, bass vs bass stem...) name the weakest part: that is the next thing to improve.
The tune step tries each change in `TUNE_STEPS` (`bin/reverse.py`) and keeps it only if the overall grade rises;
the best recipe is saved to `songs/<slug>/best_recipe.json` and the next run starts from it. Every run is
appended to `songs/<slug>/history.json` - the page charts it.

## Files

`songs/<slug>/` - `source.*`, `mix.wav`, `stems/`, `drums/`, `web/` (mp3s for the page), `cache/` (note maps),
`history.json`, `best_recipe.json`, `runs/<run>/` (`events.jsonl`, `report.json`, `song.mid`, `web/rebuild*.mp3`, `log.txt`).

Setup: `uv venv -p 3.12 .venv && uv pip install -p .venv demucs librosa soundfile audio-separator onnxruntime transformers basic-pitch "setuptools<81" "yt-dlp[default]"`. Links download with `.venv/bin/yt-dlp` (starts in 0.5 s; the standalone `~/.local/bin/yt-dlp` takes 14 s).
Stem + drum split runs on MLX when `.venv-mlx` exists (~4x faster, same SDR): `uv venv -p 3.12 .venv-mlx && uv pip install -p .venv-mlx mlx-audio-separator==0.1.20 torch` (own venv: it needs numpy 2, basic-pitch needs 1.26; torch only converts the checkpoints once).
Models download on first run: htdemucs_6s (torch cache), DrumSep (`models/`), CLAP (Hugging Face cache).

## Gotchas

- Basic Pitch only finds a working model when given the `.onnx` path explicitly (`bp_model()`); its default path tries TensorFlow/CoreML and fails.
- Basic Pitch needs `setuptools<81` (it imports `pkg_resources`).
- Beat grid: librosa's tracker drifts and picks 2/3 tempo on trap (pop it: 86 vs real 128). `best_grid` fits fixed tempos at 2/3..2x, regresses the exact period on kick/snare/hat onsets, keeps the one with most hits on a 16th (pop it 97%, Drake 98%).
- CLAP prompt matters: "the sound of X" tags drum stems as rap vocals; "a recording of X" tags kick/hat/808 right. Drum parts use a drum-only label list.
- `transformers` 5 returns `BaseModelOutputWithPooling` from `get_text_features` / `get_audio_features`; use `.pooler_output`.
