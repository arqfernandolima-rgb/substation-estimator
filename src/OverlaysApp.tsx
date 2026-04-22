import { useState, useEffect, useRef, useCallback } from "react";

declare const __APP_VERSION__: string;
import {
  SLOPE_BANDS,
  renderSlopeOverlay, removeSlopeOverlay, updateSlopeOpacity,
  fetchPowerInfrastructure, renderPowerOverlay, removePowerOverlay,
  clearTerrainCache,
  type InfraFeature,
} from "./lib/overlays";

const T = {
  border:"#e2e2e2", tx1:"#1a1a1a", tx2:"#555", tx3:"#999",
  blue:"#0696d7", blueLt:"#e8f5fc", blueMid:"#b3dff2",
  green:"#00875a", greenLt:"#e3f5ef",
  warn:"#7d5a00", warnLt:"#fef9e6", warnBd:"#e8c84a",
  red:"#c24b2a", redLt:"#fff0ed", redBd:"#f0a090",
};

const IS_IN_FORMA = window.location.search.includes("origin=");
type OverlayState = "off" | "loading" | "on" | "error";
type InfraLayer = { substations:boolean; plants:boolean; lines:boolean; pipelines:boolean };


export default function OverlaysApp() {
  const [slopeState,   setSlopeState]   = useState<OverlayState>("off");
  const [slopeMsg,     setSlopeMsg]     = useState("");
  const [slopeOpacity, setSlopeOpacity] = useState(0.80);
  const [powerState,   setPowerState]   = useState<OverlayState>("off");
  const [powerMsg,     setPowerMsg]     = useState("");
  const [infraLayers,  setInfraLayers]  = useState<InfraLayer>({substations:true,plants:true,lines:true,pipelines:false});
  const [infraCache,   setInfraCache]   = useState<InfraFeature[]|null>(null);
  const [infraStats,   setInfraStats]   = useState<{subs:number;plants:number;lines:number;pipelines:number}|null>(null);
  const [refLatLon,    setRefLatLon]    = useState<[number,number]|null>(null);
  const [radiusMi,     setRadiusMi]     = useState(25);

  useEffect(() => {
    if (!IS_IN_FORMA) { setRefLatLon([35.732, -78.823]); return; }
    (async () => {
      try {
        const { Forma } = await import("forma-embedded-view-sdk/auto");
        const geo = await Forma.project.getGeoLocation();
        if (geo) setRefLatLon([geo[0], geo[1]]);
      } catch { /* ok */ }
    })();
  }, []);

  // ── Slope ─────────────────────────────────────────────────────────────────
  const toggleSlope = useCallback(async () => {
    if (slopeState === "loading") return;
    if (slopeState === "on") {
      await removeSlopeOverlay().catch(()=>{});
      setSlopeState("off"); setSlopeMsg(""); return;
    }
    setSlopeState("loading"); setSlopeMsg("Starting…");
    try {
      if (!IS_IN_FORMA) {
        await new Promise(r=>setTimeout(r,600));
        setSlopeState("on"); setSlopeMsg(""); return;
      }
      await renderSlopeOverlay(msg=>{
        if (msg==="done"){setSlopeState("on");setSlopeMsg("");}
        else setSlopeMsg(msg);
      }, slopeOpacity);
    } catch(e) {
      setSlopeState("error"); setSlopeMsg(String(e).substring(0,140));
    }
  }, [slopeState, slopeOpacity]);

  const slopeOpacityTimer = useRef<ReturnType<typeof setTimeout>|null>(null);
  const handleSlopeOpacity = (v: number) => {
    setSlopeOpacity(v);
    if (slopeState !== "on") return;
    if (slopeOpacityTimer.current) clearTimeout(slopeOpacityTimer.current);
    slopeOpacityTimer.current = setTimeout(() => updateSlopeOpacity(v).catch(()=>{}), 80);
  };

  // ── Power ─────────────────────────────────────────────────────────────────
  const applyPowerOverlay = useCallback(async (
    cache:InfraFeature[]|null, layers:InfraLayer, latLon:[number,number]|null
  ) => {
    if (!latLon){setPowerMsg("No project location detected");setPowerState("error");return;}
    setPowerState("loading"); setPowerMsg("Querying OSM…");
    try {
      let features = cache;
      if (!features) {
        if (!IS_IN_FORMA) {
          features=[
            {type:"substation",name:"Apex 115kV Substation",lat:35.745,lon:-78.810,voltage:"115000"},
            {type:"substation",name:"Holly Springs 69kV",lat:35.720,lon:-78.850,voltage:"69000"},
            {type:"plant",name:"Shearon Harris Nuclear",lat:35.655,lon:-78.956},
            {type:"line",name:"345kV Transmission",lat:35.740,lon:-78.820,voltage:"345000",
              coords:[[35.800,-78.900],[35.750,-78.830],[35.690,-78.770]]},
          ];
        } else {
          features = await fetchPowerInfrastructure(latLon[0],latLon[1],radiusMi*1609.34,msg=>setPowerMsg(msg),layers.pipelines);
        }
        setInfraCache(features);
      }
      setInfraStats({
        subs:features.filter(f=>f.type==="substation").length,
        plants:features.filter(f=>f.type==="plant").length,
        lines:features.filter(f=>f.type==="line").length,
        pipelines:features.filter(f=>f.type==="pipeline").length,
      });
      const visible=new Set<"substation"|"plant"|"line"|"pipeline">();
      if (layers.substations) visible.add("substation");
      if (layers.plants)      visible.add("plant");
      if (layers.lines)       visible.add("line");
      if (layers.pipelines)   visible.add("pipeline");
      if (!IS_IN_FORMA){await new Promise(r=>setTimeout(r,500));setPowerState("on");setPowerMsg("");return;}
      await renderPowerOverlay(features,latLon[0],latLon[1],visible,msg=>{
        if(msg==="done"){setPowerState("on");setPowerMsg("");}else setPowerMsg(msg);
      });
    } catch(e){setPowerState("error");setPowerMsg(String(e).substring(0,140));}
  }, [radiusMi]);

  const togglePower = useCallback(async () => {
    if (powerState==="loading") return;
    if (powerState==="on"){await removePowerOverlay().catch(()=>{});setPowerState("off");setPowerMsg("");return;}
    await applyPowerOverlay(infraCache,infraLayers,refLatLon);
  }, [powerState,infraCache,infraLayers,refLatLon,applyPowerOverlay]);

  const prevLayersRef = useRef(infraLayers);
  useEffect(()=>{
    const prev=prevLayersRef.current;
    if (powerState==="on"&&(prev.substations!==infraLayers.substations||prev.plants!==infraLayers.plants||prev.lines!==infraLayers.lines||prev.pipelines!==infraLayers.pipelines))
      applyPowerOverlay(infraCache,infraLayers,refLatLon);
    prevLayersRef.current=infraLayers;
  },[infraLayers,powerState,infraCache,refLatLon,applyPowerOverlay]);

  const toggleLayer=(k:keyof InfraLayer)=>{
    if(k==="pipelines"&&!infraLayers.pipelines&&!infraCache?.some(f=>f.type==="pipeline")){
      setInfraCache(null);setInfraStats(null);
    }
    setInfraLayers(p=>({...p,[k]:!p[k]}));
  };
  const clearCache=()=>{
    setInfraCache(null);setInfraStats(null);
    clearTerrainCache();
    if(powerState==="on"){removePowerOverlay().catch(()=>{});setPowerState("off");}
  };

  return (
    <div style={{fontFamily:"'Inter',system-ui,sans-serif",background:"#fff",width:"100%",boxSizing:"border-box"}}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}} *{box-sizing:border-box}`}</style>

      {/* Header */}
      <div style={{padding:"12px 14px 10px",borderBottom:`1px solid ${T.border}`}}>
        <div style={{fontSize:14,fontWeight:600,color:T.tx1}}>Site Overlays</div>
        <div style={{fontSize:11,color:T.tx3,marginTop:2}}>Slope · Power infrastructure</div>
      </div>

      <div style={{padding:"10px 14px",display:"flex",flexDirection:"column",gap:10}}>

        {/* ── Slope ──────────────────────────────────────────────────────── */}
        <OverlayCard title="Slope analysis" iconColor="#2ecc71"
          state={slopeState} msg={slopeMsg} onToggle={toggleSlope} activeColor="#2ecc71"
          description="Per-triangle slope computed from terrain mesh face normals.">
          <>
            <div style={{marginTop:10,paddingTop:10,borderTop:`1px solid ${T.border}`}}>
              <OpacitySlider label="Opacity" value={slopeOpacity} onChange={handleSlopeOpacity} color="#2ecc71"/>
            </div>
            <div style={{marginTop:8}}>
              <div style={{fontSize:10,fontWeight:600,color:T.tx3,textTransform:"uppercase",letterSpacing:.5,marginBottom:5}}>Color legend</div>
              {SLOPE_BANDS.map(band=>(
                <div key={band.label} style={{display:"flex",alignItems:"center",gap:7,marginBottom:3}}>
                  <div style={{width:14,height:14,borderRadius:2,flexShrink:0,background:band.color,border:"1px solid rgba(0,0,0,.08)"}}/>
                  <span style={{fontSize:11,color:T.tx2}}>{band.label}</span>
                </div>
              ))}
            </div>
          </>
        </OverlayCard>

        {/* ── Power ──────────────────────────────────────────────────────── */}
        <OverlayCard title="Power infrastructure" iconColor={T.blue}
          state={powerState} msg={powerMsg} onToggle={togglePower} activeColor={T.blue}
          description="HV substations, power plants, and transmission lines from OpenStreetMap.">
          <div style={{marginTop:10,paddingTop:10,borderTop:`1px solid ${T.border}`}}>
            <div style={{marginBottom:10}}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}>
                <span style={{fontSize:11,color:T.tx2}}>Search radius</span>
                <span style={{fontSize:11,fontWeight:600,color:T.blue}}>{radiusMi} mi</span>
              </div>
              <input type="range" min={5} max={50} step={5} value={radiusMi}
                onChange={e=>{setRadiusMi(+e.target.value);clearCache();}}
                onMouseDown={e=>e.stopPropagation()}
                style={{width:"100%",accentColor:T.blue,display:"block"}}/>
            </div>
            <div style={{fontSize:10,fontWeight:600,color:T.tx3,textTransform:"uppercase",letterSpacing:.5,marginBottom:5}}>Layers</div>
            {([
              {key:"substations" as keyof InfraLayer,label:"HV Substations",color:T.blue,    sym:"■"},
              {key:"plants"      as keyof InfraLayer,label:"Power plants",   color:"#e67e22", sym:"●"},
              {key:"lines"       as keyof InfraLayer,label:"Trans. lines",   color:"#e74c3c", sym:"—"},
              {key:"pipelines"   as keyof InfraLayer,label:"Pipelines",      color:"#27ae60", sym:"~"},
            ] as const).map(({key,label,color,sym})=>(
              <div key={key} onClick={()=>toggleLayer(key)}
                style={{display:"flex",alignItems:"center",gap:7,padding:"5px 7px",marginBottom:3,
                  borderRadius:4,cursor:"pointer",
                  border:`1px solid ${infraLayers[key]?color+"44":T.border}`,
                  background:infraLayers[key]?`${color}0d`:"#fafafa",transition:"all .1s"}}>
                <span style={{fontSize:13,color,fontWeight:"bold",width:14,textAlign:"center"}}>{sym}</span>
                <span style={{flex:1,fontSize:11,color:infraLayers[key]?T.tx1:T.tx3,fontWeight:infraLayers[key]?500:400}}>{label}</span>
                {infraStats&&<span style={{fontSize:10,color:T.tx3}}>{key==="substations"?infraStats.subs:key==="plants"?infraStats.plants:key==="lines"?infraStats.lines:infraStats.pipelines}</span>}
                <div style={{width:15,height:15,borderRadius:3,border:`1.5px solid ${infraLayers[key]?color:"#ccc"}`,
                  background:infraLayers[key]?color:"#fff",display:"flex",alignItems:"center",justifyContent:"center"}}>
                  {infraLayers[key]&&<span style={{color:"#fff",fontSize:9,fontWeight:"bold"}}>✓</span>}
                </div>
              </div>
            ))}
            {infraStats&&powerState==="on"&&(
              <div style={{marginTop:7,padding:"7px 8px",background:T.blueLt,borderRadius:4,
                border:`1px solid ${T.blueMid}`,fontSize:11,color:T.tx2}}>
                <span style={{color:T.blue,fontWeight:500}}>✓ Active</span>
                {" · "}{infraStats.subs} sub · {infraStats.plants} plant · {infraStats.lines} lines
                {infraStats.pipelines>0&&` · ${infraStats.pipelines} pipelines`}
                <br/><span style={{fontSize:10,color:T.tx3}}>
                  OpenStreetMap · {radiusMi} mi
                  {refLatLon&&` · ref ${refLatLon[0].toFixed(4)}, ${refLatLon[1].toFixed(4)}`}
                </span>
              </div>
            )}
            {infraCache&&<button onClick={clearCache}
              style={{marginTop:7,fontSize:10,color:T.tx3,background:"none",border:"none",cursor:"pointer",padding:0,textDecoration:"underline",display:"block"}}>
              Clear cached data
            </button>}
          </div>
        </OverlayCard>

        {/* Attribution */}
        <div style={{fontSize:10,color:T.tx3,lineHeight:1.5,paddingBottom:4}}>
          Infrastructure © OpenStreetMap contributors (ODbL).
          Slope from Forma terrain mesh.
        </div>

        {/* Version */}
        <div style={{fontSize:10,color:T.tx3,paddingBottom:12,textAlign:"right"}}>
          Site Overlays v{__APP_VERSION__}
        </div>
      </div>
    </div>
  );
}

// ─── OpacitySlider ────────────────────────────────────────────────────────────

function OpacitySlider({label,value,onChange,color}:{label:string;value:number;onChange:(v:number)=>void;color:string}) {
  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}>
        <span style={{fontSize:11,color:"#555"}}>{label}</span>
        <span style={{fontSize:11,fontWeight:600,color}}>{Math.round(value*100)}%</span>
      </div>
      <input type="range" min={0.1} max={1.0} step={0.05} value={value}
        onChange={e=>onChange(+e.target.value)}
        onMouseDown={e=>e.stopPropagation()}
        style={{width:"100%",accentColor:color,display:"block"}}/>
      <div style={{display:"flex",justifyContent:"space-between",marginTop:1}}>
        <span style={{fontSize:9,color:"#bbb"}}>10%</span>
        <span style={{fontSize:9,color:"#bbb"}}>100%</span>
      </div>
    </div>
  );
}

// ─── OverlayCard ─────────────────────────────────────────────────────────────

function OverlayCard({title,iconColor,state,msg,onToggle,activeColor,description,children}:{
  title:string;iconColor:string;
  state:OverlayState;msg:string;onToggle:()=>void;
  activeColor:string;description:string;children?:React.ReactNode;
}) {
  const isOn=state==="on", isLoading=state==="loading", isError=state==="error";
  return (
    <div style={{border:`1px solid ${isOn?activeColor+"88":isError?"#f0a090":"#e2e2e2"}`,
      borderRadius:8,background:"#fff",overflow:"hidden",
      boxShadow:isOn?`0 0 0 2px ${activeColor}18`:"none",transition:"all .2s"}}>
      <div style={{padding:"10px 12px",background:isOn?`${activeColor}09`:"#fff"}}>
        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
          <div style={{width:8,height:8,borderRadius:"50%",background:iconColor,flexShrink:0}}/>
          <span style={{flex:1,fontSize:13,fontWeight:500,color:isOn?activeColor:"#1a1a1a"}}>{title}</span>
          <div onClick={isLoading?undefined:onToggle}
            style={{width:42,height:23,borderRadius:12,background:isOn?activeColor:"#ccc",
              cursor:isLoading?"default":"pointer",flexShrink:0,
              display:"flex",alignItems:"center",padding:"0 3px",
              justifyContent:isOn?"flex-end":"flex-start",transition:"background .2s"}}>
            {isLoading
              ? <div style={{width:17,height:17,borderRadius:9,background:"rgba(255,255,255,0.5)",
                  border:"2px solid #fff",borderTopColor:"transparent",
                  animation:"spin 0.8s linear infinite"}}/>
              : <div style={{width:17,height:17,borderRadius:9,background:"#fff",
                  boxShadow:"0 1px 3px rgba(0,0,0,.2)"}}/>}
          </div>
        </div>
        <div style={{fontSize:11,color:"#777",lineHeight:1.3}}>{description}</div>
        {isLoading&&msg&&(
          <div style={{display:"flex",alignItems:"center",gap:6,marginTop:5,paddingLeft:37}}>
            <div style={{width:9,height:9,borderRadius:5,flexShrink:0,border:`2px solid ${activeColor}`,
              borderTopColor:"transparent",animation:"spin 0.8s linear infinite"}}/>
            <span style={{fontSize:11,color:"#555"}}>{msg}</span>
          </div>
        )}
        {isError&&msg&&(
          <div style={{marginTop:5,padding:"5px 7px",borderRadius:4,
            background:"#fff0ed",border:"1px solid #f0a090",fontSize:11,color:"#c24b2a",paddingLeft:37}}>{msg}</div>
        )}
      </div>
      {children&&(
        <div style={{padding:"0 12px 12px",background:isOn?`${activeColor}05`:"#fafafa"}}>
          {children}
        </div>
      )}
    </div>
  );
}
