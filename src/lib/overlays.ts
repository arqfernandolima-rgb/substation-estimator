// ─── Slope overlay ────────────────────────────────────────────────────────────
//
// CORRECT APPROACH: slope is computed per-triangle from the face normal vector.
//   slope% = tan(arccos(|nz| / |normal|)) × 100
//
// This is the standard GIS definition of slope. Each triangle in the terrain
// mesh has an intrinsic slope — no grid, no averaging, no noise from wall
// triangles or vertex interpolation artifacts.
//
// Wall triangles (|nz| < threshold) are skipped — they are cliff/edge geometry
// not terrain surface, and computing slope from them is meaningless.

export const SLOPE_BANDS = [
  { max: 2,        label: "0–2% — Flat",         color: "#2ecc71", rgb: [46,204,113]  },
  { max: 5,        label: "2–5% — Gentle",        color: "#a8d847", rgb: [168,216,71]  },
  { max: 10,       label: "5–10% — Moderate",     color: "#f1c40f", rgb: [241,196,15]  },
  { max: 20,       label: "10–20% — Steep",        color: "#e67e22", rgb: [230,126,34]  },
  { max: 30,       label: "20–30% — Very steep",   color: "#e74c3c", rgb: [231,76,60]   },
  { max: Infinity, label: ">30% — Unbuildable",    color: "#8e44ad", rgb: [142,68,173]  },
] as const;

export type SlopeStatus = "idle" | "loading" | "on" | "error";

// ─── Shared terrain data (cached between slope and topo renders) ───────────────

type TerrainCache = {
  triangles:  Float32Array;
  minX: number; maxX: number;
  minY: number; maxY: number;
  minZ: number; maxZ: number;
};

let terrainCache: TerrainCache | null = null;

async function getTerrainData(): Promise<TerrainCache> {
  if (terrainCache) return terrainCache;

  const { Forma } = await import("forma-embedded-view-sdk/auto");
  const paths = await Forma.geometry.getPathsByCategory({ category: "terrain" });
  if (!paths?.length) throw new Error("No terrain found in this project.");

  const triangles = await Forma.geometry.getTriangles({ path: paths[0] });
  if (!triangles || triangles.length < 9) throw new Error("Could not read terrain mesh.");

  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;

  for (let i = 0; i < triangles.length; i += 3) {
    const x = triangles[i], y = triangles[i+1], z = triangles[i+2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }

  terrainCache = { triangles, minX, maxX, minY, maxY, minZ, maxZ };
  return terrainCache;
}

// ─── Slope mesh cache ─────────────────────────────────────────────────────────
// groundTexture renders below Forma's native layers (satellite, topo contours).
// Forma.render.addMesh renders above all layers — used here instead.

type SlopeMeshCache = {
  positions: Float32Array;
  slopePerVertex: Float32Array;
  meshId: string | null;
};

let slopeMeshCache: SlopeMeshCache | null = null;

export function clearTerrainCache() { terrainCache = null; slopeMeshCache = null; }

// ─── Slope overlay render (Gouraud mesh) ─────────────────────────────────────

export async function renderSlopeOverlay(
  onProgress: (msg: string) => void,
  opacity = 0.80
): Promise<void> {
  const { Forma } = await import("forma-embedded-view-sdk/auto");

  if (!slopeMeshCache) {
    onProgress("Reading terrain mesh…");
    const { triangles } = await getTerrainData();
    onProgress("Computing slope…");

    // Pass 1: compute face slope and accumulate per vertex (Gouraud averaging)
    const vkey = (x: number, y: number, z: number) =>
      `${x.toFixed(1)},${y.toFixed(1)},${z.toFixed(1)}`;

    const vertexAcc = new Map<string, { sum: number; n: number }>();
    const faceSlopes: number[] = [];

    for (let i = 0; i < triangles.length; i += 9) {
      const x1=triangles[i],   y1=triangles[i+1], z1=triangles[i+2];
      const x2=triangles[i+3], y2=triangles[i+4], z2=triangles[i+5];
      const x3=triangles[i+6], y3=triangles[i+7], z3=triangles[i+8];

      const ex1=x2-x1, ey1=y2-y1, ez1=z2-z1;
      const ex2=x3-x1, ey2=y3-y1, ez2=z3-z1;
      const nx = ey1*ez2 - ez1*ey2;
      const ny = ez1*ex2 - ex1*ez2;
      const nz = ex1*ey2 - ey1*ex2;
      const nLen = Math.sqrt(nx*nx + ny*ny + nz*nz);

      if (nLen < 1e-10) { faceSlopes.push(-1); continue; }
      const cosAngle = Math.abs(nz) / nLen;
      if (cosAngle < 0.2) { faceSlopes.push(-1); continue; }

      const slopePct = (Math.sqrt(1 - cosAngle*cosAngle) / cosAngle) * 100;
      faceSlopes.push(slopePct);

      for (const [vx,vy,vz] of [[x1,y1,z1],[x2,y2,z2],[x3,y3,z3]]) {
        const k = vkey(vx, vy, vz);
        const e = vertexAcc.get(k);
        if (e) { e.sum += slopePct; e.n++; }
        else vertexAcc.set(k, { sum: slopePct, n: 1 });
      }
    }

    // Pass 2: build position + per-vertex slope arrays (skip wall faces)
    const positions: number[] = [];
    const slopes: number[] = [];

    for (let fi = 0, i = 0; fi < faceSlopes.length; fi++, i += 9) {
      if (faceSlopes[fi] < 0) continue;
      const x1=triangles[i],   y1=triangles[i+1], z1=triangles[i+2];
      const x2=triangles[i+3], y2=triangles[i+4], z2=triangles[i+5];
      const x3=triangles[i+6], y3=triangles[i+7], z3=triangles[i+8];
      for (const [vx,vy,vz] of [[x1,y1,z1],[x2,y2,z2],[x3,y3,z3]]) {
        positions.push(vx, vy, vz + 0.5); // 0.5m lift prevents Z-fighting with terrain mesh
        const e = vertexAcc.get(vkey(vx,vy,vz))!;
        slopes.push(e.sum / e.n);
      }
    }

    slopeMeshCache = {
      positions: new Float32Array(positions),
      slopePerVertex: new Float32Array(slopes),
      meshId: null,
    };
  }

  onProgress("Rendering…");
  await pushSlopeMesh(Forma, opacity);
  onProgress("done");
}

async function pushSlopeMesh(Forma: any, opacity: number): Promise<void> {
  if (!slopeMeshCache) return;
  const { positions, slopePerVertex } = slopeMeshCache;
  const alpha = Math.round(opacity * 255);

  const colors = new Uint8Array(slopePerVertex.length * 4);
  for (let i = 0; i < slopePerVertex.length; i++) {
    const band = SLOPE_BANDS.find(b => slopePerVertex[i] <= b.max) ?? SLOPE_BANDS[SLOPE_BANDS.length - 1];
    colors[i*4]   = band.rgb[0];
    colors[i*4+1] = band.rgb[1];
    colors[i*4+2] = band.rgb[2];
    colors[i*4+3] = alpha;
  }

  const geometryData = { position: positions, color: colors };

  if (slopeMeshCache.meshId) {
    await Forma.render.updateMesh({ id: slopeMeshCache.meshId, geometryData });
  } else {
    const { id } = await Forma.render.addMesh({ geometryData });
    slopeMeshCache.meshId = id;
  }
}

export async function updateSlopeOpacity(opacity: number): Promise<void> {
  if (!slopeMeshCache?.meshId) return;
  const { Forma } = await import("forma-embedded-view-sdk/auto");
  await pushSlopeMesh(Forma, opacity);
}

export async function removeSlopeOverlay(): Promise<void> {
  const { Forma } = await import("forma-embedded-view-sdk/auto");
  if (slopeMeshCache?.meshId) {
    try { await Forma.render.remove({ id: slopeMeshCache.meshId }); } catch {}
    slopeMeshCache.meshId = null;
  }
  slopeMeshCache = null;
}

// ─── Contour / topo lines overlay ────────────────────────────────────────────
//
// Builds an elevation grid from terrain triangle centroids (near-horizontal
// triangles only), then runs marching squares to trace contour lines.

let topoPixelCache: { data: Uint8ClampedArray; cols: number; rows: number } | null = null;

export async function renderTopoOverlay(
  onProgress: (msg: string) => void,
  opacity   = 0.55,
  intervalM = 5,   // contour interval in meters
): Promise<void> {
  const { Forma } = await import("forma-embedded-view-sdk/auto");

  let terrain: TerrainCache;

  if (!topoPixelCache) {
    onProgress("Building elevation grid for contours…");
    terrain = await getTerrainData();

    const { triangles, minX, maxX, minY, maxY, minZ, maxZ } = terrain;
    const W = maxX - minX, H = maxY - minY;
    const CELL = 4; // 4 m/px — contours don't need sub-meter resolution
    const cols = Math.ceil(W / CELL) + 2;
    const rows = Math.ceil(H / CELL) + 2;

    // Build elevation grid from near-horizontal triangle centroids
    const elevSum   = new Float64Array(rows * cols);
    const elevCount = new Uint32Array(rows * cols);

    for (let i = 0; i < triangles.length; i += 9) {
      const x1=triangles[i],  y1=triangles[i+1], z1=triangles[i+2];
      const x2=triangles[i+3],y2=triangles[i+4], z2=triangles[i+5];
      const x3=triangles[i+6],y3=triangles[i+7], z3=triangles[i+8];

      // Face normal — skip wall triangles
      const ex1=x2-x1, ey1=y2-y1, ez1=z2-z1;
      const ex2=x3-x1, ey2=y3-y1, ez2=z3-z1;
      const nz  = ex1*ey2 - ey1*ex2;
      const nLen = Math.sqrt(
        (ey1*ez2-ez1*ey2)**2 + (ez1*ex2-ex1*ez2)**2 + nz**2
      );
      if (nLen < 1e-10 || Math.abs(nz)/nLen < 0.2) continue;

      // Centroid of surface triangle
      const cx = (x1+x2+x3)/3, cy = (y1+y2+y3)/3, cz = (z1+z2+z3)/3;
      const gc = Math.min(cols-1, Math.floor((cx-minX)/CELL));
      const gr = Math.min(rows-1, Math.floor((cy-minY)/CELL));
      if (gc < 0 || gr < 0) continue;
      elevSum[gr*cols+gc]   += cz;
      elevCount[gr*cols+gc] += 1;
    }

    // Average and fill gaps
    const elev = new Float32Array(rows * cols);
    let fb = minZ;
    for (let i = 0; i < elev.length; i++) {
      elev[i] = elevCount[i] > 0 ? elevSum[i]/elevCount[i] : NaN;
      if (elevCount[i] > 0) fb = elev[i];
    }
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        const i = r*cols+c;
        if (isNaN(elev[i])) {
          const nb = [
            r>0      ? elev[(r-1)*cols+c] : NaN,
            r<rows-1 ? elev[(r+1)*cols+c] : NaN,
            c>0      ? elev[r*cols+c-1]   : NaN,
            c<cols-1 ? elev[r*cols+c+1]   : NaN,
          ].filter(v=>!isNaN(v));
          elev[i] = nb.length ? nb.reduce((a,b)=>a+b,0)/nb.length : fb;
        }
      }

    onProgress("Tracing contour lines…");

    // Marching squares contour tracing
    const canvas = document.createElement("canvas");
    canvas.width  = cols;
    canvas.height = rows;
    const ctx = canvas.getContext("2d")!;

    // Contour levels
    const zMin = Math.ceil(minZ / intervalM) * intervalM;
    const zMax = Math.floor(maxZ / intervalM) * intervalM;

    // Helper: world→canvas (Y flipped)
    const toPx = (gc: number, gr: number): [number, number] => [gc, rows - gr];

    // Linear interpolation along edge where elevation = level
    const interp = (v0: number, v1: number, level: number): number =>
      (level - v0) / (v1 - v0);

    // Major contours (every 5× interval) are thicker/darker
    for (let level = zMin; level <= zMax; level += intervalM) {
      const isMajor = Math.round(level / intervalM) % 5 === 0;
      ctx.strokeStyle = isMajor ? "rgba(60,40,20,0.9)" : "rgba(90,60,30,0.6)";
      ctx.lineWidth   = isMajor ? 1.5 : 0.8;
      ctx.beginPath();

      for (let r = 0; r < rows-1; r++) {
        for (let c = 0; c < cols-1; c++) {
          // Values at 4 corners of this cell (bottom-left, bottom-right, top-right, top-left)
          const v00 = elev[r*cols+c];
          const v10 = elev[r*cols+c+1];
          const v11 = elev[(r+1)*cols+c+1];
          const v01 = elev[(r+1)*cols+c];

          if ([v00,v10,v11,v01].some(isNaN)) continue;

          // Marching squares case index
          const a = v00 >= level ? 1 : 0;
          const b = v10 >= level ? 2 : 0;
          const cc2 = v11 >= level ? 4 : 0;
          const d = v01 >= level ? 8 : 0;
          const idx = a | b | cc2 | d;

          if (idx === 0 || idx === 15) continue; // all below or all above

          // Edge midpoints (with interpolation)
          const B = interp(v00, v10, level); // bottom edge: (c+B, r)
          const R = interp(v10, v11, level); // right edge:  (c+1, r+R)
          const T = interp(v01, v11, level); // top edge:    (c+T, r+1)
          const L = interp(v00, v01, level); // left edge:   (c,   r+L)

          const pts: {x:number;y:number}[][] = [];

          // All 16 marching squares cases → line segment(s)
          switch (idx) {
            case 1:  case 14: pts.push([{x:c+B,y:r},{x:c,y:r+L}]); break;
            case 2:  case 13: pts.push([{x:c+B,y:r},{x:c+1,y:r+R}]); break;
            case 3:  case 12: pts.push([{x:c,y:r+L},{x:c+1,y:r+R}]); break;
            case 4:  case 11: pts.push([{x:c+1,y:r+R},{x:c+T,y:r+1}]); break;
            case 6:  case 9:  pts.push([{x:c+B,y:r},{x:c+T,y:r+1}]); break;
            case 7:  case 8:  pts.push([{x:c,y:r+L},{x:c+T,y:r+1}]); break;
            // Saddle cases — use average to disambiguate
            case 5:
              pts.push([{x:c+B,y:r},{x:c+1,y:r+R}],[{x:c,y:r+L},{x:c+T,y:r+1}]); break;
            case 10:
              pts.push([{x:c+B,y:r},{x:c,y:r+L}],[{x:c+1,y:r+R},{x:c+T,y:r+1}]); break;
          }

          for (const seg of pts) {
            if (seg.length < 2) continue;
            const [ax, ay] = toPx(seg[0].x, seg[0].y);
            const [bx, by] = toPx(seg[1].x, seg[1].y);
            ctx.moveTo(ax, ay);
            ctx.lineTo(bx, by);
          }
        }
      }
      ctx.stroke();
    }

    // Cache raw pixel data
    const imgData = ctx.getImageData(0, 0, cols, rows);
    topoPixelCache = { data: imgData.data.slice(), cols, rows };
    (topoPixelCache as any).minX = minX;
    (topoPixelCache as any).maxX = maxX;
    (topoPixelCache as any).minY = minY;
    (topoPixelCache as any).maxY = maxY;
    (topoPixelCache as any).CELL = CELL;
  }

  onProgress("Applying contours…");
  await pushTopoTexture(Forma, opacity);
  onProgress("done");
}

export async function updateTopoOpacity(opacity: number): Promise<void> {
  if (!topoPixelCache) return;
  const { Forma } = await import("forma-embedded-view-sdk/auto");
  await pushTopoTexture(Forma, opacity);
}

async function pushTopoTexture(Forma: any, opacity: number): Promise<void> {
  if (!topoPixelCache) return;
  const { data, cols, rows } = topoPixelCache;
  const c = topoPixelCache as any;

  const canvas = document.createElement("canvas");
  canvas.width  = cols;
  canvas.height = rows;
  const ctx     = canvas.getContext("2d")!;
  const imgData = ctx.createImageData(cols, rows);

  for (let i = 0; i < data.length; i += 4) {
    imgData.data[i]   = data[i];
    imgData.data[i+1] = data[i+1];
    imgData.data[i+2] = data[i+2];
    imgData.data[i+3] = data[i+3] > 0 ? Math.round(data[i+3] * opacity) : 0;
  }
  ctx.putImageData(imgData, 0, 0);

  const centerX = (c.minX + c.maxX) / 2;
  const centerY = (c.minY + c.maxY) / 2;

  try {
    await Forma.terrain.groundTexture.updateTextureData({ name: "topo-overlay", canvas });
  } catch {
    try { await Forma.terrain.groundTexture.remove({ name: "topo-overlay" }); } catch {}
    await Forma.terrain.groundTexture.add({
      name: "topo-overlay", canvas,
      position: { x: centerX, y: centerY, z: 1 }, // below slope (z:2)
      scale: { x: c.CELL, y: c.CELL },
    });
  }
}

export async function removeTopoOverlay(): Promise<void> {
  topoPixelCache = null;
  const { Forma } = await import("forma-embedded-view-sdk/auto");
  try { await Forma.terrain.groundTexture.remove({ name: "topo-overlay" }); } catch {}
}

// ─── Power infrastructure overlay ────────────────────────────────────────────
// Uses Forma.render.addMesh (same as slope) so it renders above native layers.
// groundTexture.add() renders below satellite/topo and was the original bug.

let powerMeshCache: { meshId: string | null } | null = null;

export type InfraFeature = {
  type:    "substation" | "plant" | "line" | "pipeline";
  name:    string;
  lat:     number;
  lon:     number;
  voltage?: string;
  fuel?:   string;
  coords?: [number, number][];
};

// ─── HIFLD transmission lines ────────────────────────────────────────────────
// Only Electric_Power_Transmission_Lines is confirmed live at this org.
// Substations and plants are fetched from OSM separately.

const HIFLD_LINES = "https://services1.arcgis.com/Hp6G80Pky0om7QvQ/arcgis/rest/services/Electric_Power_Transmission_Lines/FeatureServer/0/query";

async function fetchHIFLDLines(
  lat: number, lon: number, radiusM: number,
): Promise<InfraFeature[]> {
  const latD = radiusM / 111320;
  const lonD = radiusM / (111320 * Math.cos(lat * Math.PI / 180));
  const bbox = JSON.stringify({ xmin: lon-lonD, ymin: lat-latD, xmax: lon+lonD, ymax: lat+latD });
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 25000);
  const url = `${HIFLD_LINES}?where=STATUS%3D'IN+SERVICE'` +
    `&geometry=${encodeURIComponent(bbox)}&geometryType=esriGeometryEnvelope&inSR=4326` +
    `&spatialRel=esriSpatialRelIntersects&outFields=VOLTAGE,VOLT_CLASS,SUB_1,SUB_2` +
    `&returnGeometry=true&outSR=4326&f=json`;
  try {
    const resp = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!resp.ok) throw new Error(`HIFLD HTTP ${resp.status}`);
    const json = await resp.json();
    if (json.error) throw new Error(`HIFLD: ${json.error.message}`);
    const features: InfraFeature[] = [];
    for (const f of json.features ?? []) {
      const paths: number[][][] = f.geometry?.paths ?? [];
      if (!paths.length || paths[0].length < 2) continue;
      const path = paths[0];
      const mid  = path[Math.floor(path.length / 2)];
      const kv   = parseFloat(f.attributes?.VOLTAGE ?? "");
      const s1   = (f.attributes?.SUB_1 ?? "").replace(/^(TAP|UNKNOWN)\d+$/i, "");
      const s2   = (f.attributes?.SUB_2 ?? "").replace(/^(TAP|UNKNOWN)\d+$/i, "");
      const name = (s1 && s2) ? `${s1} → ${s2}` : (kv ? `${kv}kV Line` : f.attributes?.VOLT_CLASS || "Transmission line");
      features.push({
        type: "line", name,
        lat: mid[1], lon: mid[0],
        voltage: kv ? String(Math.round(kv * 1000)) : "",
        coords: path.map((pt: number[]) => [pt[1], pt[0]] as [number, number]),
      });
    }
    return features;
  } catch (e) { clearTimeout(timer); throw e; }
}

// ─── OSM Overpass ─────────────────────────────────────────────────────────────

const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

async function overpassFetch(query: string): Promise<any> {
  const body = `data=${encodeURIComponent(query)}`;
  const headers = { "Content-Type": "application/x-www-form-urlencoded" };
  let lastErr: unknown;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 25000);
      const resp = await fetch(endpoint, { method: "POST", headers, body, signal: ctrl.signal });
      clearTimeout(timer);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      return await resp.json();
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

// Substations + plants only — no lines (HIFLD handles those), keeps query fast
async function fetchOSMSubstationsPlants(
  lat: number, lon: number, radiusM: number,
): Promise<InfraFeature[]> {
  const query = `
    [out:json][timeout:20];
    (
      node["power"="substation"]["voltage"~"^[1-9]"](around:${radiusM},${lat},${lon});
      way["power"="substation"]["voltage"~"^[1-9]"](around:${radiusM},${lat},${lon});
      node["power"="plant"](around:${radiusM},${lat},${lon});
      way["power"="plant"](around:${radiusM},${lat},${lon});
    );
    out center;
  `;
  const data = await overpassFetch(query);
  const features: InfraFeature[] = [];
  for (const el of data.elements ?? []) {
    const clat = el.lat ?? el.center?.lat;
    const clon = el.lon ?? el.center?.lon;
    if (!clat || !clon) continue;
    const tags  = el.tags ?? {};
    const name  = tags.name || tags["name:en"] || "";
    const voltage = tags.voltage ?? "";
    if (tags.power === "substation") {
      features.push({ type:"substation", name: name || `Substation (${voltage||"HV"})`, lat:clat, lon:clon, voltage });
    } else if (tags.power === "plant") {
      features.push({ type:"plant", name: name || "Power plant", lat:clat, lon:clon, fuel: tags["plant:source"] ?? tags.generator ?? "" });
    }
  }
  return features;
}

async function fetchOSMPipelines(
  lat: number, lon: number, radiusM: number,
): Promise<InfraFeature[]> {
  // Broad query: man_made=pipeline covers most tagged pipelines; adding ways with
  // any pipeline=* tag catches oil/gas lines tagged by substance rather than man_made.
  const query = `
    [out:json][timeout:25];
    (
      way["man_made"="pipeline"](around:${radiusM},${lat},${lon});
      way["pipeline"~"."](around:${radiusM},${lat},${lon});
    );
    out geom;
  `;
  const data = await overpassFetch(query);
  const seen = new Set<string>();
  const features: InfraFeature[] = [];
  for (const el of data.elements ?? []) {
    if (!el.geometry || el.geometry.length < 2) continue;
    const id = String(el.id);
    if (seen.has(id)) continue;
    seen.add(id);
    const tags = el.tags ?? {};
    const substance = tags.substance || tags.pipeline || "";
    const name = tags.name || (substance ? `${substance} pipeline` : "Pipeline");
    const midIdx = Math.floor(el.geometry.length / 2);
    const mid = el.geometry[midIdx];
    const coords: [number,number][] = el.geometry.map((n:{lat:number;lon:number}) => [n.lat, n.lon] as [number,number]);
    features.push({ type:"pipeline", name, lat:mid.lat, lon:mid.lon, coords });
  }
  return features;
}

// Full OSM fallback (lines + subs + plants) used only when both primary sources fail
async function fetchOSMAll(
  lat: number, lon: number, radiusM: number,
): Promise<InfraFeature[]> {
  const query = `
    [out:json][timeout:25];
    (
      node["power"="substation"]["voltage"~"^[1-9]"](around:${radiusM},${lat},${lon});
      way["power"="substation"]["voltage"~"^[1-9]"](around:${radiusM},${lat},${lon});
      node["power"="plant"](around:${radiusM},${lat},${lon});
      way["power"="plant"](around:${radiusM},${lat},${lon});
      way["power"="line"]["voltage"~"^[1-9][0-9]{4,}"](around:${radiusM},${lat},${lon});
    );
    out center geom;
  `;
  const data = await overpassFetch(query);
  const features: InfraFeature[] = [];
  for (const el of data.elements ?? []) {
    const clat = el.lat ?? el.center?.lat;
    const clon = el.lon ?? el.center?.lon;
    if (!clat || !clon) continue;
    const tags  = el.tags ?? {};
    const name  = tags.name || tags["name:en"] || "";
    const voltage = tags.voltage ?? "";
    if (tags.power === "substation") {
      features.push({ type:"substation", name: name || `Substation (${voltage||"HV"})`, lat:clat, lon:clon, voltage });
    } else if (tags.power === "plant") {
      features.push({ type:"plant", name: name || "Power plant", lat:clat, lon:clon, fuel: tags["plant:source"] ?? tags.generator ?? "" });
    } else if (tags.power === "line" && el.geometry) {
      const coords: [number,number][] = el.geometry.map((n:{lat:number;lon:number}) => [n.lat, n.lon] as [number,number]);
      if (coords.length >= 2) features.push({ type:"line", name: name || `${voltage?voltage+"V ":""}Transmission line`, lat:clat, lon:clon, voltage, coords });
    }
  }
  return features;
}

export async function fetchPowerInfrastructure(
  lat: number, lon: number, radiusM = 40000,
  onProgress?: (msg: string) => void,
  includePipelines = false,
): Promise<InfraFeature[]> {
  onProgress?.("Querying power infrastructure…");

  const [linesResult, osmResult, pipelineResult] = await Promise.allSettled([
    fetchHIFLDLines(lat, lon, radiusM),
    fetchOSMSubstationsPlants(lat, lon, radiusM),
    includePipelines ? fetchOSMPipelines(lat, lon, radiusM) : Promise.resolve([] as InfraFeature[]),
  ]);

  const features: InfraFeature[] = [];
  if (linesResult.status   === "fulfilled") features.push(...linesResult.value);
  if (osmResult.status     === "fulfilled") features.push(...osmResult.value);
  if (pipelineResult.status === "fulfilled") features.push(...pipelineResult.value);

  // If we got no power features at all, fall back to full OSM query
  if (features.filter(f => f.type !== "pipeline").length === 0) {
    onProgress?.("Primary sources unavailable, trying OSM fallback…");
    const fallback = await fetchOSMAll(lat, lon, radiusM);
    features.push(...fallback);
  }

  const subs      = features.filter(f=>f.type==="substation").length;
  const plants    = features.filter(f=>f.type==="plant").length;
  const lines     = features.filter(f=>f.type==="line").length;
  const pipelines = features.filter(f=>f.type==="pipeline").length;
  const pipeStr   = includePipelines ? `, ${pipelines} pipelines` : "";
  onProgress?.(`Found ${subs} substations, ${plants} plants, ${lines} lines${pipeStr}`);
  return features;
}

function latLonToLocal(lat:number,lon:number,refLat:number,refLon:number):[number,number] {
  const R=6_371_000;
  const dx=(lon-refLon)*(Math.PI/180)*R*Math.cos(refLat*Math.PI/180);
  const dy=(lat-refLat)*(Math.PI/180)*R;
  return [dx,dy];
}

// ─── Stroke font for always-visible voltage labels ────────────────────────────
// 3×5 unit cell per glyph. Segments are [x1,y1,x2,y2], y=0 bottom, y=5 top, midline at y=2.5.

const GLYPHS: Record<string, [number,number,number,number][]> = {
  '0': [[0,5,3,5],[0,0,0,5],[3,0,3,5],[0,0,3,0]],
  '1': [[1.5,5,1.5,0]],
  '2': [[0,5,3,5],[3,5,3,2.5],[0,2.5,3,2.5],[0,2.5,0,0],[0,0,3,0]],
  '3': [[0,5,3,5],[3,5,3,0],[0,2.5,3,2.5],[0,0,3,0]],
  '4': [[0,5,0,2.5],[0,2.5,3,2.5],[3,5,3,0]],
  '5': [[0,5,3,5],[0,5,0,2.5],[0,2.5,3,2.5],[3,2.5,3,0],[0,0,3,0]],
  '6': [[0,5,3,5],[0,5,0,0],[0,2.5,3,2.5],[3,2.5,3,0],[0,0,3,0]],
  '7': [[0,5,3,5],[3,5,3,0]],
  '8': [[0,5,3,5],[0,0,0,5],[3,0,3,5],[0,0,3,0],[0,2.5,3,2.5]],
  '9': [[0,5,3,5],[0,5,0,2.5],[3,5,3,0],[0,2.5,3,2.5],[0,0,3,0]],
  'k': [[0,5,0,0],[0,2.5,3,5],[0,2.5,3,0]],
  'K': [[0,5,0,0],[0,2.5,3,5],[0,2.5,3,0]],
  'V': [[0,5,1.5,0],[3,5,1.5,0]],
  'v': [[0,5,1.5,0],[3,5,1.5,0]],
  ' ': [],
};

export async function renderPowerOverlay(
  features: InfraFeature[], refLat: number, refLon: number,
  visibleTypes: Set<"substation"|"plant"|"line"|"pipeline">,
  onProgress: (msg: string) => void
): Promise<void> {
  const { Forma } = await import("forma-embedded-view-sdk/auto");
  onProgress("Building infrastructure overlay…");

  // Place geometry 50m above terrain surface so it's always visible
  let baseZ = 200;
  try { const t = await getTerrainData(); baseZ = t.maxZ + 50; } catch { /* use default */ }

  const LINE_W = 6;   // ribbon width in meters for transmission lines
  const PT_SZ  = 60;  // square side in meters for point markers

  const positions: number[] = [];
  const colors:   number[] = [];

  function vert(x: number, y: number, z: number, r: number, g: number, b: number, a: number) {
    positions.push(x, y, z);
    colors.push(r, g, b, a);
  }

  function addSegment(
    x1: number, y1: number, x2: number, y2: number, z: number,
    w: number,
    r: number, g: number, b: number, a: number
  ) {
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.sqrt(dx*dx + dy*dy);
    if (len < 0.1) return;
    const nx = (-dy / len) * w / 2;
    const ny = ( dx / len) * w / 2;
    const lax=x1+nx, lay=y1+ny, rax=x1-nx, ray=y1-ny;
    const lbx=x2+nx, lby=y2+ny, rbx=x2-nx, rby=y2-ny;
    vert(lax,lay,z, r,g,b,a); vert(rax,ray,z, r,g,b,a); vert(lbx,lby,z, r,g,b,a);
    vert(rax,ray,z, r,g,b,a); vert(rbx,rby,z, r,g,b,a); vert(lbx,lby,z, r,g,b,a);
  }

  function addBox(cx: number, cy: number, z: number, size: number, r: number, g: number, b: number, a: number) {
    const h = size / 2;
    vert(cx-h,cy-h,z, r,g,b,a); vert(cx+h,cy-h,z, r,g,b,a); vert(cx+h,cy+h,z, r,g,b,a);
    vert(cx-h,cy-h,z, r,g,b,a); vert(cx+h,cy+h,z, r,g,b,a); vert(cx-h,cy+h,z, r,g,b,a);
  }

  // Render a voltage string (e.g. "230kV") as stroke geometry centered on cx,cy
  function addGlyphLabel(
    cx: number, cy: number, z: number,
    text: string, charH: number,
    r: number, g: number, b: number, a: number
  ) {
    const scale   = charH / 5;          // 5 = glyph height in units
    const sw      = Math.max(scale * 0.55, 1);
    const advance = 4 * scale;
    const totalW  = text.length * advance - scale;
    let ox = cx - totalW / 2;
    for (const ch of text) {
      for (const [x1,y1,x2,y2] of (GLYPHS[ch] ?? [])) {
        addSegment(
          ox + x1*scale, cy + (y1-2.5)*scale,
          ox + x2*scale, cy + (y2-2.5)*scale,
          z, sw, r, g, b, a
        );
      }
      ox += advance;
    }
  }

  if (visibleTypes.has("pipeline")) {
    for (const f of features.filter(f => f.type === "pipeline" && f.coords)) {
      const pts = f.coords!.map(([la, lo]) => latLonToLocal(la, lo, refLat, refLon));
      for (let i = 0; i < pts.length - 1; i++)
        addSegment(pts[i][0], pts[i][1], pts[i+1][0], pts[i+1][1], baseZ, LINE_W, 39, 174, 96, 200);
    }
  }

  if (visibleTypes.has("line")) {
    for (const f of features.filter(f => f.type === "line" && f.coords)) {
      const pts = f.coords!.map(([la, lo]) => latLonToLocal(la, lo, refLat, refLon));
      for (let i = 0; i < pts.length - 1; i++)
        addSegment(pts[i][0], pts[i][1], pts[i+1][0], pts[i+1][1], baseZ, LINE_W, 231, 76, 60, 200);
    }
    // Voltage labels at each line's midpoint — rendered above lines (baseZ+1)
    const CHAR_H = 80;
    for (const f of features.filter(f => f.type === "line")) {
      const v = parseInt(f.voltage ?? "0");
      if (!v) continue;
      const kv = Math.round(v / 1000);
      const [lx, ly] = latLonToLocal(f.lat, f.lon, refLat, refLon);
      addGlyphLabel(lx, ly + CHAR_H * 0.9, baseZ + 1, `${kv}kV`, CHAR_H, 255, 255, 255, 230);
    }
  }

  if (visibleTypes.has("plant")) {
    for (const f of features.filter(f => f.type === "plant")) {
      const [lx, ly] = latLonToLocal(f.lat, f.lon, refLat, refLon);
      addBox(lx, ly, baseZ, PT_SZ, 230, 126, 34, 230);
    }
  }

  if (visibleTypes.has("substation")) {
    for (const f of features.filter(f => f.type === "substation")) {
      const [lx, ly] = latLonToLocal(f.lat, f.lon, refLat, refLon);
      addBox(lx, ly, baseZ, PT_SZ, 6, 150, 215, 230);
    }
  }

  if (positions.length === 0) { onProgress("done"); return; }

  onProgress("Applying overlay…");
  const geometryData = {
    position: new Float32Array(positions),
    color: new Uint8Array(colors),
  };

  if (powerMeshCache?.meshId) {
    await Forma.render.updateMesh({ id: powerMeshCache.meshId, geometryData });
  } else {
    const { id } = await Forma.render.addMesh({ geometryData });
    powerMeshCache = { meshId: id };
  }
  onProgress("done");
}

export async function removePowerOverlay(): Promise<void> {
  const { Forma } = await import("forma-embedded-view-sdk/auto");
  if (powerMeshCache?.meshId) {
    try { await Forma.render.remove({ id: powerMeshCache.meshId }); } catch {}
    powerMeshCache = null;
  }
  // Clean up any legacy groundTexture from before this fix
  try { await Forma.terrain.groundTexture.remove({ name: "power-overlay" }); } catch {}
}
