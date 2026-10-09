// Motor con GRABACIÓN REAL de cabina.
// La grabación es una aceleración a fondo en una sola marcha (p. ej. 3.000 → 9.000 rpm). Al cargarla se detectan
// sus rpm en cada instante (frecuencia de explosión = rpm/60 · cilindros/2 y sus armónicos, con seguimiento continuo).
// Para sonar a X rpm se reproducen "granos" de 80 ms sacados del punto de la grabación que está a X rpm,
// solapados ×3 con ventana Hann y desplazados en ciclos enteros del motor (sin efecto "flanger").
// Fuera del tramo grabado se corrige el tono; por debajo (ralentí) se mezcla con el sintetizado.
//
// Misma API que EngineSound: start, stop, update, shift, setVolume, output.

window.GRAIN_SRC = String.raw`
// Una sola voz que recorre la grabación (sin granos superpuestos, que suenan "a túnel"):
// lee hacia delante corrigiendo el tono con las rpm grabadas en ese punto, y cuando se aleja del punto
// que corresponde a las rpm pedidas salta un número ENTERO de ciclos del motor con un fundido de 12 ms.
class GrainProc extends AudioWorkletProcessor {
  static get parameterDescriptors() { return [
    { name: "rpm", defaultValue: 3000, minValue: 0, maxValue: 12000, automationRate: "k-rate" },
    { name: "tol", defaultValue: 800, minValue: 100, maxValue: 4000, automationRate: "k-rate" },   // rpm de diferencia antes de saltar
  ]; }
  constructor() { super(); this.d = null; this.pos = -1; this.old = null; this.fade = 0; if (this.port) this.port.onmessage = e => this.setData(e.data); }
  setData(m) { this.d = m.data; this.k = m.sr / sampleRate; this.tab = m.tab; this.r0 = m.r0; this.step = m.step; this.rmin = m.rmin; this.rmax = m.rmax;
               // fundido largo: el ruido de fondo de la grabación (rodillo del banco, sala) no coincide en el empalme
               // y con fundidos cortos se oye como un corte; con 120 ms se desliza
               this.srcSr = m.sr; this.XF = Math.round(0.12 * sampleRate); this.tr = 0; this.lastR = -1; }
  // rpm grabadas en una posición (la tabla sube con la posición en una aceleración y baja en una retención)
  rpmAt(p) {
    const t = this.tab, n = t.length, asc = t[n - 1] >= t[0], top = this.r0 + (n - 1) * this.step;
    if (asc ? p <= t[0] : p >= t[0]) return this.r0;
    if (asc ? p >= t[n - 1] : p <= t[n - 1]) return top;
    let a = 0, b = n - 1;
    while (b - a > 1) { const m = (a + b) >> 1; if ((t[m] <= p) === asc) a = m; else b = m; }
    return this.r0 + (a + (p - t[a]) / ((t[b] - t[a]) || 1)) * this.step;
  }
  read(p) { const d = this.d, x0 = Math.floor(p), fr = p - x0; return x0 >= 0 && x0 + 1 < d.length ? d[x0] + (d[x0 + 1] - d[x0]) * fr : 0; }
  // Empalme sin costura: busca alrededor de "guess" (±medio ciclo) el punto cuya forma de onda más se parece
  // a lo que seguiría sonando desde "from" (correlación normalizada, primero gruesa y luego fina)
  splice(from, guess, cyc) {
    const d = this.d, n = d.length, L = Math.round(0.03 * this.srcSr), S = Math.round(cyc / 2);
    const f0 = Math.round(from), g0 = Math.round(guess);
    const corr = (o, st) => {
      let s = 0, e = 0;
      for (let i = 0; i < L; i += st) {
        const ia = f0 + i, ib = g0 + o + i;
        if (ia < 0 || ib < 0 || ia >= n || ib >= n) continue;
        s += d[ia] * d[ib]; e += d[ib] * d[ib];
      }
      return s / Math.sqrt(e + 1e-9);
    };
    let best = -Infinity, bo = 0;
    for (let o = -S; o <= S; o += 4) { const c = corr(o, 4); if (c > best) { best = c; bo = o; } }
    let b2 = -Infinity, bo2 = bo;
    for (let o = bo - 4; o <= bo + 4; o++) { const c = corr(o, 1); if (c > b2) { b2 = c; bo2 = o; } }
    return g0 + bo2 + (from - f0);
  }
  posFor(r) {
    const i = (r - this.r0) / this.step, i0 = Math.max(0, Math.min(this.tab.length - 1, Math.floor(i)));
    const i1 = Math.min(this.tab.length - 1, i0 + 1), f = Math.max(0, Math.min(1, i - i0));
    return this.tab[i0] + (this.tab[i1] - this.tab[i0]) * f;
  }
  process(_in, outputs, params) {
    const out = outputs[0][0];
    if (!this.d) { out.fill(0); return true; }
    const rpm = Math.max(300, params.rpm[0]), rr = Math.min(this.rmax, Math.max(this.rmin, rpm)), tol = params.tol[0];
    if (this.lastR < 0) this.lastR = rpm;
    this.tr = this.tr * 0.9 + (rpm - this.lastR) * 0.1; this.lastR = rpm;   // tendencia de las rpm
    if (this.pos < 0) this.pos = this.posFor(rr);
    const recR = Math.max(300, this.rpmAt(this.pos));
    const rate = this.k * rpm / recR;                      // tono exacto: rpm pedidas ÷ rpm grabadas en este punto
    const cyc = this.srcSr * 120 / recR;                    // un ciclo completo del motor (2 vueltas) en muestras
    // solo salta si el timbre grabado se aleja mucho de las rpm pedidas (o se acaba la grabación);
    // bajando de vueltas salta a un punto por debajo, para tener margen leyendo hacia delante
    const end = this.d.length - 0.08 * this.srcSr;
    if (this.old === null && (Math.abs(recR - rr) > tol || this.pos > end)) {
      const goal = Math.min(this.rmax, Math.max(this.rmin, this.tr < -0.5 ? rr - 0.6 * tol : rr));
      const m = Math.round((Math.min(this.posFor(goal), end - 0.3 * this.srcSr) - this.pos) / cyc);
      if (m !== 0) { this.old = this.pos; this.pos = this.splice(this.pos, this.pos + m * cyc, cyc); this.fade = 0; }
    }
    // la voz que se va lleva su propia corrección de tono: las dos suenan a las mismas rpm y no "baten"
    const rateNew = this.k * rpm / Math.max(300, this.rpmAt(this.pos));
    const rateOld = this.old !== null ? this.k * rpm / Math.max(300, this.rpmAt(this.old)) : rateNew;
    for (let j = 0; j < out.length; j++) {
      let v = this.read(this.pos);
      if (this.old !== null) {
        const x = this.fade / this.XF;                     // las dos ondas coinciden: fundido lineal
        v = v * x + this.read(this.old) * (1 - x);
        this.old += rateOld;
        if (++this.fade >= this.XF) this.old = null;
      }
      this.pos += rateNew;
      out[j] = v;
    }
    return true;
  }
}
registerProcessor("grain-proc", GrainProc);
`;

const recModes = new WeakMap();

class RecordedEngine {
  constructor(ctx, car, opts = {}) {
    this.ctx = ctx; this.car = car; this.volume = opts.volume ?? 0.75;
    this.synth = new EngineSound(ctx, car, { volume: 0, noPops: true });   // ralentí y respaldo
    this.N = null; this.error = null; this.info = null; this.popsUntil = 0; this.lastUpdate = 0;
  }

  static cache = new Map();

  // Carga y analiza la grabación (una vez por archivo)
  static async load(ctx, rec) {
    if (RecordedEngine.cache.has(rec.file)) return RecordedEngine.cache.get(rec.file);
    const res = await fetch(rec.file);
    if (!res.ok) throw new Error(`no encontré ${rec.file}`);
    const buf = await ctx.decodeAudioData(await res.arrayBuffer());
    const r = RecordedEngine.analyze(buf, rec);
    RecordedEngine.cache.set(rec.file, r);
    return r;
  }

  // Detecta las rpm de la grabación y arma la tabla rpm → posición
  static analyze(buf, rec, cyl = 6) {
    const sr0 = buf.sampleRate, n0 = buf.length, ch = buf.numberOfChannels;
    const data = new Float32Array(n0);
    for (let c = 0; c < ch; c++) { const x = buf.getChannelData(c); for (let i = 0; i < n0; i++) data[i] += x[i] / ch; }
    let pk = 0; for (let i = 0; i < n0; i++) pk = Math.max(pk, Math.abs(data[i]));
    if (pk > 0) for (let i = 0; i < n0; i++) data[i] *= 0.8 / pk;
    // a ~22 kHz para el análisis
    const dec = sr0 >= 44100 ? 2 : 1, sr = sr0 / dec, m = Math.floor(n0 / dec), x = new Float32Array(m);
    for (let i = 0; i < m; i++) { let s = 0; for (let k = 0; k < dec; k++) s += data[i * dec + k]; x[i] = s / dec; }
    const N = 8192, hop = 1024, win = new Float32Array(N);
    for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1));
    const lo = rec.rpmLo * 0.85, hi = rec.rpmHi * 1.06, stepR = 10, nc = Math.floor((hi - lo) / stepR) + 1;
    const t0 = Math.floor((rec.t0 ?? 0) * sr), t1 = Math.min(m, Math.floor((rec.t1 ?? m / sr) * sr));
    const frames = [], scores = [];
    const re = new Float64Array(N), im = new Float64Array(N), mag = new Float32Array(N / 2);
    for (let s = t0; s + N <= t1; s += hop) {
      for (let i = 0; i < N; i++) { re[i] = x[s + i] * win[i]; im[i] = 0; }
      fft(re, im);
      for (let i = 0; i < N / 2; i++) mag[i] = Math.sqrt(re[i] * re[i] + im[i] * im[i]);
      const sc = new Float32Array(nc), bin = sr / N;
      // media de los múltiplos de medio orden de encendido (órdenes 1,5 · 3 · 4,5 … en un 6 cilindros):
      // a la mitad de rpm la mitad de esos puntos caen en huecos y la media baja
      for (let c = 0; c < nc; c++) {
        const f = (lo + c * stepR) / 60 * cyl / 4;
        let on = 0, cnt = 0;
        for (let k = 1; k <= 12; k++) {
          const b = Math.round(k * f / bin);
          if (b > 1 && b + 1 < N / 2) { on += Math.max(mag[b - 1], mag[b], mag[b + 1]); cnt++; }
        }
        sc[c] = cnt ? on / cnt : 0;
      }
      let mx = 0; for (let c = 0; c < nc; c++) mx = Math.max(mx, sc[c]);
      if (mx > 0) for (let c = 0; c < nc; c++) sc[c] /= mx;
      frames.push((s + N / 2) * dec); scores.push(sc);
    }
    if (frames.length < 4) throw new Error("la grabación es demasiado corta");
    // seguimiento: máxima puntuación con cambios suaves (aceleración −200…+400 rpm por cuadro; retención al revés)
    const fall = !!rec.falling;
    const F = frames.length, dn = fall ? 40 : 20, up = fall ? 20 : 40, best = scores.map(() => new Float32Array(nc)), from = scores.map(() => new Int16Array(nc));
    // guía: la grabación va de rpmLo a rpmHi (o al revés en retención); castiga alejarse más de 1.500 rpm de esa recta
    for (let f = 0; f < F; f++) {
      const q = fall ? 1 - f / (F - 1) : f / (F - 1), exp = rec.rpmLo + (rec.rpmHi - rec.rpmLo) * q;
      for (let c = 0; c < nc; c++) scores[f][c] -= 0.6 * Math.max(0, Math.abs(lo + c * stepR - exp) / 1500 - 1);
    }
    best[0].set(scores[0]);
    for (let f = 1; f < F; f++) for (let c = 0; c < nc; c++) {
      let bv = -1e9, bc = c;
      for (let p = Math.max(0, c - up); p <= Math.min(nc - 1, c + dn); p++) {
        const v = best[f - 1][p] - 0.002 * Math.abs(c - p);
        if (v > bv) { bv = v; bc = p; }
      }
      best[f][c] = bv + scores[f][c]; from[f][c] = bc;
    }
    let c = 0; for (let k = 1; k < nc; k++) if (best[F - 1][k] > best[F - 1][c]) c = k;
    const rpm = new Float32Array(F);
    for (let f = F - 1; f >= 0; f--) { rpm[f] = lo + c * stepR; c = from[f][c]; }
    // suavizado y subida monótona (para buscar la posición de cada rpm)
    const sm = new Float32Array(F);
    for (let f = 0; f < F; f++) { let s = 0, k = 0; for (let j = Math.max(0, f - 3); j <= Math.min(F - 1, f + 3); j++) { s += rpm[j]; k++; } sm[f] = s / k; }
    for (let f = 1; f < F; f++) sm[f] = fall ? Math.min(sm[f], sm[f - 1]) : Math.max(sm[f], sm[f - 1]);
    // ordenado por rpm de menor a mayor (en una retención se recorre al revés)
    const rs = fall ? Array.from(sm).reverse() : Array.from(sm), ps = fall ? frames.slice().reverse() : frames;
    const rmin = Math.max(rec.rpmLo * 0.9, rs[0]), rmax = Math.min(rec.rpmHi * 1.03, rs[F - 1]);
    const step = 20, tab = new Float32Array(Math.floor((rmax - rmin) / step) + 1);
    let f = 0;
    for (let i = 0; i < tab.length; i++) {
      const R = rmin + i * step;
      while (f < F - 1 && rs[f + 1] < R) f++;
      const a = rs[f], b = rs[Math.min(F - 1, f + 1)], fr = b > a ? Math.min(1, Math.max(0, (R - a) / (b - a))) : 0;
      tab[i] = ps[f] + (ps[Math.min(F - 1, f + 1)] - ps[f]) * fr;
    }
    return { data, sr: sr0, tab, r0: rmin, step, rmin, rmax, cyl, track: { t: frames.map(s => s / sr0), rpm: Array.from(rpm) } };
  }

  static async prepare(ctx) {
    if (recModes.has(ctx)) return recModes.get(ctx);
    let mode = "script";
    try {
      if (ctx.audioWorklet) {
        await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([window.GRAIN_SRC], { type: "application/javascript" })));
        mode = "worklet";
      }
    } catch { mode = "script"; }
    recModes.set(ctx, mode);
    return mode;
  }

  async start() {
    let R;
    try { R = await RecordedEngine.load(this.ctx, this.car.recording); }
    catch (e) { this.error = e.message; this.synth.volume = this.volume; await this.synth.start(); return; }
    this.info = `grabación ${Math.round(R.rmin)}–${Math.round(R.rmax)} rpm`;
    const ctx = this.ctx, mode = await RecordedEngine.prepare(ctx), t = ctx.currentTime;
    const msg = { data: R.data, sr: R.sr, tab: R.tab, r0: R.r0, step: R.step, rmin: R.rmin, rmax: R.rmax, grain: 0.08, cyl: R.cyl };
    let node;
    if (mode === "worklet") {
      node = new AudioWorkletNode(ctx, "grain-proc", { numberOfInputs: 0, outputChannelCount: [1] });
      node.port.postMessage(msg);
    } else node = this._scriptNode(msg);

    // cadena: protección de graves para los altavoces del coche → apagado en retención → nivel por carga
    const hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 35; hp.Q.value = 0.7;
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 12000; lp.Q.value = 0.5;
    const chop = ctx.createGain(); chop.gain.value = 1;          // "brap" del cambio
    const load = ctx.createGain(); load.gain.value = 0;
    const master = ctx.createGain(); master.gain.value = 0; master.gain.setTargetAtTime(1, t, 0.3);
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -12; comp.ratio.value = 3; comp.attack.value = 0.005; comp.release.value = 0.2;
    // más fuerte (+5 dB) con limitador para no saturar los altavoces del coche
    const boost = ctx.createGain(); boost.gain.value = 1.8;
    const lim = ctx.createDynamicsCompressor(); lim.threshold.value = -1.5; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.001; lim.release.value = 0.06;
    const vol = ctx.createGain(); vol.gain.value = this.volume;
    const mainG = ctx.createGain(); mainG.gain.value = 1;
    node.connect(mainG).connect(hp).connect(lp).connect(chop).connect(load).connect(master).connect(comp).connect(boost).connect(lim).connect(vol).connect(ctx.destination);
    // ralentí real: bucle sin costura, empieza en un punto al azar; entra directo a "chop" (sin el filtro de carga)
    let idle = null, idleG = null;
    if (this.car.idleRec) {
      try {
        const ib = await RecordedEngine.loadBuffer(ctx, this.car.idleRec.file);
        idle = ctx.createBufferSource(); idle.buffer = ib; idle.loop = true;
        idleG = ctx.createGain(); idleG.gain.value = 0;
        idle.connect(idleG).connect(chop);
        idle.start(t, Math.random() * ib.duration);
      } catch { idle = null; }
    }
    let pops = null;
    if (this.car.popsFx) {
      const plim = ctx.createDynamicsCompressor(); plim.threshold.value = -4; plim.ratio.value = 20; plim.attack.value = 0.001; plim.release.value = 0.08;
      const pg = ctx.createGain(); pg.gain.value = this.car.popsFx.level;
      pg.connect(plim).connect(vol);
      pops = new Pops(ctx, pg);
    }
    this.N = { node, mainG, lp, chop, load, master, vol, pops, R, idle, idleG };
    this.wob = 0;
  }

  static async loadBuffer(ctx, file) {
    if (RecordedEngine.cache.has(file)) return RecordedEngine.cache.get(file);
    const res = await fetch(file);
    if (!res.ok) throw new Error(`no encontré ${file}`);
    const b = await ctx.decodeAudioData(await res.arrayBuffer());
    RecordedEngine.cache.set(file, b);
    return b;
  }

  update(p) {
    const { rpm, throttle = 0, blip = 0, overrun = 0 } = p;
    const N = this.N;
    if (!N) { this.synth.update(p); return; }
    const t = this.ctx.currentTime, ld = Math.max(throttle, blip);
    this.lastRpm = rpm;
    const k = 1;
    // ralentí real hasta ~1.350 rpm; entre 1.350 y 1.900 se pasa a la grabación de aceleración (fundido de igual potencia)
    if (N.idle) {
      const ir = this.car.idleRec.rpm, w = Math.max(0, Math.min(1, (1900 - rpm) / (1900 - ir)));
      this.wob = Math.max(-0.012, Math.min(0.012, this.wob * 0.98 + (Math.random() - 0.5) * 0.003));   // ralentí que "respira"
      N.idle.playbackRate.setTargetAtTime(Math.max(1, rpm / ir) * (1 + this.wob), t, 0.05);
      N.idleG.gain.setTargetAtTime(Math.sin(w * Math.PI / 2), t, 0.05);
      N.mainG.gain.setTargetAtTime(Math.cos(w * Math.PI / 2), t, 0.05);
    }
    N.node.parameters.get("rpm").setTargetAtTime(rpm, t, 0.015);
    // empalmes pequeños (cada ~300 rpm de diferencia acelerando, ~600 soltando): cada uno casi no cambia el fondo
    N.node.parameters.get("tol").setTargetAtTime(300 + 300 * (1 - ld), t, 0.1);
    // la grabación es a fondo: soltando, más bajo y más apagado
    N.load.gain.setTargetAtTime(k * (0.5 + 0.5 * Math.pow(ld, 0.8)), t, 0.06);
    N.lp.frequency.setTargetAtTime(4500 + 9500 * Math.pow(ld, 0.6), t, 0.08);   // soltando, solo un poco más apagado
    popTrigger(this, N.pops, overrun, t);
  }

  shift(dir, o = {}) {
    this.synth.shift(dir, o);
    const N = this.N; if (!N) return;
    const t = this.ctx.currentTime, g = N.chop.gain, feel = this.car.shiftFeel ?? 1, thr = o.throttle ?? 0;
    g.cancelScheduledValues(t);
    // Subir a fondo (PDK): la caída de rpm la hace la caja (~0,1 s). Encima, sin huecos de silencio:
    //  · un solo bajón suave de par (~−3,5 dB, 60 ms)
    //  · el "brap": vibración al ritmo de 1 de cada 3 explosiones (rpm/20/3 Hz) durante 85 ms
    if (dir === "up" && this.car.brap && thr > 0.5) {
      const ctx = this.ctx, f = Math.max(30, (this.lastRpm || 8000) / 20 / 3);
      g.setTargetAtTime(0.67, t, 0.008); g.setTargetAtTime(1 + 0.05 * feel, t + 0.06, 0.025); g.setTargetAtTime(1, t + 0.16, 0.05);
      const osc = ctx.createOscillator(), og = ctx.createGain();
      osc.type = "square"; osc.frequency.value = f;
      og.gain.setValueAtTime(0, t); og.gain.linearRampToValueAtTime(0.14 * feel, t + 0.01);
      og.gain.setValueAtTime(0.14 * feel, t + 0.07); og.gain.linearRampToValueAtTime(0, t + 0.09);
      osc.connect(og).connect(g); osc.start(t); osc.stop(t + 0.1);
    } else if (dir === "down") {
      // golpe de gas al reducir: sube el volumen con las rpm
      g.setTargetAtTime(1 + 0.15 * feel, t, 0.02); g.setTargetAtTime(1, t + 0.22, 0.08);
    }
  }

  setVolume(v) {
    this.volume = v;
    if (this.N) this.N.vol.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02); else this.synth.setVolume(v);
  }

  get output() { return this.N?.vol ?? this.synth.output; }

  stop() {
    this.synth.stop();
    const N = this.N; if (!N) return; this.N = null;
    N.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
    setTimeout(() => { try { N.node.stop?.(); N.node.disconnect(); } catch {} try { N.idle?.stop(); } catch {} try { N.vol.disconnect(); } catch {} }, 400);
  }

  _scriptNode(msg) {
    const ctx = this.ctx; let Proc = null;
    new Function("AudioWorkletProcessor", "registerProcessor", "sampleRate", window.GRAIN_SRC)(
      class { constructor() { this.port = null; } }, (name, cls) => { Proc = cls; }, ctx.sampleRate);
    const proc = new Proc(); proc.setData(msg);
    const mk = v => ({ value: v, cur: v, setTargetAtTime(x) { this.value = x; } });
    const P = { rpm: mk(3000), tol: mk(800) };
    const node = ctx.createScriptProcessor(1024, 1, 1);
    node.onaudioprocess = ev => {
      const out = ev.outputBuffer.getChannelData(0);
      for (let o = 0; o < out.length; o += 128) {
        for (const k in P) P[k].cur += (P[k].value - P[k].cur) * 0.35;
        proc.process([], [[out.subarray(o, o + 128)]], { rpm: [P.rpm.cur], tol: [P.tol.cur] });
      }
    };
    node.parameters = { get: k => P[k] };
    node.stop = () => { node.onaudioprocess = null; };
    return node;
  }
}

// FFT compleja radix-2 en el sitio
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let j = 0; j < len / 2; j++) {
        const a = i + j, b = a + len / 2, tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
}
window.RecordedEngine = RecordedEngine;
