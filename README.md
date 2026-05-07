# Substation Estimator — Autodesk Forma Extension

A Forma right-panel extension built for **Pike EPC** (pike.com), a utility infrastructure EPC contractor operating up to 500 kV across 27 states. Deployed as two separate panels in a single Vite build.

**Live:** https://substation-estimator.vercel.app  
**Repo:** https://github.com/arqfernandolima-rgb/substation-estimator  
**Auto-deploy:** every push to `main` triggers a Vercel production build.

---

## Tools

### 1 — Substation Estimator (floating panel)
Reads the Forma site boundary polygon, auto-detects GPS region and terrain class, and produces a Class 5 (±30%) bill of materials using RSMeans 2024 Heavy Construction unit costs. Exports to CSV or PDF print report.

**BOM sections:** Civil & Site Work · Foundations & Concrete · Structural Steel · Primary Equipment · Grounding System · Controls & SCADA · Auxiliary Structures · Grid Interconnection · Project Costs

### 2 — Site Overlays (right analysis panel)
Four independent overlays rendered directly into the Forma 3D scene via `Forma.render.addMesh`.

| Overlay | What it does |
|---|---|
| **Slope analysis** | Colors terrain triangles by face-normal slope % (6 bands, Gouraud shading) |
| **Elevation banding** | Colors terrain by elevation, 6 bands auto-scaled to site range (green → red) |
| **Spot elevation** | Click any terrain point → places a labeled pin with elevation in ft |
| **Power infrastructure** | HV substations, power plants, transmission lines, pipelines from OSM + HIFLD |

---

## Tech stack

| | |
|---|---|
| UI | React 19, TypeScript 6 |
| Build | Vite 8, multi-page (two entry points) |
| Forma SDK | `forma-embedded-view-sdk` v0.93.0 (dynamic import) |
| External data | OSM Overpass, HIFLD ArcGIS, FEMA NFHL, USGS, EPA eGRID |
| Hosting | Vercel (static) |
| Backend | None — all computation is client-side |

---

## Quick start

```bash
npm install
npm run dev        # http://localhost:3000  (estimator)
                   # http://localhost:3000/overlays.html  (overlays panel)
```

Both apps run fully in a plain browser tab. When not loaded inside Forma (`?origin=` query param absent) they use hardcoded mock data — an Apex, NC site for the estimator and lat/lon `35.732, -78.823` for the overlays.

```bash
npm run build      # tsc typecheck → vite bundle → dist/
npm run preview    # serve dist/ locally (post-build smoke test)
npm run lint       # ESLint 9 flat config
```

> TypeScript config uses `erasableSyntaxOnly: true` — no `enum`, `namespace`, or `const enum`. Use plain objects or union types instead.

---

## Architecture

```
index.html          → src/main.tsx         → App.tsx
overlays.html       → src/overlays-main.tsx → OverlaysApp.tsx
```

The two pages share no runtime state. They are bundled as separate Rollup chunks and can be loaded independently. `OverlaysApp` is heavier (terrain mesh processing, external API calls).

### Estimator data flow

```
Forma SDK
  └─ useFormaIntegration.ts  (polls every 4 s)
       ├─ getFootprint(site_limit) → polygon → shoelace area → SF / acres
       ├─ getGeoLocation() → latLonToRegion() → 5 CCI cost zones
       ├─ getTriangles(terrain) → elevation range → classifyTerrain()
       └─ getTriangles(building) + ray-cast → FormaBuilding[] inside site
            ↓
App.tsx  (idle → configure → results state machine)
  └─ computeBOM(Config, SiteData)  in lib/compute.ts
       ├─ Bay footprint × unit costs (RSMeans 2024)
       ├─ Multipliers: CCI × terrain × GIS premium × bus config
       └─ BOMResult { sections[], grandTotal, footprintEstimate }
            ↓
  ├─ lib/export.ts   → exportCSV()
  └─ lib/report.ts   → printReport() → HTML in new tab → window.print()
```

### Overlays data flow

```
OverlaysApp.tsx
  ├─ Slope / Elevation banding
  │    lib/overlays.ts → getTerrainData() [cached]
  │      └─ Forma.geometry.getTriangles(terrain)
  │           → per-vertex slope / elevation → Forma.render.addMesh()
  │
  ├─ Spot elevation
  │    lib/elevation.ts
  │      ├─ Forma.designTool.getPoint()   (click-to-pick)
  │      └─ Forma.terrain.getElevationAt(x, y)
  │           → orange marker + glyph label → Forma.render.addMesh()
  │
  └─ Power infrastructure
       lib/overlays.ts → fetchPowerInfrastructure()
         ├─ HIFLD ArcGIS (transmission lines, primary)
         └─ OSM Overpass (substations, plants, pipelines, fallback)
              → ribbon/box 3D mesh + voltage glyph labels → Forma.render.addMesh()
```

---

## File structure

```
src/
  App.tsx                    Main estimator UI (Configure → Results flow)
  OverlaysApp.tsx            Site overlays panel UI
  main.tsx                   Entry point — estimator
  overlays-main.tsx          Entry point — overlays panel
  hooks/
    useFormaIntegration.ts   All Forma SDK calls, polling, mock fallback
  lib/
    compute.ts               RSMeans 2024 BoM calculation engine
    overlays.ts              Slope, elevation banding, power overlay logic
    elevation.ts             Spot elevation pick tool and pin rendering
    export.ts                CSV export
    report.ts                PDF print report generator
    standards.ts             IEEE / RSMeans standards reference data
index.html                   Estimator entry (floating panel)
overlays.html                Overlays entry (right analysis panel)
vite.config.ts               Multi-page build; injects __APP_VERSION__
```

---

## Forma SDK — API calls in use

### Geometry
| Call | Used for |
|---|---|
| `Forma.geometry.getPathsByCategory({ category: "site_limit" })` | Locate site boundary path |
| `Forma.geometry.getFootprint({ path })` | Site polygon coordinates (meters) |
| `Forma.geometry.getPathsByCategory({ category: "terrain" })` | Locate terrain mesh path |
| `Forma.geometry.getTriangles({ path })` | Raw terrain / building mesh triangles |
| `Forma.geometry.getPathsByCategory({ category: "building" })` | Locate building paths |

### Terrain
| Call | Used for |
|---|---|
| `Forma.terrain.getElevationAt({ x, y })` | Single-point elevation query (spot elevation tool) |
| `Forma.terrain.groundTexture` | Canvas-based texture overlay (legacy; replaced by addMesh) |

### Rendering
| Call | Used for |
|---|---|
| `Forma.render.addMesh({ geometryData })` | Place slope / elevation / power / pin meshes |
| `Forma.render.updateMesh({ id, geometryData })` | Update mesh in place (opacity change) |
| `Forma.render.remove({ id })` | Remove a named mesh |

### Interaction
| Call | Used for |
|---|---|
| `Forma.designTool.getPoint()` | Click-to-pick point in 3D scene (spot elevation) |

### Project
| Call | Used for |
|---|---|
| `Forma.project.getGeoLocation()` | `[lat, lon]` → CCI region + power search center |

### Dev mode detection
```typescript
const IS_IN_FORMA = window.location.search.includes("origin=");
```
When `false`, both apps return hardcoded mock data so the full UI can be developed in a plain browser.

### Critical constraints (learned from experience)
- `getFootprint()` works on: `site_limit`, `road`, `vegetation`
- `getTriangles()` works on: `building`, `terrain`, `constraints`, `vegetation`
- Buildings **must** use `getTriangles()` — `getFootprint()` silently returns nothing
- Category string is `"building"` (singular), not `"buildings"`
- Canvas Y is top-down — flip Y when drawing: `py = rows - (y - minY) / CELL`
- `geoData.upload()` adds to the Forma library **permanently** — use `groundTexture` or `render.addMesh` for temporary overlays
- Right panel iframe: use `overflow-y: auto`, not `overflow: hidden`; avoid `height: 100vh`

---

## APS Extension setup

**Extension ID:** `984b8119-06de-42b7-8977-990a244bab62`

The extension registers **two panels**. Only one can be declared in the YAML button (APS limitation for unpublished extensions); the second is registered via the Embedded Views UI field.

| Panel | Type | Config |
|---|---|---|
| Substation Estimator | `OPEN_FLOATING_PANEL` | width 420, height 900 |
| Site Overlays | `RIGHT_MENU_ANALYSIS_PANEL` | registered via Embedded Views field |

### Register / update in APS

1. Go to [APS Developer Portal](https://aps.autodesk.com) → your app → **Forma Extensions**
2. Set the extension URL to `https://substation-estimator.vercel.app`
3. For local dev, use `http://localhost:3000` (Vite serves with CORS enabled)
4. The Site Overlays panel URL is `https://substation-estimator.vercel.app/overlays.html`

### Install in Forma

1. Open Forma → project → Extensions (puzzle icon) → find **Substation Estimator** → Install
2. Substation Estimator opens as a floating panel from the toolbar
3. Site Overlays appears in the right analysis rail

---

## External APIs

| API | Purpose | Auth | Notes |
|---|---|---|---|
| OSM Overpass | Substations, plants, lines, pipelines | None | 20 s timeout; rate-limited — sequential after power data |
| HIFLD ArcGIS | HV transmission lines (primary) | None (public) | Potential CORS issues in Forma iframe; OSM is fallback |
| FEMA NFHL | Flood zone classification | None | |
| USGS | Seismic PGA | None | |
| EPA eGRID | Grid carbon intensity | None | Hardcoded lookup by region |

---

## Cost data

- **Source:** RSMeans 2024 Heavy Construction (Gordian), CSI Divisions 03, 05, 26, 27, 31, 33
- **Accuracy:** AACE Class 5, ±30%
- **Regional adjustment:** CCI (5 zones derived from GPS location)
- **Voltage classes:** Distribution 28×45 ft bay, Sub-transmission 48×75 ft, Transmission 90×130 ft (IEEE C2)
- **GIS switchgear:** ×1.6 cost multiplier, ×0.42 footprint multiplier vs AIS

Unit costs are hardcoded constants in `src/lib/compute.ts`. Swap them with licensed RSMeans API data or project-specific values for higher accuracy.

---

## Deploy

Vercel auto-deploys on every push to `main`. No manual steps required.

```bash
git add . && git commit -m "msg" && git push   # triggers Vercel build
```

Manual build output for inspection:
```bash
npm run build    # → dist/index.html + dist/overlays.html + dist/assets/
npm run preview  # serve dist/ on localhost:4173
```

---

## Known constraints

- OSM Overpass can be slow or rate-limited — 20 s timeout with `AbortController`, sequential after power data fetch to avoid 429s
- HIFLD may have CORS issues inside the Forma iframe — OSM is the automatic fallback
- `Forma.terrain.getElevationAt()` is per-point only (too slow for bulk mesh data — use `getTriangles` for bulk)
- Only one YAML toolbar button allowed per unpublished extension; second panel must use the Embedded Views field
- Extension icon is not settable for unpublished extensions (APS limitation)

---

## Changelog

### v1.3.7
- **New:** Elevation banding overlay — terrain colored by elevation, 6 auto-scaled bands (green → red), Gouraud shading, opacity slider, ft legend
- Spot elevation pin labels and markers scaled down another 20%

### v1.3.6
- **New:** Spot elevation tool — click any terrain point to place a labeled orange pin with elevation in ft; accumulates multiple pins with individual remove
- Pin/label size now proportional to terrain diagonal (auto-scales to site size)
- Label color changed to dark grey; crosshair darkened
- Panel list shows elevation in ft only

### v1.3.4 – v1.3.1
- Pipeline fetch stability fixes (sequential ordering to avoid Overpass 429s)
- Bbox-based queries, split endpoints, parallel fetches

### v1.3.0
- Voltage labels on transmission lines (stroke glyph font)
- Pipeline toggle layer added to power overlay

### v1.2.x
- Slope overlay switched to `Forma.render.addMesh` (renders above native Forma layers)
- Gouraud shading for smooth slope color transitions
- HIFLD primary source for transmission lines with OSM fallback

### v1.1.x
- Grid connection picker (HIFLD + OSM) with interconnection BOM section
- Multi-page Vite build (estimator + overlays as separate bundles)

### v1.0.0
- Initial release: Substation Estimator with RSMeans 2024 cost engine, CSV export, PDF report
