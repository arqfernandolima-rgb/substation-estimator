// ─── RSMeans 2024 Heavy Construction · IEEE C2/NESC spacing standards ─────────

export const VOLTAGE_CLASSES = {
  dist: {
    label:"Distribution", sub:"12–35 kV", grid:10, xBays:2, bldgSF:1200,
    padCY:15, dflF:8, dflMVA:15,
    bkrC:42000, ctC:2800, cvtC:8500, arrC:1800, discC:7500, mDiscC:15500,
    // IEEE C2: phase-to-ground 3.5 ft, phase-to-phase 5 ft
    // Bay width includes structure, clearances, maintenance aisle
    bayW:28, bayD:45,
    xfmrW:30, xfmrD:40,  // transformer clearance zone per unit
  },
  subtrans: {
    label:"Sub-Transmission", sub:"69–138 kV", grid:10, xBays:3, bldgSF:2500,
    padCY:40, dflF:6, dflMVA:75,
    bkrC:128000, ctC:4200, cvtC:14500, arrC:3800, discC:9500, mDiscC:19500,
    // IEEE C2: phase-to-ground 5.5–7 ft, phase-to-phase 8–10 ft
    bayW:48, bayD:75,
    xfmrW:45, xfmrD:60,
  },
  trans: {
    label:"Transmission", sub:"230–500 kV", grid:8, xBays:4, bldgSF:5000,
    padCY:120, dflF:4, dflMVA:300,
    bkrC:385000, ctC:8500, cvtC:28000, arrC:8500, discC:14500, mDiscC:32000,
    // IEEE C2: phase-to-ground 12–18 ft, phase-to-phase 16–22 ft
    bayW:90, bayD:130,
    xfmrW:70, xfmrD:90,
  },
} as const;

export type VCKey = keyof typeof VOLTAGE_CLASSES;

export const MVA_OPTIONS: Record<VCKey, number[]> = {
  dist:    [10,15,20,25,30],
  subtrans:[30,50,75,100,150],
  trans:   [100,200,300,500],
};

export const TRANSFORMER_COSTS: Record<VCKey, Record<number,number>> = {
  dist:    {10:145000,15:185000,20:225000,25:275000,30:325000},
  subtrans:{30:520000,50:780000,75:1050000,100:1350000,150:1850000},
  trans:   {100:2200000,200:3800000,300:5500000,500:8200000},
};

export const BUS_CONFIGS = {
  single:   {label:"Single Bus",    desc:"Standard, lowest cost",          bkrM:1.0,strM:1.0,footM:1.00},
  maintrans:{label:"Main-Transfer", desc:"Backup bus, higher reliability",  bkrM:1.3,strM:1.2,footM:1.20},
  ring:     {label:"Ring Bus",      desc:"High flexibility, mid-size sites",bkrM:1.5,strM:1.3,footM:1.30},
  bah:      {label:"Breaker & Half",desc:"Max reliability, transmission",   bkrM:1.5,strM:1.4,footM:1.50},
} as const;
export type BusKey = keyof typeof BUS_CONFIGS;

export const SWITCHGEAR = {
  ais:{label:"AIS",desc:"Air-insulated, open yard — standard for most sites",  gisMultiplier:1.0,footprintMultiplier:1.00,footprintNote:null},
  gis:{label:"GIS",desc:"Gas-insulated, compact — urban / constrained sites",  gisMultiplier:1.6,footprintMultiplier:0.42,footprintNote:"~58% footprint reduction · ×1.6 equipment cost"},
} as const;
export type SWKey = keyof typeof SWITCHGEAR;

export const REGIONS = {
  northeast:{label:"Northeast",        cci:1.18},
  southeast:{label:"Southeast",        cci:0.95},
  midwest:  {label:"Midwest",          cci:1.05},
  gulf:     {label:"Gulf / S. Central",cci:0.92},
  west:     {label:"West / Mountain",  cci:1.12},
} as const;
export type RegionKey = keyof typeof REGIONS;

export const TERRAIN_TYPES = {
  flat:    {label:"Flat",    sub:"<2% slope",  earthworkMultiplier:1.0},
  moderate:{label:"Moderate",sub:"2–8% slope", earthworkMultiplier:1.8},
  steep:   {label:"Steep",   sub:">8% slope",  earthworkMultiplier:3.2},
} as const;
export type TerrainKey = keyof typeof TERRAIN_TYPES;

// ─── Auxiliary structures (RSMeans 2024 pre-engineered / industrial) ──────────

// ─── Building functions (RSMeans 2024 commercial/industrial construction) ────

export const BUILDING_FUNCTIONS = {
  control:    { label:"Control & relay building",    desc:"Climate-controlled, raised floor, EMI shielding",    costPerSF:285, defaultSF:2500  },
  operations: { label:"Operations center",            desc:"Offices, dispatch, monitoring workstations",         costPerSF:260, defaultSF:3000  },
  maintenance:{ label:"Maintenance workshop",         desc:"High-bay, roll-up doors, overhead crane prep",       costPerSF:185, defaultSF:2400  },
  warehouse:  { label:"Equipment storage",            desc:"Unheated storage, heavy-duty industrial slab",       costPerSF:135, defaultSF:3600  },
  guardhouse: { label:"Security guardhouse",          desc:"Staffed entry checkpoint, CCTV integration",         costPerSF:230, defaultSF:400   },
  battery:    { label:"Battery room (standalone)",    desc:"Ventilated, acid-resistant floor, dedicated HVAC",   costPerSF:265, defaultSF:800   },
  oil_contain:{ label:"Oil containment structure",    desc:"Concrete berm, drainage collection, fire suppression",costPerSF:195, defaultSF:600  },
  spare_parts:{ label:"Spare parts / critical spares",desc:"Conditioned, shelved storage for rotating spares",   costPerSF:155, defaultSF:1200  },
  office:     { label:"Site office / meeting room",   desc:"Permanent modular office, conference room",           costPerSF:210, defaultSF:1000  },
  visitor:    { label:"Visitor & training facility",  desc:"Presentation space, training room, restrooms",        costPerSF:245, defaultSF:1500  },
} as const;

export type AuxKey = keyof typeof BUILDING_FUNCTIONS;

// Keep backward-compatible alias
export const AUX_STRUCTURES = BUILDING_FUNCTIONS;

export type AuxEntry = {
  key:        AuxKey;
  sf:         number;
  functionKey?: AuxKey;  // building function (may differ from key if Forma-detected)
  label?:     string;    // display label override
  fromForma?: boolean;   // true = footprint came from Forma
  path?:      string;    // Forma element path
};

// ─── Config ───────────────────────────────────────────────────────────────────

export type Config = {
  vc:      VCKey;
  mva:     number;
  xCount:  number;
  feeders: number;
  bus:     BusKey;
  sw:      SWKey;
  terrain: TerrainKey;
  region:  RegionKey;
  cont:    number;
  sf:      number;
  auxStructures: AuxEntry[];
};

// ─── Line item & BoM types ────────────────────────────────────────────────────

export type LineItem = {desc:string; qty:number; unit:string; u:number; total:number};
export type BOMSection = {name:string; items:LineItem[]};

export type FootprintBreakdown = {
  switchyardSF:      number;
  transformerSF:     number;
  controlBldgSF:     number;
  accessRoadsSF:     number;
  auxSF:             number;
  totalRequiredSF:   number;
  availableSF:       number;
  utilPct:           number;
  overCapacity:      boolean;
  headroomSF:        number;
  gisRequiredSF:     number;
  reducedFeedersSF:  number;
  recommendedSiteSF: number;
};

export type BOMResult = {
  sections:    BOMSection[];
  totalDirect: number;
  contingency: number;
  grand:       number;
  footprint:   FootprintBreakdown;
  metrics: {
    ewCY:number; copperLB:number; trenchLF:number; ctrlLF:number;
    bays:number; bkrs:number; cpMVA:number; cpSF:number;
  };
};

// ─── Footprint calculator ─────────────────────────────────────────────────────

export function calcFootprint(c: Config): FootprintBreakdown {
  const vc  = VOLTAGE_CLASSES[c.vc];
  const bus = BUS_CONFIGS[c.bus];
  const sw  = SWITCHGEAR[c.sw];
  const bays = c.feeders + vc.xBays;

  // Switchyard: bays × (width × depth) × bus config multiplier × switchgear multiplier
  const switchyardSF  = Math.round(bays * vc.bayW * vc.bayD * bus.footM * sw.footprintMultiplier);

  // Transformer clearance zones (1.5× pad footprint for maintenance access)
  const xfmrZoneSF    = vc.xfmrW * vc.xfmrD * 1.5;
  const transformerSF = Math.round(c.xCount * xfmrZoneSF * sw.footprintMultiplier);

  // Control building (fixed per voltage class, no GIS reduction)
  const controlBldgSF = vc.bldgSF;

  // Access roads + security fence setback + internal clearances (45% buffer)
  const coreAreaSF    = switchyardSF + transformerSF + controlBldgSF;
  const accessRoadsSF = Math.round(coreAreaSF * 0.45);

  // Auxiliary / Forma-detected structures
  const auxSF = c.auxStructures.reduce((s,a) => s + a.sf, 0);

  const totalRequiredSF   = coreAreaSF + accessRoadsSF + auxSF;
  const availableSF       = c.sf;
  const utilPct           = Math.round((totalRequiredSF / Math.max(1, availableSF)) * 100);
  const overCapacity      = utilPct > 100;
  const headroomSF        = availableSF - totalRequiredSF;

  // Option 1: switch to GIS
  const gisRequiredSF = overCapacity
    ? Math.round(totalRequiredSF * (SWITCHGEAR.gis.footprintMultiplier / sw.footprintMultiplier))
    : 0;

  // Option 2: reduce feeders by 2
  const reducedBays       = Math.max(vc.xBays + 2, bays - 2);
  const reducedSwitch     = Math.round(reducedBays * vc.bayW * vc.bayD * bus.footM * sw.footprintMultiplier);
  const reducedCore       = reducedSwitch + transformerSF + controlBldgSF;
  const reducedFeedersSF  = overCapacity
    ? reducedCore + Math.round(reducedCore * 0.45) + auxSF
    : 0;

  // Recommended minimum site (required + 15% future expansion)
  const recommendedSiteSF = Math.round(totalRequiredSF * 1.15);

  return {
    switchyardSF, transformerSF, controlBldgSF, accessRoadsSF, auxSF,
    totalRequiredSF, availableSF, utilPct, overCapacity, headroomSF,
    gisRequiredSF, reducedFeedersSF, recommendedSiteSF,
  };
}

// ─── Compute ──────────────────────────────────────────────────────────────────

export function computeBOM(c: Config): BOMResult {
  const vc  = VOLTAGE_CLASSES[c.vc];
  const bus = BUS_CONFIGS[c.bus];
  const cci = REGIONS[c.region].cci;
  const tM  = TERRAIN_TYPES[c.terrain].earthworkMultiplier;
  const gM  = SWITCHGEAR[c.sw].gisMultiplier;
  const adj = (x:number) => x * cci;

  const sfAc    = c.sf / 43560;
  const perim   = Math.round(Math.sqrt(c.sf) * 4);
  const bays    = c.feeders + vc.xBays;
  const bkrs    = Math.round(bays * bus.bkrM);
  const discs   = bkrs * 2;
  const mDiscs  = Math.max(1, Math.round(discs * 0.2));
  const cts     = bkrs * 3;
  const cvts    = bays * 3;
  const arrs    = bays * 3;
  const structs = Math.round(bays * bus.strM * 2);
  const busSt   = Math.round(bays * bus.strM);
  const gants   = Math.max(2, Math.round(c.feeders * 0.5));
  const lights  = Math.max(4, Math.round(c.sf / 5000));
  const sLights = Math.max(4, Math.round(perim / 200));
  const topCY   = Math.round((c.sf * 0.5) / 27);
  const ewCY    = Math.round(sfAc * 1200 * tM);
  const fillCY  = Math.round(ewCY * 0.45);
  const cutCY   = ewCY - fillCY;
  const gridLF  = Math.round((c.sf / vc.grid) * 2 * 1.1);
  const gRods   = Math.max(8, Math.round(c.sf / 100));
  const cadw    = Math.round((gridLF / vc.grid) * 1.5);
  const copperLB= Math.round(gridLF * 0.656);
  const fp      = calcFootprint(c);
  const trenchLF= Math.round((fp.switchyardSF / 800) * bays);
  const condLF  = trenchLF * 4;
  const ctrlLF  = bays * 500;
  const fiberLF = Math.round(vc.bldgSF * 0.5 + bays * 80);
  const xfmrCost= TRANSFORMER_COSTS[c.vc][c.mva] ?? TRANSFORMER_COSTS[c.vc][vc.dflMVA];
  const xPadCY  = vc.padCY * c.xCount;
  const bPadCY  = Math.round(bkrs * (c.vc==="trans"?6:c.vc==="subtrans"?3.5:1.5));
  const gFndCY  = Math.round(gants * 2 * vc.padCY * 0.35);
  const piers   = Math.round(structs * 2);

  const mk = (items: Omit<LineItem,"total">[]): LineItem[] =>
    items.map(i => ({...i, total: i.qty * i.u}));

  const sections: BOMSection[] = [
    { name:"Civil & Site Work", items: mk([
      {desc:"Site clearing & grubbing",         qty:+sfAc.toFixed(2),             unit:"Acre",u:adj(3500) },
      {desc:"Topsoil stripping (6\")",           qty:topCY,                        unit:"CY",  u:adj(8.50) },
      {desc:"Rough grading — cut",              qty:cutCY,                        unit:"CY",  u:adj(18.50)},
      {desc:"Rough grading — fill & compact",   qty:fillCY,                       unit:"CY",  u:adj(22.00)},
      {desc:"Crushed stone surfacing (4\")",    qty:Math.round(fp.switchyardSF/9),unit:"SY",  u:adj(18.00)},
      {desc:"Perimeter fence (8-ft chain-link)",qty:perim,                        unit:"LF",  u:adj(38.00)},
      {desc:"Vehicle entry gates",              qty:2,                            unit:"EA",  u:adj(9200) },
      {desc:"Access road (gravel base)",        qty:300,                          unit:"LF",  u:adj(48.00)},
      {desc:"Stormwater drainage",              qty:+sfAc.toFixed(2),             unit:"Acre",u:adj(28000)},
      {desc:"Oil containment berm",             qty:c.xCount*80,                  unit:"LF",  u:adj(92)   },
      {desc:"Area lighting (LED pole-mounted)", qty:lights,                       unit:"EA",  u:adj(4800) },
      {desc:"Security lighting",                qty:sLights,                      unit:"EA",  u:adj(2900) },
    ])},
    { name:"Foundations & Concrete", items: mk([
      {desc:"Transformer equipment pads",       qty:xPadCY,   unit:"CY",u:adj(875)  },
      {desc:"Circuit breaker pads",             qty:bPadCY,   unit:"CY",u:adj(775)  },
      {desc:"Drilled piers — steel structures", qty:piers,    unit:"EA",u:adj(2900) },
      {desc:"Gantry structure foundations",     qty:gFndCY,   unit:"CY",u:adj(950)  },
      {desc:"Control building concrete slab",   qty:vc.bldgSF,unit:"SF",u:adj(19.50)},
      {desc:"Cable trench (concrete-encased)",  qty:trenchLF, unit:"LF",u:adj(98)   },
      {desc:"Conduit in trench (4-way PVC)",    qty:condLF,   unit:"LF",u:adj(12.50)},
    ])},
    { name:"Structural Steel", items: mk([
      {desc:"Equipment support structures",  qty:structs,                unit:"EA",u:adj(13500)},
      {desc:"Bus support structures",        qty:busSt,                  unit:"EA",u:adj(9200) },
      {desc:"Transmission deadend / gantry",qty:gants,                  unit:"EA",u:adj(22500)},
      {desc:"Rigid tubular aluminum bus",    qty:Math.round(bays*45),   unit:"LF",u:adj(48)   },
      {desc:"Strain bus (ACSR conductor)",   qty:Math.round(gants*120), unit:"LF",u:adj(19.50)},
      {desc:"Bus clamps & connectors",       qty:Math.round(bays*8),    unit:"EA",u:adj(295)  },
      {desc:"Control building (pre-eng.)",   qty:vc.bldgSF,             unit:"SF",u:adj(195)  },
    ])},
    { name:"Primary Equipment", items: mk([
      {desc:`Power transformer (${c.mva} MVA, ${vc.sub})`,qty:c.xCount,unit:"EA",u:adj(xfmrCost)*gM},
      {desc:"Station service transformer",              qty:1,         unit:"EA",u:adj(28500)        },
      {desc:"SF6 circuit breakers",                     qty:bkrs,      unit:"EA",u:adj(vc.bkrC)*gM  },
      {desc:"Disconnect switches (group)",              qty:discs,     unit:"EA",u:adj(vc.discC)     },
      {desc:"Disconnect switches (motor)",              qty:mDiscs,    unit:"EA",u:adj(vc.mDiscC)    },
      {desc:"Current transformers (3Ø sets)",          qty:cts,       unit:"EA",u:adj(vc.ctC)       },
      {desc:"Capacitive voltage transformers",          qty:cvts,      unit:"EA",u:adj(vc.cvtC)      },
      {desc:"Surge arresters — MOV (3Ø)",              qty:arrs,      unit:"EA",u:adj(vc.arrC)      },
      {desc:"Neutral grounding resistors",              qty:c.xCount,  unit:"EA",u:adj(8500)         },
    ])},
    { name:"Grounding System", items: mk([
      {desc:`4/0 copper grid (${vc.grid}×${vc.grid} ft mesh)`,qty:gridLF,            unit:"LF",u:adj(5.80)},
      {desc:"Ground rods (5/8\" × 10 ft copper-clad)",        qty:gRods,             unit:"EA",u:adj(295) },
      {desc:"Exothermic welds (Cadweld)",                      qty:cadw,              unit:"EA",u:adj(48)  },
      {desc:"Equipment grounding conductors",qty:Math.round((structs+bkrs)*25),unit:"LF",u:adj(4.50)},
      {desc:"Fence grounding (perimeter)",qty:perim,           unit:"LF",u:adj(8.80)},
    ])},
    { name:"Controls & SCADA", items: mk([
      {desc:"Protection & control relay panels", qty:bays,                  unit:"EA",u:adj(38000)},
      {desc:"Control cables (600V multi-cond.)", qty:ctrlLF,                unit:"LF",u:adj(4.80) },
      {desc:"Fiber optic cable (OS2)",            qty:fiberLF,               unit:"LF",u:adj(4.20) },
      {desc:"SCADA / RTU cabinet",               qty:1,                     unit:"EA",u:adj(92000)},
      {desc:"Communications equipment",          qty:1,                     unit:"LS",u:adj(38500)},
      {desc:"Revenue metering",                  qty:Math.max(1,c.xCount),  unit:"EA",u:adj(14500)},
      {desc:"Battery bank (125VDC, 200Ah)",      qty:1,                     unit:"EA",u:adj(32000)},
      {desc:"Battery charger",                   qty:1,                     unit:"EA",u:adj(9200) },
      {desc:"AC/DC distribution boards",         qty:2,                     unit:"EA",u:adj(11000)},
      {desc:"Annunciator / alarm system",        qty:1,                     unit:"EA",u:adj(19500)},
    ])},
  ];

  // Auxiliary structures (manual + Forma-detected buildings)
  if (c.auxStructures.length > 0) {
    sections.push({
      name: "Auxiliary Structures",
      items: c.auxStructures.map(a => {
        const fnKey = a.functionKey ?? a.key;
        const def = BUILDING_FUNCTIONS[fnKey] ?? BUILDING_FUNCTIONS.maintenance;
        const costPerSF = def.costPerSF * cci;
        return {
          desc: a.label ?? def.label,
          qty:   a.sf,
          unit:  "SF",
          u:     costPerSF,
          total: Math.round(a.sf * costPerSF),
        };
      }),
    });
  }

  const directSub = sections.reduce((s,sec)=>s+sec.items.reduce((ss,i)=>ss+i.total,0),0);
  const commC=directSub*0.03, engC=directSub*0.10, mobC=directSub*0.04;
  sections.push({ name:"Project Costs", items:[
    {desc:"Safety & fire equipment",           qty:1,        unit:"LS",u:9500,  total:9500        },
    {desc:"Signage (safety, electrical hazard)",qty:bays+4,  unit:"EA",u:485,   total:(bays+4)*485},
    {desc:"Testing & commissioning (3%)",       qty:1,       unit:"LS",u:commC, total:commC       },
    {desc:"Engineering & design — EPC (10%)",   qty:1,       unit:"LS",u:engC,  total:engC        },
    {desc:"Contractor mob / demob (4%)",         qty:1,      unit:"LS",u:mobC,  total:mobC        },
    {desc:"Permits & environmental review",     qty:1,       unit:"LS",u:28000, total:28000       },
  ]});

  const totalDirect = sections.reduce((s,sec)=>s+sec.items.reduce((ss,i)=>ss+i.total,0),0);
  const contingency = totalDirect*(c.cont/100);
  const grand       = totalDirect+contingency;

  return {
    sections, totalDirect, contingency, grand, footprint: fp,
    metrics:{ewCY,copperLB,trenchLF,ctrlLF,bays,bkrs,
      cpMVA:grand/(c.mva*c.xCount), cpSF:grand/Math.max(1,c.sf)},
  };
}
