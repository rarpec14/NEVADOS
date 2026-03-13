// ==============================================
// Cálculo y exportación anual de NDSI para nevado Chimborazo
// (Landsat Collection 2 Level 2 Surface Reflectance)
// ==============================================
// Para reducir parches sin datos (ej. 2002):
// 1) fusiona L5/L7/L8,
// 2) usa ventana temporal +/- años,
// 3) usa percentil en vez de promedio.

var ndsiVis = {
  min: -1,
  max: 1,
  palette: ['blue', 'white', 'green']
};

// --- Configuración principal ---
var startYear = 2000;
var endYear = 2013;
var cloudCoverMax = 60;
var temporalPaddingYears = 1; // 1 => usa [año-1, año+1]
var ndsiPercentile = 60;
var noDataValue = -9999;

// AOI
// true: usa polígono fijo Chimborazo
// false: usa geometry/roi/aoi dibujada por ti en GEE
var useChimborazoPolygon = true;

// Polígono base Chimborazo (puedes reemplazarlo por uno más pequeño)
var chimborazoPolygon = ee.Geometry.Polygon([
  [
    [-78.92, -1.40],
    [-78.73, -1.40],
    [-78.73, -1.62],
    [-78.92, -1.62],
    [-78.92, -1.40]
  ]
]);

// Prioridad AOI: Chimborazo fijo -> geometry -> roi -> aoi -> bounds de mapa
var studyArea = useChimborazoPolygon
  ? chimborazoPolygon
  : ((typeof geometry !== 'undefined' && geometry) ||
     (typeof roi !== 'undefined' && roi) ||
     (typeof aoi !== 'undefined' && aoi) ||
     null);

if (!studyArea) {
  studyArea = ee.Geometry.Rectangle(Map.getBounds(), null, false);
  print('Aviso: no se encontró geometry/roi/aoi. Se usa la extensión del mapa.');
}

function addNDSI(image) {
  var ndsi = image.normalizedDifference(['GREEN', 'SWIR1']).rename('NDSI');
  return image.addBands(ndsi);
}

function maskAndScaleL57(image) {
  var qa = image.select('QA_PIXEL');
  var dilatedCloud = qa.bitwiseAnd(1 << 1).neq(0);
  var cloud = qa.bitwiseAnd(1 << 3).neq(0);
  var cloudShadow = qa.bitwiseAnd(1 << 4).neq(0);
  var dropped = image.select('QA_RADSAT').bitwiseAnd(1 << 9).neq(0);

  var mask = dilatedCloud.or(cloud).or(cloudShadow).or(dropped).not();

  return image.select(['SR_B2', 'SR_B5'], ['GREEN', 'SWIR1'])
    .multiply(0.0000275)
    .add(-0.2)
    .updateMask(mask)
    .copyProperties(image, image.propertyNames());
}

function maskAndScaleL8(image) {
  var qa = image.select('QA_PIXEL');
  var dilatedCloud = qa.bitwiseAnd(1 << 1).neq(0);
  var cloud = qa.bitwiseAnd(1 << 3).neq(0);
  var cloudShadow = qa.bitwiseAnd(1 << 4).neq(0);
  var saturated = image.select('QA_RADSAT').neq(0);

  var mask = dilatedCloud.or(cloud).or(cloudShadow).or(saturated).not();

  return image.select(['SR_B3', 'SR_B6'], ['GREEN', 'SWIR1'])
    .multiply(0.0000275)
    .add(-0.2)
    .updateMask(mask)
    .copyProperties(image, image.propertyNames());
}

function buildCollection(start, end) {
  var l5 = ee.ImageCollection('LANDSAT/LT05/C02/T1_L2')
    .filterDate(start, end)
    .filterBounds(studyArea)
    .filter(ee.Filter.lt('CLOUD_COVER', cloudCoverMax))
    .map(maskAndScaleL57);

  var l7 = ee.ImageCollection('LANDSAT/LE07/C02/T1_L2')
    .filterDate(start, end)
    .filterBounds(studyArea)
    .filter(ee.Filter.lt('CLOUD_COVER', cloudCoverMax))
    .map(maskAndScaleL57);

  var l8 = ee.ImageCollection('LANDSAT/LC08/C02/T1_L2')
    .filterDate(start, end)
    .filterBounds(studyArea)
    .filter(ee.Filter.lt('CLOUD_COVER', cloudCoverMax))
    .map(maskAndScaleL8);

  return l5.merge(l7).merge(l8).map(addNDSI);
}

function processAndExportYear(year) {
  var start = ee.Date.fromYMD(year, 1, 1).advance(-temporalPaddingYears, 'year');
  var end = ee.Date.fromYMD(year + 1, 1, 1).advance(temporalPaddingYears, 'year');

  var collection = buildCollection(start, end);
  var count = collection.size();
  print('Año ' + year + ' - imágenes usadas:', count);

  var ndsiYear = ee.Image(
    ee.Algorithms.If(
      count.gt(0),
      collection.select('NDSI')
        .reduce(ee.Reducer.percentile([ndsiPercentile]))
        .rename('NDSI')
        .clip(studyArea),
      ee.Image(0).rename('NDSI').clip(studyArea).selfMask()
    )
  );

  Map.addLayer(ndsiYear, ndsiVis, 'NDSI Chimborazo ' + year);

  Export.image.toDrive({
    image: ndsiYear.unmask(noDataValue).toFloat(),
    description: 'Export_NDSI_Chimborazo_' + year,
    folder: 'Chimborazo',
    fileNamePrefix: 'NDSI_Chimborazo_' + year,
    region: studyArea,
    scale: 30,
    maxPixels: 1e13,
    crs: 'EPSG:4326',
    fileFormat: 'GeoTIFF',
    formatOptions: {noData: noDataValue}
  });
}

Map.addLayer(studyArea, {color: 'red'}, 'AOI - Chimborazo');
Map.centerObject(studyArea, 11);

for (var year = startYear; year <= endYear; year++) {
  processAndExportYear(year);
}

print('TIP: para recortar más el área, pon useChimborazoPolygon = false y dibuja geometry con la herramienta de polígono.');
