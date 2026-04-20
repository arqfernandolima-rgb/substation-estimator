import { useState, useMemo, useEffect, useRef } from "react";
import { useFormaIntegration, getFormaBuildingsFromForma } from "./hooks/useFormaIntegration";
import { printReport } from "./lib/report";
import {
  computeBOM, calcFootprint,
  VOLTAGE_CLASSES, MVA_OPTIONS, BUS_CONFIGS, SWITCHGEAR,
  REGIONS, TERRAIN_TYPES, BUILDING_FUNCTIONS,
  type Config, type VCKey, type BusKey, type SWKey,
  type RegionKey, type TerrainKey, type AuxKey,
} from "./lib/compute";
import { exportCSV } from "./lib/export";
import { STANDARDS, ASSUMPTIONS } from "./lib/standards";

const T = {
  panel:"#ffffff", border:"#e2e2e2",
  tx1:"#1a1a1a", tx2:"#555555", tx3:"#999999",
  blue:"#0696d7", blueHov:"#057ab5", blueLt:"#e8f5fc", blueMid:"#b3dff2",
  green:"#00875a", greenLt:"#e3f5ef",
  warn:"#7d5a00", warnLt:"#fef9e6", warnBd:"#e8c84a",
  red:"#c24b2a",  redLt:"#fff0ed",  redBd:"#f0a090",
};

const PRINT_CSS = `
@media print {
  body { font-family: 'Inter', sans-serif; font-size: 11px; color: #000; }
  #root { display: block !important; height: auto !important; overflow: visible !important; }
  .no-print { display: none !important; }
  .print-only { display: block !important; }
  .print-page { page-break-before: always; padding: 24px; }
  .print-section { margin-bottom: 16px; }
  .print-section h3 { font-size: 12px; font-weight: 600; border-bottom: 1px solid #ccc; padding-bottom: 4px; margin-bottom: 8px; }
  .print-row { display: flex; justify-content: space-between; padding: 3px 0; border-bottom: 0.5px solid #eee; font-size: 11px; }
  .print-row span:first-child { color: #555; }
  .print-row span:last-child { font-weight: 500; }
  .print-std-item { margin-bottom: 4px; font-size: 10px; }
  .print-std-code { font-weight: 600; color: #0696d7; }
  .print-std-desc { color: #555; margin-left: 6px; }
  .print-assume { display: flex; gap: 12px; margin-bottom: 4px; font-size: 10px; }
  .print-assume-label { font-weight: 500; min-width: 180px; color: #333; }
  .print-assume-val { color: #555; flex: 1; }
}
@media screen { .print-only { display: none !important; } }
`;

const fc = (n:number) => n>=1e6?`$${(n/1e6).toFixed(2)}M`:n>=1000?`$${(n/1000).toFixed(0)}K`:`$${Math.round(n).toLocaleString()}`;
const ff = (n:number) => `$${Math.round(n).toLocaleString()}`;
const fn = (n:number) => Math.round(n).toLocaleString();
const fac= (sf:number) => `${(sf/43560).toFixed(2)} ac`;

type Stage = "idle"|"configure"|"results";

const PARAMS: {id:keyof Config; label:string; required:boolean}[] = [
  {id:"vc",      label:"Voltage class",       required:true},
  {id:"mva",     label:"Transformer MVA",     required:true},
  {id:"xCount",  label:"No. of transformers", required:true},
  {id:"feeders", label:"Feeder bays",         required:true},
  {id:"bus",     label:"Bus configuration",   required:true},
  {id:"sw",      label:"Switchgear type",     required:true},
  {id:"terrain", label:"Site terrain",        required:true},
  {id:"region",  label:"Cost region (CCI)",   required:true},
  {id:"cont",    label:"Contingency",         required:false},
];

export default function App() {
  const {siteData, formaBuildings, loading, error, refresh} = useFormaIntegration();
  const [stage,       setStage]       = useState<Stage>("idle");
  const [cfg,         setCfg]         = useState<Partial<Config>>({cont:15, auxStructures:[]});
  const [openParam,   setOpenParam]   = useState<keyof Config|null>("vc");
  const [openSecs,    setOpenSecs]    = useState<Set<string>>(new Set());
  const [showAux,     setShowAux]     = useState(false);
  const [showInfo,    setShowInfo]    = useState(false);
  const [bldgLoading, setBldgLoading] = useState(false);
  const [bldgStatus,  setBldgStatus]  = useState<string|null>(null);
  // Building function picker state: path of building being assigned a function
  const [pickingFn,   setPickingFn]   = useState<string|null>(null);

  // Auto-sync Forma buildings into auxStructures when detected or updated
  const prevBuildingPaths = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!formaBuildings.length) return;
    setCfg(prev => {
      const manual = (prev.auxStructures || []).filter(a => !a.fromForma);
      const existing = new Map((prev.auxStructures || []).filter(a => a.fromForma).map(a => [a.path!, a]));
      const synced = formaBuildings.map((b, i) => {
        const ex = existing.get(b.path);
        return ex
          ? { ...ex, sf: b.sf, label: `Building ${i+1} (${b.sf.toLocaleString()} SF, from Forma)` }
          : { key: "maintenance" as AuxKey, functionKey: undefined as AuxKey|undefined,
              sf: b.sf, label: `Building ${i+1} (${b.sf.toLocaleString()} SF, from Forma)`,
              fromForma: true, path: b.path };
      });
      return { ...prev, auxStructures: [...manual, ...synced] };
    });
    prevBuildingPaths.current = new Set(formaBuildings.map(b => b.path));
  }, [formaBuildings]);

  const unassignedBuildings = (cfg.auxStructures || []).filter(a => a.fromForma && !a.functionKey);

  const effectiveStage:Stage = !siteData?"idle":stage==="idle"?"configure":stage;

  const set = (k:keyof Config, v:unknown) => {
    setCfg(prev => {
      const next = {...prev,[k]:v};
      if(k==="vc"){
        const vc=VOLTAGE_CLASSES[v as VCKey];
        next.mva=vc.dflMVA; next.feeders=vc.dflF;
        if(!prev.terrain&&siteData?.terrain) next.terrain=siteData.terrain as TerrainKey;
        if(!prev.region &&siteData?.region)  next.region=siteData.region   as RegionKey;
      }
      return next;
    });
    const idx=PARAMS.findIndex(p=>p.id===k);
    const next=PARAMS.slice(idx+1).find(p=>!cfg[p.id]&&p.required);
    setOpenParam(next?next.id:null);
  };

  const setVal = (k:keyof Config, v:unknown) => setCfg(prev=>({...prev,[k]:v}));

  // Add manual building
  const addBuilding = (fnKey:AuxKey) => {
    const def=BUILDING_FUNCTIONS[fnKey];
    setCfg(prev=>({...prev,
      auxStructures:[...(prev.auxStructures||[]),
        {key:fnKey, functionKey:fnKey, sf:def.defaultSF, label:def.label}]}));
  };

  const removeBuilding = (idx:number) =>
    setCfg(prev=>({...prev,
      auxStructures:(prev.auxStructures||[]).filter((_,i)=>i!==idx)}));

  const updateBuildingSF = (idx:number, sf:number) =>
    setCfg(prev=>({...prev,
      auxStructures:(prev.auxStructures||[]).map((a,i)=>i===idx?{...a,sf}:a)}));

  const assignFunction = (path:string, fnKey:AuxKey) => {
    const def=BUILDING_FUNCTIONS[fnKey];
    setCfg(prev=>({...prev,
      auxStructures:(prev.auxStructures||[]).map(a=>
        a.path===path?{...a,functionKey:fnKey,label:`${def.label} (from Forma)`}:a)}));
    setPickingFn(null);
  };

  // Sync Forma buildings
  const syncBuildings = async () => {
    setBldgLoading(true); setBldgStatus(null);
    try {
      const buildings = await getFormaBuildingsFromForma();
      if(buildings.length===0){
        setBldgStatus("No buildings found. Draw buildings on the site in Forma first.");
      } else {
        const manual=(cfg.auxStructures||[]).filter(a=>!a.fromForma);
        const fromForma=buildings.map(b=>({
          key:"maintenance" as AuxKey,
          functionKey:undefined as AuxKey|undefined,
          sf:b.sf,
          label:b.label,
          fromForma:true,
          path:b.path,
        }));
        setCfg(prev=>({...prev,auxStructures:[...manual,...fromForma]}));
        setBldgStatus(`✓ ${buildings.length} building${buildings.length>1?"s":""} synced — assign a function to each`);
        setShowAux(true);
      }
    } catch { setBldgStatus("Could not read buildings — are you running inside Forma?"); }
    setBldgLoading(false);
  };

  const requiredParams=PARAMS.filter(p=>p.required);
  const setCount=requiredParams.filter(p=>cfg[p.id]!==undefined&&cfg[p.id]!==null).length;
  const ready=setCount===requiredParams.length;
  const fullCfg:Config|null=ready&&siteData?{...cfg as Config,sf:siteData.sf,auxStructures:cfg.auxStructures||[]}:null;
  const liveFootprint=useMemo(()=>fullCfg?calcFootprint(fullCfg):null,[fullCfg]);
  const res=useMemo(()=>fullCfg&&stage==="results"?computeBOM(fullCfg):null,[stage,fullCfg]);
  const togSec=(id:string)=>setOpenSecs(p=>{const s=new Set(p);s.has(id)?s.delete(id):s.add(id);return s;});
  const reset=()=>{setStage("idle");setCfg({cont:15,auxStructures:[]});setOpenParam("vc");setOpenSecs(new Set());setBldgStatus(null);setShowInfo(false);};
  const pLabel=(id:keyof Config):string|null=>{
    const v=cfg[id]; if(v===undefined||v===null) return null;
    switch(id){
      case "vc":      return `${VOLTAGE_CLASSES[v as VCKey].label} · ${VOLTAGE_CLASSES[v as VCKey].sub}`;
      case "mva":     return `${v} MVA`;
      case "xCount":  return `${v} transformer${Number(v)>1?"s":""}`;
      case "feeders": return `${v} feeders`;
      case "bus":     return BUS_CONFIGS[v as BusKey].label;
      case "sw":      return SWITCHGEAR[v as SWKey].label;
      case "terrain": return `${TERRAIN_TYPES[v as TerrainKey].label} · ${TERRAIN_TYPES[v as TerrainKey].sub}`;
      case "region":  return `${REGIONS[v as RegionKey].label} (×${REGIONS[v as RegionKey].cci.toFixed(2)})`;
      case "cont":    return `${v}%`;
      default:        return String(v);
    }
  };

  return (
    <div style={{display:"flex",flexDirection:"column",height:"100vh",background:T.panel,
      fontFamily:"'Inter',system-ui,sans-serif",overflow:"hidden",position:"relative"}}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}${PRINT_CSS}`}</style>

      {/* ── Info panel overlay ── */}
      {showInfo&&(
        <div style={{position:"absolute",inset:0,zIndex:100,background:"rgba(0,0,0,0.35)",display:"flex",flexDirection:"column",justifyContent:"flex-end"}}>
          <div style={{background:"#fff",borderRadius:"12px 12px 0 0",maxHeight:"80vh",overflowY:"auto",padding:"16px 16px 24px"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
              <div style={{fontSize:13,fontWeight:600,color:T.tx1}}>Standards & assumptions</div>
              <button onClick={()=>setShowInfo(false)} style={{fontSize:18,color:T.tx3,background:"none",border:"none",cursor:"pointer",lineHeight:1}}>×</button>
            </div>
            {STANDARDS.map(cat=>(
              <div key={cat.category} style={{marginBottom:14}}>
                <div style={{fontSize:10,fontWeight:600,color:T.tx3,textTransform:"uppercase",letterSpacing:.5,marginBottom:6}}>{cat.category}</div>
                {cat.items.map(item=>(
                  <div key={item.code} style={{marginBottom:6,paddingLeft:0}}>
                    <span style={{fontSize:11,fontWeight:600,color:T.blue}}>{item.code}</span>
                    <span style={{fontSize:11,color:T.tx2,marginLeft:6}}>{item.desc}</span>
                  </div>
                ))}
              </div>
            ))}
            <div style={{marginBottom:6}}>
              <div style={{fontSize:10,fontWeight:600,color:T.tx3,textTransform:"uppercase",letterSpacing:.5,marginBottom:8}}>Key assumptions</div>
              {ASSUMPTIONS.map(a=>(
                <div key={a.label} style={{display:"flex",gap:8,marginBottom:6,paddingBottom:6,borderBottom:`0.5px solid ${T.border}`}}>
                  <span style={{fontSize:11,fontWeight:500,color:T.tx1,minWidth:140,flexShrink:0}}>{a.label}</span>
                  <span style={{fontSize:11,color:T.tx2,lineHeight:1.4}}>{a.value}</span>
                </div>
              ))}
            </div>
            <div style={{fontSize:10,color:T.tx3,padding:"8px 0",borderTop:`1px solid ${T.border}`,marginTop:4}}>
              AACE Class 5 estimate · Accuracy ±30% · RSMeans 2024 base year
            </div>
          </div>
        </div>
      )}

      {/* ── Print-only standards page ── */}
      <div className="print-only print-page">
        <div className="print-section">
          <h3>Standards &amp; References</h3>
          {STANDARDS.map(cat=>(
            <div key={cat.category} style={{marginBottom:10}}>
              <div style={{fontSize:11,fontWeight:600,marginBottom:4}}>{cat.category}</div>
              {cat.items.map(i=>(
                <div key={i.code} className="print-std-item">
                  <span className="print-std-code">{i.code}</span>
                  <span className="print-std-desc">{i.desc}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
        <div className="print-section">
          <h3>Key Assumptions</h3>
          {ASSUMPTIONS.map(a=>(
            <div key={a.label} className="print-assume">
              <span className="print-assume-label">{a.label}</span>
              <span className="print-assume-val">{a.value}</span>
            </div>
          ))}
        </div>
        <div style={{fontSize:9,color:"#999",marginTop:16}}>
          AACE Class 5 estimate · Accuracy ±30% · RSMeans 2024 base year · Substation Estimator powered by Autodesk Forma
        </div>
      </div>

      {/* ── Header ── */}
      <div className="no-print" style={{padding:"14px 16px 0",borderBottom:`1px solid ${T.border}`,flexShrink:0}}>
        <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between"}}>
          <div>
            <div style={{fontSize:14,fontWeight:600,color:T.tx1,lineHeight:1}}>Substation Estimator</div>
            <div style={{fontSize:11,color:T.tx3,marginTop:3}}>RSMeans 2024 · Feasibility ±30%</div>
          </div>
          <div style={{display:"flex",gap:6,alignItems:"center"}}>
            {/* Info button */}
            <button onClick={()=>setShowInfo(true)} title="Standards & assumptions"
              style={{width:24,height:24,borderRadius:12,fontSize:12,fontWeight:600,
                color:T.blue,background:T.blueLt,border:`1px solid ${T.blueMid}`,
                cursor:"pointer",lineHeight:1,display:"flex",alignItems:"center",justifyContent:"center"}}>
              i
            </button>
            <button onClick={refresh} style={{fontSize:13,color:T.tx3,background:"none",border:"none",cursor:"pointer"}}>↺</button>
            {effectiveStage!=="idle"&&<button onClick={reset} style={{fontSize:11,color:T.tx3,background:"none",border:"none",cursor:"pointer"}}>Reset</button>}
          </div>
        </div>
        {effectiveStage==="configure"&&(
          <div style={{marginTop:10,paddingBottom:12}}>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
              <span style={{fontSize:11,color:T.tx3}}>{setCount} of {requiredParams.length} set</span>
              {ready&&<span style={{fontSize:11,color:T.green,fontWeight:500}}>Ready</span>}
            </div>
            <div style={{height:3,background:"#ebebeb",borderRadius:2,overflow:"hidden"}}>
              <div style={{height:"100%",borderRadius:2,transition:"width .3s ease",
                background:ready?T.green:T.blue,width:`${(setCount/requiredParams.length)*100}%`}}/>
            </div>
          </div>
        )}
        {effectiveStage!=="idle"&&(
          <div style={{display:"flex",marginBottom:-1}}>
            {(["configure","results"] as Stage[]).map(s=>{
              const active=effectiveStage===s;
              return <button key={s}
                onClick={()=>{if(s==="results"&&ready)setStage("results");else if(s==="configure")setStage("configure");}}
                disabled={s==="results"&&!ready}
                style={{flex:1,padding:"6px 0",fontSize:12,fontWeight:active?500:400,
                  color:active?T.blue:(s==="results"&&!ready?"#ccc":T.tx2),
                  background:"none",border:"none",
                  borderBottom:active?`2px solid ${T.blue}`:"2px solid transparent",
                  cursor:s==="results"&&!ready?"not-allowed":"pointer",transition:"all .15s"}}>
                {s==="configure"?"Configure":"Results"}
              </button>;
            })}
          </div>
        )}
      </div>

      {/* IDLE */}
      {effectiveStage==="idle"&&(
        <div className="no-print" style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:24,gap:12}}>
          {loading
            ?<><div style={{width:36,height:36,border:`3px solid ${T.border}`,borderTop:`3px solid ${T.blue}`,borderRadius:"50%",animation:"spin 1s linear infinite"}}/><div style={{fontSize:12,color:T.tx3}}>Reading Forma project…</div></>
            :<><div style={{width:48,height:48,borderRadius:24,background:"#f0f0f0",display:"flex",alignItems:"center",justifyContent:"center",fontSize:20}}>⬡</div>
            <div style={{textAlign:"center"}}><div style={{fontSize:13,fontWeight:500,color:T.tx1,marginBottom:4}}>No site boundary detected</div>
              <div style={{fontSize:12,color:T.tx2,lineHeight:1.5,maxWidth:240,margin:"0 auto"}}>Draw a site limit in Forma to begin.</div>
            </div>
            {error&&<div style={{fontSize:11,color:T.red,background:T.redLt,padding:"8px 10px",borderRadius:4,border:`1px solid ${T.redBd}`,width:"100%",textAlign:"center"}}>{error}</div>}
            </>}
        </div>
      )}

      {/* CONFIGURE */}
      {effectiveStage==="configure"&&siteData&&(
        <div className="no-print" style={{flex:1,overflowY:"auto"}}>
          <div style={{margin:"12px 16px",padding:"10px 12px",background:T.blueLt,borderRadius:6,border:`1px solid ${T.blueMid}`}}>
            <div style={{fontSize:11,fontWeight:500,color:T.blue,marginBottom:4}}>✓ Site detected from Forma</div>
            <div style={{fontSize:12,color:T.tx1,fontWeight:500,marginBottom:6}}>{siteData.address}</div>
            <div style={{fontSize:11,color:T.tx2,marginBottom:6}}>{fn(siteData.sf)} SF · {siteData.acres} ac</div>
            <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
              {formaBuildings.length>0&&(
                <span style={{display:"inline-flex",alignItems:"center",gap:4,fontSize:10,fontWeight:500,
                  color:T.green,background:T.greenLt,border:`1px solid ${T.green}44`,padding:"3px 8px",borderRadius:3}}>
                  ⬡ {formaBuildings.length} building{formaBuildings.length>1?"s":""} detected
                </span>
              )}
              {siteData.regionAutoDetected&&(
                <span style={{display:"inline-flex",alignItems:"center",gap:4,fontSize:10,fontWeight:500,
                  color:T.green,background:T.greenLt,border:`1px solid ${T.green}44`,padding:"3px 8px",borderRadius:3}}>
                  ✓ GPS · {REGIONS[siteData.region].label}{siteData.lat&&` (${siteData.lat.toFixed(3)}°, ${siteData.lon?.toFixed(3)}°)`}
                </span>
              )}
              {siteData.elevRangeFt>0&&(
                <span style={{display:"inline-flex",alignItems:"center",gap:4,fontSize:10,
                  color:T.tx2,background:"#f5f5f5",border:`1px solid ${T.border}`,padding:"3px 8px",borderRadius:3}}>
                  {siteData.terrainAutoDetected?"✓ ":""}Elev {siteData.elevMinFt}–{siteData.elevMaxFt} ft · Δ{siteData.elevRangeFt} ft · {TERRAIN_TYPES[siteData.terrain].label}
                </span>
              )}
            </div>
          </div>

          {liveFootprint&&(
            <UtilizationCard fp={liveFootprint}
              onSwitchGIS={()=>set("sw","gis")}
              onReduceFeeders={()=>setVal("feeders",Math.max(2,(cfg.feeders||6)-2))}/>
          )}

          <div style={{padding:"0 16px",display:"flex",flexDirection:"column",gap:2}}>
            <div style={{fontSize:11,fontWeight:500,color:T.tx3,textTransform:"uppercase",letterSpacing:.5,marginBottom:6,marginTop:2}}>Configure substation</div>
            {PARAMS.map(p=>{
              const val=cfg[p.id],isSet=val!==undefined&&val!==null,isOpen=openParam===p.id,lbl=pLabel(p.id);
              return(
                <div key={String(p.id)} style={{border:`1px solid ${isOpen?T.blue:T.border}`,borderRadius:6,overflow:"hidden",
                  boxShadow:isOpen?`0 0 0 2px ${T.blue}22`:"none",transition:"box-shadow .15s,border-color .15s"}}>
                  <div onClick={()=>setOpenParam(isOpen?null:p.id as keyof Config)}
                    style={{display:"flex",alignItems:"center",justifyContent:"space-between",
                      padding:"8px 12px",cursor:"pointer",background:isOpen?T.blueLt:"#fff",transition:"background .1s"}}>
                    <div style={{display:"flex",alignItems:"center",gap:8}}>
                      {isSet?<span style={{fontSize:12,color:T.green}}>✓</span>
                        :<span style={{width:12,height:12,borderRadius:6,border:`1.5px solid ${isOpen?T.blue:"#ccc"}`,display:"inline-block"}}/>}
                      <span style={{fontSize:12,fontWeight:isOpen?500:400,color:isOpen?T.blue:T.tx1}}>{p.label}</span>
                      {!p.required&&<span style={{fontSize:10,color:T.tx3,background:"#f0f0f0",padding:"1px 5px",borderRadius:3}}>optional</span>}
                    </div>
                    <div style={{display:"flex",alignItems:"center",gap:6}}>
                      {isSet&&!isOpen&&<span style={{fontSize:11,color:T.tx2}}>{lbl}</span>}
                      <span style={{fontSize:12,color:T.tx3,display:"inline-block",transition:"transform .15s",transform:isOpen?"rotate(90deg)":"none"}}>›</span>
                    </div>
                  </div>
                  {isOpen&&(
                    <div style={{borderTop:`1px solid ${T.blueMid}`,padding:"10px 12px",background:"#fff"}}>
                      <ParamInput id={p.id} val={val} cfg={cfg} onSet={set} onSetVal={setVal}/>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Structures & Buildings */}
          <div style={{padding:"10px 16px 0"}}>
            <div onClick={()=>setShowAux(!showAux)}
              style={{display:"flex",alignItems:"center",justifyContent:"space-between",
                padding:"8px 12px",cursor:"pointer",border:`1px solid ${T.border}`,borderRadius:6,
                background:showAux?T.blueLt:"#fff"}}>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <span style={{fontSize:12,color:showAux?T.blue:T.tx1,fontWeight:showAux?500:400}}>Structures & buildings</span>
                {(cfg.auxStructures||[]).length>0&&(
                  <span style={{fontSize:10,background:T.blue,color:"#fff",padding:"1px 6px",borderRadius:3}}>
                    {(cfg.auxStructures||[]).length}
                  </span>
                )}
                <span style={{fontSize:10,color:T.tx3,background:"#f0f0f0",padding:"1px 5px",borderRadius:3}}>optional</span>
              </div>
              <span style={{fontSize:12,color:T.tx3,display:"inline-block",transition:"transform .15s",transform:showAux?"rotate(90deg)":"none"}}>›</span>
            </div>

            {showAux&&(
              <div style={{border:`1px solid ${T.border}`,borderTop:"none",borderRadius:"0 0 6px 6px",padding:"12px",background:"#fff"}}>

                {/* Forma sync */}
                <div style={{marginBottom:12,padding:"10px",background:"#f7f9ff",border:`1px solid ${T.blueMid}`,borderRadius:6}}>
                  <div style={{fontSize:11,fontWeight:500,color:T.blue,marginBottom:4}}>Sync buildings from Forma</div>
                  <div style={{fontSize:11,color:T.tx2,marginBottom:8,lineHeight:1.4}}>Draw buildings on your site in Forma, then sync to read real footprint areas. You'll assign a function to each.</div>
                  <button onClick={syncBuildings} disabled={bldgLoading}
                    style={{display:"flex",alignItems:"center",gap:6,padding:"7px 12px",fontSize:11,fontWeight:500,
                      color:"#fff",background:bldgLoading?"#aaa":T.blue,border:"none",borderRadius:4,cursor:bldgLoading?"not-allowed":"pointer"}}>
                    {bldgLoading
                      ?<><span style={{width:12,height:12,border:"2px solid #fff",borderTop:"2px solid transparent",borderRadius:"50%",animation:"spin 1s linear infinite",display:"inline-block"}}/> Syncing…</>
                      :"⬡ Sync buildings from Forma"}
                  </button>
                  {bldgStatus&&<div style={{fontSize:11,marginTop:6,color:bldgStatus.startsWith("✓")?T.green:T.warn}}>{bldgStatus}</div>}
                </div>

                {/* Forma-synced buildings */}
                {(cfg.auxStructures||[]).filter(a=>a.fromForma).map((a,idx)=>{
                  const isPicking=pickingFn===a.path;
                  const hasFn=!!a.functionKey;
                  const def=hasFn?BUILDING_FUNCTIONS[a.functionKey!]:null;
                  return(
                    <div key={a.path||idx} style={{marginBottom:8,border:`1px solid ${hasFn?T.blue:T.warnBd}`,borderRadius:6,overflow:"hidden"}}>
                      <div style={{display:"flex",alignItems:"center",gap:8,padding:"8px 10px",
                        background:hasFn?T.blueLt:T.warnLt}}>
                        <span style={{fontSize:11,color:hasFn?T.blue:T.warn}}>⬡</span>
                        <div style={{flex:1}}>
                          <div style={{fontSize:11,fontWeight:500,color:hasFn?T.blue:T.warn}}>{a.label}</div>
                          <div style={{fontSize:10,color:T.tx3}}>{fn(a.sf)} SF · {hasFn?`$${def!.costPerSF}/SF`:"⚠ assign a function to price"}</div>
                        </div>
                        <button onClick={()=>setPickingFn(isPicking?null:a.path||null)}
                          style={{fontSize:10,fontWeight:500,color:hasFn?T.tx2:T.warn,background:"#fff",
                            border:`1px solid ${hasFn?T.border:T.warnBd}`,borderRadius:4,padding:"3px 8px",cursor:"pointer"}}>
                          {hasFn?"Change":"Assign function"}
                        </button>
                        <button onClick={()=>removeBuilding((cfg.auxStructures||[]).indexOf(a))}
                          style={{fontSize:13,color:T.red,background:"none",border:"none",cursor:"pointer",padding:"0 2px"}}>×</button>
                      </div>
                      {isPicking&&(
                        <div style={{borderTop:`1px solid ${T.border}`,padding:"8px",background:"#fff"}}>
                          <div style={{fontSize:10,color:T.tx3,marginBottom:6}}>Select this building's function:</div>
                          <div style={{display:"flex",flexDirection:"column",gap:4}}>
                            {Object.entries(BUILDING_FUNCTIONS).map(([k,d])=>(
                              <div key={k} onClick={()=>assignFunction(a.path!,k as AuxKey)}
                                style={{display:"flex",justifyContent:"space-between",alignItems:"center",
                                  padding:"6px 8px",borderRadius:4,cursor:"pointer",
                                  border:`1px solid ${a.functionKey===k?T.blue:T.border}`,
                                  background:a.functionKey===k?T.blueLt:"#fafafa"}}>
                                <div>
                                  <div style={{fontSize:11,fontWeight:a.functionKey===k?500:400,color:a.functionKey===k?T.blue:T.tx1}}>{d.label}</div>
                                  <div style={{fontSize:10,color:T.tx3}}>{d.desc}</div>
                                </div>
                                <span style={{fontSize:11,fontWeight:500,color:T.tx2,whiteSpace:"nowrap",marginLeft:8}}>${d.costPerSF}/SF</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* Manual add */}
                <div style={{fontSize:11,color:T.tx3,marginBottom:6,marginTop:4}}>Add a building manually:</div>
                <div style={{display:"flex",flexDirection:"column",gap:4}}>
                  {Object.entries(BUILDING_FUNCTIONS).map(([k,def])=>{
                    const existing=(cfg.auxStructures||[]).find(a=>a.key===k&&!a.fromForma);
                    if(existing) return(
                      <div key={k} style={{display:"flex",alignItems:"center",gap:8,padding:"7px 10px",
                        border:`1px solid ${T.blue}`,borderRadius:5,background:T.blueLt}}>
                        <div style={{flex:1}}>
                          <div style={{fontSize:11,fontWeight:500,color:T.blue}}>{def.label}</div>
                          <div style={{fontSize:10,color:T.tx3}}>${def.costPerSF}/SF · {def.desc}</div>
                        </div>
                        <input type="number" value={existing.sf} min={100} step={100}
                          onChange={e=>updateBuildingSF((cfg.auxStructures||[]).indexOf(existing),+e.target.value)}
                          onClick={e=>e.stopPropagation()}
                          style={{width:72,padding:"4px 6px",fontSize:11,border:`1px solid ${T.border}`,borderRadius:4,
                            background:"#fff",color:T.tx1,outline:"none",textAlign:"right"}}/>
                        <span style={{fontSize:10,color:T.tx3}}>SF</span>
                        <button onClick={()=>removeBuilding((cfg.auxStructures||[]).indexOf(existing))}
                          style={{fontSize:13,color:T.red,background:"none",border:"none",cursor:"pointer",padding:"0 2px"}}>×</button>
                      </div>
                    );
                    return(
                      <div key={k} onClick={()=>addBuilding(k as AuxKey)}
                        style={{display:"flex",alignItems:"center",justifyContent:"space-between",
                          padding:"7px 10px",borderRadius:5,cursor:"pointer",
                          border:`1px solid ${T.border}`,background:"#fafafa",transition:"all .12s"}}
                        onMouseEnter={e=>(e.currentTarget.style.background='#f5f5f5')}
                        onMouseLeave={e=>(e.currentTarget.style.background="#fafafa")}>
                        <div>
                          <div style={{fontSize:11,color:T.tx1}}>{def.label}</div>
                          <div style={{fontSize:10,color:T.tx3}}>{def.desc}</div>
                        </div>
                        <div style={{display:"flex",alignItems:"center",gap:8,flexShrink:0,marginLeft:8}}>
                          <span style={{fontSize:10,color:T.tx2}}>${def.costPerSF}/SF</span>
                          <span style={{fontSize:12,color:T.blue,fontWeight:600}}>+</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Unassigned buildings warning */}
          {unassignedBuildings.length > 0 && (
            <div style={{margin:"0 16px 10px",padding:"10px 12px",background:T.warnLt,
              borderRadius:6,border:`1px solid ${T.warnBd}`}}>
              <div style={{fontSize:11,fontWeight:500,color:T.warn,marginBottom:3}}>
                ⚠ {unassignedBuildings.length} building{unassignedBuildings.length>1?"s":""} detected — assign a function before generating
              </div>
              <div style={{fontSize:10,color:T.tx2}}>
                Open "Structures & buildings" below to assign functions to Forma-detected buildings.
              </div>
            </div>
          )}

          <div style={{padding:"14px 16px 20px"}}>
            <button disabled={!ready} onClick={()=>setStage("results")}
              style={{width:"100%",padding:"10px",fontSize:13,fontWeight:500,
                color:ready?"#fff":"#aaa",background:ready?T.blue:"#e8e8e8",
                border:"none",borderRadius:4,cursor:ready?"pointer":"not-allowed",transition:"background .2s"}}>
              {ready?`Generate Estimate →`:`Set ${requiredParams.length-setCount} more parameter${requiredParams.length-setCount!==1?"s":""}`}
            </button>
          </div>
        </div>
      )}

      {/* RESULTS */}
      {effectiveStage==="results"&&res&&siteData&&fullCfg&&(
        <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
          <div style={{flex:1,overflowY:"auto"}}>
            <div className="no-print" style={{padding:"10px 16px",borderBottom:`1px solid ${T.border}`,display:"flex",flexWrap:"wrap",gap:4}}>
              {[`${VOLTAGE_CLASSES[fullCfg.vc].label} · ${VOLTAGE_CLASSES[fullCfg.vc].sub}`,
                `${fullCfg.mva} MVA × ${fullCfg.xCount}T`,`${fullCfg.feeders} feeders`,
                BUS_CONFIGS[fullCfg.bus].label,fullCfg.sw.toUpperCase(),REGIONS[fullCfg.region].label
              ].map((chip,i)=>(
                <span key={i} style={{fontSize:10,fontWeight:500,color:T.tx2,background:"#f0f0f0",padding:"2px 8px",borderRadius:3,border:`1px solid ${T.border}`}}>{chip}</span>
              ))}
              <button onClick={()=>setStage("configure")} style={{fontSize:10,color:T.blue,background:"none",border:"none",padding:"2px 4px",cursor:"pointer"}}>Edit ✎</button>
            </div>

            {/* Print header */}
            <div className="print-only" style={{padding:"16px 16px 8px",borderBottom:`1px solid ${T.border}`}}>
              <div style={{fontSize:16,fontWeight:700}}>Substation Estimator — Project Estimate</div>
              <div style={{fontSize:11,color:"#555",marginTop:4}}>{siteData.address} · {fn(siteData.sf)} SF · {REGIONS[fullCfg.region].label}</div>
              <div style={{fontSize:11,color:"#555"}}>{VOLTAGE_CLASSES[fullCfg.vc].label} ({VOLTAGE_CLASSES[fullCfg.vc].sub}) · {fullCfg.mva} MVA × {fullCfg.xCount}T · {BUS_CONFIGS[fullCfg.bus].label} · {fullCfg.sw.toUpperCase()} · RSMeans 2024</div>
            </div>

            <div style={{padding:"14px 16px",borderBottom:`1px solid ${T.border}`,background:T.blueLt}}>
              <div style={{fontSize:11,color:T.blue,marginBottom:2}}>Estimated project total</div>
              <div style={{fontSize:26,fontWeight:600,color:T.blue,lineHeight:1}}>{ff(res.grand)}</div>
              <div style={{fontSize:11,color:T.tx2,marginTop:4}}>Direct {ff(res.totalDirect)} + {fullCfg.cont}% contingency {ff(res.contingency)}</div>
            </div>

            <UtilizationCard fp={res.footprint} prominent
              onSwitchGIS={()=>{set("sw","gis");setStage("configure");}}
              onReduceFeeders={()=>{setVal("feeders",Math.max(2,fullCfg.feeders-2));setStage("configure");}}/>

            <div style={{padding:"10px 16px",borderBottom:`1px solid ${T.border}`}}>
              <STitle>Key metrics</STitle>
              <MRow label="Cost per MVA"     value={fc(res.metrics.cpMVA)}/>
              <MRow label="Cost per SF"      value={`$${res.metrics.cpSF.toFixed(2)}`}/>
              <MRow label="Total bays"       value={String(res.metrics.bays)}/>
              <MRow label="Circuit breakers" value={String(res.metrics.bkrs)}/>
            </div>

            <div style={{padding:"10px 16px",borderBottom:`1px solid ${T.border}`}}>
              <STitle>Quantities</STitle>
              <MRow label="Earthwork volume" value={`${fn(res.metrics.ewCY)} CY`}/>
              <MRow label="Grounding copper" value={`${fn(res.metrics.copperLB)} LB`}/>
              <MRow label="Cable trench"     value={`${fn(res.metrics.trenchLF)} LF`}/>
              <MRow label="Control cable"    value={`${fn(res.metrics.ctrlLF)} LF`}/>
            </div>

            {/* Standards summary in results (screen only, brief) */}
            <div className="no-print" style={{padding:"10px 16px",borderBottom:`1px solid ${T.border}`,background:"#f9f9f9"}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:4}}>
                <STitle>Standards & basis</STitle>
                <button onClick={()=>setShowInfo(true)} style={{fontSize:10,color:T.blue,background:"none",border:"none",cursor:"pointer",padding:0}}>View all →</button>
              </div>
              <div style={{fontSize:10,color:T.tx2,lineHeight:1.5}}>
                IEEE C2 (NESC) bay spacing · RSMeans 2024 Heavy Construction · AACE Class 5 ±30%<br/>
                CCI: {REGIONS[fullCfg.region].label} ×{REGIONS[fullCfg.region].cci.toFixed(2)} · {fullCfg.sw.toUpperCase()} spacing {fullCfg.sw==="gis"?"(58% footprint reduction vs AIS)":"(open yard)"} · 45% access & clearance buffer
              </div>
            </div>

            <div>
              <div style={{padding:"10px 16px 4px"}}><STitle>Bill of materials</STitle></div>
              {res.sections.map(sec=>{
                const tot=sec.items.reduce((s,i)=>s+i.total,0);
                const pct=Math.round((tot/res.totalDirect)*100);
                const isOpen=openSecs.has(sec.name);
                return(
                  <div key={sec.name} style={{borderBottom:`1px solid ${T.border}`}}>
                    <div onClick={()=>togSec(sec.name)}
                      style={{display:"flex",alignItems:"center",justifyContent:"space-between",
                        padding:"8px 16px",cursor:"pointer",background:isOpen?"#f9f9f9":"#fff",transition:"background .1s"}}>
                      <div style={{display:"flex",alignItems:"center",gap:8}}>
                        <span style={{fontSize:12,color:isOpen?T.blue:T.tx2,display:"inline-block",
                          transform:isOpen?"rotate(90deg)":"none",transition:"transform .15s"}}>›</span>
                        <span style={{fontSize:12,fontWeight:isOpen?500:400,color:T.tx1}}>{sec.name}</span>
                        <span style={{fontSize:10,color:T.tx3}}>{pct}%</span>
                      </div>
                      <span style={{fontSize:12,fontWeight:500,color:T.tx1}}>{fc(tot)}</span>
                    </div>
                    {isOpen&&(
                      <div style={{background:"#fafafa",borderTop:`1px solid ${T.border}`}}>
                        <div style={{display:"grid",gridTemplateColumns:"1fr 48px 44px 68px",padding:"4px 16px 4px 32px",gap:6,borderBottom:`1px solid ${T.border}`}}>
                          {["Description","Qty","Unit","Total"].map(h=>(
                            <div key={h} style={{fontSize:10,color:T.tx3,fontWeight:500,textAlign:h==="Qty"||h==="Total"?"right":"left"}}>{h}</div>
                          ))}
                        </div>
                        {sec.items.map((item,j)=>(
                          <div key={j} style={{display:"grid",gridTemplateColumns:"1fr 48px 44px 68px",
                            padding:"5px 16px 5px 32px",gap:6,borderBottom:j<sec.items.length-1?`1px solid ${T.border}`:"none"}}>
                            <div style={{fontSize:11,color:T.tx2,lineHeight:1.3}}>{item.desc}</div>
                            <div style={{fontSize:11,color:T.tx2,textAlign:"right"}}>{item.qty<10&&!Number.isInteger(item.qty)?item.qty.toFixed(2):fn(item.qty)}</div>
                            <div style={{fontSize:10,color:T.tx3}}>{item.unit}</div>
                            <div style={{fontSize:11,color:T.tx1,fontWeight:500,textAlign:"right"}}>{fc(item.total)}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="no-print" style={{padding:"12px 16px",borderTop:`1px solid ${T.border}`,background:"#fff",display:"flex",gap:8,flexShrink:0}}>
            <button onClick={()=>exportCSV(res,fullCfg,siteData.address)}
              style={{flex:1,padding:"8px",fontSize:12,fontWeight:500,color:T.blue,background:"#fff",
                border:`1px solid ${T.blue}`,borderRadius:4,cursor:"pointer"}}>↓ Export CSV</button>
            <button onClick={()=>res&&siteData&&fullCfg&&printReport(res,fullCfg,siteData)}
              style={{flex:1,padding:"8px",fontSize:12,fontWeight:500,color:"#fff",background:T.blue,
                border:"none",borderRadius:4,cursor:"pointer"}}>⎙ Print / PDF</button>
          </div>
        </div>
      )}
    </div>
  );
}

function UtilizationCard({fp,prominent=false,onSwitchGIS,onReduceFeeders}:{
  fp:ReturnType<typeof calcFootprint>; prominent?:boolean;
  onSwitchGIS:()=>void; onReduceFeeders:()=>void;
}){
  const pct=fp.utilPct,over=fp.overCapacity,nearFull=pct>=85&&!over;
  const barColor=over?"#c24b2a":nearFull?"#7d5a00":"#00875a";
  const bgColor=over?"#fff0ed":nearFull?"#fef9e6":prominent?"#e8f5fc":"#f9f9f9";
  const bdColor=over?"#f0a090":nearFull?"#e8c84a":prominent?"#b3dff2":"#e2e2e2";
  return(
    <div style={{margin:"8px 16px",padding:"12px",background:bgColor,borderRadius:6,border:`1px solid ${bdColor}`}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
        <span style={{fontSize:12,fontWeight:500,color:"#1a1a1a"}}>Site utilization</span>
        <span style={{fontSize:prominent?22:16,fontWeight:600,color:barColor,lineHeight:1}}>{pct}%</span>
      </div>
      <div style={{height:6,background:"#e0e0e0",borderRadius:3,overflow:"hidden",marginBottom:10}}>
        <div style={{height:"100%",borderRadius:3,transition:"width .4s ease",background:barColor,width:`${Math.min(100,pct)}%`}}/>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"3px 12px",marginBottom:8}}>
        {[
          ["Switchyard",   fn(fp.switchyardSF)+" SF"],
          ["Transformers", fn(fp.transformerSF)+" SF"],
          ["Control bldg", fn(fp.controlBldgSF)+" SF"],
          ["Access/roads", fn(fp.accessRoadsSF)+" SF"],
          ...(fp.auxSF>0?[["Structures",fn(fp.auxSF)+" SF"]]:[]),
          ["Required",`${fn(fp.totalRequiredSF)} SF · ${fac(fp.totalRequiredSF)}`],
          ["Available",`${fn(fp.availableSF)} SF · ${fac(fp.availableSF)}`],
        ].map(([l,v],i,arr)=>(
          <div key={i} style={{display:"flex",justifyContent:"space-between",gridColumn:i>=arr.length-2?"1 / -1":"auto",padding:"2px 0",borderBottom:"0.5px solid #e2e2e2"}}>
            <span style={{fontSize:10,color:"#999"}}>{l}</span>
            <span style={{fontSize:10,fontWeight:500,color:i>=arr.length-2?barColor:"#555"}}>{v}</span>
          </div>
        ))}
      </div>
      {over&&(
        <div style={{marginTop:8}}>
          <div style={{fontSize:11,fontWeight:500,color:"#c24b2a",marginBottom:6}}>⚠ Site too small by {fn(Math.abs(fp.headroomSF))} SF — choose an option:</div>
          <div style={{display:"flex",flexDirection:"column",gap:6}}>
            <button onClick={onSwitchGIS} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 10px",fontSize:11,fontWeight:500,color:"#0696d7",background:"#fff",border:"1px solid #0696d7",borderRadius:5,cursor:"pointer",textAlign:"left"}}>
              <div><div>Switch to GIS switchgear</div><div style={{fontSize:10,color:"#999",fontWeight:400,marginTop:1}}>Reduces footprint ~58% → {fn(fp.gisRequiredSF)} SF needed</div></div><span>→</span>
            </button>
            <button onClick={onReduceFeeders} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 10px",fontSize:11,fontWeight:500,color:"#7d5a00",background:"#fff",border:"1px solid #e8c84a",borderRadius:5,cursor:"pointer",textAlign:"left"}}>
              <div><div>Reduce feeders by 2</div><div style={{fontSize:10,color:"#999",fontWeight:400,marginTop:1}}>Saves {fn(fp.totalRequiredSF-fp.reducedFeedersSF)} SF → {fn(fp.reducedFeedersSF)} SF needed</div></div><span>→</span>
            </button>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 10px",fontSize:11,color:"#555",background:"#f7f7f7",border:"1px solid #e2e2e2",borderRadius:5}}>
              <div><div style={{fontWeight:500}}>Expand the site boundary in Forma</div><div style={{fontSize:10,color:"#999",marginTop:1}}>Minimum recommended: {fn(fp.recommendedSiteSF)} SF ({fac(fp.recommendedSiteSF)})</div></div><span>⬡</span>
            </div>
          </div>
        </div>
      )}
      {nearFull&&!over&&<div style={{fontSize:11,color:"#7d5a00",marginTop:4}}>Site is {pct}% utilized — limited room for future expansion.</div>}
      {!over&&!nearFull&&fp.headroomSF>0&&<div style={{fontSize:10,color:"#999",marginTop:2}}>{fn(fp.headroomSF)} SF headroom · {fac(fp.headroomSF)}</div>}
    </div>
  );
}

function STitle({children}:{children:React.ReactNode}){
  return <div style={{fontSize:11,fontWeight:500,color:"#999",textTransform:"uppercase",letterSpacing:.5,marginBottom:6}}>{children}</div>;
}
function MRow({label,value}:{label:string;value:string}){
  return(
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",padding:"4px 0",borderBottom:"1px solid #e2e2e2"}}>
      <span style={{fontSize:11,color:"#555"}}>{label}</span>
      <span style={{fontSize:12,fontWeight:500,color:"#1a1a1a"}}>{value}</span>
    </div>
  );
}
function OCard({selected,onClick,label,sub,note}:{selected:boolean;onClick:()=>void;label:string;sub?:string;note?:string|null}){
  return(
    <div onClick={onClick} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"7px 10px",borderRadius:5,cursor:"pointer",border:`1px solid ${selected?"#0696d7":"#e2e2e2"}`,background:selected?"#e8f5fc":"#fff",transition:"all .12s"}}>
      <div>
        <div style={{fontSize:12,fontWeight:selected?500:400,color:selected?"#0696d7":"#1a1a1a"}}>{label}</div>
        {sub&&<div style={{fontSize:11,color:"#999",marginTop:1}}>{sub}</div>}
        {note&&<div style={{fontSize:11,color:"#7d5a00",marginTop:2}}>{note}</div>}
      </div>
      <div style={{width:16,height:16,borderRadius:8,flexShrink:0,border:`1.5px solid ${selected?"#0696d7":"#ccc"}`,background:selected?"#0696d7":"#fff",display:"flex",alignItems:"center",justifyContent:"center"}}>
        {selected&&<div style={{width:6,height:6,borderRadius:3,background:"#fff"}}/>}
      </div>
    </div>
  );
}
function ParamInput({id,val,cfg,onSet,onSetVal}:{id:keyof Config;val:unknown;cfg:Partial<Config>;onSet:(k:keyof Config,v:unknown)=>void;onSetVal:(k:keyof Config,v:unknown)=>void}){
  const blue="#0696d7",blueLt="#e8f5fc",border="#e2e2e2",tx2="#555";
  switch(id){
    case "vc": return(<div style={{display:"flex",flexDirection:"column",gap:6}}>{Object.entries(VOLTAGE_CLASSES).map(([k,v])=>(<OCard key={k} selected={val===k} onClick={()=>onSet("vc",k)} label={v.label} sub={v.sub}/>))}</div>);
    case "mva":{const opts=cfg.vc?MVA_OPTIONS[cfg.vc]:MVA_OPTIONS.subtrans;return(<div style={{display:"flex",flexWrap:"wrap",gap:6}}>{opts.map(m=>(<button key={m} onClick={()=>onSet("mva",m)} style={{padding:"6px 14px",fontSize:12,fontWeight:val===m?500:400,color:val===m?blue:tx2,background:val===m?blueLt:"#f7f7f7",border:`1px solid ${val===m?blue:border}`,borderRadius:4,cursor:"pointer"}}>{m} MVA</button>))}</div>);}
    case "xCount": return(<div style={{display:"flex",gap:6}}>{[1,2,3].map(n=>(<button key={n} onClick={()=>onSet("xCount",n)} style={{flex:1,padding:"7px",fontSize:12,fontWeight:val===n?500:400,color:val===n?blue:tx2,background:val===n?blueLt:"#f7f7f7",border:`1px solid ${val===n?blue:border}`,borderRadius:4,cursor:"pointer"}}>{n}</button>))}</div>);
    case "feeders":{
      const cur=(val as number)??(cfg.vc?VOLTAGE_CLASSES[cfg.vc].dflF:6);
      return(<div style={{display:"flex",flexDirection:"column",gap:6}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <input type="range" min={2} max={16} step={1} value={cur}
            onChange={e=>onSetVal("feeders",+e.target.value)}
            onMouseDown={e=>e.stopPropagation()} onPointerDown={e=>e.stopPropagation()}
            style={{flex:1,accentColor:blue}}/>
          <span style={{fontSize:13,fontWeight:500,color:blue,minWidth:28,textAlign:"right"}}>{cur}</span>
        </div>
        <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
          {[2,4,6,8,10,12].map(n=>(<button key={n} onClick={()=>onSetVal("feeders",n)} style={{padding:"3px 10px",fontSize:11,fontWeight:cur===n?500:400,color:cur===n?blue:tx2,background:cur===n?blueLt:"#f7f7f7",border:`1px solid ${cur===n?blue:border}`,borderRadius:3,cursor:"pointer"}}>{n}</button>))}
        </div>
      </div>);
    }
    case "bus": return(<div style={{display:"flex",flexDirection:"column",gap:6}}>{Object.entries(BUS_CONFIGS).map(([k,v])=>(<OCard key={k} selected={val===k} onClick={()=>onSet("bus",k)} label={v.label} sub={v.desc}/>))}</div>);
    case "sw":  return(<div style={{display:"flex",flexDirection:"column",gap:6}}>{Object.entries(SWITCHGEAR).map(([k,v])=>(<OCard key={k} selected={val===k} onClick={()=>onSet("sw",k)} label={v.label} sub={v.desc} note={val===k?v.footprintNote:null}/>))}</div>);
    case "terrain": return(<div style={{display:"flex",flexDirection:"column",gap:6}}>{Object.entries(TERRAIN_TYPES).map(([k,v])=>(<OCard key={k} selected={val===k} onClick={()=>onSet("terrain",k)} label={v.label} sub={v.sub}/>))}</div>);
    case "region":  return(<div style={{display:"flex",flexDirection:"column",gap:4}}>{Object.entries(REGIONS).map(([k,v])=>(<OCard key={k} selected={val===k} onClick={()=>onSet("region",k)} label={v.label} sub={`CCI ×${v.cci.toFixed(2)}`}/>))}</div>);
    case "cont":{
      const cur=(val as number)??15;
      return(<div style={{display:"flex",flexDirection:"column",gap:6}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <input type="range" min={5} max={30} step={1} value={cur}
            onChange={e=>onSetVal("cont",+e.target.value)}
            onMouseDown={e=>e.stopPropagation()} onPointerDown={e=>e.stopPropagation()}
            style={{flex:1,accentColor:blue}}/>
          <span style={{fontSize:13,fontWeight:500,color:blue,minWidth:32,textAlign:"right"}}>{cur}%</span>
        </div>
        <div style={{fontSize:11,color:"#999"}}>15% = conceptual · 10% = feasibility · 5% = detailed</div>
      </div>);
    }
    default: return null;
  }
}
