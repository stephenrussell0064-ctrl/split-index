/**
 * Self-generated sound design.
 *
 * Every SFX in public/sfx is synthesised here from oscillators and filtered
 * noise, so the licence question has a one-word answer: ours. No samples, no
 * downloads, nothing to attribute. Run `npm run sfx` to regenerate.
 *
 * Output: 48 kHz, 16-bit, stereo WAV.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "sfx");
const SR = 48_000;

// ---------- primitives ----------

/** Deterministic noise so renders are reproducible. */
function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

/** Biquad filter (RBJ cookbook). type: 'lp' | 'hp' | 'bp'. */
function biquad(type, freq, q) {
  const w0 = (2 * Math.PI * Math.min(freq, SR / 2 - 1)) / SR;
  const alpha = Math.sin(w0) / (2 * q);
  const cos = Math.cos(w0);
  let b0, b1, b2;
  const a0 = 1 + alpha;
  const a1 = -2 * cos;
  const a2 = 1 - alpha;
  if (type === "lp") {
    b0 = (1 - cos) / 2;
    b1 = 1 - cos;
    b2 = (1 - cos) / 2;
  } else if (type === "hp") {
    b0 = (1 + cos) / 2;
    b1 = -(1 + cos);
    b2 = (1 + cos) / 2;
  } else {
    b0 = alpha;
    b1 = 0;
    b2 = -alpha;
  }
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  return (x) => {
    const y = (b0 / a0) * x + (b1 / a0) * x1 + (b2 / a0) * x2 - (a1 / a0) * y1 - (a2 / a0) * y2;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
    return y;
  };
}

/** Sweeping filter: rebuilt every `hop` samples so the cutoff can glide. */
function sweep(type, freqAt, q, hop = 64) {
  let f = biquad(type, freqAt(0), q);
  let i = 0;
  return (x, t) => {
    if (i++ % hop === 0) {
      // Preserve state by re-creating only coefficients is complex; a fresh
      // filter every 64 samples is inaudible for noise sources.
      const nf = biquad(type, freqAt(t), q);
      // warm the new filter with the last input so there's no click
      nf(x);
      f = nf;
    }
    return f(x);
  };
}

const env = {
  /** Exponential decay */
  exp: (t, tau) => Math.exp(-t / tau),
  /** Attack-decay with linear attack */
  ad: (t, a, d) => (t < a ? t / a : Math.max(0, 1 - (t - a) / d)),
  /** Smooth fade-in curve */
  smooth: (x) => x * x * (3 - 2 * x),
};

function render(seconds, fn) {
  const n = Math.round(seconds * SR);
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const [l, r] = fn(t, i);
    L[i] = l;
    R[i] = r;
  }
  return { L, R };
}

function normalise({ L, R }, peak = 0.89) {
  let m = 0;
  for (let i = 0; i < L.length; i++) m = Math.max(m, Math.abs(L[i]), Math.abs(R[i]));
  const g = m > 0 ? peak / m : 1;
  for (let i = 0; i < L.length; i++) {
    L[i] *= g;
    R[i] *= g;
  }
  return { L, R };
}

/** Soft clipper so bass hits can be pushed without hard clipping. */
const soft = (x) => Math.tanh(x);

function writeWav(name, { L, R }) {
  const n = L.length;
  const buf = Buffer.alloc(44 + n * 4);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + n * 4, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(2, 22); // stereo
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 4, 28);
  buf.writeUInt16LE(4, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) {
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, L[i])) * 32767), 44 + i * 4);
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, R[i])) * 32767), 46 + i * 4);
  }
  writeFileSync(join(OUT, name), buf);
  console.log(`wrote ${name} (${(n / SR).toFixed(2)}s)`);
}

// ---------- the sounds ----------

/** Sub-bass slam: pitch drops 140→38 Hz, plus a click transient. */
function bassHit(seed = 1) {
  const rng = makeRng(seed);
  const clickLp = biquad("lp", 3200, 0.7);
  let phase = 0;
  return normalise(
    render(0.9, (t, i) => {
      const f = 38 + 102 * Math.exp(-t * 18);
      phase += (2 * Math.PI * f) / SR;
      const body = Math.sin(phase) * env.exp(t, 0.28);
      const click = clickLp((rng() * 2 - 1) * env.exp(t, 0.012)) * 0.9;
      const s = soft(body * 2.4 + click);
      return [s, s];
    }),
    0.95,
  );
}

/** Whoosh: pink-ish noise, band-pass sweeping 400→3800 Hz, swelling then cut. */
function whoosh(seed = 7, seconds = 0.42, dir = 1) {
  const rng = makeRng(seed);
  const bpL = sweep("bp", (t) => 380 + 3400 * env.smooth(Math.min(1, t / seconds)), 1.1);
  const bpR = sweep("bp", (t) => 420 + 3400 * env.smooth(Math.min(1, t / seconds)), 1.1);
  const lp = biquad("lp", 6000, 0.7);
  return normalise(
    render(seconds, (t) => {
      const x = lp(rng() * 2 - 1);
      const a = env.ad(t, seconds * 0.55, seconds * 0.45);
      const pan = 0.5 + dir * 0.5 * (t / seconds - 0.5);
      const l = bpL(x, t) * a * (1 - pan) * 2;
      const r = bpR(x, t) * a * pan * 2;
      return [l, r];
    }),
    0.7,
  );
}

/** Riser: noise + rising sine, 1.6s, into the score reveal. */
function riser(seed = 11) {
  const rng = makeRng(seed);
  const D = 1.6;
  const hp = sweep("hp", (t) => 200 + 2600 * (t / D) ** 2, 0.8);
  let phase = 0;
  return normalise(
    render(D, (t) => {
      const p = t / D;
      const f = 110 * Math.pow(2, p * 3.2); // 110 Hz → ~1 kHz
      phase += (2 * Math.PI * f) / SR;
      const tone = Math.sin(phase) * 0.35 + Math.sin(phase * 2.01) * 0.12;
      const n = hp(rng() * 2 - 1, t) * 0.6;
      const a = env.smooth(p) * (p < 0.96 ? 1 : (1 - p) / 0.04);
      const s = (tone + n) * a;
      return [s, s];
    }),
    0.8,
  );
}

/** Digit tick: 2.2 kHz burst, 28 ms. */
function tick(seed = 3) {
  const rng = makeRng(seed);
  let phase = 0;
  const hp = biquad("hp", 1200, 0.7);
  return normalise(
    render(0.035, (t) => {
      phase += (2 * Math.PI * 2200) / SR;
      const s = (Math.sin(phase) * 0.7 + hp(rng() * 2 - 1) * 0.5) * env.exp(t, 0.006);
      return [s, s];
    }),
    0.55,
  );
}

/** Slam: bass hit layered with a crushed noise burst — the tier badge landing. */
function slam(seed = 5) {
  const rng = makeRng(seed);
  const lp = biquad("lp", 1800, 0.9);
  let phase = 0;
  return normalise(
    render(1.1, (t) => {
      const f = 34 + 160 * Math.exp(-t * 22);
      phase += (2 * Math.PI * f) / SR;
      const body = Math.sin(phase) * env.exp(t, 0.36);
      const burst = lp(rng() * 2 - 1) * env.exp(t, 0.06) * 1.4;
      const s = soft(body * 2.8 + burst);
      return [s, s];
    }),
    0.97,
  );
}

/** Whip: very short high-passed noise for the flash frames. */
function whip(seed = 9) {
  const rng = makeRng(seed);
  const hp = biquad("hp", 2500, 0.8);
  return normalise(
    render(0.16, (t) => {
      const s = hp(rng() * 2 - 1) * env.ad(t, 0.02, 0.14);
      return [s * 0.9, s];
    }),
    0.6,
  );
}

/** Shimmer: soft bright pad for the CTA hold — filtered detuned sines. */
function shimmer() {
  const D = 2.6;
  const freqs = [523.25, 659.25, 783.99, 1046.5];
  let phases = freqs.map(() => 0);
  return normalise(
    render(D, (t) => {
      let l = 0, r = 0;
      freqs.forEach((f, k) => {
        phases[k] += (2 * Math.PI * (f * (1 + (k % 2 ? 0.0009 : -0.0009)))) / SR;
        const v = Math.sin(phases[k]) / freqs.length;
        if (k % 2) l += v; else r += v;
        l += v * 0.5; r += v * 0.5;
      });
      const a = env.smooth(Math.min(1, t / 0.5)) * env.smooth(Math.min(1, (D - t) / 1.1));
      return [l * a, r * a];
    }),
    0.35,
  );
}

mkdirSync(OUT, { recursive: true });
writeWav("bass-hit.wav", bassHit());
writeWav("slam.wav", slam());
writeWav("whoosh.wav", whoosh(7, 0.42, 1));
writeWav("whoosh-rev.wav", whoosh(8, 0.42, -1));
writeWav("riser.wav", riser());
writeWav("tick.wav", tick());
writeWav("whip.wav", whip());
writeWav("shimmer.wav", shimmer());
