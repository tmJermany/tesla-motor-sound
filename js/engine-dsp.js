// Núcleo de síntesis del motor (procesador de audio).
// Se ejecuta como AudioWorklet; si el navegador no lo permite (p. ej. archivo abierto con doble clic)
// EngineSound lo ejecuta dentro de un ScriptProcessor.
//
// Salidas: canal 0 = escape, canal 1 = admisión, canal 2 = mecánico (distribución/taqués)
// Parámetros: rpm, load (0-1, carga efectiva), overrun (0-1, intensidad de petardeo en retención)
window.ENGINE_DSP_SOURCE = String.raw`
class EngineProc extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: "rpm", defaultValue: 900, minValue: 0, maxValue: 12000, automationRate: "k-rate" },
      { name: "load", defaultValue: 0, minValue: 0, maxValue: 1, automationRate: "k-rate" },
      { name: "overrun", defaultValue: 0, minValue: 0, maxValue: 1, automationRate: "k-rate" },
      { name: "cut", defaultValue: 0, minValue: 0, maxValue: 1, automationRate: "k-rate" },
    ];
  }
  constructor(o) {
    super();
    const c = this.c = o.processorOptions;
    this.n = c.fire.length;
    this.angle = 0;
    this.amp = new Float32Array(this.n).fill(1);
    this.lastA = new Float32Array(this.n).fill(720);
    this.exD = Math.max(2, Math.round(sampleRate * c.exDelay)); this.exB = new Float32Array(this.exD); this.exI = 0;
    this.inD = Math.max(2, Math.round(sampleRate * c.inDelay)); this.inB = new Float32Array(this.inD); this.inI = 0;
    // Órdenes del motor: [orden, nivel, inclinación con rpm, sensibilidad a la carga]
    this.ord = c.orders.map(x => x[0]);
    this.ordPh = c.orders.map(() => Math.random());
    this.ordA = new Float32Array(c.orders.length);
    this.ordNorm = 1 / c.orders.reduce((s, x) => s + x[1], 0);
    this.lpN = 0; this.crack = 0; this.crackLp = 0; this.cv = 1; this.cvT = 1; this.click = 0;
    this.cutAcc = 0; this.dip = 0;
    this.dc = [0, 0, 0, 0, 0, 0];
  }
  process(inputs, outputs, params) {
    const out = outputs[0], L = out[0], R = out[1] || out[0], M = out[2] || R;
    const rpm = params.rpm[0], load = params.load[0], ovr = params.overrun[0], cut = params.cut ? params.cut[0] : 0;
    const c = this.c, f1 = rpm / 60, dA = f1 * 360 / sampleRate, dP = f1 / sampleRate;
    const norm = Math.min(1, Math.max(0, (rpm - c.idle) / (c.red - c.idle)));
    const pw = c.pw * (1 - load * 0.3);
    const eventsPerSec = Math.max(1, rpm / 120 * this.n);
    const crackDecay = Math.exp(-1 / (sampleRate * 0.012));
    const clickDecay = Math.exp(-1 / (sampleRate * 0.0007));
    const dipDecay = Math.exp(-eventsPerSec / sampleRate);   // un hueco dura ~1 intervalo entre explosiones
    const nyq = sampleRate * 0.45;
    for (let k = 0; k < this.ord.length; k++) {
      const [, a, tilt, lg] = c.orders[k];
      const f = this.ord[k] * f1;
      this.ordA[k] = f > nyq ? 0 : a * Math.max(0, 1 + tilt * (norm - 0.5)) * (1 - lg + lg * (0.22 + 0.78 * load));
    }
    const air = (rpm / c.red) * (0.15 + 0.85 * load);
    for (let s = 0; s < L.length; s++) {
      this.angle += dA; if (this.angle >= 720) this.angle -= 720;
      const w = Math.random() * 2 - 1;
      this.lpN += (w - this.lpN) * 0.25;
      let pul = 0, inn = 0;
      for (let i = 0; i < this.n; i++) {
        let a = this.angle - c.fire[i]; if (a < 0) a += 720;
        if (a < this.lastA[i]) {
          // corte de encendido repartido (cambio del PDK): nunca muchos huecos seguidos
          let skip = false;
          if (cut > 0) { this.cutAcc += cut; if (this.cutAcc + (Math.random() - 0.5) * 0.5 >= 1) { this.cutAcc -= 1; skip = true; } }
          else this.cutAcc = 0;
          if (skip) this.dip = 1;
          this.amp[i] = skip ? 0 : 1 + (Math.random() * 2 - 1) * c.jitter;
          this.cvT = 1 + (Math.random() * 2 - 1) * c.jitter;
          this.click = 0.5 + Math.random() * 0.5;
          if (c.pops > 0 && ovr > 0.02 && Math.random() < ovr * c.pops / eventsPerSec) this.crack = 0.5 + Math.random() * 1.2;
        }
        this.lastA[i] = a;
        if (a < pw) {
          const x = a / pw, e = Math.sin(Math.PI * x), p = e * e * (1 - 0.65 * x);
          const amp = (c.idleAmp + (1 - c.idleAmp) * load) * this.amp[i] * c.bank[i];
          pul += p * amp * (1 + c.rough * this.lpN * (0.4 + load));
          inn += p * (0.15 + 0.85 * load) * (0.6 + 0.4 * w);
        }
      }
      // tono armónico por órdenes (timbre característico de cada motor)
      let tone = 0;
      for (let k = 0; k < this.ord.length; k++) {
        let ph = this.ordPh[k] + this.ord[k] * dP; if (ph >= 1) ph -= 1; this.ordPh[k] = ph;
        if (this.ordA[k]) tone += this.ordA[k] * Math.sin(6.283185307 * ph);
      }
      this.cv += (this.cvT - this.cv) * 0.004;
      tone *= 1 - (c.cutDip ?? 0.5) * this.dip; this.dip *= dipDecay;
      let ex = (tone * this.ordNorm * c.toneMix + pul * c.pulseMix) * this.cv;
      // petardeo / crepitar en retención
      if (this.crack > 0.001) {
        this.crackLp += (w - this.crackLp) * 0.5;
        ex += this.crack * (this.crackLp * 1.6 + this.lpN * 0.8);
        this.crack *= crackDecay;
      }
      // admisión: pulsos + aire entrando
      inn = inn * 0.8 + w * air * c.hiss;
      // mecánico: taqués/distribución en cada encendido + siseo con las vueltas
      const mech = (this.click * w + w * norm * 0.25) * c.mech;
      this.click *= clickDecay;
      // resonadores (escape y admisión)
      const eo = ex + c.exFb * this.exB[this.exI]; this.exB[this.exI] = eo; this.exI = (this.exI + 1) % this.exD;
      const io = inn + c.inFb * this.inB[this.inI]; this.inB[this.inI] = io; this.inI = (this.inI + 1) % this.inD;
      // quitar continua
      const d = this.dc;
      const y1 = eo - d[0] + 0.995 * d[1]; d[0] = eo; d[1] = y1;
      const y2 = io - d[2] + 0.995 * d[3]; d[2] = io; d[3] = y2;
      const y3 = mech - d[4] + 0.995 * d[5]; d[4] = mech; d[5] = y3;
      L[s] = y1 * 0.5; R[s] = y2 * 0.5; if (M !== R) M[s] = y3 * 0.5;
    }
    return true;
  }
}
registerProcessor("engine-proc", EngineProc);
`;
