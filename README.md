# Tesla Motor Sound

Web para el navegador del Tesla Model 3 que reproduce sonido de motor de combustión según la velocidad del coche (GPS).

## Coches
- **Porsche 911 GT3 RS (992)**: 4.0 bóxer 6 atmosférico, corte a 9.000 rpm, PDK de 7 marchas (3,75 / 2,38 / 1,72 / 1,34 / 1,11 / 0,96 / 0,84, grupo 4,27). Tablero con cuentavueltas amarillo.
- **BMW M3 Competition (G80)**: S58 3.0 biturbo 6 en línea, corte a 7.250 rpm, 8 marchas (5,00 / 3,20 / 2,14 / 1,72 / 1,31 / 1,00 / 0,82 / 0,64, grupo 3,15). Tablero estilo M.

## Uso
1. Abre la web en el navegador del Tesla (tiene que ser por HTTPS para que funcione el GPS).
2. Elige coche y pulsa **Arrancar motor**. Acepta el permiso de ubicación.
3. Conduce. El modo **Prueba** sirve para oírlo aparcado.

## Probar en el PC
```
python -m http.server 8000 --directory D:\TeslaMotorSound
```
y abre http://localhost:8000
