// Petardeos / crepitar del escape: explosiones prerenderizadas y ráfagas irregulares.
// Cada explosión = chasquido inicial + estampido (ruido por dos resonancias del escape) + golpe grave, saturado.
//
//   const pops = new Pops(ctx, destino, { level: 1 });
//   pops.burst(intensidad)   // 0-1; devuelve cuándo termina la ráfaga (tiempo del AudioContext)
class Pops {
  constructor(ctx, dest, opts = {}) {
    this.ctx = ctx; this.dest = dest; this.level = opts.level ?? 1;
    this.small = []; this.big = [];
    for (let i = 0; i < 6; i++) this.small.push(this._make(false));
    for (let i = 0; i < 3; i++) this.big.push(this._make(true));
  }

  _make(big) {
    const sr = this.ctx.sampleRate, len = Math.floor(sr * (big ? 0.4 : 0.2));
    const b = this.ctx.createBuffer(1, len, sr), d = b.getChannelData(0);
    const bp = (f, q) => {
      const w = 2 * Math.PI * f / sr, al = Math.sin(w) / (2 * q), a0 = 1 + al;
      return { b0: al / a0, b2: -al / a0, a1: -2 * Math.cos(w) / a0, a2: (1 - al) / a0, x1: 0, x2: 0, y1: 0, y2: 0 };
    };
    const run = (s, x) => { const y = s.b0 * x + s.b2 * s.x2 - s.a1 * s.y1 - s.a2 * s.y2; s.x2 = s.x1; s.x1 = x; s.y2 = s.y1; s.y1 = y; return y; };
    const r1 = bp(170 + Math.random() * 260, 2.5), r2 = bp(900 + Math.random() * 1700, 1.6), r3 = bp(3200 + Math.random() * 1500, 1.2);
    const decay = big ? 0.055 + Math.random() * 0.03 : 0.01 + Math.random() * 0.016;
    const thumpF = 50 + Math.random() * 35, thumpT = big ? 0.09 : 0.03, clickN = Math.floor(sr * 0.0007);
    let peak = 0;
    for (let i = 0; i < len; i++) {
      const t = i / sr, env = Math.exp(-t / decay), n = (Math.random() * 2 - 1) * env;
      let v = run(r1, n) * 3.2 + run(r2, n) * 1.3 + run(r3, n) * (big ? 0.6 : 0.9) + n * 0.3;     // estampido
      v += Math.sin(2 * Math.PI * thumpF * t * (1 - Math.min(0.5, t * 3))) * Math.exp(-t / thumpT) * (big ? 1.1 : 0.55); // golpe grave
      if (i < clickN) v += (1 - i / clickN) * (big ? 1.6 : 1) * (i % 2 ? -1 : 1);                 // chasquido
      if (big && t > 0.012) v += (Math.random() * 2 - 1) * Math.exp(-(t - 0.012) / 0.12) * 0.12;  // cola del estallido
      d[i] = Math.tanh(v * (big ? 2.4 : 1.7));
      peak = Math.max(peak, Math.abs(d[i]));
    }
    for (let i = 0; i < len; i++) d[i] /= peak || 1;
    // fundido final para que no corte
    const fade = Math.floor(sr * 0.01);
    for (let i = 0; i < fade; i++) d[len - 1 - i] *= i / fade;
    return b;
  }

  burst(intensity = 1, at = this.ctx.currentTime) {
    const n = 2 + Math.floor(Math.random() * (3 + 6 * intensity));
    let t = at;
    for (let i = 0; i < n; i++) {
      const big = Math.random() < 0.1 + 0.15 * intensity;
      const list = big ? this.big : this.small;
      const s = this.ctx.createBufferSource(); s.buffer = list[Math.floor(Math.random() * list.length)];
      s.playbackRate.value = 0.85 + Math.random() * 0.3;
      const g = this.ctx.createGain();
      g.gain.value = this.level * (big ? 0.95 : 0.25 + Math.random() * 0.5) * (0.55 + 0.45 * intensity);
      s.connect(g).connect(this.dest); s.start(t);
      t += big ? 0.08 + Math.random() * 0.1 : 0.018 + Math.random() * 0.09;
    }
    return t;
  }
}
window.Pops = Pops;
