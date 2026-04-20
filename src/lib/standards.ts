// ─── Standards, references and assumptions ────────────────────────────────────

export const STANDARDS = [
  {
    category: "Electrical",
    items: [
      { code:"IEEE C2 (NESC)",   desc:"National Electrical Safety Code — minimum phase clearances and working space used for all AIS bay spacing calculations" },
      { code:"IEEE 80",          desc:"Guide for safety in AC substation grounding — grounding grid mesh sizing and copper conductor sizing" },
      { code:"IEEE 980",         desc:"Guide for containment and control of oil spills in substations — transformer berm sizing" },
      { code:"IEC 62271-203",    desc:"Gas-insulated metal-enclosed switchgear — GIS footprint reduction factor of 58% vs. AIS" },
      { code:"NEMA SG-6",        desc:"Power circuit breakers — equipment pricing basis for SF6 breakers by voltage class" },
    ],
  },
  {
    category: "Civil & Structural",
    items: [
      { code:"ACI 318",          desc:"Building code for structural concrete — transformer pads, cable trenches, and drilled pier design basis" },
      { code:"AISC 360",         desc:"Specification for structural steel — A-frame and H-frame structure steel tonnage basis" },
      { code:"IBC 2021",         desc:"International Building Code — control building and auxiliary structure construction cost basis" },
    ],
  },
  {
    category: "Cost data",
    items: [
      { code:"RSMeans 2024",     desc:"Heavy Construction Cost Data (Gordian) — all unit costs. CSI Divisions 03, 05, 26, 27, 31, 33" },
      { code:"RSMeans CCI",      desc:"City Cost Index — regional labor and material adjustment applied per project geolocation" },
      { code:"AACE Class 5",     desc:"Conceptual estimate — expected accuracy range ±30%. Suitable for budget authorization and site feasibility" },
    ],
  },
];

export const ASSUMPTIONS = [
  { label:"AIS bay spacing",         value:"Distribution 28×45 ft · Sub-transmission 48×75 ft · Transmission 90×130 ft (IEEE C2 minimum + maintenance aisle)" },
  { label:"GIS footprint",           value:"58% reduction vs. AIS per IEC 62271-203. Equipment cost ×1.6 due to SF6 technology premium" },
  { label:"Transformer zones",       value:"1.5× pad footprint per unit to include maintenance access, oil containment berm, and handling clearance" },
  { label:"Access & clearances",     value:"45% buffer over core equipment area for internal roads, fence setback, drainage, and future access" },
  { label:"Earthwork",               value:"Cut/fill volume derived from site area × terrain slope class (1.0× flat · 1.8× moderate · 3.2× steep)" },
  { label:"Grounding grid",          value:"4/0 AWG bare copper at IEEE 80 mesh spacing (distribution 10×10 ft · transmission 8×8 ft)" },
  { label:"Control cable",           value:"500 LF per bay average; includes relay panels, battery bank, SCADA, and AC/DC distribution" },
  { label:"Soft costs (EPC)",        value:"Engineering 10% · Testing & commissioning 3% · Contractor mob/demob 4% of direct cost" },
  { label:"Contingency default",     value:"15% for conceptual estimates (AACE Class 5). Reduce to 10% at feasibility, 5% at detailed design" },
  { label:"Escalation",             value:"Not applied unless user specifies. Costs are in current-year USD (RSMeans 2024 base)" },
  { label:"Excluded scope",         value:"Land acquisition · Transmission line interconnection · Permitting fees (except allowance) · Owner's costs · Financing" },
];
