"""Fast loop on ONE rebuilt part: load stem + notes once, try rebuild methods, score each like the pipeline does."""
import json, sys, time
import numpy as np
import librosa
import soundfile as sf

sys.path.insert(0, str(__import__('pathlib').Path(__file__).resolve().parent.parent / 'bin'))
import reverse as R

SR = R.SR


class Part:
    def __init__(self, slug, part):
        self.song = R.SONGS / slug
        run = sorted((self.song / 'runs').glob('r*/report.json'))[-1]
        self.rep = json.loads(run.read_text())
        self.part = part
        self.y = R.load(self.song / 'stems' / f'{part}.wav')
        self.n = len(self.y)
        self.mel = R.logmel(self.y)
        self.beats = np.array(self.rep['rhythm']['beats'])
        self.downs = np.array(self.rep['rhythm']['downbeats'])
        self.notes = self.rep['notes'][part]
        self._like = None

    def like_model(self):
        if self._like is None:
            from transformers import ClapModel, ClapProcessor
            class X: pass
            r = X()
            r.stems = {self.part: self.y}
            r.drums = {}
            r.clap = (ClapModel.from_pretrained('laion/clap-htsat-unfused').eval(), ClapProcessor.from_pretrained('laion/clap-htsat-unfused'))
            self._like = R.Likeness(r, [self.part])
        return self._like

    def score(self, out):
        out = R.apply_gain(out.astype(np.float32), self.y, 'env')
        pm = R.logmel(out)
        k = min(pm.shape[1], self.mel.shape[1])
        spec = R.spec_score(self.mel[:, :k], pm[:, :k])
        like = self.like_model()({self.part: out}).get(self.part, 0)
        ca = librosa.feature.chroma_cqt(y=self.y, sr=SR, hop_length=2048)
        cb = librosa.feature.chroma_cqt(y=out + 1e-6, sr=SR, hop_length=2048)
        m = min(ca.shape[1], cb.shape[1])
        cos = (ca[:, :m] * cb[:, :m]).sum(0) / (np.linalg.norm(ca[:, :m], axis=0) * np.linalg.norm(cb[:, :m], axis=0) + 1e-9)
        act = librosa.feature.rms(y=self.y, hop_length=2048)[0][:m] > 1e-3
        return {'part': round((spec + like) / 2, 1), 'sound': round(spec, 1), 'same_instr': like, 'chroma': round(float(cos[act].mean()) * 100, 1)}, out

    def save(self, name, out, a=55, b=75):
        d = self.song / 'lab'
        d.mkdir(exist_ok=True)
        seg = out[SR * a:SR * b]
        sf.write(d / f'{self.part}-{name}.wav', seg / (np.abs(seg).max() + 1e-9) * 0.8, SR)
        return d / f'{self.part}-{name}.wav'
