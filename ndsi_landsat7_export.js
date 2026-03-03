// ==============================================
// Cálculo y exportación anual de NDSI (Cayambe / AOI)
// ==============================================
// ¿Por qué salían franjas? Landsat 7 tiene falla SLC-off (desde 2003),
// lo que genera líneas sin datos. Para reducir ese efecto:
// 1) se enmascaran pixeles inválidos (QA_RADSAT),
// 2) se fusionan sensores L5/L7/L8,
// 3) se usa ventana temporal móvil para rellenar huecos.

// =====================================================
// 1) POLÍGONO DE INTERÉS (ejemplo: Cayambe)
// =====================================================
var useCayambePolygon = true;
var cayambePolygon = ee.Geometry.Polygon([
  [
    [-78.035, 0.085],
    [-77.965, 0.085],
    [-77.965, 0.005],
    [-78.035, 0.005],
    [-78.035, 0.085]
  ]
]);

// AOI: Cayambe -> geometry/roi/aoi -> bounds del mapa
var studyArea = useCayambePolygon
  ? cayambePolygon
  : ((typeof geometry !== 'undefined' && geometry) ||
      (typeof roi !== 'undefined' && roi) ||
      (typeof aoi !== 'undefined' && aoi) ||
      null);

if (!studyArea) {
  var bounds = Map.getBounds(); // [west, south, east, north]
  studyArea = ee.Geometry.Rectangle(bounds, null, false);
  print('Aviso: AOI no definida. Usando extensión actual del mapa.');
}

var ndsiVis = {min: -1, max: 1, palette: ['blue', 'white', 'green']};
var snowThreshold = 0.4;
var snowVis = {min: 0, max: 1, palette: ['000000', '00FFFF']};

// Ventana temporal para reducir franjas (en años alrededor del año objetivo)
var temporalPaddingYears = 1; // 1 => usa [año-1, año+1)

function maskAndScaleL57(image) {
  var qa = image.select('QA_PIXEL');
  var cloudShadow = qa.bitwiseAnd(1 << 4).neq(0);
  var cloud = qa.bitwiseAnd(1 << 3).neq(0);
  var dilatedCloud = qa.bitwiseAnd(1 << 1).neq(0);

  // En L4-7 C2: bit 9 en QA_RADSAT = dropped pixel (SLC-off / inválido)
  var dropped = image.select('QA_RADSAT').bitwiseAnd(1 << 9).neq(0);

  var mask = cloudShadow.or(cloud).or(dilatedCloud).or(dropped).not();

  var scaled = image
    .select(['SR_B2', 'SR_B5'], ['GREEN', 'SWIR1'])
    .multiply(0.0000275)
    .add(-0.2)
    .updateMask(mask);

  return scaled.copyProperties(image, image.propertyNames());
}

function maskAndScaleL8(image) {
  var qa = image.select('QA_PIXEL');
  var cloudShadow = qa.bitwiseAnd(1 << 4).neq(0);
  var cloud = qa.bitwiseAnd(1 << 3).neq(0);
  var dilatedCloud = qa.bitwiseAnd(1 << 1).neq(0);
  var saturated = image.select('QA_RADSAT').neq(0);

  var mask = cloudShadow.or(cloud).or(dilatedCloud).or(saturated).not();

  var scaled = image
    .select(['SR_B3', 'SR_B6'], ['GREEN', 'SWIR1'])
    .multiply(0.0000275)
    .add(-0.2)
    .updateMask(mask);

  return scaled.copyProperties(image, image.propertyNames());
}

function buildCollection(start, end) {
  var l5 = ee.ImageCollection('LANDSAT/LT05/C02/T1_L2')
    .filterDate(start, end)
    .filterBounds(studyArea)
    .filter(ee.Filter.lt('CLOUD_COVER', 70))
    .map(maskAndScaleL57);

  var l7 = ee.ImageCollection('LANDSAT/LE07/C02/T1_L2')
    .filterDate(start, end)
    .filterBounds(studyArea)
    .filter(ee.Filter.lt('CLOUD_COVER', 70))
    .map(maskAndScaleL57);

  var l8 = ee.ImageCollection('LANDSAT/LC08/C02/T1_L2')
    .filterDate(start, end)
    .filterBounds(studyArea)
    .filter(ee.Filter.lt('CLOUD_COVER', 70))
    .map(maskAndScaleL8);

  return l5.merge(l7).merge(l8);
}

function processAndExportYear(year) {
  var start = ee.Date.fromYMD(year, 1, 1).advance(-temporalPaddingYears, 'year');
  var end = ee.Date.fromYMD(year + 1, 1, 1).advance(temporalPaddingYears, 'year');

  var collection = buildCollection(start, end).map(function (img) {
    return img.addBands(img.normalizedDifference(['GREEN', 'SWIR1']).rename('NDSI'));
  });

  var count = collection.size();
  print('Año ' + year + ' - imágenes usadas (ventana ampliada):', count);

  // percentil 60 para favorecer pixeles de nieve y reducir ruido
  var ndsiComposite = ee.Image(
    ee.Algorithms.If(
      count.gt(0),
      collection.select('NDSI').reduce(ee.Reducer.percentile([60])).rename('NDSI').clip(studyArea),
      ee.Image(0).rename('NDSI').clip(studyArea).selfMask()
    )
  );

  var snowMask = ndsiComposite.gte(snowThreshold).rename('SNOW_MASK').selfMask();

  Map.addLayer(ndsiComposite, ndsiVis, 'NDSI ' + year);
  Map.addLayer(snowMask, snowVis, 'Nevado (NDSI>=' + snowThreshold + ') ' + year);

  Export.image.toDrive({
    image: ndsiComposite,
    description: 'Export_NDSI_' + year,
    folder: 'Denali',
    fileNamePrefix: 'NDSI_' + year,
    region: studyArea,
    scale: 30,
    maxPixels: 1e13,
    crs: 'EPSG:4326'
  });

  Export.image.toDrive({
    image: snowMask,
    description: 'Export_SNOW_MASK_' + year,
    folder: 'Denali',
    fileNamePrefix: 'SNOW_MASK_' + year,
    region: studyArea,
    scale: 30,
    maxPixels: 1e13,
    crs: 'EPSG:4326'
  });
}

var startYear = 2000;
var endYear = 2013;

Map.addLayer(studyArea, {color: 'red'}, 'AOI - Nevado de interés');
for (var year = startYear; year <= endYear; year++) {
  processAndExportYear(year);
}
Map.centerObject(studyArea, 11);
