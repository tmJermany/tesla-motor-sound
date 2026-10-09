// Sonido de motor + transmisión desde la cabina.
//
//   const engine = new EngineSound(audioCtx, CARS.gt3rs, { volume: 0.75 });
//   await engine.start();                                   // tras un toque del usuario
//   engine.update({ rpm, throttle, gear, speed, overrun, pedal });   // cada ~25 ms
//   engine.shift("up" | "down", { throttle });              // cuando la caja cambia
//   engine.setVolume(0.8); engine.stop();
//
// rpm: vueltas del motor · throttle: carga efectiva 0-1 (0 durante el corte de encendido)
// gear: marcha (1..n) · speed: m/s · overrun: 0-1 retención (solo suena si el coche tiene petardeos)
// pedal: posición real del acelerador (para la descarga del turbo al soltar)
const engineModes = new WeakMap();

class EngineSound {
  constructor(ctx, car, opts = {}) {
    this.ctx = ctx; this.car = car;
    this.volume = opts.volume ?? 0.75;
    this.noPops = !!opts.noPops; this.popsUntil = 0; this.lastUpdate = 0;
    this.N = null; this.boost = 0; this.prevPedal = 0;
  }

  // Carga el AudioWorklet una vez por AudioContext; si falla se usa ScriptProcessor
  static async prepare(ctx) {
    if (engineModes.has(ctx)) return engineModes.get(ctx);
    let mode = "script";
    try {
      if (ctx.audioWorklet) {
        await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([window.ENGINE_DSP_SOURCE], { type: "application/javascript" })));
        mode = "worklet";
      }
    } catch { mode = "script"; }
    engineModes.set(ctx, mode);
    return mode;
  }

  async start() {
    const mode = await EngineSound.prepare(this.ctx);
    this._build(mode);
  }

  stop() {
    const N = this.N; if (!N) return; this.N = null;
    N.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
    setTimeout(() => { N.srcs.forEach(s => { try { s.stop?.(); } catch {} try { s.disconnect(); } catch {} }); N.vol.disconnect(); }, 400);
  }

  setVolume(v) { this.volume = v; if (this.N) this.N.vol.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02); }

  get output() { return this.N?.vol; }

  // ---------- grafo de audio ----------
  _build(mode) {
    const ctx = this.ctx, car = this.car, c = car.cabin, t = ctx.currentTime;
    const opts = { ...car.synth, idle: car.idle, red: car.red };
    const eng = mode === "worklet"
      ? new AudioWorkletNode(ctx, "engine-proc", { numberOfInputs: 0, outputChannelCount: [3], processorOptions: opts })
      : this._scriptEngine(opts);
    const srcs = [eng];
    const vg = ctx.createGain(); vg.gain.value = 1;          // compensa el volumen durante el "brap" del cambio
    const split = ctx.createChannelSplitter(3); eng.connect(vg).connect(split);
    const biq = (type, f, gain = 0, Q = 0.7) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.gain.value = gain; b.Q.value = Q; return b; };

    // Escape: saturación → graves (zona baja) → rasposo (zona media) → resonancias de carrocería → aislamiento
    const sat = ctx.createWaveShaper(); sat.curve = satCurve(c.drive); sat.oversample = "4x";
    const lowShelf = biq("lowshelf", c.shelfHz);
    const rasp = biq("peaking", c.raspHz, 0, 0.8);
    split.connect(sat, 0); sat.connect(lowShelf).connect(rasp);
    let chain = rasp;
    c.peaks.forEach(([f, g, q]) => { const p = biq("peaking", f, g, q); chain.connect(p); chain = p; });
    const lp = biq("lowpass", c.lp[1]); chain.connect(lp);
    const exG = ctx.createGain(); exG.gain.value = c.exhaust; lp.connect(exG);

    // Aullido de altas vueltas: banda 1,5-4,5 kHz en paralelo
    const screamBp = biq("bandpass", 2500, 0, 0.9);
    const screamG = ctx.createGain(); screamG.gain.value = 0;
    sat.connect(screamBp).connect(screamG);

    // Admisión
    const inBp = biq("bandpass", 1000, 0, 0.9);
    const inG = ctx.createGain(); inG.gain.value = 0; split.connect(inBp, 1).connect(inG);

    // Mecánico (distribución/taqués)
    const mechHp = biq("highpass", 2200), mechPk = biq("peaking", 4500, 4, 1.5);
    const mechG = ctx.createGain(); mechG.gain.value = c.mech;
    split.connect(mechHp, 2).connect(mechPk).connect(mechG);

    const mix = ctx.createGain();
    [exG, screamG, inG, mechG].forEach(n => n.connect(mix));

    // Silbido de la caja (piñón de entrada) y del grupo (depende de la velocidad)
    const osc = (type) => { const o = ctx.createOscillator(); o.type = type; o.start(); srcs.push(o); return o; };
    const gw = osc("sine"), gwG = ctx.createGain(); gwG.gain.value = 0; gw.connect(gwG).connect(mix);
    const dw = osc("sine"), dwG = ctx.createGain(); dwG.gain.value = 0; dw.connect(dwG).connect(mix);

    // Turbo
    let tW = null, tWG = null, tNG = null, tNBp = null;
    if (c.turbo) {
      tW = osc("sine"); tWG = ctx.createGain(); tWG.gain.value = 0; tW.connect(tWG).connect(mix);
      const tN = this._noise(); tN.start(); srcs.push(tN);
      tNBp = biq("bandpass", 1500, 0, 1.4); tNG = ctx.createGain(); tNG.gain.value = 0;
      tN.connect(tNBp).connect(tNG).connect(mix);
    }

    // Habitáculo: seco + reverberación corta
    const conv = ctx.createConvolver(); conv.buffer = cabinIR(ctx);
    const wet = ctx.createGain(); wet.gain.value = c.wet; mix.connect(conv).connect(wet);
    const master = ctx.createGain(); master.gain.value = 0;
    mix.connect(master); wet.connect(master);
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4; comp.attack.value = 0.005; comp.release.value = 0.15;
    const vol = ctx.createGain(); vol.gain.value = this.volume;
    master.connect(comp).connect(vol).connect(ctx.destination);
    master.gain.setTargetAtTime(1, t, 0.4);

    // petardeos (car.popsFx): con su propio limitador, sin pasar por el compresor del motor
    let pops = null;
    if (car.popsFx && !this.noPops) {
      const plim = ctx.createDynamicsCompressor(); plim.threshold.value = -4; plim.ratio.value = 20; plim.attack.value = 0.001; plim.release.value = 0.08;
      const pg = ctx.createGain(); pg.gain.value = car.popsFx.level;
      pg.connect(plim).connect(vol);
      pops = new Pops(ctx, pg);
    }

    this.N = { eng, vg, lowShelf, rasp, lp, screamBp, screamG, inBp, inG, mechG, gw, gwG, dw, dwG, tW, tWG, tNG, tNBp, master, vol, srcs, pops };
  }

  // ---------- control en tiempo real ----------
  update({ rpm, throttle = 0, gear = 1, speed = 0, overrun = 0, pedal = throttle, blip = 0 }) {
    const N = this.N; if (!N) return;
    const car = this.car, c = car.cabin, t = this.ctx.currentTime;
    const load = clamp01(Math.max(throttle, blip));          // el golpe de gas al reducir cuenta como carga
    const norm = clamp01((rpm - car.idle) / (car.red - car.idle));
    const set = (param, v, tc = 0.03) => param.setTargetAtTime(v, t, tc);

    set(N.eng.parameters.get("rpm"), rpm, 0.015);
    set(N.eng.parameters.get("load"), load, 0.02);
    set(N.eng.parameters.get("overrun"), car.synth.pops > 0 ? overrun : 0, 0.05);

    // zonas de sonido por rpm
    set(N.lowShelf.gain, interp(car.bands.lowShelfDb, rpm), 0.05);
    set(N.rasp.gain, interp(car.bands.raspDb, rpm) * (0.5 + 0.5 * load), 0.05);
    set(N.screamBp.frequency, 1500 + 3000 * clamp01((rpm - 6000) / 3000));
    set(N.screamG.gain, interp(car.bands.scream, rpm) * (0.35 + 0.65 * load) * c.scream);

    // aislamiento: más abierto con vueltas y carga
    set(N.lp.frequency, c.lp[0] + (c.lp[1] - c.lp[0]) * (norm * 0.65 + load * 0.35));

    // admisión: a fondo abierta y fuerte, en retención casi cerrada
    set(N.inBp.frequency, 250 + rpm * 0.22);
    set(N.inG.gain, c.intake * (0.12 + load * 0.88) * (0.3 + norm * 0.7), 0.04);
    // mecánico: más presente en retención (sonido seco y metálico)
    set(N.mechG.gain, c.mech * (0.4 + norm) * (0.8 + (1 - load) * 0.5));

    // silbido de engranajes
    const w = car.whine, teeth = w.teeth[gear - 1] || 0;
    set(N.gw.frequency, Math.max(20, rpm / 60 * teeth), 0.02);
    set(N.gwG.gain, teeth ? w.gear * (0.3 + 0.7 * load) * (0.2 + norm) : 0, 0.05);
    set(N.dw.frequency, Math.max(20, speed / car.tire * car.final * w.ringTeeth), 0.05);
    set(N.dwG.gain, w.diff * clamp01(speed / 30), 0.1);

    // turbo
    if (N.tW) {
      const target = clamp01(load * clamp01((rpm - 1800) / 2500));
      this.boost += (target - this.boost) * (target > this.boost ? 0.06 : 0.2);
      set(N.tW.frequency, 2400 + this.boost * 5200 + norm * 1500, 0.08);
      set(N.tWG.gain, c.turbo * this.boost * 0.018, 0.1);
      set(N.tNBp.frequency, 1200 + this.boost * 2500, 0.1);
      set(N.tNG.gain, c.turbo * this.boost * 0.05, 0.1);
      if (this.prevPedal > 0.15 && pedal <= 0.15 && this.boost > 0.35) this._blowOff(this.boost);
    }
    this.prevPedal = pedal;
    popTrigger(this, N.pops, overrun, t);
  }

  // Cambio de marcha. Con `car.brap` (PDK): al subir a fondo, 85 ms cortando 1 de cada 3 explosiones
  // con la voz compensada; las rpm se deslizan solas (Drivetrain). `car.shiftFx`: golpe de embrague opcional.
  shift(dir, { throttle = 0 } = {}) {
    const N = this.N; if (!N) return;
    const t = this.ctx.currentTime;
    const fx = this.car.shiftFx?.[dir === "up" ? "up" : "down"];
    if (fx?.clack) this._burst({ at: t, dur: 0.018, hp: 1800, gain: fx.clack });
    if (fx?.thud) this._thud({ at: t + 0.004, freq: 58, dur: 0.09, gain: fx.thud });
    if (dir === "up" && this.car.brap && throttle > 0.5) {
      const cut = N.eng.parameters.get("cut");
      cut.cancelScheduledValues(t); cut.setValueAtTime(1 / 3, t); cut.setValueAtTime(0, t + 0.085);
      // compensación de volumen con rampas de ~4 ms (un salto instantáneo de ganancia hace chasquido)
      N.vg.gain.cancelScheduledValues(t); N.vg.gain.setTargetAtTime(1 / Math.sqrt(1 - 1 / 3), t, 0.004); N.vg.gain.setTargetAtTime(1, t + 0.085, 0.004);
    }
  }

  // ---------- utilidades ----------
  _noise() {
    if (!this._noiseBuf) {
      const ctx = this.ctx, len = ctx.sampleRate * 2, b = ctx.createBuffer(1, len, ctx.sampleRate), d = b.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this._noiseBuf = b;
    }
    const s = this.ctx.createBufferSource(); s.buffer = this._noiseBuf; s.loop = true; return s;
  }
  _burst({ at, dur, hp, gain }) {
    const ctx = this.ctx, n = this._noise(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    f.type = "highpass"; f.frequency.value = hp;
    g.gain.setValueAtTime(gain, at); g.gain.exponentialRampToValueAtTime(0.0005, at + dur);
    n.connect(f).connect(g).connect(this.N.master); n.start(at); n.stop(at + dur + 0.02);
  }
  _thud({ at, freq, dur, gain }) {
    const ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(freq * 1.6, at); o.frequency.exponentialRampToValueAtTime(freq, at + dur * 0.5);
    g.gain.setValueAtTime(gain, at); g.gain.exponentialRampToValueAtTime(0.0005, at + dur);
    o.connect(g).connect(this.N.master); o.start(at); o.stop(at + dur + 0.02);
  }
  _blowOff(strength) {
    const ctx = this.ctx, t = ctx.currentTime, n = this._noise(), bp = ctx.createBiquadFilter(), g = ctx.createGain();
    bp.type = "bandpass"; bp.Q.value = 1.2; bp.frequency.setValueAtTime(3200, t); bp.frequency.exponentialRampToValueAtTime(900, t + 0.45);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.09 * strength, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0005, t + 0.5);
    n.connect(bp).connect(g).connect(this.N.master); n.start(t); n.stop(t + 0.6);
  }
  // Mismo procesador ejecutado en el hilo principal (cuando no hay AudioWorklet)
  _scriptEngine(opts) {
    const ctx = this.ctx; let Proc = null;
    new Function("AudioWorkletProcessor", "registerProcessor", "sampleRate", window.ENGINE_DSP_SOURCE)(
      class {}, (name, cls) => { Proc = cls; }, ctx.sampleRate);
    const proc = new Proc({ processorOptions: opts });
    const mk = (v, k = 0.35) => ({ value: v, cur: v, k, ev: [],
      setTargetAtTime(x) { this.value = x; }, setValueAtTime(x, at) { this.ev.push([at, x]); }, cancelScheduledValues() { this.ev.length = 0; } });
    const P = { rpm: mk(this.car.idle), load: mk(0), overrun: mk(0), cut: mk(0, 1) };
    const node = ctx.createScriptProcessor(1024, 1, 3), sr = ctx.sampleRate;
    node.onaudioprocess = ev => {
      const ob = ev.outputBuffer, L = ob.getChannelData(0), R = ob.getChannelData(1), M = ob.getChannelData(2);
      const t0 = ev.playbackTime ?? ctx.currentTime;
      for (let o = 0; o < L.length; o += 128) {
        const now = t0 + o / sr, prm = {};
        for (const k in P) {
          const p = P[k];
          while (p.ev.length && p.ev[0][0] <= now) { p.value = p.cur = p.ev.shift()[1]; }
          p.cur += (p.value - p.cur) * p.k; prm[k] = [p.cur];
        }
        proc.process([], [[L.subarray(o, o + 128), R.subarray(o, o + 128), M.subarray(o, o + 128)]], prm);
      }
    };
    node.parameters = { get: k => P[k] };
    node.stop = () => { node.onaudioprocess = null; };
    return node;
  }
}

function clamp01(v) { return Math.max(0, Math.min(1, v)); }
// Ráfagas de petardeo en retención: más seguidas cuanto más fuerte la retención (car.popsFx.rate ráfagas/s a tope)
function popTrigger(self, pops, overrun, t) {
  const dt = self.lastUpdate ? Math.min(0.1, t - self.lastUpdate) : 0; self.lastUpdate = t;
  if (!pops || overrun < 0.08 || t < self.popsUntil) return;
  if (Math.random() < overrun * self.car.popsFx.rate * dt) self.popsUntil = pops.burst(overrun, t + 0.01) + 0.05 + Math.random() * 0.25;
}
function interp(pts, x) {
  if (x <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) if (x <= pts[i][0]) {
    const [x0, y0] = pts[i - 1], [x1, y1] = pts[i]; return y0 + (y1 - y0) * (x - x0) / (x1 - x0);
  }
  return pts[pts.length - 1][1];
}
function satCurve(k) {
  const c = new Float32Array(2048);
  for (let i = 0; i < 2048; i++) { const x = i / 1024 - 1; c[i] = Math.tanh(k * x) / Math.tanh(k); }
  return c;
}
// Respuesta de impulso de un habitáculo pequeño (reflexiones cortas y amortiguadas)
function cabinIR(ctx) {
  const sr = ctx.sampleRate, len = Math.floor(sr * 0.32), b = ctx.createBuffer(2, len, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch); let lp = 0;
    for (let i = 0; i < len; i++) { lp += ((Math.random() * 2 - 1) - lp) * 0.22; d[i] = lp * Math.exp(-(i / sr) / 0.05) * 0.6; }
    [0.0021, 0.0037, 0.0054, 0.0079, 0.011].forEach((t, j) => { d[Math.floor(t * sr) + ch * 7] += (j % 2 ? -0.5 : 0.6) / (j + 1); });
  }
  return b;
}
window.EngineSound = EngineSound;
