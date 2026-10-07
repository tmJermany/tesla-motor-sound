# Integrar el sonido de motor

## Archivos

| Archivo | Qué hace |
|---|---|
| `js/engine-dsp.js` | Síntesis del motor (explosiones de cada cilindro, órdenes armónicos, admisión, ruido mecánico, corte de encendido del "brap"). Va en AudioWorklet; si no se puede (archivo abierto con doble clic) se ejecuta en ScriptProcessor. |
| `js/cars.js` | Datos de cada coche: marchas, rpm, reducciones, curvas de sonido por rpm, filtro de cabina, silbido de la caja. |
| `js/drivetrain.js` | Caja de cambios: de velocidad + acelerador saca rpm, marcha, carga, golpe de gas y cuándo cambia. |
| `js/engine-sound.js` | Grafo de audio de cabina y API `EngineSound`. |
| `tools/medir-cambios.html` | Graba sin tiempo real una aceleración a fondo y una frenada, mide cada cambio y deja escucharlo. |

## Paso a paso

1. Carga los scripts en este orden:
   ```html
   <script src="js/engine-dsp.js"></script>
   <script src="js/cars.js"></script>
   <script src="js/drivetrain.js"></script>
   <script src="js/engine-sound.js"></script>
   ```
2. Crea el audio **dentro de un clic** del usuario:
   ```js
   const ctx = new AudioContext();
   await ctx.resume();
   const engine = new EngineSound(ctx, CARS.gt3rs, { volume: 0.75 });
   await engine.start();
   const drive = new Drivetrain(CARS.gt3rs);
   ```
3. Cada ~25 ms, con la velocidad (m/s) y el acelerador (0-1):
   ```js
   const s = drive.step(dtSegundos, velocidad, acelerador);
   engine.update({ rpm: s.rpm, throttle: s.load, gear: s.gear, speed: velocidad, overrun: s.overrun, pedal: acelerador, blip: s.blip });
   if (s.shift) engine.shift(s.shift, { throttle: acelerador });
   ```
4. Para parar: `engine.stop()`. Volumen: `engine.setVolume(0.5)`.

## GT3 RS: cambios de marcha (como en EL SITIO STI)

El timbre del motor es el sintetizador propio; de la receta del juego se tomaron los **cambios**, que son los que suenan reales:

- **Las rpm no saltan**: caen a la marcha nueva en ~0,1 s (tasa 28/s en el cambio, 12/s el resto, igual que la física del juego a 120 Hz con cualquier paso de tiempo).
- **Subir a fondo** (acelerador > 0,5): "brap" del PDK — durante 85 ms se corta 1 de cada 3 explosiones (repartido, nunca seguidas), la voz sube ×1,22 con rampas de 4 ms y el tono baja un 50 % en cada explosión cortada (`synth.cutDip`). La carga **no** baja en el cambio. Sin tiros, sin golpe.
- **Bajar**: golpe de gas de +280 rpm y carga 0,7 durante 0,16 s.
- **Velocidad máxima por marcha a 9.000 rpm**: 72, 115, 156, 197, 235, 272, 296 km/h.
- **Reducciones** (PDK Sport): soltando, si rpm < 5.000 y tras reducir quedan < 7.600 (una cada ≥ 0,5 s); kickdown (acelerador > 0,85) si rpm < 6.200 y tras reducir < 8.600, saltando marchas.

Añadido para conducir con el Tesla (en el juego siempre se va a fondo):
- A medio gas o crucero sube antes (de 3.300 rpm con acelerador 0 a 8.900 a fondo) y con ≥ 0,6 s entre cambios.
- No sube de marcha soltando, frenando ni mientras el acelerador va bajando.

## Mediciones (tools/medir-cambios.html, guion fijo, varias pruebas)

| Medida | Resultado |
|---|---|
| Hueco de volumen que añade el cambio (objetivo ≤ 1,3 dB) | 0,46–0,83 dB de media |
| Hueco sin cambio (referencia) | 0,1 dB |
| Irregularidad en los 85 ms del brap | ×2,0 (sin brap ×1,1–1,3) |
| Chasquidos (salto entre muestras ÷ percentil 99,9) | ≤ 1,6 (sin cambio ≤ 1,4; un clic real daría ≥ 3) |
| Conducción tipo GPS de 60 s | 23 cambios, sin subir y bajar en bucle |
