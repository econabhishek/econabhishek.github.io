(function () {
  "use strict";

  const DATA = window.GEOREFERENCE_DATA;
  const BASEMAP = window.GEOREFERENCE_BASEMAP;
  const PLACES = window.GEOREFERENCE_PLACES;
  const error = document.getElementById("map-error");
  if (!window.ol || !DATA || !BASEMAP || !PLACES) {
    error.textContent = "The historic map viewer could not load its bundled data.";
    return;
  }

  const WIDTH = DATA.imageWidth;
  const HEIGHT = DATA.imageHeight;
  const EXTENT = [0, 0, WIDTH, HEIGHT];
  const projection = new ol.proj.Projection({code: "HISTORIC:PIXELS", units: "pixels", extent: EXTENT});

  function matrixPoint(matrix, coordinate) {
    const x = coordinate[0];
    const y = coordinate[1];
    const denominator = matrix[2][0] * x + matrix[2][1] * y + matrix[2][2];
    return [
      (matrix[0][0] * x + matrix[0][1] * y + matrix[0][2]) / denominator,
      (matrix[1][0] * x + matrix[1][1] * y + matrix[1][2]) / denominator,
    ];
  }

  function pixelDownToImage(pixel) { return [pixel[0], HEIGHT - pixel[1]]; }
  function imageToPixelDown(coordinate) { return [coordinate[0], HEIGHT - coordinate[1]]; }

  const imageLayer = new ol.layer.Image({
    source: new ol.source.ImageStatic({url: DATA.imageUrl, imageExtent: EXTENT, projection}),
    zIndex: 0,
  });

  function geometryFromGeoJSON(geometry) {
    if (geometry.type === "LineString") return new ol.geom.LineString(geometry.coordinates);
    if (geometry.type === "Polygon") return new ol.geom.Polygon(geometry.coordinates);
    return null;
  }

  const modernFeatures = BASEMAP.features.map((item) => new ol.Feature({
    geometry: geometryFromGeoJSON(item.geometry),
    ...item.properties,
  }));

  const styleCache = new Map();
  function modernStyle(feature) {
    const category = feature.get("category");
    const subtype = feature.get("subtype");
    const key = `${category}:${subtype}`;
    if (styleCache.has(key)) return styleCache.get(key);
    let style;
    if (category === "building") {
      style = new ol.style.Style({fill: new ol.style.Fill({color: "rgba(121,105,87,0.28)"}), stroke: new ol.style.Stroke({color: "rgba(88,74,59,0.55)", width: 0.6})});
    } else if (category === "water") {
      style = new ol.style.Style({fill: new ol.style.Fill({color: "rgba(91,151,166,0.42)"}), stroke: new ol.style.Stroke({color: "rgba(56,113,130,0.8)", width: 1.2})});
    } else if (category === "park" || category === "landuse") {
      style = new ol.style.Style({fill: new ol.style.Fill({color: category === "park" ? "rgba(99,145,95,0.3)" : "rgba(169,152,109,0.18)"}), stroke: new ol.style.Stroke({color: "rgba(83,115,75,0.55)", width: 0.7})});
    } else if (category === "rail") {
      style = new ol.style.Style({stroke: new ol.style.Stroke({color: "rgba(74,67,64,0.85)", width: 1.4, lineDash: [7, 5]})});
    } else {
      const major = ["motorway", "trunk", "primary", "secondary"].includes(subtype);
      style = [
        new ol.style.Style({stroke: new ol.style.Stroke({color: "rgba(255,252,240,0.92)", width: major ? 4.4 : 2.6})}),
        new ol.style.Style({stroke: new ol.style.Stroke({color: major ? "rgba(177,91,60,0.9)" : "rgba(91,89,82,0.78)", width: major ? 2.1 : 1.1})}),
      ];
    }
    styleCache.set(key, style);
    return style;
  }

  const modernLayer = new ol.layer.Vector({
    source: new ol.source.Vector({features: modernFeatures}),
    style: modernStyle,
    opacity: DATA.initialOpacity,
    renderBuffer: 80,
    zIndex: 1,
  });

  const labelFeatures = PLACES.filter((place) => place.display).map((place) => new ol.Feature({
    geometry: new ol.geom.Point(place.pixel),
    name: place.name,
    kind: place.kind,
  }));
  const labelStyleCache = new Map();
  function labelStyle(feature) {
    const name = feature.get("name");
    if (!labelStyleCache.has(name)) {
      labelStyleCache.set(name, new ol.style.Style({
        image: new ol.style.Circle({radius: 2.2, fill: new ol.style.Fill({color: "#4a8b91"}), stroke: new ol.style.Stroke({color: "#fffdf7", width: 1})}),
        text: new ol.style.Text({text: name, offsetY: -10, font: "600 11px Inter, sans-serif", fill: new ol.style.Fill({color: "#25231f"}), stroke: new ol.style.Stroke({color: "rgba(255,253,247,0.96)", width: 3}), padding: [2, 3, 2, 3]}),
      }));
    }
    return labelStyleCache.get(name);
  }
  const labelLayer = new ol.layer.Vector({source: new ol.source.Vector({features: labelFeatures}), style: labelStyle, declutter: true, zIndex: 2});

  const selectionFeature = new ol.Feature();
  const selectionLayer = new ol.layer.Vector({
    source: new ol.source.Vector({features: [selectionFeature]}),
    style: (feature) => new ol.style.Style({
      image: new ol.style.Circle({radius: 7, fill: new ol.style.Fill({color: "#8f315c"}), stroke: new ol.style.Stroke({color: "#fffdf7", width: 2})}),
      text: new ol.style.Text({text: feature.get("label") || "", offsetY: -15, font: "700 12px Inter, sans-serif", fill: new ol.style.Fill({color: "#2a2420"}), stroke: new ol.style.Stroke({color: "#fffdf7", width: 3})}),
    }),
    zIndex: 3,
  });

  const view = new ol.View({projection, center: ol.extent.getCenter(EXTENT), zoom: 1, minZoom: -2, maxZoom: 8});
  const map = new ol.Map({
    target: "map",
    layers: [imageLayer, modernLayer, labelLayer, selectionLayer],
    view,
    controls: ol.control.defaults.defaults({attribution: false}).extend([new ol.control.ScaleLine({units: "metric"})]),
  });

  function fitMap() { view.fit(EXTENT, {padding: [20, 20, 20, 20], duration: 250}); }
  function normalized(value) { return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }
  function kindLabel(kind) { return kind.replace(":", " · ").replaceAll("_", " "); }

  function locate(name, latitude, longitude, status) {
    const pixel = matrixPoint(DATA.lonLatToPixelDown, [longitude, latitude]);
    const inside = Number.isFinite(pixel[0]) && Number.isFinite(pixel[1]) && pixel[0] >= 0 && pixel[0] <= WIDTH && pixel[1] >= 0 && pixel[1] <= HEIGHT;
    if (!inside) {
      status.textContent = "That location falls outside this historic map’s fitted coverage.";
      status.dataset.state = "error";
      return;
    }
    const coordinate = pixelDownToImage(pixel);
    selectionFeature.setProperties({label: name});
    selectionFeature.setGeometry(new ol.geom.Point(coordinate));
    view.animate({center: coordinate, zoom: Math.max(view.getZoom(), 3), duration: 300});
    document.getElementById("selected-location").textContent = `${name} · ${latitude.toFixed(6)}, ${longitude.toFixed(6)} · image pixel ${Math.round(pixel[0])}, ${Math.round(pixel[1])}`;
    status.textContent = `${name} is marked on the historic map.`;
    status.dataset.state = "ready";
  }

  document.getElementById("place-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const query = normalized(document.getElementById("place-query").value);
    const status = document.getElementById("place-status");
    const resultsBox = document.getElementById("place-results");
    resultsBox.replaceChildren();
    if (!query) return;
    const results = PLACES.map((place) => {
      const haystack = place.search;
      const score = haystack === query ? 0 : haystack.startsWith(query) ? 1 : haystack.includes(query) ? 2 : Infinity;
      return {place, score};
    }).filter((item) => Number.isFinite(item.score)).sort((a, b) => a.score - b.score || a.place.name.localeCompare(b.place.name)).slice(0, 8);
    if (!results.length) {
      status.textContent = "No matching name was found in the bundled local index.";
      status.dataset.state = "error";
      return;
    }
    status.textContent = `${results.length} matching place${results.length === 1 ? "" : "s"}.`;
    status.dataset.state = "ready";
    for (const result of results) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "result";
      button.innerHTML = `<strong></strong><span></span>`;
      button.querySelector("strong").textContent = result.place.name;
      button.querySelector("span").textContent = kindLabel(result.place.kind);
      button.addEventListener("click", () => locate(result.place.name, result.place.lat, result.place.lon, status));
      resultsBox.append(button);
    }
  });

  document.getElementById("coordinate-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const status = document.getElementById("coordinate-status");
    const parts = document.getElementById("coordinate-pair").value.split(/[\s,]+/).filter(Boolean).map(Number);
    if (parts.length !== 2 || !Number.isFinite(parts[0]) || !Number.isFinite(parts[1]) || Math.abs(parts[0]) > 90 || Math.abs(parts[1]) > 180) {
      status.textContent = "Enter valid decimal coordinates with latitude first.";
      status.dataset.state = "error";
      return;
    }
    locate("Entered point", parts[0], parts[1], status);
  });

  map.on("singleclick", (event) => {
    const pixel = imageToPixelDown(event.coordinate);
    const lonlat = matrixPoint(DATA.pixelDownToLonLat, pixel);
    selectionFeature.setProperties({label: ""});
    selectionFeature.setGeometry(new ol.geom.Point(event.coordinate));
    document.getElementById("selected-location").textContent = `${lonlat[1].toFixed(6)}, ${lonlat[0].toFixed(6)} · image pixel ${Math.round(pixel[0])}, ${Math.round(pixel[1])}`;
  });

  const opacity = document.getElementById("map-opacity");
  opacity.addEventListener("input", () => {
    modernLayer.setOpacity(Number(opacity.value) / 100);
    document.getElementById("map-opacity-value").value = `${opacity.value}%`;
  });
  document.getElementById("show-place-labels").addEventListener("change", (event) => labelLayer.setVisible(event.target.checked));
  document.getElementById("reset-view").addEventListener("click", fitMap);
  document.getElementById("show-full-image").addEventListener("click", fitMap);
  fitMap();
  window.setTimeout(() => map.updateSize(), 0);
})();
