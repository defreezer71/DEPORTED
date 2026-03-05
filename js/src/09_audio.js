// AUDIO SYSTEM — Procedural sounds via Web Audio API
// ═══════════════════════════════════════════════════════════
let audioCtx = null;

function ensureAudio() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

// Master compressor/limiter — prevents clipping when many sounds fire at once
let masterCompressor = null;
function getMaster() {
  const ctx = ensureAudio();
  if (!masterCompressor) {
    masterCompressor = ctx.createDynamicsCompressor();
    masterCompressor.threshold.value = -6;
    masterCompressor.knee.value = 3;
    masterCompressor.ratio.value = 4;
    masterCompressor.attack.value = 0.001;
    masterCompressor.release.value = 0.1;
    // Master gain boost after compression
    const masterGain = ctx.createGain();
    masterGain.gain.value = 3.71;
    masterCompressor.connect(masterGain).connect(ctx.destination);
  }
  return masterCompressor;
}

function playNoise(duration, volume, filterFreq, filterType) {
  const ctx = ensureAudio();
  const bufferSize = ctx.sampleRate * duration;
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    // Ultra-sharp attack in first 0.4% for a hard crack transient, then fast decay
    const attackFrac = bufferSize * 0.004;
    const env = i < attackFrac
      ? (i / attackFrac)
      : Math.pow(1 - (i - attackFrac) / (bufferSize - attackFrac), 2.2);
    // Bake volume directly into sample data so it's truly louder, not just gain-scaled
    data[i] = (Math.random() * 2 - 1) * env * Math.min(volume, 1.0);
  }
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(Math.min(volume, 1.0), ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
  const filter = ctx.createBiquadFilter();
  filter.type = filterType || 'lowpass';
  filter.frequency.value = filterFreq || 2000;
  filter.Q.value = 1.5;
  src.connect(filter).connect(gain).connect(getMaster());
  src.start(); src.stop(ctx.currentTime + duration);
}

function playTone(freq, duration, volume, type) {
  const ctx = ensureAudio();
  const osc = ctx.createOscillator();
  osc.type = type || 'sine';
  osc.frequency.setValueAtTime(freq, ctx.currentTime);
  // Pitch drops for explosive boom character
  osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq * 0.3), ctx.currentTime + duration * 0.7);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(Math.min(volume, 1.0), ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
  // For bass tones, add a lowshelf boost
  if (freq < 100) {
    const bassBoost = ctx.createBiquadFilter();
    bassBoost.type = 'lowshelf';
    bassBoost.frequency.value = 120;
    bassBoost.gain.value = 10; // +10dB bass shelf
    osc.connect(bassBoost).connect(gain).connect(getMaster());
  } else {
    osc.connect(gain).connect(getMaster());
  }
  osc.start(); osc.stop(ctx.currentTime + duration);
}

// Sharp impulse — true dirac-like spike for gun crack character
function playImpulse(volume) {
  const ctx = ensureAudio();
  // Very short buffer — just a few ms of exponential decay from a spike
  const dur = 0.018;
  const bufSize = Math.floor(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < bufSize; i++) {
    // True impulse: max at sample 0, exponential decay, alternating sign for crack
    const decay = Math.exp(-i / (bufSize * 0.08));
    d[i] = (i % 2 === 0 ? 1 : -1) * decay * volume;
  }
  const src = ctx.createBufferSource();
  src.buffer = buf;
  // High-pass to keep it snappy, not bassy
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass'; hp.frequency.value = 3000;
  src.connect(hp).connect(getMaster());
  src.start(); src.stop(ctx.currentTime + dur);
}

const SFX = {
  gunshot_m4() {
    const ctx = ensureAudio();
    const t0 = ctx.currentTime;
    // ── Layer 1: Muzzle blast transient — convolution-style burst ──
    const blastBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.003), ctx.sampleRate);
    const bd = blastBuf.getChannelData(0);
    for (let i = 0; i < bd.length; i++) bd[i] = (1 - i/bd.length) * (Math.random()*2-1);
    const blast = ctx.createBufferSource(); blast.buffer = blastBuf;
    const blastGain = ctx.createGain(); blastGain.gain.value = 1.8;
    const blastHp = ctx.createBiquadFilter(); blastHp.type = 'highpass'; blastHp.frequency.value = 2000;
    blast.connect(blastHp).connect(blastGain).connect(getMaster());
    blast.start(t0);
    // ── Layer 2: Crack body — shaped noise 5ms-60ms ──
    const crackBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.06), ctx.sampleRate);
    const cd = crackBuf.getChannelData(0);
    for (let i = 0; i < cd.length; i++) {
      const env = Math.exp(-i / (cd.length * 0.15));
      cd[i] = (Math.random()*2-1) * env;
    }
    const crack = ctx.createBufferSource(); crack.buffer = crackBuf;
    const crackBp = ctx.createBiquadFilter(); crackBp.type = 'bandpass'; crackBp.frequency.value = 2800; crackBp.Q.value = 0.6;
    const crackGain = ctx.createGain(); crackGain.gain.value = 1.1;
    crack.connect(crackBp).connect(crackGain).connect(getMaster());
    crack.start(t0 + 0.003);
    // ── Layer 3: Pressure wave — pitch-dropping tone ──
    const wave = ctx.createOscillator(); wave.type = 'sine';
    wave.frequency.setValueAtTime(180, t0);
    wave.frequency.exponentialRampToValueAtTime(18, t0 + 0.45);
    const waveGain = ctx.createGain();
    waveGain.gain.setValueAtTime(0.85, t0);
    waveGain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.55);
    wave.connect(waveGain).connect(getMaster());
    wave.start(t0); wave.stop(t0 + 0.55);
    // ── Layer 4: Sub thump ──
    const sub = ctx.createOscillator(); sub.type = 'sine';
    sub.frequency.setValueAtTime(80, t0 + 0.01);
    sub.frequency.exponentialRampToValueAtTime(22, t0 + 0.4);
    const subGain = ctx.createGain();
    subGain.gain.setValueAtTime(0.0, t0);
    subGain.gain.linearRampToValueAtTime(0.7, t0 + 0.02);
    subGain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.5);
    sub.connect(subGain).connect(getMaster());
    sub.start(t0 + 0.01); sub.stop(t0 + 0.5);
    // ── Layer 5: Room tail — reverberant low rumble ──
    setTimeout(() => playNoise(0.5, 0.12, 280, 'lowpass'), 60);
    // ── Layer 6: Mechanical bolt click ──
    setTimeout(() => {
      playNoise(0.018, 0.22, 4200, 'highpass');
      playTone(1800, 0.015, 0.1, 'square');
    }, 95);
  },
  gunshot_pistol() {
    const ctx = ensureAudio();
    const t0 = ctx.currentTime;
    // ── Silenced pistol — subsonic thwip, minimal report ──
    // Layer 1: Mechanical click of the action
    const clickBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.008), ctx.sampleRate);
    const ckd = clickBuf.getChannelData(0);
    for (let i = 0; i < ckd.length; i++) ckd[i] = (1 - i/ckd.length) * (Math.random()*2-1) * 0.5;
    const click = ctx.createBufferSource(); click.buffer = clickBuf;
    const clickHp = ctx.createBiquadFilter(); clickHp.type = 'highpass'; clickHp.frequency.value = 1800;
    const clickGain = ctx.createGain(); clickGain.gain.value = 0.18;
    click.connect(clickHp).connect(clickGain).connect(getMaster());
    click.start(t0);
    // Layer 2: Suppressed thwip
    const thwipBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.04), ctx.sampleRate);
    const td = thwipBuf.getChannelData(0);
    for (let i = 0; i < td.length; i++) {
      const env = Math.exp(-i / (td.length * 0.12));
      td[i] = (Math.random()*2-1) * env;
    }
    const thwip = ctx.createBufferSource(); thwip.buffer = thwipBuf;
    const thwipBp = ctx.createBiquadFilter(); thwipBp.type = 'bandpass'; thwipBp.frequency.value = 900; thwipBp.Q.value = 1.5;
    const thwipGain = ctx.createGain(); thwipGain.gain.value = 0.22;
    thwip.connect(thwipBp).connect(thwipGain).connect(getMaster());
    thwip.start(t0 + 0.004);
    // Layer 3: Tiny bass puff — gas venting through baffles
    const puff = ctx.createOscillator(); puff.type = 'sine';
    puff.frequency.setValueAtTime(280, t0);
    puff.frequency.exponentialRampToValueAtTime(80, t0 + 0.06);
    const puffGain = ctx.createGain();
    puffGain.gain.setValueAtTime(0.12, t0);
    puffGain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.08);
    puff.connect(puffGain).connect(getMaster());
    puff.start(t0); puff.stop(t0 + 0.08);
    // Layer 4: Slide cycle
    setTimeout(() => playNoise(0.015, 0.08, 3200, 'highpass'), 55);
  },
  reload() {
    // Mag release click
    setTimeout(() => {
      playTone(2200, 0.02, 0.05, 'square');
      playNoise(0.03, 0.04, 4000, 'highpass');
    }, 0);
    // Mag sliding out
    setTimeout(() => {
      playNoise(0.15, 0.03, 800, 'bandpass');
      playTone(300, 0.08, 0.02, 'sawtooth');
    }, 150);
    // New mag insertion — metallic slide
    setTimeout(() => {
      playNoise(0.04, 0.05, 3000, 'highpass');
      playTone(1800, 0.03, 0.04, 'square');
    }, 450);
    // Mag click/lock
    setTimeout(() => {
      playTone(2500, 0.015, 0.06, 'square');
      playNoise(0.02, 0.05, 5000, 'highpass');
    }, 550);
    // Bolt/charging handle
    setTimeout(() => {
      playNoise(0.06, 0.05, 2000, 'bandpass');
      playTone(600, 0.04, 0.03, 'sawtooth');
    }, 700);
  },
  hitmarker() {
    playTone(1800, 0.06, 0.22, 'sine');
    playTone(2200, 0.04, 0.16, 'sine');
  },
  headshot() {
    // Sharp metallic ping — instant attack, fast ring-out
    const ctx = ensureAudio();
    const t0 = ctx.currentTime;
    const osc = ctx.createOscillator(); osc.type = 'sine';
    osc.frequency.value = 2800;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.36, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.18);
    osc.connect(g).connect(getMaster());
    osc.start(t0); osc.stop(t0 + 0.18);
  },
  kill() {
    playTone(820, 0.12, 0.14, 'sine'); // Single lower ding
  },
  pickup() {
    playTone(600, 0.08, 0.1, 'sine');
    setTimeout(() => playTone(900, 0.1, 0.1, 'sine'), 60);
  },
  empty_click() {
    playTone(400, 0.03, 0.08, 'square');
  },
  footstep() {
    // Varied footstep — alternates between two tones for left/right feel
    const crush = 120 + Math.random() * 80;
    playNoise(0.06, 0.22, crush, 'lowpass');
    playNoise(0.03, 0.12, 180, 'lowpass');
    setTimeout(() => playNoise(0.04, 0.08, 400, 'bandpass'), 20);
  },
  water_damage() {
    playNoise(0.15, 0.04, 800, 'lowpass');
    playTone(200, 0.1, 0.03, 'sine');
  },
  weapon_switch() {
    playTone(500, 0.04, 0.06, 'square');
    setTimeout(() => playTone(700, 0.03, 0.06, 'square'), 50);
  },
  kill_chaching() {
    // Deep satisfying elimination thump — low impact + rising confirm tone
    const ctx = ensureAudio();
    const t0 = ctx.currentTime;
    // Heavy low thump
    const sub = ctx.createOscillator(); sub.type = 'sine';
    sub.frequency.setValueAtTime(90, t0);
    sub.frequency.exponentialRampToValueAtTime(32, t0 + 0.18);
    const subG = ctx.createGain();
    subG.gain.setValueAtTime(0.0, t0);
    subG.gain.linearRampToValueAtTime(0.55, t0 + 0.012);
    subG.gain.exponentialRampToValueAtTime(0.001, t0 + 0.22);
    sub.connect(subG).connect(getMaster());
    sub.start(t0); sub.stop(t0 + 0.25);
    // Mid body punch
    playNoise(0.08, 0.22, 320, 'lowpass');
    // Two-note rising confirm — not shrill, feels earned
    setTimeout(() => playTone(380, 0.12, 0.13, 'sine'), 60);
    setTimeout(() => playTone(570, 0.14, 0.11, 'sine'), 145);
  },
  bird() {
    const ctx = ensureAudio();
    const species = Math.floor(Math.random() * 4);
    if (species === 0) {
      // Melodic tropical warbler — smooth FM chirps with natural envelope
      const base = 1800 + Math.random() * 600;
      const notes = 5 + Math.floor(Math.random() * 4);
      for (let i = 0; i < notes; i++) {
        const t = i * 110 + Math.random() * 40;
        setTimeout(() => {
          const ctx2 = ensureAudio();
          const t0 = ctx2.currentTime;
          const osc = ctx2.createOscillator(); osc.type = 'sine';
          const noteF = base + Math.sin(i * 1.8) * 400 + Math.random() * 120;
          osc.frequency.setValueAtTime(noteF, t0);
          osc.frequency.linearRampToValueAtTime(noteF * 1.08, t0 + 0.04);
          osc.frequency.linearRampToValueAtTime(noteF * 0.97, t0 + 0.09);
          const g = ctx2.createGain();
          g.gain.setValueAtTime(0, t0);
          g.gain.linearRampToValueAtTime(0.045, t0 + 0.015);
          g.gain.linearRampToValueAtTime(0.032, t0 + 0.06);
          g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.11);
          osc.connect(g).connect(getMaster());
          osc.start(t0); osc.stop(t0 + 0.12);
        }, t);
      }
    } else if (species === 1) {
      // Rapid staccato finch trill — natural rhythmic burst
      const base = 2600 + Math.random() * 500;
      const chirps = 6 + Math.floor(Math.random() * 5);
      for (let i = 0; i < chirps; i++) {
        setTimeout(() => {
          const ctx2 = ensureAudio();
          const t0 = ctx2.currentTime;
          const osc = ctx2.createOscillator(); osc.type = 'sine';
          const f = base + (Math.random() - 0.5) * 300;
          osc.frequency.setValueAtTime(f, t0);
          osc.frequency.linearRampToValueAtTime(f * 1.12, t0 + 0.025);
          const g = ctx2.createGain();
          g.gain.setValueAtTime(0, t0);
          g.gain.linearRampToValueAtTime(0.038, t0 + 0.008);
          g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.055);
          osc.connect(g).connect(getMaster());
          osc.start(t0); osc.stop(t0 + 0.06);
        }, i * 75 + Math.random() * 20);
      }
    } else if (species === 2) {
      // Deep coo — tropical dove with natural vibrato
      const base = 480 + Math.random() * 180;
      const coos = 2 + Math.floor(Math.random() * 3);
      for (let i = 0; i < coos; i++) {
        setTimeout(() => {
          const ctx2 = ensureAudio();
          const t0 = ctx2.currentTime;
          const osc = ctx2.createOscillator(); osc.type = 'sine';
          osc.frequency.setValueAtTime(base, t0);
          osc.frequency.linearRampToValueAtTime(base * 1.06, t0 + 0.06);
          osc.frequency.linearRampToValueAtTime(base * 0.94, t0 + 0.22);
          osc.frequency.linearRampToValueAtTime(base * 0.88, t0 + 0.30);
          const g = ctx2.createGain();
          g.gain.setValueAtTime(0, t0);
          g.gain.linearRampToValueAtTime(0.042, t0 + 0.04);
          g.gain.setValueAtTime(0.038, t0 + 0.18);
          g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.32);
          osc.connect(g).connect(getMaster());
          osc.start(t0); osc.stop(t0 + 0.33);
        }, i * 400 + Math.random() * 60);
      }
    } else {
      // Long descending whistle — like a jungle oriole
      const ctx2 = ensureAudio();
      const t0 = ctx2.currentTime;
      const osc = ctx2.createOscillator(); osc.type = 'sine';
      const startF = 2200 + Math.random() * 400;
      osc.frequency.setValueAtTime(startF, t0);
      osc.frequency.linearRampToValueAtTime(startF * 0.72, t0 + 0.35);
      osc.frequency.linearRampToValueAtTime(startF * 0.58, t0 + 0.6);
      const g = ctx2.createGain();
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(0.048, t0 + 0.03);
      g.gain.setValueAtTime(0.04, t0 + 0.3);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.65);
      osc.connect(g).connect(getMaster());
      osc.start(t0); osc.stop(t0 + 0.66);
    }
  },
  insect() {
    // Cicada-like: amplitude modulated bandpass noise — 20% louder
    const ctx = ensureAudio();
    const dur = 1.5 + Math.random() * 2.5;
    const bufSize = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
    const d = buf.getChannelData(0);
    const modFreq = 40 + Math.random() * 60;
    for (let i = 0; i < bufSize; i++) {
      const am = 0.5 + 0.5 * Math.sin((i / ctx.sampleRate) * modFreq * Math.PI * 2);
      d[i] = (Math.random() * 2 - 1) * am * 0.018; // was 0.015, +20%
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 5000 + Math.random() * 3000;
    filter.Q.value = 3;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(1.2, ctx.currentTime + 0.3); // was 1.0, +20%
    gain.gain.linearRampToValueAtTime(1.2, ctx.currentTime + dur - 0.3);
    gain.gain.linearRampToValueAtTime(0, ctx.currentTime + dur);
    src.connect(filter).connect(gain).connect(getMaster());
    src.start(); src.stop(ctx.currentTime + dur);
  },
  wind() {
    // Multi-layer wind — low rumble through trees + high whistle + random gusts
    const gustVol = 0.03 + Math.random() * 0.025;
    playNoise(4 + Math.random() * 4, gustVol, 150 + Math.random() * 100, 'lowpass');
    playNoise(3 + Math.random() * 3, gustVol * 0.6, 600 + Math.random() * 300, 'bandpass');
    // Occasional high whistle through leaves
    if (Math.random() < 0.4) {
      setTimeout(() => playNoise(1.5, 0.012, 2800 + Math.random() * 800, 'bandpass'), Math.random() * 1000);
    }
  },
  gate_creak() {
    const ctx = ensureAudio();
    const t0 = ctx.currentTime;
    // ── Single prominent intercom buzz ──
    const buzz = ctx.createOscillator(); buzz.type = 'square';
    buzz.frequency.value = 120;
    const buzzGain = ctx.createGain();
    buzzGain.gain.setValueAtTime(0.0, t0);
    buzzGain.gain.linearRampToValueAtTime(0.176, t0 + 0.05);  // ramp up
    buzzGain.gain.setValueAtTime(0.176, t0 + 0.65);           // hold
    buzzGain.gain.linearRampToValueAtTime(0.0, t0 + 0.85);   // fade out
    const buzzLp = ctx.createBiquadFilter(); buzzLp.type = 'lowpass'; buzzLp.frequency.value = 800;
    buzz.connect(buzzLp).connect(buzzGain).connect(getMaster());
    buzz.start(t0); buzz.stop(t0 + 0.85);
    // ── Gate swings open after buzz ends ──
    setTimeout(() => {
      const dur = 1.6;
      const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) {
        const t = i / d.length;
        const mod = 0.5 + 0.5 * Math.sin(t * 28) * Math.sin(t * 11);
        const env = t < 0.05 ? t/0.05 : t > 0.8 ? (1-t)/0.2 : 1;
        d[i] = (Math.random()*2-1) * mod * env * 0.096;
      }
      const src = ctx.createBufferSource(); src.buffer = buf;
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 420; bp.Q.value = 1.2;
      const g = ctx.createGain(); g.gain.value = 0.80;
      src.connect(bp).connect(g).connect(getMaster());
      src.start();
      playTone(68, 1.12, 0.18, 'sawtooth');
      playTone(102, 0.96, 0.10, 'sawtooth');
    }, 900);
    // ── Final slam ──
    setTimeout(() => {
      playTone(62, 0.20, 0.5, 'sine');
      playNoise(0.144, 0.3, 500, 'lowpass');
      playNoise(0.064, 0.15, 2500, 'highpass');
    }, 2450);
  }
};

// Ambient sound timer
let ambientTimer = 3 + Math.random() * 5;

// Footstep timer
let footstepTimer = 0;

// ═══════════════════════════════════════════════════════════
