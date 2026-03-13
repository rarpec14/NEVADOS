// ==============================================
// Cálculo y exportación anual de NDSI (Landsat 7 C2 L2 Surface Reflectance)
// ==============================================
// Nota clave para SR (Surface Reflectance) en LE07/C02/T1_L2:
// - GREEN = SR_B2
// - SWIR1 = SR_B5  (recomendado para NDSI)
// - SWIR2 = SR_B7  (NO es el estándar para NDSI)

var ndsiVis = {
  min: -1,
  max: 1,
  palette: ['blue', 'white', 'green']
};

// Prioridad de AOI: geometry -> roi -> aoi -> extensión actual del mapa
var studyArea = (typeof geometry !== 'undefined' && geometry) ||
  (typeof roi !== 'undefined' && roi) ||
  (typeof aoi !== 'undefined' && aoi) ||
  null;

if (!studyArea) {
  studyArea = ee.Geometry.Rectangle(Map.getBounds(), null, false);
  print('Aviso: no se encontró geometry/roi/aoi. Se usa la extensión actual del mapa.');
}

function maskAndScaleL7SR(image) {
  var qaPixel = image.select('QA_PIXEL');

  // Máscara de nubosidad/sombra en C2 L2
  var dilatedCloud = qaPixel.bitwiseAnd(1 << 1).neq(0);
  var cloud = qaPixel.bitwiseAnd(1 << 3).neq(0);
  var cloudShadow = qaPixel.bitwiseAnd(1 << 4).neq(0);

  // L7: bit 9 en QA_RADSAT = dropped pixel (SLC-off / inválido)
  var dropped = image.select('QA_RADSAT').bitwiseAnd(1 << 9).neq(0);

  var mask = dilatedCloud.or(cloud).or(cloudShadow).or(dropped).not();

  // Escalado oficial SR para Collection 2 Level 2
  var scaled = image.select(['SR_B2', 'SR_B5'], ['GREEN', 'SWIR1'])
    .multiply(0.0000275)
    .add(-0.2)
    .updateMask(mask);

  return scaled.copyProperties(image, image.propertyNames());
}

function calculateNDSI(image) {
  var ndsi = image.normalizedDifference(['GREEN', 'SWIR1']).rename('NDSI');
  return image.addBands(ndsi);
}

function processAndExportYear(year) {
  var start = ee.Date.fromYMD(year, 1, 1);
  var end = start.advance(1, 'year');

  var collection = ee.ImageCollection('LANDSAT/LE07/C02/T1_L2')
    .filterDate(start, end)
    .filterBounds(studyArea)
    .filter(ee.Filter.lt('CLOUD_COVER', 50))
    .map(maskAndScaleL7SR)
    .map(calculateNDSI);

  var count = collection.size();
  print('Año ' + year + ' - imágenes válidas:', count);

  var ndsiYear = ee.Image(
    ee.Algorithms.If(
      count.gt(0),
      collection.select('NDSI').mean().clip(studyArea),
      ee.Image(0).rename('NDSI').clip(studyArea).selfMask()
    )
  );

  Map.addLayer(ndsiYear, ndsiVis, 'NDSI ' + year);

  Export.image.toDrive({
    image: ndsiYear.toFloat(),
    description: 'Export_NDSI_' + year,
    folder: 'Denali',
    fileNamePrefix: 'NDSI_' + year,
    region: studyArea,
    scale: 30,
    maxPixels: 1e13,
    crs: 'EPSG:4326',
    fileFormat: 'GeoTIFF'
  });
}

var startYear = 2000;
var endYear = 2013;

Map.addLayer(studyArea, {color: 'red'}, 'AOI');
Map.centerObject(studyArea, 10);

// Para tareas de exportación en GEE Code Editor, mejor loop cliente simple
for (var year = startYear; year <= endYear; year++) {
  processAndExportYear(year);
}
