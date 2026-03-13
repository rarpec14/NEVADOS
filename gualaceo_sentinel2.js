// =====================================================
// Sentinel-2 + Hillshade para cantón Gualaceo (Azuay, Ecuador)
// =====================================================

// 1) Límites administrativos (GAUL nivel 2)
var ecBoundaries = ee.FeatureCollection('FAO/GAUL/2015/level2')
  .filter(ee.Filter.eq('ADM0_NAME', 'Ecuador'));

// Filtrar el cantón Gualaceo (provincia Azuay)
var gualaceoBoundary = ecBoundaries
  .filter(ee.Filter.eq('ADM1_NAME', 'Azuay'))
  .filter(ee.Filter.eq('ADM2_NAME', 'Gualaceo'));

print('Límite de Gualaceo:', gualaceoBoundary);

// Comprobación opcional: cuántas entidades encontró
print('Cantidad de features:', gualaceoBoundary.size());

// Mostrar límite y centrar mapa
Map.addLayer(gualaceoBoundary, {color: 'blue'}, 'Gualaceo Boundary');
Map.centerObject(gualaceoBoundary.geometry().bounds(), 11);

// 2) Enmascarado de nubes Sentinel-2 usando QA60
function maskS2clouds(image) {
  var qa = image.select('QA60');

  // Bits 10 y 11: cloud y cirrus
  var cloudBitMask = 1 << 10;
  var cirrusBitMask = 1 << 11;

  var mask = qa.bitwiseAnd(cloudBitMask).eq(0)
    .and(qa.bitwiseAnd(cirrusBitMask).eq(0));

  // Escala reflectancia a 0-1
  return image.updateMask(mask).divide(10000)
    .copyProperties(image, image.propertyNames());
}

// 3) Colección Sentinel-2 armonizada (enero 2022, como tu ejemplo)
var dataset = ee.ImageCollection('COPERNICUS/S2_HARMONIZED')
  .filterDate('2022-01-01', '2022-01-31')
  .filterBounds(gualaceoBoundary.geometry())
  .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 20))
  .map(maskS2clouds)
  .median()
  .clip(gualaceoBoundary.geometry());

var rgbVis = {
  min: 0.0,
  max: 0.3,
  bands: ['B4', 'B3', 'B2']
};

Map.addLayer(dataset, rgbVis, 'RGB Gualaceo S2');

// 4) Exportar imagen recortada a Google Drive
Export.image.toDrive({
  image: dataset,
  description: 'Sentinel2_Gualaceo_Azuay',
  folder: 'Gualaceo',
  fileNamePrefix: 'Sentinel2_Gualaceo_2022_01',
  scale: 10,
  region: gualaceoBoundary.geometry(),
  fileFormat: 'GeoTIFF',
  maxPixels: 1e13,
  crs: 'EPSG:4326'
});

// 5) DEM + Hillshade
var dem = ee.Image('USGS/SRTMGL1_003').clip(gualaceoBoundary.geometry());
var hillshade = ee.Terrain.hillshade(dem);
Map.addLayer(hillshade, {min: 0, max: 255, palette: ['black', 'white']}, 'Hillshade Gualaceo');
