// Spot elevation check: click a point → read terrain elevation → render a pin + label in the scene.
// Uses Forma.designTool.getPoint() for the pick interaction and terrain.getElevationAt() for the value.

export type ElevPin = {
  id:     number;
  x:      number;
  y:      number;
  elevM:  number;
  elevFt: number;
  meshId: string | null;
};

// 3×5 stroke font for elevation labels. Same grid convention as overlays.ts GLYPHS.
// Characters needed: 0-9, '.', 'f', 't', '-', ' '
const GLYPHS: Record<string, [number, number, number, number][]> = {
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
  '.': [[1.2,0.4,1.8,0.4]],
  'f': [[0,5,2.5,5],[0,5,0,0],[0,2.5,2,2.5]],
  't': [[1.5,5,1.5,0],[0,4,3,4]],
  '-': [[0,2.5,3,2.5]],
  ' ': [],
};

let _nextId = 0;

function buildPinGeometry(x: number, y: number, elevM: number, elevFt: number) {
  const positions: number[] = [];
  const colorArr:  number[] = [];

  function vert(vx: number, vy: number, vz: number, r: number, g: number, b: number, a: number) {
    positions.push(vx, vy, vz);
    colorArr.push(r, g, b, a);
  }

  function addSegment(
    x1: number, y1: number, x2: number, y2: number, z: number, w: number,
    r: number, g: number, b: number, a: number
  ) {
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 0.1) return;
    const nx = (-dy / len) * w / 2;
    const ny = ( dx / len) * w / 2;
    vert(x1+nx, y1+ny, z, r,g,b,a); vert(x1-nx, y1-ny, z, r,g,b,a); vert(x2+nx, y2+ny, z, r,g,b,a);
    vert(x1-nx, y1-ny, z, r,g,b,a); vert(x2-nx, y2-ny, z, r,g,b,a); vert(x2+nx, y2+ny, z, r,g,b,a);
  }

  function addGlyph(
    cx: number, cy: number, z: number, text: string, charH: number,
    r: number, g: number, b: number, a: number
  ) {
    const scale   = charH / 5;
    const sw      = Math.max(scale * 0.55, 1);
    const advance = 4 * scale;
    const totalW  = text.length * advance - scale;
    let ox = cx - totalW / 2;
    for (const ch of text) {
      for (const [x1, y1, x2, y2] of (GLYPHS[ch] ?? [])) {
        addSegment(
          ox + x1 * scale, cy + (y1 - 2.5) * scale,
          ox + x2 * scale, cy + (y2 - 2.5) * scale,
          z, sw, r, g, b, a
        );
      }
      ox += advance;
    }
  }

  const markerZ = elevM + 1.0;  // 1 m above terrain surface, clears the 0.5 m slope mesh lift
  const labelZ  = elevM + 8.0;  // floating label above pin
  const HALF    = 4;             // half-size of square marker (meters)
  const CHAR_H  = 24;            // glyph height (meters)

  // Orange filled square ground marker
  vert(x-HALF,y-HALF,markerZ, 255,140,0,230); vert(x+HALF,y-HALF,markerZ, 255,140,0,230); vert(x+HALF,y+HALF,markerZ, 255,140,0,230);
  vert(x-HALF,y-HALF,markerZ, 255,140,0,230); vert(x+HALF,y+HALF,markerZ, 255,140,0,230); vert(x-HALF,y+HALF,markerZ, 255,140,0,230);

  // White crosshair on top of marker
  addSegment(x - HALF*2.5, y, x + HALF*2.5, y, markerZ+0.1, 1.5, 255,255,255,200);
  addSegment(x, y - HALF*2.5, x, y + HALF*2.5, markerZ+0.1, 1.5, 255,255,255,200);

  // Floating elevation label e.g. "342.8ft"
  const sign  = elevFt < 0 ? '-' : '';
  const label = sign + Math.abs(elevFt).toFixed(1) + 'ft';
  addGlyph(x, y, labelZ, label, CHAR_H, 255, 255, 255, 240);

  return {
    position: new Float32Array(positions),
    color:    new Uint8Array(colorArr),
  };
}

export async function pickElevationPoint(): Promise<ElevPin | null> {
  const { Forma } = await import("forma-embedded-view-sdk/auto");
  const point = await Forma.designTool.getPoint();
  if (!point) return null;  // user pressed ESC

  const elevM  = await Forma.terrain.getElevationAt({ x: point.x, y: point.y });
  const elevFt = elevM * 3.28084;
  const id     = ++_nextId;

  const geometryData = buildPinGeometry(point.x, point.y, elevM, elevFt);
  const { id: meshId } = await Forma.render.addMesh({ geometryData });
  return { id, x: point.x, y: point.y, elevM, elevFt, meshId };
}

export async function removeElevationPin(pin: ElevPin): Promise<void> {
  if (!pin.meshId) return;
  const { Forma } = await import("forma-embedded-view-sdk/auto");
  try { await Forma.render.remove({ id: pin.meshId }); } catch { /* ignore */ }
}

export async function clearAllElevationPins(pins: ElevPin[]): Promise<void> {
  if (!pins.length) return;
  const { Forma } = await import("forma-embedded-view-sdk/auto");
  await Promise.all(
    pins.map(p => p.meshId ? Forma.render.remove({ id: p.meshId }).catch(() => {}) : Promise.resolve())
  );
}
