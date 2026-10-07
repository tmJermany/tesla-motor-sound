// Caja de cambios simulada: convierte velocidad + acelerador en rpm, marcha y carga del motor.
//
//   const dt = new Drivetrain(CARS.gt3rs);
//   const s = dt.step(segundos, velocidad_m_s, acelerador_0_1);
//   s = { rpm, gear, load, overrun, shift: "up" | "down" | null }
//
// - Subida: corte de encendido (load = 0 durante cutMs) y caída inmediata de rpm a la nueva marcha.
// - Bajada: golpe de gas (load ≥ 0,6 y rpm un poco por encima durante blipMs) antes de engranar.
class Drivetrain {
  constructor(car) { this.setCar(car); }

  setCar(car) {
    this.car = car; this.gear = 1; this.rpm = car.idle;
    this.shiftUntil = 0; this.cutUntil = 0; this.blipUntil = 0; this.dir = 0; this.lastShiftAt = -1e9; this.thrRef = 0;
    this.liftAt = 0; this.prevThr = 0; this.limT = 0;
  }

  rpmAt(gear, speed) { const c = this.car; return speed / c.tire * 60 * c.ratios[gear - 1] * c.final; }

  // GT3 RS (receta §2): rpm = ralentí + v / tope de la marcha · (corte − ralentí); las rpm no saltan en el cambio
  stepGearTop(dt, speed, throttle, now) {
    const c = this.car, n = c.gearTop.length, D = c.down;
    const target = g => c.idle + Math.max(0, speed) / (c.gearTop[g - 1] / 3.6) * (c.red - c.idle);
    let shift = null;
    // a fondo sube a upFull (como el juego); a medio gas o crucero sube antes (en el Tesla casi nunca se va a fondo)
    const up = c.upLight + (c.upFull - c.upLight) * Math.pow(throttle, 1.4);
    const since = now - this.lastShiftAt;
    const down = (g) => {
      this.gear = g; shift = "down"; this.lastShiftAt = now;
      this.shiftUntil = now + c.shiftMs; this.blipUntil = now + c.blipMs;
    };
    if (now >= this.shiftUntil) {
      // no sube soltando o frenando ni mientras el acelerador va bajando (salvo para no pasarse del corte);
      // a medio gas, cambios separados ≥ 0,6 s
      const easing = throttle < this.thrRef - 0.03;          // soltando: el PDK mantiene la marcha
      const canUp = (throttle >= 0.06 && !easing) || target(this.gear) > c.upFull;
      if (this.gear < n && canUp && target(this.gear) >= up && since >= (throttle > 0.8 ? 0 : 600)) {
        this.gear++; shift = "up"; this.lastShiftAt = now; this.shiftUntil = now + c.shiftMs;
      } else if (this.gear > 1) {
        const after = target(this.gear - 1);
        if (throttle > D.kick && this.rpm < D.kickRpm && after < D.kickMax) {
          // kickdown: directo a la marcha más baja que no pase del límite (salta marchas)
          let g2 = this.gear - 1;
          while (g2 > 1 && target(g2) < D.kickRpm && target(g2 - 1) < D.kickMax) g2--;
          down(g2);
        } else if (throttle < 0.06 && this.rpm < D.coastRpm && after < D.coastMax && since >= 500) {
          down(this.gear - 1);                                                   // soltando de verdad (crucero ≈ 0,12)
        } else if (this.rpm < 2000 + throttle * 3000 && after < D.coastMax && since >= 400) {
          down(this.gear - 1);                                                   // se queda sin vueltas para lo que pides
        }
      }
    }
    // referencia lenta del acelerador (~0,25 s) para saber si va bajando (al soltar mantiene la marcha ~1 s)
    this.thrRef += (throttle - this.thrRef) * (1 - Math.exp(-dt / 0.25));
    let goal = target(this.gear);
    if (speed < 3 && throttle > 0) goal = Math.max(goal, c.idle + throttle * 3000);   // casi parado y acelerando
    let blip = 0;
    if (now < this.blipUntil) { goal += c.blipRpm; blip = c.blip; }
    // misma respuesta que la física del juego a 120 Hz (tasa 12/s; 28/s en el cambio), con cualquier dt
    const rate = now < this.shiftUntil ? 28 : 12;
    const k = 1 - Math.pow(1 - Math.min(1, rate / 120), dt * 120);
    this.rpm += (Math.min(c.red + 150, goal) - this.rpm) * k;
    return { rpm: this.rpm, gear: this.gear, load: throttle, blip, overrun: 0, shift };
  }

  step(dt, speed, throttle, now = performance.now()) {
    if (this.car.gearTop) return this.stepGearTop(dt, speed, throttle, now);
    const c = this.car, n = c.ratios.length, clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    let shift = null;
    if (this.prevThr > 0.15 && throttle <= 0.15) this.liftAt = now;
    this.prevThr = throttle;

    if (speed < 1.0) {
      this.gear = 1;
      const target = c.idle + throttle * (c.limiter * 0.42 - c.idle);
      this.rpm += (target - this.rpm) * Math.min(1, dt * 5);
    } else {
      const shifting = now < this.shiftUntil;
      const up = c.upLight + (c.upFull - c.upLight) * Math.pow(throttle, 1.4);
      const down = c.idle * 1.25 + throttle * (c.upFull * 0.42);
      if (!shifting) {
        if (this.gear < n && this.rpmAt(this.gear, speed) > up) {
          this.gear++; this.dir = 1; shift = "up";
          this.shiftUntil = now + c.shiftMs * 2.5;
          if (throttle > 0.3) this.cutUntil = now + c.cutMs;
        } else if (this.gear > 1 && this.rpmAt(this.gear, speed) < down && this.rpmAt(this.gear - 1, speed) < c.upFull * 0.97) {
          this.gear--; this.dir = -1; shift = "down";
          this.shiftUntil = now + c.shiftMs * 3;
          this.blipUntil = now + c.blipMs;
        }
      }
      let target = Math.max(this.rpmAt(this.gear, speed), c.idle);
      if (this.gear === 1 && speed < 4) target = Math.max(target, c.idle + throttle * 2600); // embrague patinando al salir
      if (now < this.blipUntil) target *= 1.08;                                             // golpe de gas al reducir
      const follow = now < this.shiftUntil ? 1000 / c.shiftMs : 14;
      this.rpm += (target - this.rpm) * Math.min(1, dt * follow);
    }

    // limitador
    let limiterCut = false;
    if (this.rpm >= c.limiter - 30 && throttle > 0.5) {
      this.limT += dt; limiterCut = (this.limT % 0.09) < 0.045;
      if (limiterCut) this.rpm -= 5000 * dt;
    }
    this.rpm = clamp(this.rpm, c.idle * 0.9, c.limiter + 40);

    const cut = now < this.cutUntil || limiterCut;
    let load = cut ? 0 : throttle;
    if (now < this.blipUntil) load = Math.max(load, 0.6);

    const norm = clamp((this.rpm - c.idle) / (c.red - c.idle), 0, 1);
    let overrun = 0;
    if (throttle < 0.1 && norm > 0.2) overrun = Math.exp(-(now - this.liftAt) / 1800) * clamp(norm * 1.4, 0, 1);
    if (this.dir < 0 && now < this.shiftUntil) overrun = Math.max(overrun, 0.6);
    if (cut && throttle > 0.5) overrun = Math.max(overrun, 0.9);

    return { rpm: this.rpm, gear: this.gear, load, overrun, blip: 0, shift };
  }
}
window.Drivetrain = Drivetrain;
