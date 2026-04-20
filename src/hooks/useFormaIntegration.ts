import { useState, useEffect, useCallback, useRef } from "react";

export type RegionKey = "northeast" | "southeast" | "midwest" | "gulf" | "west";
export type TerrainKey = "flat" | "moderate" | "steep";

export type SiteData = {
  sf:                  number;
  acres:               string;
  address:             string;
  region:              RegionKey;
  regionAutoDetected:  boolean;
  lat:                 number | null;
  lon:                 number | null;
  terrain:             TerrainKey;
  terrainAutoDetected: boolean;
  elevRangeFt:         number;
  elevMinFt:           number;
  elevMaxFt:           number;
};

export type FormaBuilding = {
  path:     string;
  sf:       number;
  label:    string;
  category: string;
};

const M_TO_FT = 3.28084;
const IS_IN_FORMA = window.location.search.includes("origin=");
const POLL_MS = 4000;

const DEV_MOCK_SITE: SiteData = {
  sf: 217800, acres: "5.00",
  address: "6300 King David Ct, Apex, NC 27539",
  region: "southeast", regionAutoDetected: true,
  lat: 35.732, lon: -78.823,
  terrain: "flat", terrainAutoDetected: true,
  elevRangeFt: 12, elevMinFt: 312, elevMaxFt: 324,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function shoelaceAreaM2(coords: [number, number][]): number {
  let area = 0;
  const n = coords.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += coords[i][0] * coords[j][1] - coords[j][0] * coords[i][1];
  }
  return Math.abs(area / 2);
}

function latLonToRegion(lat: number, lon: number): RegionKey {
  if (lon < -115) return "west";
  if (lon < -100 && lat > 40) return "west";
  if (lon < -100 && lat <= 40) return "gulf";
  if (lon >= -100 && lon < -88 && lat > 40) return "midwest";
  if (lon >= -100 && lon < -88 && lat <= 40) return "gulf";
  if (lon >= -88 && lon < -70 && lat > 38) return "northeast";
  if (lon >= -88 && lon < -70 && lat <= 38) return "southeast";
  if (lon >= -70) return "northeast";
  return "southeast";
}

function classifyTerrain(elevRangeFt: number, areaM2: number): TerrainKey {
  const diagFt = Math.sqrt(areaM2) * 1.414 * M_TO_FT;
  const slope  = diagFt > 0 ? elevRangeFt / diagFt : 0;
  if (slope > 0.08) return "steep";
  if (slope > 0.02) return "moderate";
  return "flat";
}

function pointInPolygon(px: number, py: number, polygon: [number, number][]): boolean {
  let inside = false;
  const n = polygon.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i][0], yi = polygon[i][1];
    const xj = polygon[j][0], yj = polygon[j][1];
    const hit = (yi > py) !== (yj > py) &&
      px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (hit) inside = !inside;
  }
  return inside;
}

// ─── Forma fetchers ───────────────────────────────────────────────────────────

async function fetchSiteFromForma(): Promise<SiteData | null> {
  const { Forma } = await import("forma-embedded-view-sdk/auto");

  const paths = await Forma.geometry.getPathsByCategory({ category: "site_limit" });
  if (!paths?.length) return null;

  const fp = await Forma.geometry.getFootprint({ path: paths[0] });
  if (!fp?.coordinates?.length) return null;

  const areaM2 = shoelaceAreaM2(fp.coordinates);
  const areaSF = areaM2 * 10.7639;

  let address = "Site boundary detected";
  let region: RegionKey = "southeast";
  let regionAutoDetected = false;
  let lat: number | null = null;
  let lon: number | null = null;

  try {
    const [project, geo] = await Promise.all([
      Forma.project.get(),
      Forma.project.getGeoLocation(),
    ]);
    if (project?.name) address = project.name;
    if (geo) {
      lat = geo[0]; lon = geo[1];
      region = latLonToRegion(lat, lon);
      regionAutoDetected = true;
    }
  } catch { /* non-fatal */ }

  let elevRangeFt = 0, elevMinFt = 0, elevMaxFt = 0;
  let terrain: TerrainKey = "flat";
  let terrainAutoDetected = false;

  try {
    const bbox = await Forma.terrain.getBbox();
    elevMinFt = Math.round((bbox.min.z ?? 0) * M_TO_FT);
    elevMaxFt = Math.round((bbox.max.z ?? 0) * M_TO_FT);
    elevRangeFt = Math.max(0, elevMaxFt - elevMinFt);
    terrain = classifyTerrain(elevRangeFt, areaM2);
    terrainAutoDetected = true;
  } catch { /* non-fatal */ }

  return {
    sf: Math.round(areaSF), acres: (areaSF / 43560).toFixed(2),
    address, region, regionAutoDetected, lat, lon,
    terrain, terrainAutoDetected, elevRangeFt, elevMinFt, elevMaxFt,
  };
}

/**
 * Detect buildings inside the site boundary.
 *
 * SDK rule (Autodesk developer forum):
 *   getFootprint → site_limit, road, vegetation  (polylines)
 *   getTriangles → building, terrain, vegetation  (meshes)
 *
 * Building area = XY-projected area of floor-level triangles.
 * Spatial filter = centroid ray-cast against site_limit polygon.
 */
async function fetchBuildingsFromForma(): Promise<FormaBuilding[]> {
  const { Forma } = await import("forma-embedded-view-sdk/auto");

  // Site boundary for spatial filter
  const sitePaths = await Forma.geometry.getPathsByCategory({ category: "site_limit" });
  if (!sitePaths?.length) return [];

  const siteFp = await Forma.geometry.getFootprint({ path: sitePaths[0] });
  if (!siteFp?.coordinates?.length) return [];

  const sitePolygon = siteFp.coordinates;
  const siteSet     = new Set(sitePaths);

  // Buildings — category "building" (singular) per SDK docs
  const buildingPaths = await Forma.geometry.getPathsByCategory({ category: "building" });
  if (!buildingPaths?.length) return [];

  const buildings: FormaBuilding[] = [];
  let idx = 1;

  for (const path of buildingPaths) {
    if (siteSet.has(path)) continue;
    try {
      const triangles = await Forma.geometry.getTriangles({ path });
      if (!triangles || triangles.length < 9) continue;

      // Find ground level (min Z)
      let minZ = Infinity;
      for (let i = 2; i < triangles.length; i += 3) {
        if (triangles[i] < minZ) minZ = triangles[i];
      }

      let floorAreaM2 = 0;
      let sumX = 0, sumY = 0, vertCount = 0;

      for (let i = 0; i < triangles.length; i += 9) {
        const x1 = triangles[i],   y1 = triangles[i+1], z1 = triangles[i+2];
        const x2 = triangles[i+3], y2 = triangles[i+4], z2 = triangles[i+5];
        const x3 = triangles[i+6], y3 = triangles[i+7], z3 = triangles[i+8];

        sumX += x1 + x2 + x3;
        sumY += y1 + y2 + y3;
        vertCount += 3;

        // Floor triangles only (within 0.5 m of ground)
        if (z1 <= minZ + 0.5 && z2 <= minZ + 0.5 && z3 <= minZ + 0.5) {
          floorAreaM2 += Math.abs((x2-x1)*(y3-y1) - (x3-x1)*(y2-y1)) / 2;
        }
      }

      if (vertCount === 0 || floorAreaM2 < 1) continue;

      const cx = sumX / vertCount;
      const cy = sumY / vertCount;
      if (!pointInPolygon(cx, cy, sitePolygon)) continue;

      const sf = Math.round(floorAreaM2 * 10.7639);
      if (sf < 10 || sf > 500_000) continue;

      buildings.push({
        path, sf,
        label:    `Building ${idx} (${sf.toLocaleString()} SF)`,
        category: "building",
      });
      idx++;
    } catch { /* no geometry — skip */ }
  }

  return buildings;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useFormaIntegration() {
  const [siteData,       setSiteData]       = useState<SiteData | null>(null);
  const [formaBuildings, setFormaBuildings] = useState<FormaBuilding[]>([]);
  const [loading,        setLoading]        = useState(true);
  const [error,          setError]          = useState<string | null>(null);
  const siteRef      = useRef<ReturnType<typeof setInterval> | null>(null);
  const buildingsRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchSite = useCallback(async () => {
    setError(null);
    if (!IS_IN_FORMA) { setSiteData(DEV_MOCK_SITE); setLoading(false); return; }
    try {
      setSiteData(await fetchSiteFromForma());
    } catch (e) {
      console.error("[SubstationEstimator] site fetch:", e);
      setError("Could not read site boundary from Forma.");
      setSiteData(null);
    }
    setLoading(false);
  }, []);

  const fetchBuildings = useCallback(async () => {
    if (!IS_IN_FORMA) return; // no mock buildings in dev
    try {
      const buildings = await fetchBuildingsFromForma();
      setFormaBuildings(prev => {
        // Only update if something actually changed (path set or any SF changed)
        const prevMap = new Map(prev.map(b => [b.path, b.sf]));
        const changed = buildings.length !== prev.length ||
          buildings.some(b => prevMap.get(b.path) !== b.sf);
        return changed ? buildings : prev;
      });
    } catch { /* non-fatal */ }
  }, []);

  useEffect(() => {
    fetchSite();
    fetchBuildings();

    if (IS_IN_FORMA) {
      siteRef.current      = setInterval(fetchSite,      POLL_MS);
      buildingsRef.current = setInterval(fetchBuildings, POLL_MS);
    }
    return () => {
      if (siteRef.current)      clearInterval(siteRef.current);
      if (buildingsRef.current) clearInterval(buildingsRef.current);
    };
  }, [fetchSite, fetchBuildings]);

  return {
    siteData,
    formaBuildings,
    loading,
    error,
    refresh: () => { fetchSite(); fetchBuildings(); },
  };
}

// ─── Exported building sync (manual button) ───────────────────────────────────
export async function getFormaBuildingsFromForma(): Promise<FormaBuilding[]> {
  return fetchBuildingsFromForma();
}
