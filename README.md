# Substation Estimator — Forma Extension

Right-panel Forma extension for preliminary substation design cost estimation.
Reads site boundary polygons directly from Forma, computes a full bill of
materials using RSMeans 2024 unit costs adjusted by regional CCI, and exports
to CSV or PDF.

---

## Quick start

```bash
npm install
npm run dev        # http://localhost:3000
```

Then register the extension in APS and install it in your Forma project (see below).

---

## Forma API integration

| Call | What it does |
|------|-------------|
| `Forma.geometry.getPathsByCategory({ category: "site_limit" })` | Detects drawn site boundary → `string[]` of paths |
| `Forma.geometry.getFootprint({ path })` | Returns `{ type, coordinates: [x,y][] }` in local meters |
| `Forma.project.get()` | Project name |
| `Forma.project.getGeoLocation()` | `[latitude, longitude]` → RSMeans CCI region |
| `Forma.terrain.getBbox()` | `{ min, max }` elevation → terrain roughness class |

The hook polls every 4 s so the estimate auto-refreshes when the user
redraws the site boundary polygon.

---

## Register the extension in APS

1. Go to https://aps.autodesk.com → Your App → **Forma Extensions**
2. Create extension:
   - **Type:** Right panel (Analysis panel)
   - **URL (dev):** `http://localhost:3000`
3. Copy the Extension ID

## Install in Forma

1. Open Forma → your project
2. Extensions menu (puzzle icon) → find **Substation Estimator** → Install
3. The panel appears in the right rail next to the Analyze panel

---

## Project structure

```
src/
  hooks/
    useFormaIntegration.ts   ← Forma SDK: site area, geo, terrain
  lib/
    compute.ts               ← RSMeans 2024 BoM engine
    export.ts                ← CSV export
  App.tsx                    ← UI: idle → configure → results
  main.tsx                   ← React entry
index.html
vite.config.ts
```

## Deploy to production

```bash
npm run build                # outputs dist/
```

Upload `dist/` to any static HTTPS host (Vercel, Netlify, S3+CloudFront).
Update your APS extension URL to the production HTTPS endpoint.

---

## Cost data

All unit costs: **RSMeans 2024 Heavy Construction** (Gordian), CSI Divisions
03, 05, 26, 27, 31, 33. Regional adjustment via City Cost Index (CCI).

**Feasibility grade ±30%.** Swap unit costs in `src/lib/compute.ts` with
licensed RSMeans API data or project-specific values for higher accuracy.
