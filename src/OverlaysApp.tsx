import { useState, useEffect, useRef, useCallback } from "react";
import {
  SLOPE_BANDS,
  renderSlopeOverlay, removeSlopeOverlay,
  fetchPowerInfrastructure, renderPowerOverlay, removePowerOverlay,
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

type InfraLayer = {
  substations: boolean;
  plants:      boolean;
  lines:       boolean;
};

export default function OverlaysApp() {
  const [slopeState,  setSlopeState]  = useState<OverlayState>("off");
  const [slopeMsg,    setSlopeMsg]    = useState("");
  const [powerState,  setPowerState]  = useState<OverlayState>("off");
  const [powerMsg,    setPowerMsg]    = useState("");
  const [infraLayers, setInfraLayers] = useState<InfraLayer>({ substations: true, plants: true, lines: true });
  const [infraCache,  setInfraCache]  = useState<InfraFeature[] | null>(null);
  const [infraStats,  setInfraStats]  = useState<{subs:number;plants:number;lines:number}|null>(null);
  const [refLatLon,   setRefLatLon]   = useState<[number,number]|null>(null);
  const [radiusMi,    setRadiusMi]    = useState(25);

  // Get project lat/lon on load
  useEffect(() => {
    if (!IS_IN_FORMA) {
      setRefLatLon([35.732, -78.823]); // dev mock
      return;
    }
    (async () => {
      try {
        const { Forma } = await import("forma-embedded-view-sdk/auto");
        const geo = await Forma.project.getGeoLocation();
        if (geo) setRefLatLon([geo[0], geo[1]]);
      } catch { /* non-fatal */ }
    })();
  }, []);

  // ── Slope overlay ────────────────────────────────────────────────────────
  const toggleSlope = useCallback(async () => {
    if (slopeState === "loading") return;

    if (slopeState === "on") {
      await removeSlopeOverlay();
      setSlopeState("off");
      setSlopeMsg("");
      return;
    }

    setSlopeState("loading");
    setSlopeMsg("Starting…");
    try {
      if (!IS_IN_FORMA) {
        // Dev mode simulation
        await new Promise(r => setTimeout(r, 1200));
        setSlopeState("on");
        setSlopeMsg("Slope overlay applied (dev mode)");
        return;
      }
      await renderSlopeOverlay(msg => {
        if (msg === "done") { setSlopeState("on"); setSlopeMsg(""); }
        else setSlopeMsg(msg);
      });
    } catch (e) {
      setSlopeState("error");
      setSlopeMsg(String(e));
    }
  }, [slopeState]);

  // ── Power infrastructure overlay ─────────────────────────────────────────
  const applyPowerOverlay = useCallback(async (
    cache: InfraFeature[] | null,
    layers: InfraLayer,
    latLon: [number, number] | null
  ) => {
    if (!latLon) { setPowerMsg("No project location detected"); setPowerState("error"); return; }

    setPowerState("loading");
    setPowerMsg("Fetching infrastructure data…");

    try {
      let features = cache;
      if (!features) {
        if (!IS_IN_FORMA) {
          // Dev mock
          features = [
            { type:"substation", name:"Apex 115kV Substation", lat:35.745, lon:-78.810, voltage:"115000" },
            { type:"substation", name:"Holly Springs 69kV",   lat:35.720, lon:-78.850, voltage:"69000"  },
            { type:"plant",      name:"Shearon Harris Nuclear", lat:35.655, lon:-78.956, fuel:"nuclear"  },
            { type:"plant",      name:"Lee Gas Turbine Plant", lat:35.800, lon:-78.780, fuel:"gas"      },
            { type:"line",       name:"345kV Transmission",    lat:35.740, lon:-78.820, voltage:"345000",
              coords:[[35.800,-78.900],[35.780,-78.860],[35.750,-78.830],[35.720,-78.800],[35.690,-78.770]] },
            { type:"line",       name:"115kV Transmission",    lat:35.730, lon:-78.815, voltage:"115000",
              coords:[[35.760,-78.780],[35.740,-78.810],[35.720,-78.840]] },
          ];
          setInfraCache(features);
        } else {
          features = await fetchPowerInfrastructure(
            latLon[0], latLon[1], radiusMi * 1609.34,
            msg => setPowerMsg(msg)
          );
          setInfraCache(features);
        }
      }

      setInfraStats({
        subs:   features.filter(f=>f.type==="substation").length,
        plants: features.filter(f=>f.type==="plant").length,
        lines:  features.filter(f=>f.type==="line").length,
      });

      const visible = new Set<"substation"|"plant"|"line">();
      if (layers.substations) visible.add("substation");
      if (layers.plants)      visible.add("plant");
      if (layers.lines)       visible.add("line");

      if (!IS_IN_FORMA) {
        await new Promise(r => setTimeout(r, 800));
        setPowerState("on");
        setPowerMsg("");
        return;
      }

      await renderPowerOverlay(features, latLon[0], latLon[1], visible, msg => {
        if (msg === "done") { setPowerState("on"); setPowerMsg(""); }
        else setPowerMsg(msg);
      });
    } catch(e) {
      setPowerState("error");
      setPowerMsg(String(e));
    }
  }, [radiusMi]);

  const togglePower = useCallback(async () => {
    if (powerState === "loading") return;
    if (powerState === "on") {
      await removePowerOverlay();
      setPowerState("off");
      setPowerMsg("");
      return;
    }
    await applyPowerOverlay(infraCache, infraLayers, refLatLon);
  }, [powerState, infraCache, infraLayers, refLatLon, applyPowerOverlay]);

  // When layers toggle while on, re-render
  const prevLayersRef = useRef(infraLayers);
  useEffect(() => {
    if (powerState === "on" &&
      (prevLayersRef.current.substations !== infraLayers.substations ||
       prevLayersRef.current.plants      !== infraLayers.plants ||
       prevLayersRef.current.lines       !== infraLayers.lines)) {
      applyPowerOverlay(infraCache, infraLayers, refLatLon);
    }
    prevLayersRef.current = infraLayers;
  }, [infraLayers, powerState, infraCache, refLatLon, applyPowerOverlay]);

  const toggleLayer = (key: keyof InfraLayer) =>
    setInfraLayers(prev => ({ ...prev, [key]: !prev[key] }));

  const clearCache = () => {
    setInfraCache(null);
    setInfraStats(null);
    if (powerState === "on") { removePowerOverlay(); setPowerState("off"); }
  };

  return (
    <div style={{display:"flex",flexDirection:"column",height:"100vh",background:"#fff",
      fontFamily:"'Inter',system-ui,sans-serif",overflow:"hidden"}}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>

      {/* Header */}
      <div style={{padding:"14px 16px 12px",borderBottom:`1px solid ${T.border}`,flexShrink:0}}>
        <div style={{fontSize:14,fontWeight:600,color:T.tx1,lineHeight:1}}>Site Overlays</div>
        <div style={{fontSize:11,color:T.tx3,marginTop:3}}>
          Terrain analysis · Power infrastructure
          {refLatLon && !IS_IN_FORMA && <span style={{color:T.warn}}> · Dev mode</span>}
        </div>
      </div>

      <div style={{flex:1,overflowY:"auto",padding:"12px 16px",display:"flex",flexDirection:"column",gap:12}}>

        {/* ── Slope Overlay ────────────────────────────────────────────── */}
        <OverlayCard
          title="Slope analysis"
          icon="📐"
          state={slopeState}
          msg={slopeMsg}
          onToggle={toggleSlope}
          activeColor="#2ecc71"
          description="Color-codes terrain slope across the site. Identifies buildable areas and grading challenges."
        >
          {/* Legend */}
          <div style={{marginTop:8}}>
            <div style={{fontSize:10,fontWeight:500,color:T.tx3,textTransform:"uppercase",letterSpacing:.4,marginBottom:4}}>Color legend</div>
            <div style={{display:"flex",flexDirection:"column",gap:3}}>
              {SLOPE_BANDS.map(band => (
                <div key={band.label} style={{display:"flex",alignItems:"center",gap:6}}>
                  <div style={{width:16,height:16,borderRadius:3,background:band.color,border:"1px solid rgba(0,0,0,.1)",flexShrink:0}}/>
                  <span style={{fontSize:11,color:T.tx2}}>{band.label}</span>
                </div>
              ))}
            </div>
          </div>

          {slopeState === "on" && (
            <div style={{marginTop:8,fontSize:11,color:T.green,fontWeight:500}}>
              ✓ Slope overlay active — visible in Forma 3D view
            </div>
          )}
        </OverlayCard>

        {/* ── Power Infrastructure Overlay ─────────────────────────────── */}
        <OverlayCard
          title="Power infrastructure"
          icon="⚡"
          state={powerState}
          msg={powerMsg}
          onToggle={togglePower}
          activeColor={T.blue}
          description="Shows HV substations, power plants, and transmission lines from OpenStreetMap within the search radius."
        >
          {/* Radius */}
          <div style={{marginTop:8}}>
            <div style={{fontSize:10,fontWeight:500,color:T.tx3,textTransform:"uppercase",letterSpacing:.4,marginBottom:4}}>
              Search radius: {radiusMi} mi
            </div>
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              <input type="range" min={5} max={50} step={5} value={radiusMi}
                onChange={e=>{ setRadiusMi(+e.target.value); clearCache(); }}
                onMouseDown={e=>e.stopPropagation()}
                style={{flex:1,accentColor:T.blue}}/>
              <span style={{fontSize:11,fontWeight:500,color:T.blue,minWidth:36,textAlign:"right"}}>{radiusMi} mi</span>
            </div>
            {infraCache && (
              <button onClick={clearCache}
                style={{marginTop:4,fontSize:10,color:T.tx3,background:"none",border:"none",
                  cursor:"pointer",padding:0,textDecoration:"underline"}}>
                Clear cached data
              </button>
            )}
          </div>

          {/* Layer toggles */}
          <div style={{marginTop:8}}>
            <div style={{fontSize:10,fontWeight:500,color:T.tx3,textTransform:"uppercase",letterSpacing:.4,marginBottom:4}}>Layers</div>
            <div style={{display:"flex",flexDirection:"column",gap:4}}>
              {[
                { key:"substations" as keyof InfraLayer, label:"HV Substations",       color:T.blue,   icon:"■", count:infraStats?.subs  },
                { key:"plants"      as keyof InfraLayer, label:"Power plants",          color:"#e67e22", icon:"●", count:infraStats?.plants },
                { key:"lines"       as keyof InfraLayer, label:"Transmission lines",    color:"#e74c3c", icon:"—", count:infraStats?.lines  },
              ].map(({key,label,color,icon,count}) => (
                <div key={key} onClick={()=>toggleLayer(key)}
                  style={{display:"flex",alignItems:"center",gap:8,padding:"6px 8px",
                    borderRadius:5,cursor:"pointer",border:`1px solid ${infraLayers[key]?color+"55":T.border}`,
                    background:infraLayers[key]?`${color}0d`:"#fafafa",transition:"all .12s"}}>
                  <span style={{fontSize:14,color,lineHeight:1}}>{icon}</span>
                  <span style={{flex:1,fontSize:12,color:infraLayers[key]?T.tx1:T.tx3,fontWeight:infraLayers[key]?500:400}}>{label}</span>
                  {count !== undefined && <span style={{fontSize:10,color:T.tx3}}>{count}</span>}
                  <div style={{width:16,height:16,borderRadius:8,border:`1.5px solid ${infraLayers[key]?color:"#ccc"}`,
                    background:infraLayers[key]?color:"#fff",display:"flex",alignItems:"center",justifyContent:"center"}}>
                    {infraLayers[key] && <div style={{width:6,height:6,borderRadius:3,background:"#fff"}}/>}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Infrastructure summary */}
          {infraStats && powerState === "on" && (
            <div style={{marginTop:8,padding:"8px 10px",background:T.blueLt,borderRadius:5,border:`1px solid ${T.blueMid}`}}>
              <div style={{fontSize:11,fontWeight:500,color:T.blue,marginBottom:3}}>✓ Infrastructure overlay active</div>
              <div style={{fontSize:10,color:T.tx2}}>
                {infraStats.subs} substations · {infraStats.plants} plants · {infraStats.lines} transmission lines
                <br/>within {radiusMi} mi · Source: OpenStreetMap
              </div>
            </div>
          )}
        </OverlayCard>

        {/* Attribution */}
        <div style={{fontSize:10,color:T.tx3,lineHeight:1.4,padding:"4px 0"}}>
          Infrastructure data © OpenStreetMap contributors (ODbL). Slope computed from Forma terrain mesh.
        </div>
      </div>
    </div>
  );
}

// ─── OverlayCard ─────────────────────────────────────────────────────────────

function OverlayCard({title, icon, state, msg, onToggle, activeColor, description, children}: {
  title: string; icon: string; state: OverlayState; msg: string;
  onToggle: ()=>void; activeColor: string; description: string;
  children?: React.ReactNode;
}) {
  const isOn      = state === "on";
  const isLoading = state === "loading";
  const isError   = state === "error";

  return (
    <div style={{border:`1px solid ${isOn?activeColor+"66":isError?"#f0a090":"#e2e2e2"}`,
      borderRadius:8,overflow:"hidden",
      boxShadow:isOn?`0 0 0 2px ${activeColor}22`:"none",transition:"all .2s"}}>

      {/* Card header */}
      <div style={{padding:"10px 12px",background:isOn?`${activeColor}0d`:"#fff"}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:6}}>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <span style={{fontSize:16}}>{icon}</span>
            <span style={{fontSize:13,fontWeight:500,color:isOn?activeColor:"#1a1a1a"}}>{title}</span>
          </div>
          <Toggle active={isOn} loading={isLoading} color={activeColor} onClick={onToggle}/>
        </div>
        <div style={{fontSize:11,color:"#777",lineHeight:1.4}}>{description}</div>

        {/* Loading progress */}
        {isLoading && msg && (
          <div style={{marginTop:6,display:"flex",alignItems:"center",gap:6}}>
            <div style={{width:12,height:12,border:`2px solid ${activeColor}`,borderTop:"2px solid transparent",
              borderRadius:"50%",animation:"spin 1s linear infinite",flexShrink:0}}/>
            <span style={{fontSize:11,color:"#555"}}>{msg}</span>
          </div>
        )}

        {/* Error */}
        {isError && (
          <div style={{marginTop:6,fontSize:11,color:"#c24b2a",background:"#fff0ed",
            padding:"6px 8px",borderRadius:4,border:"1px solid #f0a090"}}>{msg}</div>
        )}
      </div>

      {/* Children (legend, controls) — always shown */}
      {children && (
        <div style={{padding:"0 12px 12px",borderTop:`1px solid ${isOn?activeColor+"33":"#e2e2e2"}`,
          background:isOn?`${activeColor}05`:"#fafafa"}}>
          {children}
        </div>
      )}
    </div>
  );
}

function Toggle({active, loading, color, onClick}: {
  active: boolean; loading: boolean; color: string; onClick: ()=>void;
}) {
  return (
    <div onClick={loading?undefined:onClick}
      style={{width:40,height:22,borderRadius:11,cursor:loading?"not-allowed":"pointer",
        background:active?color:"#ccc",position:"relative",transition:"background .2s",flexShrink:0}}>
      {loading
        ? <div style={{position:"absolute",top:"50%",left:"50%",transform:"translate(-50%,-50%)",
            width:14,height:14,border:"2px solid #fff",borderTop:"2px solid transparent",
            borderRadius:"50%",animation:"spin 1s linear infinite"}}/>
        : <div style={{position:"absolute",top:2,left:active?20:2,width:18,height:18,
            borderRadius:9,background:"#fff",transition:"left .2s",
            boxShadow:"0 1px 3px rgba(0,0,0,.2)"}}/>
      }
    </div>
  );
}
