// All sound is synthesized with WebAudio: filtered noise bursts and short oscillator
// blips, no audio files, no network. The context is created lazily on the first user
// gesture (pointer lock click) and every effect reuses one shared noise buffer.
// In a staged screenshot (?shot=) there is no gesture, so silent mode skips the
// context entirely instead of spamming autoplay warnings.
export function createAudio(options = {}) {
  const silent = !!options.silent;
  let ctx = null;
  let noiseBuf = null;
  let master = null;

  function ensure() {
    if (silent) return null;
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return ctx;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
    const len = Math.floor(ctx.sampleRate * 1);
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i += 1) data[i] = Math.random() * 2 - 1;
    return ctx;
  }

  function noiseBurst({ duration, freq, type = 'lowpass', gain = 0.5, sweepTo = null, when = 0 }) {
    const c = ensure();
    if (!c) return;
    const t = c.currentTime + when;
    const src = c.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    const filter = c.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(freq, t);
    if (sweepTo) filter.frequency.exponentialRampToValueAtTime(Math.max(40, sweepTo), t + duration);
    const g = c.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + duration);
    src.connect(filter).connect(g).connect(master);
    src.start(t);
    src.stop(t + duration + 0.02);
  }

  function tone({ freq, endFreq = null, duration, type = 'sine', gain = 0.3, when = 0 }) {
    const c = ensure();
    if (!c) return;
    const t = c.currentTime + when;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (endFreq) o.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), t + duration);
    const g = c.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + duration);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + duration + 0.02);
  }

  return {
    unlock() { ensure(); },
    shot(kind) {
      if (kind === 'rifle') {
        noiseBurst({ duration: 0.14, freq: 2400, type: 'bandpass', gain: 0.7 });
        tone({ freq: 180, endFreq: 70, duration: 0.09, type: 'square', gain: 0.22 });
      } else if (kind === 'smg') {
        noiseBurst({ duration: 0.09, freq: 3000, type: 'bandpass', gain: 0.5 });
        tone({ freq: 220, endFreq: 90, duration: 0.06, type: 'square', gain: 0.16 });
      } else {
        noiseBurst({ duration: 0.11, freq: 1800, type: 'bandpass', gain: 0.6 });
        tone({ freq: 150, endFreq: 60, duration: 0.08, type: 'square', gain: 0.2 });
      }
    },
    distantShot() {
      noiseBurst({ duration: 0.12, freq: 900, gain: 0.18 });
    },
    dryFire() {
      tone({ freq: 1300, duration: 0.03, type: 'square', gain: 0.12 });
    },
    reload() {
      tone({ freq: 900, duration: 0.04, type: 'square', gain: 0.14 });
      tone({ freq: 600, duration: 0.04, type: 'square', gain: 0.14, when: 0.18 });
      tone({ freq: 1100, duration: 0.05, type: 'square', gain: 0.16, when: 0.42 });
    },
    hit() {
      tone({ freq: 2100, duration: 0.05, type: 'sine', gain: 0.25 });
    },
    kill() {
      tone({ freq: 2100, duration: 0.05, type: 'sine', gain: 0.25 });
      tone({ freq: 2600, duration: 0.07, type: 'sine', gain: 0.25, when: 0.07 });
    },
    hurt() {
      tone({ freq: 120, endFreq: 70, duration: 0.18, type: 'sawtooth', gain: 0.25 });
    },
    explosion() {
      noiseBurst({ duration: 1.1, freq: 900, sweepTo: 90, gain: 1.0 });
      tone({ freq: 90, endFreq: 32, duration: 0.9, type: 'sine', gain: 0.8 });
    },
    beep(urgent) {
      tone({ freq: urgent ? 1250 : 950, duration: 0.09, type: 'sine', gain: 0.3 });
    },
    plantTick() {
      tone({ freq: 1500, duration: 0.04, type: 'square', gain: 0.15 });
    },
    roundWin() {
      tone({ freq: 523, duration: 0.14, type: 'sine', gain: 0.3 });
      tone({ freq: 659, duration: 0.14, type: 'sine', gain: 0.3, when: 0.13 });
      tone({ freq: 784, duration: 0.22, type: 'sine', gain: 0.3, when: 0.26 });
    },
    roundLose() {
      tone({ freq: 392, duration: 0.16, type: 'sine', gain: 0.28 });
      tone({ freq: 311, duration: 0.26, type: 'sine', gain: 0.28, when: 0.15 });
    },
    buy() {
      tone({ freq: 880, duration: 0.06, type: 'sine', gain: 0.2 });
      tone({ freq: 1174, duration: 0.08, type: 'sine', gain: 0.2, when: 0.06 });
    },
    denied() {
      tone({ freq: 220, duration: 0.1, type: 'square', gain: 0.15 });
    },
    throwWhoosh() {
      noiseBurst({ duration: 0.25, freq: 1200, type: 'bandpass', sweepTo: 300, gain: 0.25 });
    },
  };
}
