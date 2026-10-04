// The film's music and its little sounds, made from nothing: a tune on the film's beat in the
// mood it asks for, chords under it, and a pop, a pen's scratch or a sparkle wherever its
// scenes asked for one. The same seed makes the same music, in the page's player and in the
// mp4 alike: `composeScore(film, rate)` gives { rate, left, right }.

function composeScore(film, rate = 48000) {
  const SR = rate;
  const spb = 60 / film.bpm;
  const dur = film.duration + 0.05;
  const N = Math.ceil(dur * SR);
  const L = new Float32Array(N);
  const R = new Float32Array(N);
  let s0 = (film.seed * 2654435761) >>> 0 || 1;
  const rnd = () => {
    s0 = (s0 + 0x6d2b79f5) >>> 0;
    let t = s0;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const hz = (m) => 440 * 2 ** ((m - 69) / 12);
  const TWO_PI = Math.PI * 2;

  /** A sound laid in at `t` seconds, `pan` -1 left to 1 right. */
  const put = (sig, t, pan = 0, gain = 1) => {
    const i0 = Math.round(t * SR);
    const gl = Math.cos(((pan + 1) * Math.PI) / 4) * gain;
    const gr = Math.sin(((pan + 1) * Math.PI) / 4) * gain;
    for (let i = 0; i < sig.length; i++) {
      const k = i0 + i;
      if (k < 0) continue;
      if (k >= N) break;
      L[k] += sig[i] * gl;
      R[k] += sig[i] * gr;
    }
  };
  const noise = (n) => {
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = rnd() * 2 - 1;
    return out;
  };
  /** A band of a sound kept, through a two-pole filter: the shape of a hiss. */
  const band = (x, lo, hi) => {
    // Kept under the rate's limit, where the filter would run away
    hi = Math.min(hi, SR * 0.45);
    lo = Math.min(lo, hi * 0.8);
    const f0 = Math.sqrt(lo * hi);
    const q = f0 / Math.max(1, hi - lo);
    const w = (TWO_PI * f0) / SR;
    const al = Math.sin(w) / (2 * q);
    const b0 = al;
    const a0 = 1 + al;
    const a1 = -2 * Math.cos(w);
    const a2 = 1 - al;
    const out = new Float32Array(x.length);
    let x1 = 0;
    let x2 = 0;
    let y1 = 0;
    let y2 = 0;
    for (let i = 0; i < x.length; i++) {
      const y = (b0 * x[i] - b0 * x2 - a1 * y1 - a2 * y2) / a0;
      x2 = x1;
      x1 = x[i];
      y2 = y1;
      y1 = y;
      out[i] = y;
    }
    return out;
  };

  // ---------------------------------------------------------------- instruments
  // Each voice is a few sine partials, each dying away at its own rate: a sine made by
  // turning a point around a circle (one multiply a sample), its decay by one more.
  const osc = (out, f, amp, decay, phase = 0) => {
    if (f >= SR / 2 || amp === 0) return;
    const w = (TWO_PI * f) / SR;
    const c = 2 * Math.cos(w);
    let s1 = Math.sin(phase - w);
    let s2 = Math.sin(phase - 2 * w);
    const dk = Math.exp(-decay / SR);
    let e = amp;
    // Where it has died below hearing, it stops
    const end =
      decay > 0
        ? Math.min(
            out.length,
            Math.ceil((Math.log(Math.abs(amp) / 1e-4) / decay) * SR),
          )
        : out.length;
    for (let i = 0; i < end; i++) {
      const v = c * s1 - s2;
      s2 = s1;
      s1 = v;
      out[i] += v * e;
      e *= dk;
    }
  };
  /** How a note starts and stops: up in `attack` seconds, down over `release` after `len`. */
  const shape = (out, attack, len, release, vel) => {
    const a = Math.max(1, Math.round(attack * SR));
    const r0 = Math.round(len * SR);
    const r = Math.max(1, Math.round(release * SR));
    const n = out.length;
    for (let i = 0; i < n; i++) {
      if (i < a) out[i] *= (i / a) * vel;
      else if (i <= r0) out[i] *= vel;
      else if (i < r0 + r) out[i] *= (1 - (i - r0) / r) * vel;
      else out[i] = 0;
    }
    return out;
  };
  const voice = (secs, f, partials) => {
    const out = new Float32Array(Math.ceil(secs * SR));
    for (const [ratio, amp, decay, ph] of partials)
      osc(out, f * ratio, amp, decay, ph ?? 0);
    return out;
  };
  const musicbox = (m, len, vel) =>
    shape(
      voice(len + 1.5, hz(m), [
        [1, 1, 2.6],
        [2, 0.18, 5],
        [2.76, 0.22, 7],
        [5.4, 0.08, 11],
      ]),
      0.002,
      len + 1.5,
      0.01,
      vel * 0.22,
    );
  const piano = (m, len, vel) => {
    const ps = [[1.0015, 0.5, 1.1]];
    for (let k = 1; k < 7; k++)
      ps.push([k * (1 + 0.0004 * k * k), 1 / k ** 1.6, 0.9 + 0.55 * k, k]);
    return shape(voice(len + 1.1, hz(m), ps), 0.006, len, 0.35, vel * 0.15);
  };
  const pluck = (m, len, vel) =>
    shape(
      voice(Math.min(len, 0.6) + 0.5, hz(m), [
        [1, 1, 7],
        [4, 0.4, 16],
        [10, 0.2, 30],
      ]),
      0.002,
      1,
      0.01,
      vel * 0.22,
    );
  const bell = (m, len, vel) =>
    shape(
      voice(len + 1.4, hz(m), [
        [1, 1, 3],
        [2.76, 0.35, 6],
        [5.4, 0.15, 10],
      ]),
      0.002,
      len + 1.4,
      0.01,
      vel * 0.13,
    );
  const pad = (m, len, vel) => {
    const ps = [];
    for (const cents of [-6, 6])
      for (let k = 1; k < 5; k++)
        ps.push([k * 2 ** (cents / 1200), 1.4 / k ** 1.5, 0, cents + k]);
    const out = voice(len + 0.9, hz(m), ps);
    // A slow swell rather than a strike
    const a = Math.min(Math.round(0.5 * SR), out.length);
    for (let i = 0; i < a; i++) {
      const q = i / a;
      out[i] *= q * Math.sqrt(q);
    }
    return shape(out, 0.001, len, 0.85, vel * 0.026);
  };
  const bass = (m, len, vel) =>
    shape(
      voice(len + 0.5, hz(m), [
        [1, 1, 1.3],
        [2, 0.25, 1.3],
      ]),
      0.01,
      len,
      0.4,
      vel * 0.16,
    );
  const kick = (vel) => {
    const n = Math.ceil(0.35 * SR);
    const out = new Float32Array(n);
    let ph = 0;
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      ph += (TWO_PI * 55 * (1 + 0.8 * Math.exp(-t * 40))) / SR;
      out[i] = Math.sin(ph) * Math.exp(-t * 14) * vel * 0.5;
    }
    return out;
  };
  const hiss = (len, lo, hi, decay, vel) => {
    const n = Math.ceil(len * SR);
    const x = band(noise(n), lo, hi);
    for (let i = 0; i < n; i++)
      x[i] *= Math.exp((-i / SR) * decay) * Math.min(1, i / (0.002 * SR)) * vel;
    return x;
  };

  // ---------------------------------------------------------------- the moods
  const MOODS = {
    tender: {
      key: 65,
      lead: musicbox,
      chord: piano,
      arp: true,
      padV: 0.8,
      drums: false,
      per: 2,
      progs: [
        [1, 5, 6, 4],
        [1, 3, 4, 5],
        [4, 5, 3, 6],
        [1, 6, 4, 5],
      ],
      rhythm: [
        [1, 0.5, 0.5, 1, 1],
        [0.5, 0.5, 1, 2],
        [1, 1, 1, 1],
        [1.5, 0.5, 2],
      ],
    },
    warm: {
      key: 62,
      lead: piano,
      chord: piano,
      arp: true,
      padV: 1,
      drums: false,
      per: 2,
      progs: [
        [1, 5, 6, 4],
        [1, 4, 6, 5],
        [6, 4, 1, 5],
      ],
      rhythm: [
        [1, 1, 2],
        [0.5, 0.5, 1, 1, 1],
        [1.5, 0.5, 1, 1],
      ],
    },
    playful: {
      key: 60,
      lead: pluck,
      chord: pluck,
      arp: false,
      padV: 0.35,
      drums: "light",
      per: 4,
      progs: [
        [1, 4, 5, 1],
        [1, 6, 2, 5],
        [4, 5, 1, 6],
      ],
      rhythm: [
        [0.5, 0.5, 0.5, 0.5, 1, 1],
        [1, 0.5, 0.5, 1, 1],
        [0.5, 0.5, 1, 0.5, 0.5, 1],
      ],
    },
    nostalgic: {
      key: 57,
      lead: piano,
      chord: piano,
      arp: true,
      padV: 1,
      drums: false,
      per: 2,
      progs: [
        [6, 4, 1, 5],
        [6, 5, 4, 5],
        [4, 1, 5, 6],
      ],
      rhythm: [
        [2, 1, 1],
        [1, 1, 2],
        [1.5, 0.5, 1, 1],
      ],
      second: musicbox,
    },
    celebratory: {
      key: 67,
      lead: bell,
      chord: piano,
      arp: false,
      padV: 0.7,
      drums: "full",
      per: 4,
      progs: [
        [1, 5, 6, 4],
        [4, 5, 1, 1],
        [1, 4, 5, 5],
      ],
      rhythm: [
        [0.5, 0.5, 1, 0.5, 0.5, 1],
        [1, 1, 0.5, 0.5, 1],
        [0.5, 0.5, 0.5, 0.5, 2],
      ],
    },
  };
  const M = MOODS[film.mood] ?? MOODS.warm;
  const key = M.key + pick([0, 0, 2, -2, 3]);
  const SCALE = [0, 2, 4, 5, 7, 9, 11];
  const deg = (d, oct = 0) =>
    key + SCALE[(d - 1) % 7] + 12 * (oct + Math.floor((d - 1) / 7));
  const triad = (d) => [deg(d), deg(d + 2), deg(d + 4)];
  const prog = pick(M.progs);
  const total = film.totalBeats;
  // The last chord lands two beats before the end of the scenes and rings through the hold
  const endBeat = Math.max(0, total - 4);
  const bigs = film.scenes.filter((s) => s.big).map((s) => s.b0);
  const fullness = (b) => {
    const k = b / Math.max(1, endBeat);
    const lift = bigs.some((x) => b >= x && b < x + 8) ? 0.25 : 0;
    return Math.min(1, 0.45 + 0.55 * k + lift);
  };

  // Chords, their bass, and the pad
  let ci = 0;
  for (let b = 0; b < endBeat; b += M.per, ci++) {
    const d = prog[ci % prog.length];
    const len = Math.min(M.per, endBeat - b);
    const t = b * spb;
    const tones = triad(d);
    const v = fullness(b);
    put(bass(deg(d) - 24, len * spb, 0.9), t, -0.1);
    tones.forEach((m, i) =>
      put(pad(m - 12, len * spb, M.padV * (0.4 + 0.6 * v)), t, -0.5 + i * 0.5),
    );
    if (M.arp) {
      const seq = [tones[0] - 12, tones[1] - 12, tones[2] - 12, tones[1]];
      for (let k = 0; k < len * 2; k++)
        put(M.chord(seq[k % 4], spb * 0.9, 0.45 * v), t + (k * spb) / 2, 0.3);
    } else {
      for (let k = 0; k < len; k++)
        tones.forEach((m, i) =>
          put(
            M.chord(m - 12, spb * 0.8, (k % 2 ? 0.35 : 0.5) * v),
            t + k * spb + i * 0.01,
            -0.2 + i * 0.2,
          ),
        );
    }
    if (M.drums)
      for (let k = 0; k < len; k++) {
        const tb = t + k * spb;
        if (M.drums === "full" || k % 2 === 0) put(kick(0.8 * v), tb, 0);
        if (k % 2 === 1) put(hiss(0.18, 900, 5000, 30, 0.35 * v), tb, 0.1);
        if (M.drums === "full")
          put(hiss(0.06, 5000, 12000, 60, 0.12 * v), tb + spb / 2, 0.3);
      }
  }
  // The last chord, long
  {
    const t = endBeat * spb;
    const len = (total - endBeat) * spb;
    put(bass(deg(1) - 24, len, 0.9), t, -0.1);
    triad(1).forEach((m, i) => {
      put(pad(m - 12, len, M.padV), t, -0.5 + i * 0.5);
      put(M.chord(m - 12, len, 0.5), t + i * 0.06, -0.2 + i * 0.2);
    });
    put(M.lead(deg(1, 1), len, 0.9), t + 0.18, 0.1);
  }

  // The tune, in steps of the scale: each chord's first note one of its own, the notes after
  // it walking toward the next chord's, phrases of two chords that come back A A B A
  const CELLS =
    M.per === 2
      ? [
          [1, 1],
          [0.5, 0.5, 1],
          [1.5, 0.5],
          [1, 0.5, 0.5],
        ]
      : [
          [1, 1, 1, 1],
          [0.5, 0.5, 1, 2],
          [1, 0.5, 0.5, 2],
          [2, 1, 1],
          [1.5, 0.5, 1, 1],
        ];
  const midiOf = (d) => key + SCALE[((d % 7) + 7) % 7] + 12 * Math.floor(d / 7);
  const tonesOf = (chordDeg) => [0, 2, 4].map((k) => chordDeg - 1 + k);
  const nearest = (from, chordDeg) => {
    let best = null;
    for (const t of tonesOf(chordDeg))
      for (const o of [-7, 0, 7, 14]) {
        const c = t + o;
        if (c < 5 || c > 16) continue;
        const cost = Math.abs(c - from) + (c === from ? 1.5 : 0) + rnd() * 0.8;
        if (!best || cost < best.cost) best = { c, cost };
      }
    return best?.c ?? 9;
  };
  const makePhrase = (chordAt, last) => {
    const notes = [];
    let d = nearest(9, chordAt(0));
    const cells = [pick(CELLS), pick(CELLS)];
    let b = 0;
    cells.forEach((cell, ci) => {
      const target = nearest(d, chordAt(ci));
      cell.forEach((len, k) => {
        if (k === 0) d = target;
        else {
          const next = ci === 0 ? nearest(d, chordAt(1)) : target;
          const dir = Math.sign(next - d) || pick([-1, 1]);
          d += dir * (rnd() < 0.8 ? 1 : 2);
        }
        d = Math.max(5, Math.min(16, d));
        notes.push([b, midiOf(d), len]);
        b += len;
      });
    });
    if (last) {
      // A phrase that closes rests on a long note of its chord
      const end = notes[notes.length - 1];
      end[2] += 0.5;
    }
    return notes;
  };
  const phraseBeats = M.per * 2;
  const chordOfBeat = (b) => prog[Math.floor(b / M.per) % prog.length];
  let A = null;
  const form = ["A", "A", "B", "A"];
  for (
    let b = M.per, p = 0;
    b + phraseBeats <= endBeat;
    b += phraseBeats, p++
  ) {
    const kind = form[p % 4];
    const chordAt = (ci) => chordOfBeat(b + ci * M.per);
    // A comes back only where its chords are the same as when it was made
    const same = A && A.chords.every((c, ci) => c === chordAt(ci));
    const notes =
      kind === "A" && same ? A.notes : makePhrase(chordAt, p % 4 === 3);
    if (kind === "A" && !A) A = { notes, chords: [chordAt(0), chordAt(1)] };
    const v = fullness(b);
    for (const [nb, m, len] of notes) {
      put(M.lead(m, len * spb, 0.9 * (0.6 + 0.4 * v)), (b + nb) * spb, 0.12);
      if (M.second && v > 0.7)
        put(M.second(m + 12, len * spb, 0.35), (b + nb) * spb, -0.2);
    }
  }
  // A lift where a big moment starts
  for (const b of bigs) {
    put(hiss(1.6, 3000, 12000, 2.5, 0.08), b * spb - 0.02, 0);
    for (const [i, m] of [1, 3, 5, 8].entries())
      put(bell(deg(m, 2), 1, 0.5), b * spb + i * 0.06, -0.4 + i * 0.25);
  }

  // ---------------------------------------------------------------- the sounds scenes asked for
  const SOUNDS = {
    pop(t) {
      const n = Math.ceil(0.16 * SR);
      const out = new Float32Array(n);
      let ph = 0;
      for (let i = 0; i < n; i++) {
        const tt = i / SR;
        ph += (TWO_PI * 330 * (1 + 2.2 * Math.min(1, tt / 0.07))) / SR;
        out[i] =
          Math.sin(ph) * Math.exp(-tt * 28) * Math.min(1, tt / 0.002) * 0.3;
      }
      put(out, t, -0.1);
    },
    write(t, len) {
      const n = Math.ceil(Math.max(0.2, len) * SR);
      const x = band(noise(n), 2500, 7500);
      for (let i = 0; i < n; i++) {
        const tt = i / SR;
        const mod =
          (0.5 +
            0.5 *
              Math.sin(TWO_PI * 7.5 * tt + 2 * Math.sin(TWO_PI * 2.3 * tt))) *
          (0.6 + 0.4 * Math.sin(TWO_PI * 3.1 * tt + 1));
        x[i] *=
          mod *
          Math.min(1, tt / 0.05) *
          Math.min(1, Math.max(0, (n / SR - tt) / 0.08)) *
          0.1;
      }
      put(x, t, 0.15);
    },
    sparkle(t) {
      [89, 91, 93, 96, 98, 101, 103].forEach((m, i) =>
        put(
          bell(m - 12, 0.6, 0.35 * (1 - i * 0.06)),
          t + i * 0.045,
          -0.6 + i * 0.2,
        ),
      );
    },
    chime(t) {
      [1, 5, 8].forEach((d, i) =>
        put(bell(deg(d, 2), 1.2, 0.6), t + i * 0.09, -0.3 + i * 0.3),
      );
    },
    whoosh(t) {
      const n = Math.ceil(0.8 * SR);
      const lo = band(noise(n), 300, 1200);
      const hi = band(noise(n), 1200, 5000);
      const out = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const tt = i / SR;
        const mix = Math.min(1, tt / 0.6);
        out[i] =
          (lo[i] * (1 - mix) + hi[i] * mix) *
          Math.sin(Math.PI * Math.min(1, tt / 0.8)) ** 2 *
          0.25;
      }
      put(out, t - 0.25, -0.3);
    },
    thump(t) {
      put(kick(0.5), t, 0);
      put(hiss(0.12, 150, 2500, 40, 0.5), t, 0);
    },
    clap(t) {
      for (const [k, d] of [0, 0.006, 0.013].entries())
        put(hiss(0.1, 800, 5000, 60, 0.9 - k * 0.2), t + d, 0);
    },
    boing(t) {
      const n = Math.ceil(0.35 * SR);
      const out = new Float32Array(n);
      let ph = 0;
      for (let i = 0; i < n; i++) {
        const tt = i / SR;
        ph +=
          (TWO_PI *
            330 *
            (1 + 0.8 * Math.exp(-tt * 18)) *
            (1 + 0.03 * Math.sin(TWO_PI * 14 * tt))) /
          SR;
        out[i] =
          Math.sin(ph) * Math.exp(-tt * 9) * Math.min(1, tt / 0.003) * 0.25;
      }
      put(out, t, 0.2);
    },
    rustle(t) {
      const n = Math.ceil(0.6 * SR);
      const x = band(noise(n), 1500, 8000);
      const am = band(noise(n), 5, 40);
      let peak = 1e-9;
      for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(am[i]));
      for (let i = 0; i < n; i++)
        x[i] *= (Math.abs(am[i]) / peak) * Math.sin((Math.PI * i) / n) * 0.35;
      put(x, t - 0.1, 0.1);
    },
    blow(t) {
      const n = Math.ceil(0.9 * SR);
      const x = band(noise(n), 300, 2400);
      for (let i = 0; i < n; i++)
        x[i] *= Math.sin((Math.PI * i) / n) ** 1.5 * 0.4;
      put(x, t, 0);
    },
    shutter(t) {
      put(hiss(0.05, 2000, 8000, 80, 0.8), t, 0);
      put(hiss(0.06, 1000, 6000, 70, 0.6), t + 0.08, 0);
    },
  };
  for (const c of film.cues ?? []) SOUNDS[c.kind]?.(c.at, c.len);

  // ---------------------------------------------------------------- a room for it all
  // A small hall: eight combs and four all-passes per side, the classic reverb
  const hall = (x, spread) => {
    const out = new Float32Array(x.length);
    const combs = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617].map((d) => ({
      buf: new Float32Array(Math.round(((d + spread) * SR) / 44100)),
      i: 0,
      store: 0,
    }));
    const alls = [556, 441, 341, 225].map((d) => ({
      buf: new Float32Array(Math.round(((d + spread) * SR) / 44100)),
      i: 0,
    }));
    for (let n = 0; n < x.length; n++) {
      const inp = x[n] * 0.015;
      let s = 0;
      for (const c of combs) {
        const y = c.buf[c.i];
        c.store = y * 0.8 + c.store * 0.2;
        c.buf[c.i] = inp + c.store * 0.84;
        if (++c.i === c.buf.length) c.i = 0;
        s += y;
      }
      for (const a of alls) {
        const y = a.buf[a.i];
        a.buf[a.i] = s + y * 0.5;
        if (++a.i === a.buf.length) a.i = 0;
        s = y - s;
      }
      out[n] = s;
    }
    return out;
  };
  const wl = hall(L, 0);
  const wr = hall(R, 23);
  let peak = 1e-9;
  const fadeFrom = N - Math.round(0.6 * SR);
  for (let i = 0; i < N; i++) {
    let l = L[i] + wl[i] * 1.1;
    let r = R[i] + wr[i] * 1.1;
    if (i > fadeFrom) {
      const fade = (N - i) / (N - fadeFrom);
      l *= fade;
      r *= fade;
    }
    L[i] = l;
    R[i] = r;
    if (l > peak) peak = l;
    else if (-l > peak) peak = -l;
    if (r > peak) peak = r;
    else if (-r > peak) peak = -r;
  }
  const gain = 0.72 / peak;
  for (let i = 0; i < N; i++) {
    L[i] *= gain;
    R[i] *= gain;
  }
  return { rate: SR, left: L, right: R };
}
