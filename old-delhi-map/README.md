# Delhi Before the Siege (1858) viewer

This HTML viewer leaves the 1858 engraving in its original pixel geometry and draws a modern OpenStreetMap-derived vector extract in that image space.

The viewer uses the **natural-perspective mesh**: three overlapping, smoothly weighted regional affine fits that follow the engraving's locally inconsistent perspectives without hard seams. The simpler global affine remains part of the research outputs and provides the numerical starting point for inverting the mesh, but it is no longer exposed as a viewer option.

The modern map is a bundled, label-free vector extract derived from OpenStreetMap. Its 4,883 road, railway, building, water, park, and land-use features—including 2,036 building footprints—are pre-projected into illustration pixels at build time. A local cartographic canvas, building fills, road casings, parks, water, and rail styling make the layer readable as a present-day map at full opacity. This avoids both third-party tile requests and the upside-down text that would result from warping a labelled north-up raster. Names are drawn separately from a local GeoJSON-compatible feature collection as screen-upright vector labels. The map is clipped to the walled-city polygon by default. Numbered fitting landmarks are available as an optional layer; Salimgarh Fort remains a fully withheld diagnostic.

The **Find a present-day place** field searches 983 deduplicated names whose representative coordinates fall inside the preserved Old Delhi bounding box. Numeric platform labels and route relations are excluded. Search is entirely local—queries are not sent to a geocoding service. A smaller display layer contains 317 selected features: 310 labelled points and seven landmark polygons. Results include mapped streets, bazaars, monuments, religious sites, shops, public facilities, and other named places. Selecting a result converts its modern coordinates through the natural-perspective inverse warp and marks the implied position on the engraving.

Users can also paste a WGS84 latitude-longitude pair directly. Comma-, space-, and semicolon-separated decimal degrees are accepted, with optional N/S/E/W suffixes. The viewer validates the values, transforms the coordinate through the same warp, and labels it on the engraving. Points beyond the fitted wall are explicitly described as extrapolations; points beyond the visible illustration cannot be marked.

## Run

From the repository root:

```bash
python3 -m http.server 8000
```

Open `http://127.0.0.1:8000/perspective-viewer/`.

## Static website deployment

The viewer is fully self-contained. Upload the `perspective-viewer/` directory unchanged to any ordinary static host. It includes the optimized engraving, OpenLayers 10.10.0 JavaScript and CSS, the transform, the searchable index, display features, and the modern vector basemap. There are no runtime API, geocoder, CDN, font, or tile-service calls. The renderer supports Point, LineString, MultiLineString, Polygon, and MultiPolygon geometries.

Attribution is displayed in the viewer and the bundled data and software notices are in `DATA-LICENSE.md` and `vendor/OPENLAYERS-LICENSE.md`.

## Rebuild and validate

The browser data are generated from the canonical control-point and transformation outputs:

```bash
/Users/abhishekarora/miniconda3/envs/geospatial/bin/python scripts/build_perspective_viewer.py
/Users/abhishekarora/miniconda3/envs/geospatial/bin/python scripts/build_perspective_viewer.py --check
/Users/abhishekarora/miniconda3/envs/geospatial/bin/python scripts/validate_perspective_viewer.py
node --check perspective-viewer/app.js
```

The numerical validation checks the inverse transform over a dense sample inside the city-wall polygon and fails if the smooth warp folds or becomes non-invertible there.
