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

export function clearTerrainCache() { terrainCache = null; }

// ─── Cached raw slope pixel data (no alpha applied) ───────────────────────────
// Stored so opacity changes re-use the same render without new API calls.

let slopePixelCache: { data: Uint8ClampedArray; cols: number; rows: number } | null = null;

// ─── Slope overlay render ────────────────────────────────────────────────────

export async function renderSlopeOverlay(
  onProgress: (msg: string) => void,
  opacity = 0.80
): Promise<void> {
  const { Forma } = await import("forma-embedded-view-sdk/auto");

  let terrain: TerrainCache;

  if (!slopePixelCache) {
    // First render — fetch terrain and compute slope triangles
    onProgress("Reading terrain mesh…");
    terrain = await getTerrainData();
    onProgress("Computing slope from triangle normals…");

    const { triangles, minX, maxX, minY, maxY } = terrain;
    const W = maxX - minX, H = maxY - minY;
    const CELL = 2; // 2 m/px — fine enough to resolve individual slopes
    const cols = Math.ceil(W / CELL) + 2;
    const rows = Math.ceil(H / CELL) + 2;

    // World → canvas pixel (Y is flipped: canvas Y=0 is world north = high Y)
    const toPx = (wx: number, wy: number): [number, number] => [
      Math.round((wx - minX) / CELL),
      Math.round(rows - (wy - minY) / CELL),
    ];

    const canvas = document.createElement("canvas");
    canvas.width  = cols;
    canvas.height = rows;
    const ctx = canvas.getContext("2d")!;

    // Draw each terrain triangle with its face-normal slope color
    for (let i = 0; i < triangles.length; i += 9) {
      const x1 = triangles[i],   y1 = triangles[i+1], z1 = triangles[i+2];
      const x2 = triangles[i+3], y2 = triangles[i+4], z2 = triangles[i+5];
      const x3 = triangles[i+6], y3 = triangles[i+7], z3 = triangles[i+8];

      // Cross product → face normal
      const ex1 = x2-x1, ey1 = y2-y1, ez1 = z2-z1;
      const ex2 = x3-x1, ey2 = y3-y1, ez2 = z3-z1;
      const nx  = ey1*ez2 - ez1*ey2;
      const ny  = ez1*ex2 - ex1*ez2;
      const nz  = ex1*ey2 - ey1*ex2;
      const nLen = Math.sqrt(nx*nx + ny*ny + nz*nz);

      if (nLen < 1e-10) continue;

      // Skip wall triangles: |nz/nLen| < 0.2 means > ~78° tilt — not ground surface
      const cosAngle = Math.abs(nz) / nLen;
      if (cosAngle < 0.2) continue;

      // slope% = tan(arccos(cosAngle)) × 100 = sinAngle/cosAngle × 100
      const sinAngle = Math.sqrt(1 - cosAngle * cosAngle);
      const slopePct = (sinAngle / cosAngle) * 100;

      const band = SLOPE_BANDS.find(b => slopePct <= b.max) ?? SLOPE_BANDS[SLOPE_BANDS.length - 1];

      const [px1, py1] = toPx(x1, y1);
      const [px2, py2] = toPx(x2, y2);
      const [px3, py3] = toPx(x3, y3);

      ctx.fillStyle = band.color;
      ctx.beginPath();
      ctx.moveTo(px1, py1);
      ctx.lineTo(px2, py2);
      ctx.lineTo(px3, py3);
      ctx.closePath();
      ctx.fill();
    }

    // Cache raw pixel data (no alpha applied yet)
    const imgData = ctx.getImageData(0, 0, cols, rows);
    slopePixelCache = { data: imgData.data.slice(), cols, rows };

    // Store terrain bounds on the cache for groundTexture positioning
    (slopePixelCache as any).minX = minX;
    (slopePixelCache as any).maxX = maxX;
    (slopePixelCache as any).minY = minY;
    (slopePixelCache as any).maxY = maxY;
    (slopePixelCache as any).CELL = CELL;
  } else {
    terrain = await getTerrainData();
  }

  onProgress("Applying overlay…");
  await pushSlopeTexture(Forma, opacity);
  onProgress("done");
}

// Apply (or re-apply) opacity to cached slope pixel data → groundTexture
export async function updateSlopeOpacity(opacity: number): Promise<void> {
  if (!slopePixelCache) return;
  const { Forma } = await import("forma-embedded-view-sdk/auto");
  await pushSlopeTexture(Forma, opacity);
}

async function pushSlopeTexture(Forma: any, opacity: number): Promise<void> {
  if (!slopePixelCache) return;
  const { data, cols, rows } = slopePixelCache;
  const c  = (slopePixelCache as any);
  const CELL  = c.CELL;
  const minX  = c.minX, maxX = c.maxX;
  const minY  = c.minY, maxY = c.maxY;

  // Apply opacity to a copy of the raw pixel data
  const canvas = document.createElement("canvas");
  canvas.width  = cols;
  canvas.height = rows;
  const ctx     = canvas.getContext("2d")!;
  const imgData = ctx.createImageData(cols, rows);
  const alpha   = Math.round(opacity * 255);

  for (let i = 0; i < data.length; i += 4) {
    imgData.data[i]   = data[i];
    imgData.data[i+1] = data[i+1];
    imgData.data[i+2] = data[i+2];
    // Only set alpha where pixels were drawn (original alpha > 0)
    imgData.data[i+3] = data[i+3] > 0 ? alpha : 0;
  }
  ctx.putImageData(imgData, 0, 0);

  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;

  try {
    await Forma.terrain.groundTexture.updateTextureData({ name: "slope-overlay", canvas });
  } catch {
    // updateTextureData fails if texture doesn't exist yet — add it instead
    try { await Forma.terrain.groundTexture.remove({ name: "slope-overlay" }); } catch {}
    await Forma.terrain.groundTexture.add({
      name: "slope-overlay", canvas,
      position: { x: centerX, y: centerY, z: 2 },
      scale: { x: CELL, y: CELL },
    });
  }
}

export async function removeSlopeOverlay(): Promise<void> {
  slopePixelCache = null;
  const { Forma } = await import("forma-embedded-view-sdk/auto");
  try { await Forma.terrain.groundTexture.remove({ name: "slope-overlay" }); } catch {}
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

export type InfraFeature = {
  type:    "substation" | "plant" | "line";
  name:    string;
  lat:     number;
  lon:     number;
  voltage?: string;
  fuel?:   string;
  coords?: [number, number][];
};

export async function fetchPowerInfrastructure(
  lat: number, lon: number, radiusM = 40000,
  onProgress?: (msg: string) => void
): Promise<InfraFeature[]> {
  onProgress?.("Querying OpenStreetMap power infrastructure…");

  const query = `
    [out:json][timeout:25];
    (
      node["power"="substation"]["voltage"~"^[0-9]"](around:${radiusM},${lat},${lon});
      way["power"="substation"]["voltage"~"^[0-9]"](around:${radiusM},${lat},${lon});
      node["power"="plant"](around:${radiusM},${lat},${lon});
      way["power"="plant"](around:${radiusM},${lat},${lon});
      way["power"="line"]["voltage"~"^[1-9][0-9]{4,}"](around:${radiusM},${lat},${lon});
    );
    out center;
  `;

  const resp = await fetch("https://overpass-api.de/api/interpreter", {
    method: "POST",
    body: `data=${encodeURIComponent(query)}`,
  });
  if (!resp.ok) throw new Error(`OSM API error: ${resp.status}`);
  const data = await resp.json();

  const features: InfraFeature[] = [];
  for (const el of data.elements ?? []) {
    const clat = el.lat ?? el.center?.lat;
    const clon = el.lon ?? el.center?.lon;
    if (!clat || !clon) continue;
    const tags  = el.tags ?? {};
    const power = tags.power;
    const name  = tags.name || tags["name:en"] || "";
    const voltage = tags.voltage ?? "";

    if (power === "substation") {
      features.push({ type:"substation", name: name || `Substation (${voltage?voltage+"V":"HV"})`, lat:clat, lon:clon, voltage });
    } else if (power === "plant") {
      features.push({ type:"plant", name: name || "Power plant", lat:clat, lon:clon, fuel: tags.generator ?? tags["plant:source"] ?? "" });
    } else if (power === "line" && el.geometry) {
      const coords: [number,number][] = el.geometry.map((n:{lat:number;lon:number}) => [n.lat, n.lon] as [number,number]);
      if (coords.length >= 2) {
        features.push({ type:"line", name: name || `${voltage?voltage+"V ":""}Transmission line`, lat:clat, lon:clon, voltage, coords });
      }
    }
  }
  onProgress?.(`Found ${features.filter(f=>f.type==="substation").length} substations, ${features.filter(f=>f.type==="plant").length} plants, ${features.filter(f=>f.type==="line").length} lines`);
  return features;
}

function latLonToLocal(lat:number,lon:number,refLat:number,refLon:number):[number,number] {
  const R=6_371_000;
  const dx=(lon-refLon)*(Math.PI/180)*R*Math.cos(refLat*Math.PI/180);
  const dy=(lat-refLat)*(Math.PI/180)*R;
  return [dx,dy];
}

export async function renderPowerOverlay(
  features: InfraFeature[], refLat:number, refLon:number,
  visibleTypes: Set<"substation"|"plant"|"line">,
  onProgress:(msg:string)=>void
): Promise<void> {
  const { Forma } = await import("forma-embedded-view-sdk/auto");
  onProgress("Building infrastructure overlay…");

  const bbox = await Forma.terrain.getBbox();
  const {min,max} = bbox;
  const BUFFER_M = 30000;
  const canvasMinX=min.x-BUFFER_M, canvasMinY=min.y-BUFFER_M;
  const canvasW=(max.x-min.x)+BUFFER_M*2, canvasH=(max.y-min.y)+BUFFER_M*2;
  const PPM=1/20;
  const pxW=Math.ceil(canvasW*PPM), pxH=Math.ceil(canvasH*PPM);

  const canvas=document.createElement("canvas");
  canvas.width=pxW; canvas.height=pxH;
  const ctx=canvas.getContext("2d")!;

  const toPixel=(lx:number,ly:number):[number,number]=>[
    (lx-canvasMinX)*PPM,
    pxH-(ly-canvasMinY)*PPM,
  ];

  if (visibleTypes.has("line")) {
    ctx.strokeStyle="#e74c3c"; ctx.lineWidth=2;
    ctx.setLineDash([8,4]); ctx.globalAlpha=0.75;
    for (const f of features.filter(f=>f.type==="line"&&f.coords)) {
      const pts=f.coords!.map(([la,lo])=>{
        const [lx,ly]=latLonToLocal(la,lo,refLat,refLon);
        return toPixel(lx,ly);
      });
      if (pts.length<2) continue;
      ctx.beginPath(); ctx.moveTo(pts[0][0],pts[0][1]);
      for (let i=1;i<pts.length;i++) ctx.lineTo(pts[i][0],pts[i][1]);
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  if (visibleTypes.has("plant")) {
    for (const f of features.filter(f=>f.type==="plant")) {
      const [lx,ly]=latLonToLocal(f.lat,f.lon,refLat,refLon);
      const [px,py]=toPixel(lx,ly);
      ctx.globalAlpha=0.9;
      ctx.beginPath(); ctx.arc(px,py,14,0,Math.PI*2);
      ctx.fillStyle="#e67e22"; ctx.fill();
      ctx.strokeStyle="#fff"; ctx.lineWidth=2; ctx.stroke();
      ctx.fillStyle="#fff"; ctx.font="bold 14px sans-serif";
      ctx.textAlign="center"; ctx.textBaseline="middle";
      ctx.fillText("⚡",px,py);
      if (f.name) { ctx.globalAlpha=0.95; ctx.fillStyle="#000"; ctx.font="bold 11px Inter,sans-serif"; ctx.fillText(f.name.substring(0,24),px,py+20); }
    }
  }

  if (visibleTypes.has("substation")) {
    for (const f of features.filter(f=>f.type==="substation")) {
      const [lx,ly]=latLonToLocal(f.lat,f.lon,refLat,refLon);
      const [px,py]=toPixel(lx,ly);
      ctx.globalAlpha=0.92;
      const size=14;
      ctx.fillStyle="#0696d7"; ctx.fillRect(px-size/2,py-size/2,size,size);
      ctx.strokeStyle="#fff"; ctx.lineWidth=2; ctx.strokeRect(px-size/2,py-size/2,size,size);
      ctx.fillStyle="#fff"; ctx.font="bold 10px sans-serif"; ctx.textAlign="center"; ctx.textBaseline="middle";
      ctx.fillText("S",px,py);
      const label=f.name?f.name.substring(0,22):f.voltage?`${Number(f.voltage)>=1000?(Number(f.voltage)/1000).toFixed(0)+"kV":f.voltage+"V"} Sub`:"Substation";
      ctx.globalAlpha=0.95; ctx.fillStyle="#000"; ctx.font="10px Inter,sans-serif"; ctx.fillText(label,px,py+18);
    }
  }
  ctx.globalAlpha=1.0;

  onProgress("Applying infrastructure overlay…");
  const centerX=canvasMinX+canvasW/2, centerY=canvasMinY+canvasH/2;
  try { await Forma.terrain.groundTexture.remove({name:"power-overlay"}); } catch {}
  await Forma.terrain.groundTexture.add({
    name:"power-overlay", canvas,
    position:{x:centerX,y:centerY,z:3},
    scale:{x:1/PPM,y:1/PPM},
  });
  onProgress("done");
}

export async function removePowerOverlay(): Promise<void> {
  const { Forma } = await import("forma-embedded-view-sdk/auto");
  try { await Forma.terrain.groundTexture.remove({name:"power-overlay"}); } catch {}
}
