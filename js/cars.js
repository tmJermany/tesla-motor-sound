// Perfiles de coche: datos mecánicos + parámetros de sonido ajustables.
//
// GT3 RS (992, 2023): 4.0 bóxer 6 atmosférico, 525 CV a 8.500 rpm, corte 9.000 rpm, PDK 7, una mariposa por cilindro.
//   Cambios de marcha como en EL SITIO STI (receta-motor-gt3rs.md §2 y §5): rpm que se deslizan, "brap" del PDK
//   al subir a fondo, golpe de gas al reducir. El timbre del motor es el sintetizador propio (engine-dsp.js).
// M3 Competition (G80): S58 3.0 biturbo 6 en línea, 510 CV a 6.250 rpm, corte 7.250 rpm
//   M Steptronic 8: 5,00 / 3,20 / 2,14 / 1,72 / 1,31 / 1,00 / 0,82 / 0,64 · grupo 3,15 · trasera 285/30 ZR20
window.CARS = {
  gt3rs: {
    name: "911 GT3 RS", idle: 950, red: 9000, limiter: 9000, upFull: 8900, upLight: 3300,
    // velocidad máxima de cada marcha a 9.000 rpm (km/h)
    gearTop: [72, 115, 156, 197, 235, 272, 296],
    // reducciones del PDK en Sport: soltando y con kickdown (acelerador > 0,85)
    down: { coastRpm: 5000, coastMax: 7600, kickRpm: 6200, kickMax: 8600, kick: 0.85 },
    blipMs: 160, blipRpm: 280, blip: 0.7, shiftMs: 100, maxKmh: 296,
    brap: true,                     // al subir a fondo: 85 ms cortando 1 de cada 3 explosiones
    tire: 2.307, final: 4.27,       // trasera 335/30 ZR21 · grupo (para el silbido del diferencial)
    power: [[0, 0], [1000, 45], [2000, 95], [3000, 150], [4000, 205], [5000, 260], [6000, 310], [7000, 350], [8000, 378], [8500, 386], [9000, 372]],
    synth: {
      // orden de encendido 1-6-2-4-3-5 → bancadas alternas (orden 1,5 típico del bóxer). Fundamental = orden 3 = rpm/60·3 Hz
      fire: [0, 120, 240, 360, 480, 600], bank: [1, 0.8, 1, 0.8, 1, 0.8],
      pw: 60, idleAmp: 0.3, jitter: 0.08, rough: 0.35, pops: 0,   // sin petardeos
      exDelay: 0.00105, exFb: 0.25, inDelay: 0.00058, inFb: 0.45,
      toneMix: 0.65, pulseMix: 0.5, hiss: 0.35, mech: 0.6,
      cutDip: 0.5,   // en el "brap", cuánto baja el tono por cada explosión cortada (medido: hueco 0,83 dB medio / 1,3 máx.; irregularidad ×1,5)
      orders: [[1.5, 0.3, -0.6, 0.5], [3, 1, -0.3, 0.6], [4.5, 0.45, 0.2, 0.7], [6, 0.6, 0.7, 0.8], [7.5, 0.25, 0.9, 0.8],
               [9, 0.5, 1.1, 0.9], [10.5, 0.15, 1.2, 0.9], [12, 0.3, 1.3, 0.9], [15, 0.12, 1.5, 0.9], [18, 0.1, 1.7, 0.9]],
    },
    // Zonas de sonido: 1.000-4.000 graves y zumbido mecánico · 4.000-7.000 rasposo · 7.000-9.000 aullido 1,5-4,5 kHz
    bands: {
      lowShelfDb: [[1000, 7], [4000, 5], [5500, 1], [9000, 0]],
      raspDb: [[3500, 0], [5000, 5], [7000, 6], [9000, 3]],
      scream: [[6500, 0], [7500, 0.45], [9000, 1]],
    },
    // Habitáculo con poco aislamiento: paso bajo 8-12 kHz y resonancia de medios-graves ~400 Hz
    cabin: { drive: 2.2, shelfHz: 160, raspHz: 950, peaks: [[400, 4, 1.0], [1350, 3, 1.4]], lp: [8000, 12000],
             intake: 1.1, exhaust: 1, mech: 0.25, scream: 0.55, wet: 0.14, turbo: 0 },
    // Caja PDK: silbido de engranajes (dientes del piñón de entrada por marcha) y del grupo
    whine: { teeth: [17, 21, 24, 27, 29, 31, 33], gear: 0.012, ringTeeth: 37, diff: 0.004 },
    // sin golpe metálico al cambiar (como en el juego)
  },
  m3: {
    name: "M3 Competition", idle: 700, red: 7200, limiter: 7250, upFull: 7150, upLight: 1900,
    ratios: [5.0, 3.2, 2.143, 1.72, 1.314, 1.0, 0.822, 0.64], final: 3.15, tire: 2.133,
    shiftMs: 110, cutMs: 90, blipMs: 180, maxKmh: 290,
    power: [[0, 0], [1000, 60], [2000, 150], [2750, 245], [4000, 330], [5000, 375], [5500, 395], [6250, 375], [7000, 350], [7250, 340]],
    synth: {
      // orden de encendido 1-5-3-6-2-4 · un turbo por cada 3 cilindros
      fire: [0, 120, 240, 360, 480, 600], bank: [1, 0.93, 1, 0.93, 1, 0.93],
      pw: 120, idleAmp: 0.3, jitter: 0.05, rough: 0.9, pops: 20,
      exDelay: 0.0034, exFb: 0.4, inDelay: 0.0013, inFb: 0.3,
      toneMix: 0.8, pulseMix: 0.4, hiss: 0.15, mech: 0.1,
      // en cabina gran parte del sonido es el sonido activo de BMW por los altavoces: órdenes bajos dominantes
      orders: [[1.5, 0.55, -0.4, 0.6], [3, 1, -0.2, 0.6], [4.5, 0.6, 0, 0.7], [6, 0.3, 0.3, 0.7], [7.5, 0.15, 0.5, 0.8], [9, 0.12, 0.6, 0.8], [12, 0.06, 0.8, 0.8]],
    },
    bands: {
      lowShelfDb: [[700, 7], [4000, 6], [7200, 4]],
      raspDb: [[2000, 2], [5000, 4], [7200, 3]],
      scream: [[5500, 0], [7200, 0.12]],
    },
    cabin: { drive: 3.2, shelfHz: 95, raspHz: 700, peaks: [[95, 4, 1], [440, 3, 1.2], [1200, -3, 1]], lp: [1100, 3600],
             intake: 0.2, exhaust: 1, mech: 0.05, scream: 0.3, wet: 0.22, turbo: 0.7 },
    whine: { teeth: [0, 0, 0, 0, 0, 0, 0, 0], gear: 0, ringTeeth: 41, diff: 0.002 },
    shiftFx: { up: { clack: 0.03, thud: 0.12 }, down: { clack: 0.02, thud: 0.08 } },
  },
};
