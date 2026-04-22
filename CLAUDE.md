# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Substation Estimator — Autodesk Forma Extension

## Project Overview
A Forma right-panel extension built for Pike EPC (pike.com), a utility 
infrastructure EPC contractor operating up to 500kV across 27 states.
Two tools in one deployment:
1. **Substation Estimator** — feasibility cost estimate from Forma site boundary
2. **Site Overlays** — slope analysis and power infrastructure overlays

## Deployment
- **Live URL:** https://substation-estimator.vercel.app
- **GitHub:** https://github.com/arqfernandolima-rgb/substation-estimator
- **Auto-deploy:** every `git push` to main triggers Vercel build
- **Two pages:** index.html (estimator) and overlays.html (overlays panel)

## Tech Stack
- React 19, Vite 8, TypeScript 6
- forma-embedded-view-sdk v0.93.0 — imported dynamically (`await import("forma-embedded-view-sdk/auto")`)
- No backend — all computation is client-side
- No test suite — ESLint only
- External APIs: OSM Overpass, FEMA NFHL, USGS seismic, EPA eGRID, HIFLD

## Build & Dev Commands
```bash
npm run dev      # localhost:3000
npm run build    # tsc -b (typecheck) then vite build → dist/; if tsc fails, bundle never runs
npm run preview  # serve dist/ locally (post-build smoke test)
npm run lint     # ESLint 9 flat config (eslint.config.js)
git add . && git commit -m "msg" && git push   # deploys to Vercel
```

## TypeScript Config Constraints
The tsconfig uses `erasableSyntaxOnly: true` — this forbids TypeScript-only runtime constructs: no `enum`, no `namespace`, no `const enum`. Use plain objects or union types instead. Also active: `noUnusedLocals`, `noUnusedParameters`, strict mode. Module resolution is "bundler" with `verbatimModuleSyntax`.

## Data Flow: Site Boundary → BOM

```
Forma SDK
  └─ useFormaIntegration.ts (hook, polls every 4000ms)
       ├─ getFootprint(site_limit) → polygon → shoelace → site area (SF/acres)
       ├─ geo-location → latLonToRegion() → 5 CCI cost zones
       ├─ getTriangles(terrain) → elevation range → classifyTerrain()
       └─ getTriangles(building) + ray-cast → FormaBuilding[] inside site
            ↓ SiteData + FormaBuilding[]
App.tsx (state machine: idle → configure → results)
  └─ computeBOM(Config, SiteData) in compute.ts
       ├─ Bay footprint × unit costs (RSMeans 2024)
       ├─ Multipliers: CCI (region) × terrain × GIS premium × bus config
       └─ BOMResult { sections[], grandTotal, footprintEstimate }
            ↓
  ├─ export.ts — exportCSV()
  └─ report.ts — printReport() → HTML in new tab → window.print()
```

`OverlaysApp.tsx` is a completely separate React app (separate entry point, separate Vite chunk) with no shared state with the estimator.

## State Management
Pure React hooks (`useState`, `useCallback`, `useRef`) — no Redux or Zustand. `App.tsx` manages ~15 state variables covering UI stage, config fields, section toggles, and loading states. Grid connection and auxiliary structures are part of the `Config` object passed to `computeBOM`.

## Dev Mode Mock Data
```typescript
const IS_IN_FORMA = window.location.search.includes("origin=");
```
When false, `useFormaIntegration.ts` returns `DEV_MOCK_SITE` (a hardcoded NC site). `OverlaysApp.tsx` falls back to lat/lon `35.732, -78.823` (Raleigh, NC). Both apps render fully in a plain browser tab for local development.

## Project Structure
```
src/
  App.tsx               — Main estimator UI (Configure → Results flow)
  OverlaysApp.tsx       — Site overlays right panel UI
  main.tsx              — Entry point for estimator
  overlays-main.tsx     — Entry point for overlays panel
  hooks/
    useFormaIntegration.ts  — All Forma SDK calls, site + building detection
  lib/
    compute.ts          — RSMeans 2024 BoM calculation engine
    overlays.ts         — Slope (getTriangles) and power overlay logic
    export.ts           — CSV export
    report.ts           — PDF print report generator
    standards.ts        — IEEE/RSMeans standards and assumptions data
index.html              — Estimator entry (floating panel)
overlays.html           — Overlays entry (right analysis panel)
vite.config.ts          — Multi-page build (both entry points)
```

## Forma SDK — Critical Rules (learned from experience)

### API method constraints
- `getFootprint()` works on: `site_limit`, `road`, `vegetation` (polylines only)
- `getTriangles()` works on: `building`, `terrain`, `constraints`, `vegetation` (meshes)
- Buildings MUST use `getTriangles()` — `getFootprint()` silently returns nothing
- Terrain MUST use `getTriangles()` for bulk data — `getElevationAt()` is too slow
- Category string is `"building"` singular, NOT `"buildings"` plural

### Coordinate system
- Forma local coords are in meters, Y = north (standard GIS)
- Canvas Y is top-down — ALWAYS flip Y when drawing: `py = rows - (y - minY) / CELL`
- `groundTexture.add()` position = center of canvas, scale = meters per pixel
- Z-ordering: slope overlay z=2, topo z=1, power z=3

### Terrain and slope
- Get terrain mesh: `getPathsByCategory({category:"terrain"})` then `getTriangles()`
- Slope per triangle: cross product → face normal → `tan(arccos(|nz|/|n|)) × 100`
- Skip wall triangles: `|nz|/|n| < 0.2` means >78° tilt, not ground surface
- Cache terrain data in module-level variable to avoid repeat API calls

### Building detection  
- Spatial filter: get site_limit footprint, test building centroid with ray-casting
- Floor area: sum XY area of triangles where all 3 vertices at minZ + 0.5m
- Prefer `Forma.areaMetrics.calculate()` for GFA over manual triangle math

### Iframe layout rules
- Right panel iframe: use `overflow-y: auto` NOT `overflow: hidden`
- Do NOT use `height: 100vh` — use `min-height: 100%` or block layout
- `position: absolute` inside toggles needs explicit `position: relative` parent

## Forma APS Extension Config
- Extension ID: 984b8119-06de-42b7-8977-990a244bab62
- Estimator: OPEN_FLOATING_PANEL, width 420, height 900
- Overlays: RIGHT_MENU_ANALYSIS_PANEL via Embedded views field in APS
- Only one YAML button allowed per extension (OPEN_FLOATING_PANEL only)
- Right panel registered via Embedded views UI field, not YAML
- Icon: not settable for unpublished extensions (APS limitation)

## Cost Data Basis
- RSMeans 2024 Heavy Construction (Gordian) — hardcoded constants in `compute.ts`
- AACE Class 5 estimate, accuracy ±30%
- Regional CCI adjustment from project geolocation (5 zones)
- Voltage classes: Distribution 28×45ft bay, Sub-tx 48×75ft, Trans 90×130ft (IEEE C2)
- GIS switchgear: ×1.6 cost multiplier, ×0.42 footprint multiplier vs AIS

## External APIs Used
| API | Purpose | Auth |
|-----|---------|------|
| OSM Overpass | Power infrastructure | None |
| FEMA NFHL | Flood zone | None |
| USGS | Seismic PGA | None |
| EPA eGRID | Grid carbon intensity | Hardcoded lookup |
| HIFLD ArcGIS | HV substations + lines | None (public) |

## Known Issues & Constraints
- HIFLD API may have CORS issues in Forma iframe — OSM is fallback
- OSM Overpass can be slow or rate-limited — 20s timeout with AbortController
- `geoData.upload()` adds to Forma library permanently — use `groundTexture` instead

## Current BoM Sections (Substation Estimator)
1. Civil & Site Work
2. Foundations & Concrete  
3. Structural Steel
4. Primary Equipment
5. Grounding System
6. Controls & SCADA
7. Auxiliary Structures (manual + Forma-detected buildings)
8. Grid Interconnection (optional — HIFLD/OSM connection picker)
9. Project Costs

## Feature Status
- ✅ Site boundary detection (getFootprint)
- ✅ Building detection (getTriangles + site spatial filter)
- ✅ Auto-detect building function with RSMeans $/SF
- ✅ GPS region + terrain auto-detection
- ✅ Slope overlay (per-triangle face normals, groundTexture canvas)
- ✅ Power infrastructure overlay (OSM Overpass, groundTexture)
- ✅ Grid connection picker (HIFLD primary, OSM fallback)
- ✅ PDF report (full HTML in new tab, auto-print)
- ✅ CSV export with standards section
- ✅ Standards & assumptions info panel
- 🔲 Estimate comparison (Site A vs Site B) — planned next
- 🔲 Scenario mode (Conservative / Recommended / Aggressive) — planned
