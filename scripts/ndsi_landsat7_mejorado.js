// NDSI anual para Landsat 7 Collection 2 Level-2
// Requiere una variable geometry definida previamente.

// 1) Visualización
var ndsiVis = {
  min: -1,
  max: 1,
  palette: ['blue', 'white', 'green']
};

// 2) Enmascaramiento QA para L2
function maskL7L2(image) {
  var qa = image.select('QA_PIXEL');

  // Bits relevantes (Landsat C2 L2):
  // bit 1: dilated cloud
  // bit 2: cirrus
  // bit 3: cloud
  // bit 4: cloud shadow
  var mask = qa.bitwiseAnd(1 << 1).eq(0)
    .and(qa.bitwiseAnd(1 << 2).eq(0))
    .and(qa.bitwiseAnd(1 << 3).eq(0))
    .and(qa.bitwiseAnd(1 << 4).eq(0));

  return image.updateMask(mask);
}

// 3) Escalar reflectancia para bandas SR
function scaleSR(image) {
  var optical = image.select(['SR_B2', 'SR_B5'])
    .multiply(0.0000275)
    .add(-0.2);

  return image.addBands(optical, null, true);
}

// 4) Cálculo NDSI: (Green - SWIR1) / (Green + SWIR1)
function calculateNDSI(image) {
  var green = image.select('SR_B2');
  var swir = image.select('SR_B5');

  var ndsi = green.subtract(swir)
    .divide(green.add(swir))
    .rename('NDSI');

  return image.addBands(ndsi);
}

// 5) Procesar y exportar por año
function processAndExportYear(year) {
  var start = ee.Date.fromYMD(year, 1, 1);
  var end = start.advance(1, 'year');

  var collection = ee.ImageCollection('LANDSAT/LE07/C02/T1_L2')
    .filterDate(start, end)
    .filterBounds(geometry)
    .filter(ee.Filter.lt('CLOUD_COVER', 50))
    .map(maskL7L2)
    .map(scaleSR)
    .map(calculateNDSI)
    .map(function(img) {
      return img.clip(geometry);
    });

  print('Número de imágenes para el año ' + year + ':', collection.size());

  var hasImages = collection.size().gt(0);

  // Visualizar y exportar solo si hay imágenes
  hasImages.evaluate(function(ok) {
    if (!ok) {
      print('No hay imágenes válidas para el año: ' + year);
      return;
    }

    var ndsiMean = collection.select('NDSI').mean().clip(geometry);
    Map.addLayer(ndsiMean, ndsiVis, 'NDSI ' + year);

    Export.image.toDrive({
      image: ndsiMean,
      description: 'Export_NDSI_' + year,
      folder: 'CerroMercedario',
      fileNamePrefix: 'NDSI_' + year,
      region: geometry,
      scale: 30,
      maxPixels: 1e13,
      crs: 'EPSG:4326'
    });
  });
}

// 6) Centrar mapa
Map.centerObject(geometry, 10);

// 7) Años de trabajo (2000 a 2012)
var years = [2000, 2001, 2002, 2003, 2004, 2005, 2006, 2007, 2008, 2009, 2010, 2011, 2012];

// 8) Ejecutar
years.forEach(function(year) {
  processAndExportYear(year);
});
