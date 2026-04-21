// ─── Slope overlay ────────────────────────────────────────────────────────────
// Uses Forma.terrain.getElevationAt() to sample a grid across the site,
// computes slope per cell, maps to color bands, paints onto an HTML canvas,
// and pushes via Forma.terrain.groundTexture.add()

export const SLOPE_BANDS = [
  { max: 2,   label: "0–2% (Flat)",       color: "#2ecc71", alpha: 0.70 },
  { max: 5,   label: "2–5% (Gentle)",     color: "#a8d847", alpha: 0.70 },
  { max: 10,  label: "5–10% (Moderate)",  color: "#f1c40f", alpha: 0.72 },
  { max: 20,  label: "10–20% (Steep)",    color: "#e67e22", alpha: 0.74 },
  { max: 30,  label: "20–30% (Very steep)",color:"#e74c3c", alpha: 0.76 },
  { max: Infinity, label: ">30% (Unbuildable)", color: "#8e44ad", alpha: 0.80 },
] as const;

export type SlopeStatus = "idle" | "sampling" | "rendering" | "done" | "error";

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export async function renderSlopeOverlay(
  onProgress: (msg: string) => void
): Promise<void> {
  const { Forma } = await import("forma-embedded-view-sdk/auto");

  // ── Step 1: Get terrain mesh in ONE call ──────────────────────────────────
  // getTriangles() returns the entire terrain as a flat Float32Array:
  // [x1,y1,z1, x2,y2,z2, x3,y3,z3, ...] — all vertices of all triangles.
  // This is a single async round-trip, unlike getElevationAt() which requires
  // one round-trip per sample point.

  onProgress("Reading terrain mesh…");

  const terrainPaths = await Forma.geometry.getPathsByCategory({ category: "terrain" });
  if (!terrainPaths?.length) throw new Error("No terrain found in this project.");

  const triangles = await Forma.geometry.getTriangles({ path: terrainPaths[0] });
  if (!triangles || triangles.length < 9) throw new Error("Could not read terrain geometry.");

  onProgress("Computing slope from mesh…");

  // ── Step 2: Find mesh bounds ───────────────────────────────────────────────
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < triangles.length; i += 3) {
    const x = triangles[i], y = triangles[i + 1];
    if (x < minX) minX = x;  if (x > maxX) maxX = x;
    if (y < minY) minY = y;  if (y > maxY) maxY = y;
  }

  const W = maxX - minX, H = maxY - minY;
  const CELL = 4; // 4 m per grid cell — good visual resolution
  const cols = Math.ceil(W / CELL);
  const rows = Math.ceil(H / CELL);

  // ── Step 3: Bin all vertices into a regular elevation grid (pure CPU) ──────
  // Each grid cell gets the average Z of all terrain vertices that fall in it.
  const elevSum   = new Float64Array(rows * cols);
  const elevCount = new Uint32Array(rows * cols);

  for (let i = 0; i < triangles.length; i += 3) {
    const x = triangles[i], y = triangles[i + 1], z = triangles[i + 2];
    const c = Math.min(cols - 1, Math.floor((x - minX) / CELL));
    const r = Math.min(rows - 1, Math.floor((y - minY) / CELL));
    if (c >= 0 && r >= 0) {
      elevSum[r * cols + c]   += z;
      elevCount[r * cols + c] += 1;
    }
  }

  const elev = new Float32Array(rows * cols);
  let fallbackZ = 0;
  for (let i = 0; i < elev.length; i++) {
    elev[i] = elevCount[i] > 0 ? elevSum[i] / elevCount[i] : NaN;
    if (elevCount[i] > 0 && fallbackZ === 0) fallbackZ = elev[i];
  }

  // Fill empty cells (no vertices landed there) with nearest valid neighbor
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      if (!isNaN(elev[i])) continue;
      const neighbors = [
        r > 0      ? elev[(r-1)*cols+c]   : NaN,
        r < rows-1 ? elev[(r+1)*cols+c]   : NaN,
        c > 0      ? elev[r*cols+(c-1)]   : NaN,
        c < cols-1 ? elev[r*cols+(c+1)]   : NaN,
      ].filter(v => !isNaN(v));
      elev[i] = neighbors.length ? neighbors.reduce((a,b)=>a+b,0)/neighbors.length : fallbackZ;
    }
  }

  // ── Step 4: Compute slope per cell & draw canvas ───────────────────────────
  onProgress("Rendering slope bands…");

  const canvas = document.createElement("canvas");
  canvas.width  = cols;
  canvas.height = rows;
  const ctx     = canvas.getContext("2d")!;
  const imgData = ctx.createImageData(cols, rows);
  const px      = imgData.data;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c;

      // Central differences (fall back to one-sided at edges)
      const zE = c < cols-1 ? elev[idx + 1]    : elev[idx];
      const zW = c > 0      ? elev[idx - 1]    : elev[idx];
      const zN = r < rows-1 ? elev[idx + cols] : elev[idx];
      const zS = r > 0      ? elev[idx - cols] : elev[idx];

      const dzdx  = (zE - zW) / (2 * CELL);
      const dzdy  = (zN - zS) / (2 * CELL);
      const pct   = Math.sqrt(dzdx ** 2 + dzdy ** 2) * 100;

      const band  = SLOPE_BANDS.find(b => pct <= b.max) ?? SLOPE_BANDS[SLOPE_BANDS.length - 1];
      const [rr, gg, bb] = hexToRgb(band.color);

      const pi    = (r * cols + c) * 4;
      px[pi]      = rr;
      px[pi + 1]  = gg;
      px[pi + 2]  = bb;
      px[pi + 3]  = Math.round(band.alpha * 255);
    }
  }
  ctx.putImageData(imgData, 0, 0);

  // ── Step 5: Push canvas to terrain as ground texture ─────────────────────
  onProgress("Applying overlay to terrain…");

  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;

  try { await Forma.terrain.groundTexture.remove({ name: "slope-overlay" }); } catch { /* ok */ }

  await Forma.terrain.groundTexture.add({
    name:     "slope-overlay",
    canvas,
    position: { x: centerX, y: centerY, z: 1 },
    scale:    { x: CELL, y: CELL },
  });

  onProgress("done");
}

export async function removeSlopeOverlay(): Promise<void> {
  const { Forma } = await import("forma-embedded-view-sdk/auto");
  try { await Forma.terrain.groundTexture.remove({ name: "slope-overlay" }); } catch { /* ok */ }
}

// ─── Power infrastructure overlay ─────────────────────────────────────────────
// Fetches substations, power plants, and transmission lines from OSM Overpass API
// then renders them as a groundTexture canvas overlay on the terrain.
// groundTexture keeps things ephemeral — nothing gets added to the Forma library.

export type InfraFeature = {
  type:   "substation" | "plant" | "line";
  name:   string;
  lat:    number;
  lon:    number;
  voltage?: string;
  fuel?:  string;
  // for lines: array of coordinate pairs
  coords?: [number, number][];
};

export type InfraStatus = "idle" | "fetching" | "rendering" | "done" | "error";

// Fetch from OSM Overpass API
export async function fetchPowerInfrastructure(
  lat: number,
  lon: number,
  radiusM: number = 40000,   // 25 miles
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

    const tags = el.tags ?? {};
    const power = tags.power;
    const name  = tags.name || tags["name:en"] || "";
    const voltage = tags.voltage ?? "";

    if (power === "substation") {
      features.push({ type: "substation", name: name || `Substation (${voltage ? voltage + "V" : "HV"})`, lat: clat, lon: clon, voltage });
    } else if (power === "plant") {
      features.push({ type: "plant", name: name || "Power plant", lat: clat, lon: clon, fuel: tags.generator ?? tags["plant:source"] ?? "" });
    } else if (power === "line" && el.geometry) {
      // transmission lines have node geometries on the way
      const coords: [number, number][] = el.geometry.map((n: {lat:number;lon:number}) => [n.lat, n.lon] as [number, number]);
      if (coords.length >= 2) {
        features.push({ type: "line", name: name || `${voltage ? voltage + "V " : ""}Transmission line`, lat: clat, lon: clon, voltage, coords });
      }
    }
  }

  onProgress?.(`Found ${features.filter(f=>f.type==="substation").length} substations, ${features.filter(f=>f.type==="plant").length} plants, ${features.filter(f=>f.type==="line").length} lines`);
  return features;
}

// Convert lat/lon → local Forma coordinates
// Uses equirectangular projection relative to project origin
function latLonToLocal(
  lat: number, lon: number,
  refLat: number, refLon: number
): [number, number] {
  const R = 6_371_000;  // Earth radius in meters
  const dx = (lon - refLon) * (Math.PI / 180) * R * Math.cos(refLat * Math.PI / 180);
  const dy = (lat - refLat) * (Math.PI / 180) * R;
  return [dx, dy];
}

// Render all infrastructure features as a groundTexture canvas
export async function renderPowerOverlay(
  features: InfraFeature[],
  refLat: number,
  refLon: number,
  visibleTypes: Set<"substation" | "plant" | "line">,
  onProgress: (msg: string) => void
): Promise<void> {
  const { Forma } = await import("forma-embedded-view-sdk/auto");

  onProgress("Building infrastructure overlay…");

  const bbox = await Forma.terrain.getBbox();
  const minX = bbox.min.x, minY = bbox.min.y;
  const maxX = bbox.max.x, maxY = bbox.max.y;
  const W = maxX - minX;
  const H = maxY - minY;

  // Canvas covers the terrain extent + a large buffer for off-site features
  // Buffer = 30km in each direction so transmission lines appear leading off-site
  const BUFFER_M = 30000;
  const canvasMinX = minX - BUFFER_M;
  const canvasMinY = minY - BUFFER_M;
  const canvasW = W + BUFFER_M * 2;
  const canvasH = H + BUFFER_M * 2;

  // Resolution: 20 m/pixel (good enough for infrastructure context)
  const PPM = 1 / 20;  // pixels per meter
  const pxW = Math.ceil(canvasW * PPM);
  const pxH = Math.ceil(canvasH * PPM);

  const canvas = document.createElement("canvas");
  canvas.width  = pxW;
  canvas.height = pxH;
  const ctx = canvas.getContext("2d")!;

  // Helper: world meters → canvas pixels
  const toPixel = (lx: number, ly: number): [number, number] => [
    (lx - canvasMinX) * PPM,
    pxH - (ly - canvasMinY) * PPM,  // flip Y (canvas Y is top-down)
  ];

  // ── Draw transmission lines first (bottom layer) ──────────────────────────
  if (visibleTypes.has("line")) {
    ctx.strokeStyle = "#e74c3c";
    ctx.lineWidth   = 2;
    ctx.setLineDash([8, 4]);
    ctx.globalAlpha = 0.75;

    for (const f of features.filter(f => f.type === "line" && f.coords)) {
      const pts = f.coords!.map(([la, lo]) => {
        const [lx, ly] = latLonToLocal(la, lo, refLat, refLon);
        return toPixel(lx, ly);
      });
      if (pts.length < 2) continue;
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  // ── Draw power plant markers ───────────────────────────────────────────────
  if (visibleTypes.has("plant")) {
    for (const f of features.filter(f => f.type === "plant")) {
      const [lx, ly] = latLonToLocal(f.lat, f.lon, refLat, refLon);
      const [px, py] = toPixel(lx, ly);
      ctx.globalAlpha = 0.9;

      // Outer circle
      ctx.beginPath();
      ctx.arc(px, py, 14, 0, Math.PI * 2);
      ctx.fillStyle = "#e67e22";
      ctx.fill();
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 2;
      ctx.stroke();

      // Inner symbol — lightning bolt ⚡
      ctx.fillStyle = "#fff";
      ctx.font = "bold 14px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("⚡", px, py);

      // Label
      if (f.name) {
        ctx.globalAlpha = 0.95;
        ctx.fillStyle = "#000";
        ctx.font = "bold 11px Inter, sans-serif";
        ctx.fillText(f.name.substring(0, 24), px, py + 20);
      }
    }
  }

  // ── Draw substation markers ────────────────────────────────────────────────
  if (visibleTypes.has("substation")) {
    for (const f of features.filter(f => f.type === "substation")) {
      const [lx, ly] = latLonToLocal(f.lat, f.lon, refLat, refLon);
      const [px, py] = toPixel(lx, ly);
      ctx.globalAlpha = 0.92;

      // Square marker (substations are square in GIS convention)
      const size = 14;
      ctx.fillStyle = "#0696d7";
      ctx.fillRect(px - size/2, py - size/2, size, size);
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 2;
      ctx.strokeRect(px - size/2, py - size/2, size, size);

      // Inner "S"
      ctx.fillStyle = "#fff";
      ctx.font = "bold 10px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("S", px, py);

      // Label with voltage
      const label = f.name
        ? f.name.substring(0, 22)
        : f.voltage ? `${Number(f.voltage) >= 1000 ? (Number(f.voltage)/1000).toFixed(0)+"kV" : f.voltage+"V"} Sub` : "Substation";
      ctx.globalAlpha = 0.95;
      ctx.fillStyle = "#000";
      ctx.font = "10px Inter, sans-serif";
      ctx.fillText(label, px, py + 18);
    }
  }

  ctx.globalAlpha = 1.0;

  onProgress("Applying infrastructure overlay to terrain…");

  const centerX = canvasMinX + canvasW / 2;
  const centerY = canvasMinY + canvasH / 2;

  try { await Forma.terrain.groundTexture.remove({ name: "power-overlay" }); } catch { /* ok */ }

  await Forma.terrain.groundTexture.add({
    name: "power-overlay",
    canvas,
    position: { x: centerX, y: centerY, z: 2 },  // z:2 so it's above slope (z:1)
    scale: { x: 1/PPM, y: 1/PPM },               // pixels → meters
  });

  onProgress("done");
}

export async function removePowerOverlay(): Promise<void> {
  const { Forma } = await import("forma-embedded-view-sdk/auto");
  try { await Forma.terrain.groundTexture.remove({ name: "power-overlay" }); } catch { /* ok */ }
}
