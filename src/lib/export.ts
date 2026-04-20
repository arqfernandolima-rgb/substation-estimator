import type { BOMResult, Config } from "./compute";
import { VOLTAGE_CLASSES, BUS_CONFIGS, SWITCHGEAR, REGIONS } from "./compute";
import { STANDARDS, ASSUMPTIONS } from "./standards";

const fmtNum   = (n: number) => Math.round(n).toLocaleString();
const fmtMoney = (n: number) => Math.round(n).toLocaleString();
const fmtAc    = (sf: number) => `${(sf / 43560).toFixed(2)} ac`;

export function exportCSV(res: BOMResult, cfg: Config, address: string) {
  const vc = VOLTAGE_CLASSES[cfg.vc];
  const fp = res.footprint;

  const rows: string[][] = [
    ["Substation Estimator — Bill of Materials"],
    ["RSMeans 2024 Heavy Construction · AACE Class 5 Conceptual Estimate ±30%"],
    [],
    ["PROJECT INFORMATION"],
    ["Location",          address],
    ["Site area",         `${fmtNum(cfg.sf)} SF (${fmtAc(cfg.sf)})`],
    ["Voltage class",     `${vc.label} (${vc.sub})`],
    ["Capacity",          `${cfg.mva} MVA × ${cfg.xCount} transformer(s) = ${cfg.mva * cfg.xCount} MVA total`],
    ["Bus configuration", BUS_CONFIGS[cfg.bus].label],
    ["Switchgear",        SWITCHGEAR[cfg.sw].label],
    ["Region",            `${REGIONS[cfg.region].label} (CCI ×${REGIONS[cfg.region].cci.toFixed(2)})`],
    ["Contingency",       `${cfg.cont}%`],
    [],
    ["BILL OF MATERIALS"],
    ["Category", "Description", "Qty", "Unit", "Unit Cost ($)", "Total ($)"],
  ];

  for (const sec of res.sections) {
    for (const item of sec.items) {
      const qtyStr = item.qty < 10 && !Number.isInteger(item.qty)
        ? item.qty.toFixed(2) : fmtNum(item.qty);
      rows.push([sec.name, item.desc, qtyStr, item.unit,
        fmtMoney(item.u ?? 0), fmtMoney(item.total)]);
    }
    rows.push([]);
  }

  rows.push(["", "", "", "", "Direct Cost",    fmtMoney(res.totalDirect)]);
  rows.push(["", "", "", "", `Contingency (${cfg.cont}%)`, fmtMoney(res.contingency)]);
  rows.push(["", "", "", "", "GRAND TOTAL",    fmtMoney(res.grand)]);
  rows.push([]);

  // Key metrics
  rows.push(["KEY METRICS"]);
  rows.push(["Cost per MVA",     `$${fmtMoney(res.metrics.cpMVA)}`]);
  rows.push(["Cost per SF",      `$${res.metrics.cpSF.toFixed(2)}`]);
  rows.push(["Total bays",       String(res.metrics.bays)]);
  rows.push(["Circuit breakers", String(res.metrics.bkrs)]);
  rows.push(["Earthwork volume", `${fmtNum(res.metrics.ewCY)} CY`]);
  rows.push(["Grounding copper", `${fmtNum(res.metrics.copperLB)} LB`]);
  rows.push(["Cable trench",     `${fmtNum(res.metrics.trenchLF)} LF`]);
  rows.push(["Control cable",    `${fmtNum(res.metrics.ctrlLF)} LF`]);
  rows.push([]);

  // Site utilization
  rows.push(["SITE UTILIZATION"]);
  rows.push(["Total required",   `${fmtNum(fp.totalRequiredSF)} SF (${fmtAc(fp.totalRequiredSF)})`]);
  rows.push(["Available",        `${fmtNum(fp.availableSF)} SF (${fmtAc(fp.availableSF)})`]);
  rows.push(["Utilization",      `${fp.utilPct}%`]);
  rows.push(["Switchyard",       `${fmtNum(fp.switchyardSF)} SF`]);
  rows.push(["Transformer zones",`${fmtNum(fp.transformerSF)} SF`]);
  rows.push(["Control building", `${fmtNum(fp.controlBldgSF)} SF`]);
  rows.push(["Access & roads",   `${fmtNum(fp.accessRoadsSF)} SF`]);
  if (fp.auxSF > 0) rows.push(["Auxiliary structures", `${fmtNum(fp.auxSF)} SF`]);
  rows.push([]);

  // Standards & assumptions
  rows.push(["STANDARDS & REFERENCES"]);
  for (const cat of STANDARDS) {
    rows.push([cat.category.toUpperCase()]);
    for (const item of cat.items) {
      rows.push([item.code, item.desc]);
    }
  }
  rows.push([]);
  rows.push(["KEY ASSUMPTIONS"]);
  for (const a of ASSUMPTIONS) {
    rows.push([a.label, a.value]);
  }

  const csv = rows
    .map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(","))
    .join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url;
  a.download = "substation-bom.csv";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
