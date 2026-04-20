import type { BOMResult, Config } from "./compute";
import { VOLTAGE_CLASSES, BUS_CONFIGS, REGIONS, TERRAIN_TYPES } from "./compute";
import { STANDARDS, ASSUMPTIONS } from "./standards";
import type { SiteData } from "../hooks/useFormaIntegration";

const ff = (n: number) => `$${Math.round(n).toLocaleString()}`;
const fc = (n: number) => n>=1e6?`$${(n/1e6).toFixed(2)}M`:n>=1000?`$${(n/1000).toFixed(0)}K`:ff(n);
const fn = (n: number) => Math.round(n).toLocaleString();
const fac= (sf: number) => `${(sf/43560).toFixed(2)} ac`;

export function printReport(res: BOMResult, cfg: Config, site: SiteData) {
  const vc  = VOLTAGE_CLASSES[cfg.vc];
  const fp  = res.footprint;

  const css = `
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Inter', Arial, sans-serif; font-size: 11px; color: #1a1a1a; background: #fff; }
    h1 { font-size: 18px; font-weight: 700; margin-bottom: 2px; }
    h2 { font-size: 13px; font-weight: 600; color: #0696d7; margin: 18px 0 6px;
         border-bottom: 1.5px solid #0696d7; padding-bottom: 3px; }
    h3 { font-size: 11px; font-weight: 600; color: #555; margin: 10px 0 4px;
         text-transform: uppercase; letter-spacing: .5px; }
    .header { padding: 16px 24px 12px; border-bottom: 2px solid #0696d7; margin-bottom: 16px; }
    .subtitle { font-size: 11px; color: #666; margin-top: 3px; }
    .badge { display: inline-block; background: #e8f5fc; color: #0696d7; font-size: 10px;
             font-weight: 600; padding: 2px 8px; border-radius: 3px; margin-left: 8px; border: 1px solid #b3dff2; }
    .section { padding: 0 24px; margin-bottom: 12px; }
    .grand-total { background: #e8f5fc; border: 1px solid #b3dff2; border-radius: 6px;
                   padding: 12px 16px; margin: 0 24px 16px; }
    .grand-total .amount { font-size: 26px; font-weight: 700; color: #0696d7; }
    .grand-total .sub { font-size: 11px; color: #555; margin-top: 3px; }
    .metrics-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; margin: 0 24px 16px; }
    .metric-card { background: #f7f7f7; border-radius: 5px; padding: 8px 10px; }
    .metric-card .lbl { font-size: 10px; color: #888; text-transform: uppercase; letter-spacing: .5px; margin-bottom: 3px; }
    .metric-card .val { font-size: 14px; font-weight: 600; color: #1a1a1a; }
    table { width: 100%; border-collapse: collapse; font-size: 10.5px; }
    th { background: #f0f0f0; padding: 5px 8px; text-align: left; font-weight: 600;
         font-size: 10px; color: #555; border-bottom: 1px solid #ddd; }
    th.r, td.r { text-align: right; }
    td { padding: 4px 8px; border-bottom: 0.5px solid #eee; vertical-align: top; }
    tr:last-child td { border-bottom: 1px solid #ccc; }
    .cat-row td { font-weight: 600; background: #f9f9f9; color: #333; padding: 6px 8px; font-size: 11px; }
    .total-row td { font-weight: 700; background: #f0f0f0; border-top: 1.5px solid #ccc; }
    .util-bar-wrap { background: #eee; border-radius: 3px; height: 8px; margin: 6px 0; overflow: hidden; }
    .util-bar { height: 100%; border-radius: 3px; }
    .util-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 3px 16px; margin-top: 6px; }
    .util-row { display: flex; justify-content: space-between; padding: 2px 0;
                border-bottom: 0.5px solid #eee; font-size: 10px; }
    .std-item { margin-bottom: 4px; font-size: 10.5px; }
    .std-code { font-weight: 700; color: #0696d7; }
    .std-desc { color: #555; margin-left: 4px; }
    .assume-row { display: flex; gap: 12px; margin-bottom: 5px; font-size: 10.5px;
                  padding-bottom: 4px; border-bottom: 0.5px solid #eee; }
    .assume-lbl { font-weight: 600; min-width: 180px; color: #333; flex-shrink: 0; }
    .assume-val { color: #555; flex: 1; }
    .footer { font-size: 9px; color: #aaa; text-align: center; margin: 20px 24px 0;
              padding-top: 8px; border-top: 1px solid #eee; }
    @media print {
      @page { margin: 14mm 12mm; size: A4; }
      .page-break { page-break-before: always; }
    }
  `;

  const utilColor = fp.overCapacity ? "#c24b2a" : fp.utilPct >= 85 ? "#7d5a00" : "#00875a";

  // Build BoM table rows
  let bomRows = "";
  let grandDirect = 0;
  for (const sec of res.sections) {
    const secTotal = sec.items.reduce((s, i) => s + i.total, 0);
    grandDirect += secTotal;
    bomRows += `<tr class="cat-row"><td colspan="5">${sec.name}</td><td class="r">${fc(secTotal)}</td></tr>`;
    for (const item of sec.items) {
      const qty = item.qty < 10 && !Number.isInteger(item.qty) ? item.qty.toFixed(2) : fn(item.qty);
      bomRows += `<tr>
        <td style="padding-left:16px">${item.desc}</td>
        <td class="r">${qty}</td>
        <td>${item.unit}</td>
        <td class="r">$${fn(item.u ?? 0)}</td>
        <td class="r">${fc(item.total)}</td>
        <td></td>
      </tr>`;
    }
  }

  const html = `<!DOCTYPE html><html lang="en"><head>
    <meta charset="UTF-8"/>
    <title>Substation Estimator — ${site.address}</title>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" rel="stylesheet"/>
    <style>${css}</style>
  </head><body>

  <div class="header">
    <h1>Substation Estimator
      <span class="badge">AACE Class 5 · Feasibility ±30%</span>
    </h1>
    <div class="subtitle">${site.address} &nbsp;|&nbsp; ${fn(site.sf)} SF (${site.acres} ac)</div>
    <div class="subtitle" style="margin-top:3px">
      ${vc.label} (${vc.sub}) &nbsp;·&nbsp;
      ${cfg.mva} MVA × ${cfg.xCount} transformer(s) &nbsp;·&nbsp;
      ${BUS_CONFIGS[cfg.bus].label} &nbsp;·&nbsp;
      ${cfg.sw.toUpperCase()} &nbsp;·&nbsp;
      ${REGIONS[cfg.region].label} (CCI ×${REGIONS[cfg.region].cci.toFixed(2)}) &nbsp;·&nbsp;
      Terrain: ${TERRAIN_TYPES[cfg.terrain].label} &nbsp;·&nbsp;
      Contingency: ${cfg.cont}%
    </div>
  </div>

  <div class="grand-total">
    <div style="font-size:11px;color:#0696d7;margin-bottom:2px">Estimated project total</div>
    <div class="amount">${ff(res.grand)}</div>
    <div class="sub">Direct cost ${ff(res.totalDirect)} + ${cfg.cont}% contingency ${ff(res.contingency)}</div>
  </div>

  <div class="metrics-grid">
    ${[
      ["Cost per MVA",      fc(res.metrics.cpMVA)],
      ["Cost per SF",       `$${res.metrics.cpSF.toFixed(2)}`],
      ["Total bays",        String(res.metrics.bays)],
      ["Circuit breakers",  String(res.metrics.bkrs)],
      ["Earthwork volume",  `${fn(res.metrics.ewCY)} CY`],
      ["Grounding copper",  `${fn(res.metrics.copperLB)} LB`],
      ["Cable trench",      `${fn(res.metrics.trenchLF)} LF`],
      ["Control cable",     `${fn(res.metrics.ctrlLF)} LF`],
      ["Site utilization",  `${fp.utilPct}%`],
    ].map(([l,v]) => `<div class="metric-card"><div class="lbl">${l}</div><div class="val">${v}</div></div>`).join("")}
  </div>

  <div class="section">
    <h2>Site utilization</h2>
    <div style="display:flex;justify-content:space-between;align-items:center">
      <span>${fn(fp.totalRequiredSF)} SF required of ${fn(fp.availableSF)} SF available (${fac(fp.availableSF)})</span>
      <span style="font-size:18px;font-weight:700;color:${utilColor}">${fp.utilPct}%</span>
    </div>
    <div class="util-bar-wrap"><div class="util-bar" style="width:${Math.min(100,fp.utilPct)}%;background:${utilColor}"></div></div>
    <div class="util-grid">
      ${[
        ["Switchyard",     fn(fp.switchyardSF)+" SF"],
        ["Transformers",   fn(fp.transformerSF)+" SF"],
        ["Control bldg",   fn(fp.controlBldgSF)+" SF"],
        ["Access / roads", fn(fp.accessRoadsSF)+" SF"],
        ...(fp.auxSF>0?[["Structures",fn(fp.auxSF)+" SF"]]:[]),
        ["Total required", fn(fp.totalRequiredSF)+" SF · "+fac(fp.totalRequiredSF)],
      ].map(([l,v])=>`<div class="util-row"><span style="color:#888">${l}</span><span style="font-weight:500">${v}</span></div>`).join("")}
    </div>
    ${fp.overCapacity ? `<div style="color:#c24b2a;font-weight:600;margin-top:6px">
      ⚠ Site too small — ${fn(Math.abs(fp.headroomSF))} SF over capacity.
      Recommended minimum: ${fn(fp.recommendedSiteSF)} SF (${fac(fp.recommendedSiteSF)})
    </div>` : ""}
  </div>

  <div class="section">
    <h2>Bill of materials</h2>
    <table>
      <thead>
        <tr>
          <th style="width:38%">Description</th>
          <th class="r" style="width:8%">Qty</th>
          <th style="width:6%">Unit</th>
          <th class="r" style="width:14%">Unit cost</th>
          <th class="r" style="width:12%">Total</th>
          <th class="r" style="width:22%">Section total</th>
        </tr>
      </thead>
      <tbody>${bomRows}</tbody>
      <tfoot>
        <tr class="total-row">
          <td colspan="4">Direct cost</td>
          <td></td>
          <td class="r">${ff(res.totalDirect)}</td>
        </tr>
        <tr class="total-row">
          <td colspan="4">Contingency (${cfg.cont}%)</td>
          <td></td>
          <td class="r">+ ${ff(res.contingency)}</td>
        </tr>
        <tr class="total-row" style="font-size:13px">
          <td colspan="4">Grand total</td>
          <td></td>
          <td class="r" style="color:#0696d7">${ff(res.grand)}</td>
        </tr>
      </tfoot>
    </table>
  </div>

  <div class="section page-break">
    <h2>Standards &amp; references</h2>
    ${STANDARDS.map(cat => `
      <h3>${cat.category}</h3>
      ${cat.items.map(i => `
        <div class="std-item">
          <span class="std-code">${i.code}</span>
          <span class="std-desc">${i.desc}</span>
        </div>`).join("")}
    `).join("")}

    <h2 style="margin-top:18px">Key assumptions</h2>
    ${ASSUMPTIONS.map(a => `
      <div class="assume-row">
        <span class="assume-lbl">${a.label}</span>
        <span class="assume-val">${a.value}</span>
      </div>`).join("")}
  </div>

  <div class="footer">
    RSMeans 2024 Heavy Construction · AACE Class 5 Conceptual Estimate · Accuracy ±30% ·
    Substation Estimator powered by Autodesk Forma · Generated ${new Date().toLocaleDateString()}
  </div>

  <script>window.onload = () => { window.print(); }</script>
  </body></html>`;

  const win = window.open("", "_blank");
  if (!win) { alert("Allow pop-ups for this site to open the print report."); return; }
  win.document.write(html);
  win.document.close();
}
