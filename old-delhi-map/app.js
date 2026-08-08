(function () {
  "use strict";

  const tileStatus = document.getElementById("tile-status");
  const DATA = window.DELHI_VIEWER_DATA;
  const PLACES = window.DELHI_PLACE_INDEX;
  const STATIC_FEATURES = window.DELHI_STATIC_FEATURES;
  const STATIC_BASEMAP = window.DELHI_STATIC_BASEMAP;
  if (!window.ol || !DATA || !PLACES || !STATIC_FEATURES || !STATIC_BASEMAP) {
    tileStatus.textContent = "The mapping library, warp data, or local feature data could not be loaded.";
    tileStatus.dataset.state = "error";
    return;
  }
  const IMAGE_WIDTH = DATA.image.width;
  const IMAGE_HEIGHT = DATA.image.height;
  const IMAGE_EXTENT = [0, 0, IMAGE_WIDTH, IMAGE_HEIGHT];
  const CITY_MASK_PIXELS = DATA.cityMaskPixels;
  const CITY_RING = CITY_MASK_PIXELS.map(([x, y]) => [x, IMAGE_HEIGHT - y]);
  CITY_RING.push(CITY_RING[0].slice());
  const maskX = CITY_MASK_PIXELS.map((point) => point[0]);
  const maskY = CITY_MASK_PIXELS.map((point) => IMAGE_HEIGHT - point[1]);
  const CITY_EXTENT = [Math.min(...maskX), Math.min(...maskY), Math.max(...maskX), Math.max(...maskY)];
  const GLOBAL_AFFINE = DATA.globalAffine;
  const NATURAL_REGIONS = DATA.naturalRegions;
  const ANCHORS = DATA.anchors;

  const MODEL_DETAIL = {
    code: "DELHI:ILLUSTRATION:NATURAL",
    label: "Natural-perspective mesh",
    metric: `${Math.round(DATA.metrics.naturalLooRmseM)} m leave-one-out RMSE`,
  };

  function applyAffine(matrix, point) {
    const [x, y] = point;
    return [
      matrix[0][0] * x + matrix[0][1] * y + matrix[0][2],
      matrix[1][0] * x + matrix[1][1] * y + matrix[1][2],
    ];
  }

  function invertAffine(matrix, point) {
    const a = matrix[0][0];
    const b = matrix[0][1];
    const c = matrix[0][2];
    const d = matrix[1][0];
    const e = matrix[1][1];
    const f = matrix[1][2];
    const determinant = a * e - b * d;
    const targetX = point[0] - c;
    const targetY = point[1] - f;
    return [
      (e * targetX - b * targetY) / determinant,
      (-d * targetX + a * targetY) / determinant,
    ];
  }

  function naturalPixelToUtm(point) {
    let totalWeight = 0;
    let easting = 0;
    let northing = 0;
    for (const region of NATURAL_REGIONS) {
      const dx = (point[0] - region.centre[0]) / region.scale[0];
      const dy = (point[1] - region.centre[1]) / region.scale[1];
      const weight = Math.exp(Math.max(-50, -0.5 * (dx * dx + dy * dy)));
      const transformed = applyAffine(region.matrix, point);
      totalWeight += weight;
      easting += weight * transformed[0];
      northing += weight * transformed[1];
    }
    return [easting / totalWeight, northing / totalWeight];
  }

  function naturalUtmToPixel(target) {
    let point = invertAffine(GLOBAL_AFFINE, target);
    const epsilon = 0.5;
    for (let iteration = 0; iteration < 10; iteration += 1) {
      const current = naturalPixelToUtm(point);
      const errorX = current[0] - target[0];
      const errorY = current[1] - target[1];
      const xPlus = naturalPixelToUtm([point[0] + epsilon, point[1]]);
      const xMinus = naturalPixelToUtm([point[0] - epsilon, point[1]]);
      const yPlus = naturalPixelToUtm([point[0], point[1] + epsilon]);
      const yMinus = naturalPixelToUtm([point[0], point[1] - epsilon]);
      const j00 = (xPlus[0] - xMinus[0]) / (2 * epsilon);
      const j10 = (xPlus[1] - xMinus[1]) / (2 * epsilon);
      const j01 = (yPlus[0] - yMinus[0]) / (2 * epsilon);
      const j11 = (yPlus[1] - yMinus[1]) / (2 * epsilon);
      const determinant = j00 * j11 - j01 * j10;
      if (Math.abs(determinant) < 1e-10) break;
      const stepX = (j11 * errorX - j01 * errorY) / determinant;
      const stepY = (-j10 * errorX + j00 * errorY) / determinant;
      point = [point[0] - stepX, point[1] - stepY];
      if (Math.hypot(stepX, stepY) < 1e-6) break;
    }
    return point;
  }

  function imageToPixelDown(coordinate) {
    return [coordinate[0], IMAGE_HEIGHT - coordinate[1]];
  }

  function pixelDownToImage(pixel) {
    return [pixel[0], IMAGE_HEIGHT - pixel[1]];
  }

  function utmToWebMercator(utm) {
    return ol.proj.transform(utm, DATA.crs, "EPSG:3857");
  }

  function webMercatorToUtm(mercator) {
    return ol.proj.transform(mercator, "EPSG:3857", DATA.crs);
  }

  const naturalTransform = {
    forward(coordinate) {
      return utmToWebMercator(naturalPixelToUtm(imageToPixelDown(coordinate)));
    },
    inverse(mercator) {
      return pixelDownToImage(naturalUtmToPixel(webMercatorToUtm(mercator)));
    },
  };

  const webMercatorProjection = ol.proj.get("EPSG:3857");
  const illustrationProjection = new ol.proj.Projection({
    code: MODEL_DETAIL.code,
    units: "pixels",
    extent: IMAGE_EXTENT,
    metersPerUnit: 1.85,
  });
  ol.proj.addProjection(illustrationProjection);
  ol.proj.addCoordinateTransforms(
    illustrationProjection,
    webMercatorProjection,
    naturalTransform.forward,
    naturalTransform.inverse,
  );

  const anchorFeatures = ANCHORS.map((anchor) => {
    const feature = new ol.Feature({
      geometry: new ol.geom.Point(pixelDownToImage(anchor.pixel)),
      name: anchor.name,
      legend: anchor.legend,
      use: anchor.use,
      lonLat: anchor.lonLat,
      sourcePixel: anchor.pixel,
    });
    return feature;
  });

  const anchorStyleCache = new Map();
  function anchorStyle(feature) {
    const key = `${feature.get("use")}-${feature.get("legend")}`;
    if (!anchorStyleCache.has(key)) {
      const holdout = feature.get("use") === "holdout";
      anchorStyleCache.set(key, new ol.style.Style({
        image: new ol.style.Circle({
          radius: holdout ? 7 : 6,
          fill: new ol.style.Fill({color: holdout ? "#c25b2b" : "#246c63"}),
          stroke: new ol.style.Stroke({color: "#fffdf7", width: 2}),
        }),
        text: new ol.style.Text({
          text: String(feature.get("legend")),
          offsetY: -13,
          font: "700 12px Inter, system-ui, sans-serif",
          fill: new ol.style.Fill({color: "#28241d"}),
          stroke: new ol.style.Stroke({color: "rgba(255,253,247,0.95)", width: 3}),
        }),
      }));
    }
    return anchorStyleCache.get(key);
  }

  const imageLayer = new ol.layer.Image({zIndex: 0});
  function geometryFromCoordinates(geometry, transform = (coordinate) => coordinate) {
    if (geometry.type === "Point") return new ol.geom.Point(transform(geometry.coordinates));
    if (geometry.type === "LineString") return new ol.geom.LineString(geometry.coordinates.map(transform));
    if (geometry.type === "MultiLineString") {
      return new ol.geom.MultiLineString(geometry.coordinates.map((line) => line.map(transform)));
    }
    if (geometry.type === "Polygon") {
      return new ol.geom.Polygon(geometry.coordinates.map((ring) => ring.map(transform)));
    }
    if (geometry.type === "MultiPolygon") {
      return new ol.geom.MultiPolygon(
        geometry.coordinates.map((polygon) => polygon.map((ring) => ring.map(transform))),
      );
    }
    throw new Error(`Unsupported static geometry: ${geometry.type}`);
  }

  const modernBaseFeatures = STATIC_BASEMAP.features.map((record) => new ol.Feature({
    ...record.properties,
    geometry: geometryFromCoordinates(record.geometry),
  }));

  const modernBaseStyleCache = new Map();
  function modernBaseStyle(feature) {
    const category = feature.get("category");
    const subtype = feature.get("subtype");
    const tunnel = feature.get("tunnel");
    const key = `${category}-${subtype}-${tunnel}`;
    if (modernBaseStyleCache.has(key)) return modernBaseStyleCache.get(key);

    let style;
    if (category === "road") {
      const major = ["motorway", "trunk", "primary", "secondary"].includes(subtype);
      const medium = ["tertiary", "residential", "pedestrian"].includes(subtype);
      const path = ["footway", "path", "steps", "cycleway", "track"].includes(subtype);
      style = new ol.style.Style({
        stroke: new ol.style.Stroke({
          color: major ? "#a75e43" : medium ? "#667f82" : "#889694",
          width: major ? 2.4 : medium ? 1.35 : 0.75,
          lineDash: tunnel || path ? [4, 3] : undefined,
        }),
        zIndex: major ? 14 : medium ? 12 : 10,
      });
    } else if (category === "rail") {
      style = new ol.style.Style({
        stroke: new ol.style.Stroke({color: "#55514b", width: 1.1, lineDash: [5, 3]}),
        zIndex: 13,
      });
    } else if (category === "water") {
      style = new ol.style.Style({
        fill: new ol.style.Fill({color: "rgba(79,148,181,0.22)"}),
        stroke: new ol.style.Stroke({color: "#5b9ab8", width: 1.2}),
        zIndex: 4,
      });
    } else if (category === "park") {
      style = new ol.style.Style({
        fill: new ol.style.Fill({color: "rgba(76,132,91,0.16)"}),
        stroke: new ol.style.Stroke({color: "rgba(76,132,91,0.8)", width: 0.8}),
        zIndex: 3,
      });
    } else {
      style = new ol.style.Style({
        fill: new ol.style.Fill({color: "rgba(181,157,101,0.10)"}),
        stroke: new ol.style.Stroke({color: "rgba(145,126,84,0.55)", width: 0.6}),
        zIndex: 2,
      });
    }
    modernBaseStyleCache.set(key, style);
    return style;
  }

  const modernMapLayer = new ol.layer.Vector({
    source: new ol.source.Vector({features: modernBaseFeatures}),
    style: modernBaseStyle,
    opacity: 0.55,
    extent: CITY_EXTENT,
    renderBuffer: 40,
    zIndex: 1,
  });
  const wallLayer = new ol.layer.Vector({
    source: new ol.source.Vector({
      features: [new ol.Feature(new ol.geom.Polygon([CITY_RING]))],
    }),
    style: new ol.style.Style({
      stroke: new ol.style.Stroke({color: "rgba(194,91,43,0.95)", width: 2}),
      fill: new ol.style.Fill({color: "rgba(194,91,43,0.025)"}),
    }),
    zIndex: 2,
  });
  function transformStaticGeometry(geometry) {
    const toImage = ([longitude, latitude]) => naturalTransform.inverse(
      ol.proj.fromLonLat([longitude, latitude]),
    );
    return geometryFromCoordinates(geometry, toImage);
  }

  const staticFeatureObjects = STATIC_FEATURES.features
    .map((record) => new ol.Feature({
      ...record.properties,
      geometry: transformStaticGeometry(record.geometry),
    }))
    .filter((feature) => {
      const geometry = feature.getGeometry();
      return geometry.getType() !== "Point" || pointInCity(geometry.getCoordinates());
    });

  const staticFeatureStyleCache = new Map();
  function staticFeatureStyle(feature, resolution) {
    const priority = feature.get("priority");
    if ((resolution > 2.4 && priority > 0) || (resolution > 1.4 && priority > 1)) return undefined;
    const geometryType = feature.getGeometry().getType();
    const polygon = geometryType === "Polygon" || geometryType === "MultiPolygon";
    const key = `${feature.get("name")}-${priority}-${polygon}`;
    if (!staticFeatureStyleCache.has(key)) {
      staticFeatureStyleCache.set(key, new ol.style.Style({
        fill: polygon ? new ol.style.Fill({color: "rgba(38,120,201,0.10)"}) : undefined,
        stroke: polygon ? new ol.style.Stroke({color: "rgba(38,120,201,0.88)", width: 1.4}) : undefined,
        image: polygon ? undefined : new ol.style.Circle({
          radius: priority === 0 ? 3.5 : 2.5,
          fill: new ol.style.Fill({color: priority === 0 ? "#174a44" : "#2678c9"}),
          stroke: new ol.style.Stroke({color: "rgba(255,253,247,0.95)", width: 1.2}),
        }),
        text: new ol.style.Text({
          text: feature.get("name"),
          offsetY: polygon ? 0 : -9,
          font: `${priority === 0 ? "700" : "600"} ${priority === 0 ? 12 : 10}px Inter, system-ui, sans-serif`,
          fill: new ol.style.Fill({color: "#28241d"}),
          stroke: new ol.style.Stroke({color: "rgba(255,253,247,0.98)", width: 3}),
          backgroundFill: new ol.style.Fill({color: "rgba(255,253,247,0.78)"}),
          padding: [1, 3, 1, 3],
          overflow: true,
        }),
      }));
    }
    return staticFeatureStyleCache.get(key);
  }

  const staticFeatureLayer = new ol.layer.Vector({
    source: new ol.source.Vector({features: staticFeatureObjects}),
    style: staticFeatureStyle,
    declutter: true,
    zIndex: 3,
  });

  const anchorLayer = new ol.layer.Vector({
    source: new ol.source.Vector({features: anchorFeatures}),
    style: anchorStyle,
    declutter: true,
    zIndex: 4,
  });
  const selectionFeature = new ol.Feature();
  function selectionStyle(feature) {
    const searchResult = feature.get("kind") === "search";
    const coordinateResult = feature.get("kind") === "coordinates";
    const markerColor = coordinateResult ? "#7c3fa0" : searchResult ? "#2678c9" : "#28241d";
    const markerFill = coordinateResult
      ? "rgba(124,63,160,0.26)"
      : searchResult ? "rgba(38,120,201,0.28)" : "rgba(255,253,247,0.25)";
    return new ol.style.Style({
      image: new ol.style.Circle({
        radius: searchResult || coordinateResult ? 9 : 8,
        fill: new ol.style.Fill({color: markerFill}),
        stroke: new ol.style.Stroke({color: markerColor, width: 2.5}),
      }),
      text: feature.get("label") ? new ol.style.Text({
        text: feature.get("label"),
        offsetY: -18,
        font: "700 13px Inter, system-ui, sans-serif",
        fill: new ol.style.Fill({color: "#28241d"}),
        stroke: new ol.style.Stroke({color: "rgba(255,253,247,0.98)", width: 4}),
      }) : undefined,
    });
  }
  const selectionLayer = new ol.layer.Vector({
    source: new ol.source.Vector({features: [selectionFeature]}),
    style: selectionStyle,
    zIndex: 5,
  });

  function makeImageSource() {
    return new ol.source.ImageStatic({
      url: DATA.image.url,
      imageExtent: IMAGE_EXTENT,
      projection: illustrationProjection,
      interpolate: true,
      attributions: "Illustrated London News, 16 January 1858 (public domain)",
    });
  }

  function makeView() {
    return new ol.View({
      projection: illustrationProjection,
      center: ol.extent.getCenter(CITY_EXTENT),
      resolution: 3,
      extent: IMAGE_EXTENT,
      constrainOnlyCenter: true,
      maxResolution: 8,
      minResolution: 0.125,
      enableRotation: false,
    });
  }

  let clipToWall = true;
  imageLayer.setSource(makeImageSource());

  const map = new ol.Map({
    target: "map",
    layers: [imageLayer, modernMapLayer, wallLayer, staticFeatureLayer, anchorLayer, selectionLayer],
    view: makeView(),
    controls: ol.control.defaults.defaults({
      attributionOptions: {collapsible: true},
      rotate: false,
    }).extend([new ol.control.ScaleLine({units: "metric", bar: true, steps: 2})]),
  });

  function renderPixel(event, pixel) {
    const transform = event.inversePixelTransform;
    return [
      transform[0] * pixel[0] + transform[2] * pixel[1] + transform[4],
      transform[1] * pixel[0] + transform[3] * pixel[1] + transform[5],
    ];
  }

  modernMapLayer.on("prerender", (event) => {
    if (!clipToWall) return;
    const context = event.context;
    const pixels = CITY_RING.map((coordinate) => renderPixel(event, map.getPixelFromCoordinate(coordinate)));
    context.save();
    context.beginPath();
    context.moveTo(pixels[0][0], pixels[0][1]);
    for (let index = 1; index < pixels.length; index += 1) {
      context.lineTo(pixels[index][0], pixels[index][1]);
    }
    context.closePath();
    context.clip();
    context.__delhiWallClip = true;
  });

  modernMapLayer.on("postrender", (event) => {
    if (event.context.__delhiWallClip) {
      event.context.restore();
      delete event.context.__delhiWallClip;
    }
  });

  function fitExtent(extent) {
    map.getView().fit(extent, {
      padding: [28, 28, 28, 28],
      duration: 350,
      maxZoom: 8,
    });
  }

  function updateModelSummary() {
    document.getElementById("model-label").textContent = MODEL_DETAIL.label;
    document.getElementById("model-metric").textContent = MODEL_DETAIL.metric;
  }

  function pointInCity(coordinate) {
    let inside = false;
    for (let i = 0, j = CITY_RING.length - 1; i < CITY_RING.length; j = i, i += 1) {
      const xi = CITY_RING[i][0];
      const yi = CITY_RING[i][1];
      const xj = CITY_RING[j][0];
      const yj = CITY_RING[j][1];
      const intersects = yi > coordinate[1] !== yj > coordinate[1]
        && coordinate[0] < ((xj - xi) * (coordinate[1] - yi)) / (yj - yi) + xi;
      if (intersects) inside = !inside;
    }
    return inside;
  }

  function formatLocation(coordinate, anchor) {
    const mercator = naturalTransform.forward(coordinate);
    const [longitude, latitude] = ol.proj.toLonLat(mercator);
    const pixelX = Math.round(coordinate[0]);
    const pixelY = Math.round(IMAGE_HEIGHT - coordinate[1]);
    const prefix = anchor ? `${anchor.get("name")} · ` : "";
    const cityStatus = pointInCity(coordinate) ? "inside wall" : "outside fitted wall";
    return `${prefix}${latitude.toFixed(6)}, ${longitude.toFixed(6)} · image pixel ${pixelX}, ${pixelY} · ${cityStatus}`;
  }

  function normalizeSearch(value) {
    return value
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  function editDistance(left, right) {
    let previous = Array.from({length: right.length + 1}, (_, index) => index);
    for (let i = 1; i <= left.length; i += 1) {
      const current = [i];
      for (let j = 1; j <= right.length; j += 1) {
        current[j] = Math.min(
          current[j - 1] + 1,
          previous[j] + 1,
          previous[j - 1] + (left[i - 1] === right[j - 1] ? 0 : 1),
        );
      }
      previous = current;
    }
    return previous[right.length];
  }

  function matchScore(place, query) {
    const name = normalizeSearch(place.name);
    const haystack = place.search || [name, ...(place.aliases || []).map(normalizeSearch)].join(" ");
    if (name === query) return 0;
    if (name.startsWith(query)) return 1;
    if (name.includes(query)) return 2;
    const tokens = query.split(" ").filter(Boolean);
    if (tokens.length && tokens.every((token) => haystack.includes(token))) return 3;
    if (query.length >= 4 && Math.abs(name.length - query.length) <= 4) {
      const distance = editDistance(name, query);
      if (distance <= Math.max(2, Math.floor(query.length * 0.22))) return 4 + distance / 10;
    }
    return Number.POSITIVE_INFINITY;
  }

  function kindLabel(kind) {
    if (kind === "illustrated_landmark") return "Illustrated landmark";
    const [category, value = "place"] = kind.split(":");
    const cleaned = value.replaceAll("_", " ");
    if (category === "highway") return `Street · ${cleaned}`;
    if (category === "shop") return `Shop · ${cleaned}`;
    if (category === "amenity") return `Amenity · ${cleaned}`;
    if (category === "historic") return `Historic · ${cleaned}`;
    if (category === "tourism") return `Visitor place · ${cleaned}`;
    return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  }

  const searchableAnchors = ANCHORS.map((anchor) => ({
    name: anchor.name,
    aliases: [anchor.legendText],
    search: normalizeSearch(`${anchor.name} ${anchor.legendText}`),
    lon: anchor.lonLat[0],
    lat: anchor.lonLat[1],
    kind: "illustrated_landmark",
    osm: `legend/${anchor.legend}`,
    anchor: true,
  }));

  function searchPlaces(rawQuery) {
    const query = normalizeSearch(rawQuery);
    if (!query) return [];
    const candidates = [...searchableAnchors, ...PLACES]
      .map((place) => ({place, score: matchScore(place, query)}))
      .filter((candidate) => Number.isFinite(candidate.score))
      .sort((left, right) => {
        const anchorDifference = Number(Boolean(right.place.anchor)) - Number(Boolean(left.place.anchor));
        return left.score - right.score || anchorDifference || left.place.name.localeCompare(right.place.name);
      });

    const seen = new Set();
    const results = [];
    for (const candidate of candidates) {
      const key = normalizeSearch(candidate.place.name);
      if (seen.has(key)) continue;
      seen.add(key);
      results.push(candidate.place);
      if (results.length === 7) break;
    }
    return results;
  }

  function placeCoordinate(place) {
    return naturalTransform.inverse(ol.proj.fromLonLat([place.lon, place.lat]));
  }

  function locatePlace(place, recenter = true) {
    const coordinate = placeCoordinate(place);
    const coordinateInput = place.source === "coordinates";
    const status = document.getElementById(coordinateInput ? "coordinate-status" : "search-status");
    const visible = ol.extent.containsCoordinate(IMAGE_EXTENT, coordinate);
    if (!visible) {
      selectionFeature.setGeometry(undefined);
      status.textContent = "Those coordinates fall outside the engraving's visible coverage and cannot be marked.";
      status.dataset.state = "error";
      document.getElementById("selected-location").textContent =
        `${place.lat.toFixed(6)}, ${place.lon.toFixed(6)} · outside image coverage`;
      return;
    }

    const inside = pointInCity(coordinate);
    selectionFeature.setProperties({kind: coordinateInput ? "coordinates" : "search", label: place.name});
    selectionFeature.setGeometry(new ol.geom.Point(coordinate));
    selectionFeature.changed();
    const pixelX = Math.round(coordinate[0]);
    const pixelY = Math.round(IMAGE_HEIGHT - coordinate[1]);
    document.getElementById("selected-location").textContent =
      `${place.name} · ${place.lat.toFixed(6)}, ${place.lon.toFixed(6)} · image pixel ${pixelX}, ${pixelY} · ${inside ? "inside wall" : "outside fitted wall"}`;
    status.textContent = inside
      ? `${place.name} is marked on the engraving.`
      : `${place.name} is outside the fitted wall; its extrapolated position is marked.`;
    status.dataset.state = inside ? "ready" : "error";
    if (recenter) {
      const view = map.getView();
      view.animate({
        center: coordinate,
        resolution: Math.min(view.getResolution() || 1.2, 1.2),
        duration: 450,
      });
      if (window.matchMedia("(max-width: 860px)").matches) {
        window.setTimeout(() => document.getElementById("map").scrollIntoView({behavior: "smooth", block: "center"}), 150);
      }
    }
  }

  function renderSearchResults(results) {
    const list = document.getElementById("search-results");
    const status = document.getElementById("search-status");
    list.replaceChildren();
    if (!results.length) {
      list.hidden = true;
      status.textContent = "No matching named place was found in the local Old Delhi index.";
      status.dataset.state = "error";
      return;
    }

    list.hidden = false;
    status.textContent = `${results.length} matching place${results.length === 1 ? "" : "s"}. Choose one to locate it.`;
    status.dataset.state = "ready";
    for (const place of results) {
      const item = document.createElement("li");
      const button = document.createElement("button");
      const name = document.createElement("strong");
      const detail = document.createElement("small");
      button.type = "button";
      button.className = "search-result";
      name.textContent = place.name;
      const inside = pointInCity(placeCoordinate(place));
      detail.textContent = `${kindLabel(place.kind)} · ${inside ? "inside wall" : "outside fitted wall"}`;
      button.append(name, detail);
      button.addEventListener("click", () => locatePlace(place));
      item.append(button);
      list.append(item);
    }
  }

  document.getElementById("place-search-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const query = document.getElementById("place-query").value;
    renderSearchResults(searchPlaces(query));
  });

  function parseCoordinatePair(value) {
    const normalized = value.trim().replace(/[−–—]/g, "-");
    const match = normalized.match(
      /^([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*°?\s*([NS])?\s*[,;\s]+\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*°?\s*([EW])?$/i,
    );
    if (!match) return null;

    let latitude = Number(match[1]);
    let longitude = Number(match[3]);
    if (match[2]) latitude = Math.abs(latitude) * (match[2].toUpperCase() === "S" ? -1 : 1);
    if (match[4]) longitude = Math.abs(longitude) * (match[4].toUpperCase() === "W" ? -1 : 1);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)
      || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
    return {latitude, longitude};
  }

  document.getElementById("coordinate-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const pair = parseCoordinatePair(document.getElementById("coordinate-pair").value);
    const status = document.getElementById("coordinate-status");
    if (!pair) {
      status.textContent = "Enter two decimal coordinates, for example 28.6506, 77.2334. Latitude must come first.";
      status.dataset.state = "error";
      return;
    }
    locatePlace({
      name: "Entered point",
      lat: pair.latitude,
      lon: pair.longitude,
      source: "coordinates",
    });
  });

  map.on("singleclick", (event) => {
    const anchor = map.forEachFeatureAtPixel(
      event.pixel,
      (feature) => feature.get("name") ? feature : null,
      {layerFilter: (layer) => layer === anchorLayer, hitTolerance: 7},
    );
    const coordinate = anchor ? anchor.getGeometry().getCoordinates() : event.coordinate;
    selectionFeature.setProperties({kind: anchor ? "anchor" : "click", label: anchor ? anchor.get("name") : ""});
    selectionFeature.setGeometry(new ol.geom.Point(coordinate));
    document.getElementById("selected-location").textContent = formatLocation(coordinate, anchor);
  });

  map.on("pointermove", (event) => {
    if (event.dragging) return;
    const hit = map.hasFeatureAtPixel(event.pixel, {
      layerFilter: (layer) => layer === anchorLayer,
      hitTolerance: 7,
    });
    map.getTargetElement().style.cursor = hit ? "pointer" : "";
  });

  const opacityInput = document.getElementById("map-opacity");
  opacityInput.addEventListener("input", () => {
    const opacity = Number(opacityInput.value) / 100;
    modernMapLayer.setOpacity(opacity);
    document.getElementById("map-opacity-value").value = `${opacityInput.value}%`;
  });

  document.getElementById("clip-wall").addEventListener("change", (event) => {
    clipToWall = event.target.checked;
    modernMapLayer.setExtent(clipToWall ? CITY_EXTENT : undefined);
    map.render();
  });

  document.getElementById("show-anchors").addEventListener("change", (event) => {
    anchorLayer.setVisible(event.target.checked);
  });

  document.getElementById("show-place-labels").addEventListener("change", (event) => {
    staticFeatureLayer.setVisible(event.target.checked);
  });

  document.getElementById("show-wall").addEventListener("change", (event) => {
    wallLayer.setVisible(event.target.checked);
  });

  document.getElementById("fit-city").addEventListener("click", () => fitExtent(CITY_EXTENT));
  document.getElementById("show-full-image").addEventListener("click", () => fitExtent(IMAGE_EXTENT));

  updateModelSummary();
  fitExtent(CITY_EXTENT);
  tileStatus.textContent = "Local modern map ready";
  tileStatus.dataset.state = "ready";
  window.setTimeout(() => map.updateSize(), 0);
})();
