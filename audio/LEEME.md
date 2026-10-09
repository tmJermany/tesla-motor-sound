# Grabaciones de cabina

Cada coche puede sonar con una grabación real (`recording` en `js/cars.js`). Si el archivo no está, suena el sintetizado.

- `gt3rs.wav`: tirada en banco 1.650 → 8.850 rpm, segundos 366,0–383,3 de
  "Porsche 992 GT3 RS feat. FULL Akrapovic Limited Edition exhaust 340km h DYNO Pulls & Engine Sounds" (archivo del usuario).
- `m3.wav`: falta. Hace falta una aceleración a fondo en UNA sola marcha (sin cambios), de unas 2.000 a 7.200 rpm, sin música ni voces.
  Después se activa la línea `recording` del M3 en `js/cars.js`.

La web detecta sola las rpm de la grabación; `rpmLo` y `rpmHi` son las rpm aproximadas del principio y del final.
`gt3rs-original.mp3` es el vídeo completo: no hace falta subirlo a GitHub.
