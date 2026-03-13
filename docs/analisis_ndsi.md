# Análisis del script NDSI (Landsat 7 L2)

## Resumen
El script original está bien orientado para calcular NDSI anual, pero tiene detalles que pueden afectar la calidad del resultado y la estabilidad en Google Earth Engine.

## Hallazgos principales

1. **Faltan factores de escala de Landsat Collection 2 Level-2**
   - Las bandas `SR_B*` de L2 usan escala y offset.
   - Si no se aplican, el NDSI se calcula con DN escalados y puede distorsionarse.

2. **No hay enmascaramiento QA de nubes/sombras/nieve no deseada**
   - Filtrar solo por `CLOUD_COVER < 50` es insuficiente a nivel píxel.
   - Se recomienda usar `QA_PIXEL` para remover nube, sombra y cirrus.

3. **Uso de `getInfo()` dentro del flujo**
   - `if (ndsiMean.getInfo())` fuerza evaluación cliente-servidor y puede fallar o ralentizar.
   - Es mejor validar con `collection.size()` y una condición de servidor (`ee.Algorithms.If`) o manejarlo en cliente con `evaluate`.

4. **Iteración de años con `getInfo()`**
   - Funciona para rangos pequeños, pero para flujos robustos conviene usar arreglo JS directo para lanzado de exports.

5. **Exportación sin control de imágenes vacías**
   - Si un año no tiene imágenes válidas tras enmascarar, conviene evitar crear tarea de exportación vacía.

## Recomendaciones aplicadas
- Aplicar `scale = 0.0000275` y `offset = -0.2` en bandas SR.
- Incorporar función `maskL7L2` para QA_PIXEL.
- Reemplazar `getInfo()` sobre imágenes por validación de tamaño de colección.
- Mantener exportación anual solo cuando `collection.size() > 0`.
- Conservar clip y visualización por año.

## Archivo de referencia
Se incluye una versión mejorada del script en:
- `scripts/ndsi_landsat7_mejorado.js`
