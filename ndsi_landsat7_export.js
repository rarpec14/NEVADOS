// ==============================================
// Cálculo y exportación anual de NDSI para nevado Chimborazo
// (Landsat Collection 2 Level 2 Surface Reflectance)
// ==============================================
// Para reducir parches sin datos (ej. 2002):
// 1) fusiona L5/L7/L8,
// 2) usa meses secos (junio-julio-agosto),
// 3) usa mediana en vez de media/percentil,
// 4) integra ALTURA (DEM) como variable adicional.

var ndsiVis = {
  min: -1,
  max: 1,
  palette: ['blue', 'white', 'green']
};

var classVis = {
  min: 1,
  max: 3,
  palette: ['8c510a', '2166ac', 'f7f7f7'] // roca/suelo, glaciar, sin clase
};

var elevVis = {
  min: 3500,
  max: 6500,
  palette: ['2c7bb6', 'abd9e9', 'ffffbf', 'fdae61', 'd7191c']
};

// --- Configuración principal (solo flujo NDSI Landsat) ---
var scriptId = 'IS_NDSI_LANDSAT7';
var startYear = 2000;
var endYear = 2013;
var cloudCoverMax = 60;
var drySeasonStartMonth = 6;
var drySeasonEndMonth = 8;
var noDataValue = -9999;

// Umbrales para clases
var glacierNDSIThreshold = 0.4;
var minElevationGlacierM = 4600; // ALTURA mínima para considerar glaciar

// Exportaciones extra
var exportElevationBand = true;    // exporta DEM recortado
var exportClassBand = true;        // exporta clases (roca/suelo, glaciar, sin clase)

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

// Variable ALTURA (DEM)
var elevation = ee.Image('USGS/SRTMGL1_003').select('elevation').clip(studyArea);

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
    .filter(ee.Filter.calendarRange(drySeasonStartMonth, drySeasonEndMonth, 'month'))
    .filterBounds(studyArea)
    .filter(ee.Filter.lt('CLOUD_COVER', cloudCoverMax))
    .map(maskAndScaleL57);

  var l7 = ee.ImageCollection('LANDSAT/LE07/C02/T1_L2')
    .filterDate(start, end)
    .filter(ee.Filter.calendarRange(drySeasonStartMonth, drySeasonEndMonth, 'month'))
    .filterBounds(studyArea)
    .filter(ee.Filter.lt('CLOUD_COVER', cloudCoverMax))
    .map(maskAndScaleL57);

  var l8 = ee.ImageCollection('LANDSAT/LC08/C02/T1_L2')
    .filterDate(start, end)
    .filter(ee.Filter.calendarRange(drySeasonStartMonth, drySeasonEndMonth, 'month'))
    .filterBounds(studyArea)
    .filter(ee.Filter.lt('CLOUD_COVER', cloudCoverMax))
    .map(maskAndScaleL8);

  return l5.merge(l7).merge(l8).map(addNDSI);
}

function buildClasses(ndsiImage, elevImage) {
  // 1 = roca/suelo, 2 = glaciar, 3 = sin clase
  var glacier = ndsiImage.gte(glacierNDSIThreshold)
    .and(elevImage.gte(minElevationGlacierM));

  var rockSoil = ndsiImage.lt(glacierNDSIThreshold)
    .and(elevImage.gte(minElevationGlacierM));

  return ee.Image(3)
    .where(rockSoil, 1)
    .where(glacier, 2)
    .rename('CLASS')
    .toByte()
    .clip(studyArea);
}

function processAndExportYear(year) {
  var start = ee.Date.fromYMD(year, 1, 1);
  var end = ee.Date.fromYMD(year + 1, 1, 1);

  var collection = buildCollection(start, end);
  var count = collection.size();
  print('Año ' + year + ' (jun-jul-ago) - imágenes usadas:', count);

  var ndsiYear = ee.Image(
    ee.Algorithms.If(
      count.gt(0),
      collection.select('NDSI')
        .median()
        .rename('NDSI')
        .clip(studyArea),
      ee.Image(0).rename('NDSI').clip(studyArea).selfMask()
    )
  );

  var ndsiHighElevation = ndsiYear.updateMask(elevation.gte(minElevationGlacierM));
  var classImage = buildClasses(ndsiYear, elevation);

  Map.addLayer(ndsiYear, ndsiVis, 'NDSI Chimborazo ' + year);
  Map.addLayer(ndsiHighElevation, ndsiVis, 'NDSI alto (>' + minElevationGlacierM + 'm) ' + year, false);
  Map.addLayer(classImage, classVis, 'Clases (1 roca, 2 glaciar, 3 sin clase) ' + year, false);

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

  if (exportClassBand) {
    Export.image.toDrive({
      image: classImage.unmask(3).toByte(),
      description: 'Export_CLASS_Chimborazo_' + year,
      folder: 'Chimborazo',
      fileNamePrefix: 'CLASS_Chimborazo_' + year,
      region: studyArea,
      scale: 30,
      maxPixels: 1e13,
      crs: 'EPSG:4326',
      fileFormat: 'GeoTIFF',
      formatOptions: {noData: 3}
    });
  }
}

Map.addLayer(studyArea, {color: 'red'}, 'AOI - Chimborazo');
Map.addLayer(elevation, elevVis, 'ALTURA (m)', false);
Map.centerObject(studyArea, 11);

for (var year = startYear; year <= endYear; year++) {
  processAndExportYear(year);
}

if (exportElevationBand) {
  Export.image.toDrive({
    image: elevation.toInt16(),
    description: 'Export_ELEVATION_Chimborazo',
    folder: 'Chimborazo',
    fileNamePrefix: 'ELEVATION_Chimborazo',
    region: studyArea,
    scale: 30,
    maxPixels: 1e13,
    crs: 'EPSG:4326',
    fileFormat: 'GeoTIFF',
    formatOptions: {noData: -32768}
  });
}

print('Script activo:', scriptId);
print('ALTURA integrada: minElevationGlacierM =', minElevationGlacierM);
print('Meses secos usados:', drySeasonStartMonth, 'a', drySeasonEndMonth, '(junio-agosto)');
print('TIP: para recortar más el área, pon useChimborazoPolygon = false y dibuja geometry con la herramienta de polígono.');
