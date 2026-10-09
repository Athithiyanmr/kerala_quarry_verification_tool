let allFeatures=[],filtered=[],selected=null,selectedLayer=null,map,quarryLayer,districtLayer,drawnItems,currentWorker=null;
let locationMarker=null,searchLocationResults=[],suppressHighlightZoom=false,lastGeocodeAt=0;
const $=id=>document.getElementById(id),val=id=>$(id).value,esc=s=>String(s??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));
function showLogin(msg,ok=false){$("loginMsg").textContent=msg||"";$("loginMsg").className=ok?"ok":""}
function frameRequest(action,params={}){return new Promise((resolve,reject)=>{const id="req_"+Date.now()+"_"+Math.random().toString(36).slice(2),f=$("backendFrame");const timer=setTimeout(()=>{window.removeEventListener("message",handler);reject(new Error("Apps Script request timed out"))},15000);function handler(ev){if(!ev.data||ev.data._id!==id)return;clearTimeout(timer);window.removeEventListener("message",handler);resolve(ev.data.payload)}window.addEventListener("message",handler);const u=new URL(CONFIG.API_URL);u.searchParams.set("action",action);u.searchParams.set("_id",id);Object.entries(params).forEach(([k,v])=>u.searchParams.set(k,v));f.src=u.toString()})}
async function apiGet(action,params={}){return frameRequest(action==="authorize"?"authorizeFrame":"getAllFrame",params)}
async function login(){const name=$("loginName").value.trim();if(!name)return showLogin("Please enter your name.");if(!CONFIG.API_URL)return showLogin("The verification backend is not configured yet. Ask the administrator to add the Apps Script Web App URL.");$("loginBtn").disabled=true;showLogin("Checking access…");try{const j=await apiGet("authorize",{name});if(!j.authorized)return showLogin(j.message||"Access denied.");currentWorker={name};localStorage.setItem("workerName",name);$("loginGate").classList.add("hidden");$("app").classList.remove("hidden");$("workerDisplay").textContent=name;await load()}catch(e){showLogin("Could not connect to the verification server. "+e.message)}finally{$("loginBtn").disabled=false}}
function logout(){currentWorker=null;localStorage.removeItem("workerName");location.reload()}
function showError(e){console.error(e);$("mapStatus").textContent="Data loading error";$("apiState").textContent=e.message;alert("The quarry data could not be loaded. "+(e.message||e))}
function initMap(){map=L.map("map").setView([10.45,76.3],8);const satellite=L.tileLayer("https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}",{maxZoom:21,attribution:"Imagery © Google"}).addTo(map);drawnItems=new L.FeatureGroup().addTo(map);map.addControl(new L.Control.Draw({edit:{featureGroup:drawnItems},draw:{polygon:{allowIntersection:false,showArea:true},rectangle:false,circle:false,circlemarker:false,polyline:false,marker:false}}));map.on(L.Draw.Event.CREATED,e=>newQuarry(e.layer))}
async function getJSON(url){const r=await fetch(url,{cache:"no-store"});if(!r.ok)throw new Error(url+" returned HTTP "+r.status);const t=await r.text();if(!t.trim())throw new Error(url+" is empty");try{return JSON.parse(t)}catch(e){throw new Error(url+" is not valid JSON")}}
async function load(){try{initMap();$("apiState").textContent="Loading quarry data…";const[q,d]=await Promise.all([getJSON(CONFIG.DATA_URL),getJSON(CONFIG.DISTRICTS_URL)]);if(!q||q.type!=="FeatureCollection")throw new Error("Quarry data is not a GeoJSON FeatureCollection");allFeatures=(q.features||[]).filter(f=>f&&f.geometry);if(!allFeatures.length)throw new Error("Quarry GeoJSON contains no features");districtLayer=L.geoJSON(d,{style:{color:"#000000",weight:1.5,opacity:1,fill:false}}).addTo(map);assignDistricts();fillDistricts();filters();fitAll();$("apiState").textContent=allFeatures.length+" quarries loaded";$("mapStatus").classList.add("hidden")}catch(e){showError(e)}}
async function loadBackend(){const j=await apiGet("getAll");const m=new Map((j.records||[]).map(x=>[String(x.quarry_id),x]));allFeatures.forEach(f=>{const p=f.properties||{},x=m.get(String(p.quarry_id));if(!x)return;Object.assign(p,{verification_status:x.status||p.verification_status,verification_confidence:x.confidence||p.verification_confidence,water_verified:x.water||p.water_verified,water_type:x.water_type||p.water_type,quarry_type_std:x.type||p.quarry_type_std,activity_status:x.activity||p.activity_status,verification_note:x.note||p.verification_note});if(x.geometry_json)try{f.geometry=JSON.parse(x.geometry_json)}catch(e){}})}
function districtOf(p){return p._district_boundary||p.district||p.district_osm||""}
function geometryCenter(geometry){
  if(!geometry||!geometry.coordinates)return null;
  const pts=[];
  function collect(c){if(typeof c[0]==="number"&&typeof c[1]==="number")pts.push(c);else c.forEach(collect)}
  collect(geometry.coordinates);
  if(!pts.length)return null;
  return [pts.reduce((s,p)=>s+p[0],0)/pts.length,pts.reduce((s,p)=>s+p[1],0)/pts.length];
}
function pointInRing(point,ring){
  const x=point[0],y=point[1];let inside=false;
  for(let i=0,j=ring.length-1;i<ring.length;j=i++){
    const xi=ring[i][0],yi=ring[i][1],xj=ring[j][0],yj=ring[j][1];
    const intersects=((yi>y)!==(yj>y))&&(x<(xj-xi)*(y-yi)/(yj-yi+Number.EPSILON)+xi);
    if(intersects)inside=!inside;
  }
  return inside;
}
function pointInDistrict(point,geometry){
  if(!point||!geometry)return false;
  const polygons=geometry.type==="Polygon"?[geometry.coordinates]:geometry.type==="MultiPolygon"?geometry.coordinates:[];
  return polygons.some(poly=>poly.length&&pointInRing(point,poly[0])&&!poly.slice(1).some(ring=>pointInRing(point,ring)));
}
function assignDistricts(){
  const boundaries=(districtLayer?districtLayer.toGeoJSON().features:[]);
  allFeatures.forEach(f=>{
    const p=f.properties||(f.properties={});
    const center=geometryCenter(f.geometry);
    const boundary=boundaries.find(b=>pointInDistrict(center,b.geometry));
    if(boundary)p._district_boundary=boundary.properties?.DISTRICT||boundary.properties?.district||"";
  });
}
function fillDistricts(){
  const names=[...new Set((districtLayer?districtLayer.toGeoJSON().features:[])
    .map(f=>f.properties?.DISTRICT||f.properties?.district).filter(Boolean))].sort();
  $("district").innerHTML='<option value="">All districts</option>'+names.map(x=>'<option value="'+esc(x)+'">'+esc(x)+'</option>').join("");
}


let searchDebounce=null,searchRequestId=0;
function hideSearchResults(){const el=$("searchResults");if(el)el.classList.add("hidden")}
function placeLabel(p){
  return p.name||p.street||p.locality||p.city||p.town||p.village||p.county||p.state||"Unnamed place";
}
function placeSubtitle(p){
  return [p.street,p.district,p.city||p.town||p.village||p.county,p.state,p.country].filter((v,i,a)=>v&&a.indexOf(v)===i).join(", ")||p.type||"OpenStreetMap place";
}
function showSearchResults(items){
  const el=$("searchResults");if(!el)return;
  if(!items.length){el.innerHTML='<div class="searchEmpty">No results found. Try another name or search term.</div>';el.classList.remove("hidden");return}
  el.innerHTML=items.map(item=>item.kind==="quarry"
    ?'<button type="button" class="searchResult" role="option" data-kind="quarry" data-id="'+esc(item.id)+'"><span class="searchResultIcon">◆</span><span><b>'+esc(item.title)+'</b><small>'+esc(item.subtitle||"Known quarry")+'</small></span><em>Known quarry</em></button>'
    :'<button type="button" class="searchResult" role="option" data-kind="place" data-index="'+item.index+'"><span class="searchResultIcon">'+(item.category==="category"?"⌕":"⌖")+'</span><span><b>'+esc(item.title)+'</b><small>'+esc(item.subtitle||"OpenStreetMap")+'</small></span><em>'+esc(item.badge||"Place")+'</em></button>'
  ).join("");
  el.querySelectorAll(".searchResult").forEach(btn=>btn.addEventListener("click",()=>{
    if(btn.dataset.kind==="quarry"){hideSearchResults();selectFeature(btn.dataset.id)}
    else {const result=searchLocationResults[Number(btn.dataset.index)];if(result)navigateToPlace(result)}
  }));
  el.classList.remove("hidden");
}
function updateLocalQuarryMatches(q){
  return allFeatures.filter(f=>{const p=f.properties||{};return [p.quarry_id,p.osm_id,p.name,p.operator,p.mineral,districtOf(p)].join(" ").toLowerCase().includes(q.toLowerCase())})
    .slice(0,5).map(f=>{const p=f.properties||{};return{kind:"quarry",id:String(p.quarry_id||""),title:String(p.quarry_id||p.name||"Quarry"),subtitle:[p.name||p.mineral||"Known quarry",districtOf(p)].filter(Boolean).join(" · ")}});
}
function parseCoordinates(query){
  const m=query.trim().match(/^\s*(-?\d+(?:\.\d+)?)\s*[,; ]\s*(-?\d+(?:\.\d+)?)\s*$/);
  if(!m)return null;
  const lat=Number(m[1]),lng=Number(m[2]);
  return Number.isFinite(lat)&&Number.isFinite(lng)&&Math.abs(lat)<=90&&Math.abs(lng)<=180?[lat,lng]:null;
}
function toPlaceResult(feature){
  const p=feature.properties||{},coords=feature.geometry?.coordinates||[];
  return{lat:coords[1],lon:coords[0],name:placeLabel(p),display_name:placeSubtitle(p),type:p.osm_value||p.type||"Place",properties:p};
}
async function searchPlaces(query,requestId){
  const coords=parseCoordinates(query);
  if(coords){searchLocationResults=[{lat:coords[0],lon:coords[1],name:query,display_name:"Coordinates",type:"Coordinates"}];showSearchResults([{kind:"place",index:0,title:query,subtitle:"Go to coordinates",badge:"Coordinates"}]);return}
  const center=map?map.getCenter():{lat:10.45,lng:76.3};
  const params=new URLSearchParams({q:query,lat:String(center.lat),lon:String(center.lng),limit:"8",lang:"en"});
  const response=await fetch("https://photon.komoot.io/api/?"+params.toString(),{headers:{"Accept":"application/json"},cache:"no-store"});
  if(!response.ok)throw new Error("Location search returned HTTP "+response.status);
  const data=await response.json();
  if(requestId!==searchRequestId)return;
  searchLocationResults=(data.features||[]).map(toPlaceResult).filter(r=>Number.isFinite(Number(r.lat))&&Number.isFinite(Number(r.lon)));
  const places=searchLocationResults.map((r,index)=>({kind:"place",index,title:r.name,subtitle:r.display_name,badge:r.type||"Place"}));
  const quarries=updateLocalQuarryMatches(query);
  showSearchResults([...quarries,...places].slice(0,10));
}
function updateSearchResults(){
  const query=val("search").trim();
  if(searchDebounce)clearTimeout(searchDebounce);
  if(!query){searchRequestId++;hideSearchResults();return}
  const requestId=++searchRequestId;
  const local=updateLocalQuarryMatches(query);
  const box=$("searchResults");
  box.innerHTML='<div class="searchEmpty">Searching places, businesses and quarries…</div>';box.classList.remove("hidden");
  searchDebounce=setTimeout(async()=>{
    try{await searchPlaces(query,requestId)}
    catch(error){
      console.warn("OpenStreetMap autocomplete error:",error);
      if(requestId===searchRequestId)showSearchResults(local);
    }
  },350);
}
async function searchLocation(){
  const query=val("search").trim();if(!query)return;
  if(searchDebounce)clearTimeout(searchDebounce);
  const box=$("searchResults");
  box.innerHTML='<div class="searchEmpty">Searching places and businesses…</div>';box.classList.remove("hidden");
  const requestId=++searchRequestId;
  try{
    await searchPlaces(query,requestId);
    if(searchLocationResults.length===1)navigateToPlace(searchLocationResults[0]);
  }catch(error){
    console.error("OpenStreetMap search error:",error);
    box.innerHTML='<div class="searchEmpty">Search failed. Check your connection and try again.</div>';box.classList.remove("hidden");
  }
}
function navigateToPlace(result){
  const lat=Number(result.lat),lng=Number(result.lon);
  if(!Number.isFinite(lat)||!Number.isFinite(lng))return;
  hideSearchResults();suppressHighlightZoom=true;
  map.setView([lat,lng],Math.max(map.getZoom(),16),{animate:true});
  if(locationMarker)locationMarker.remove();
  locationMarker=L.marker([lat,lng]).addTo(map);
  const title=result.name||result.display_name||"Selected location";
  locationMarker.bindPopup('<b>'+esc(title)+'</b><br><small>'+esc(result.display_name||"OpenStreetMap search result")+'</small>').openPopup();
  $("apiState").textContent="Map moved to "+title;
}

function filters(){
  const d=val("district"),s=val("status"),w=val("waterFilter"),q=val("search").toLowerCase();
  filtered=allFeatures.filter(f=>{
    const p=f.properties||{};
    return(!d||districtOf(p)===d)&&(!s||p.verification_status===s)&&(!w||p.water_verified===w)&&(!q||[p.quarry_id,p.osm_id,p.name,p.operator,p.mineral].join(" ").toLowerCase().includes(q));
  });
  if(d&&districtLayer){
    districtLayer.eachLayer(layer=>{
      const name=layer.feature?.properties?.DISTRICT||layer.feature?.properties?.district;
      layer.setStyle({color:name===d?"#f4a340":"#000000",weight:name===d?3:1.5,opacity:1,fill:name===d,fillColor:"#f4a340",fillOpacity:name===d?.08:0});
    });
    const selectedBoundary=districtLayer.getLayers().find(layer=>(layer.feature?.properties?.DISTRICT||layer.feature?.properties?.district)===d);
    if(selectedBoundary)map.fitBounds(selectedBoundary.getBounds().pad(.05));
  }else if(districtLayer){
    districtLayer.setStyle({color:"#000000",weight:1.5,opacity:1,fill:false});
  }
  renderList();renderMap();stats();
}
function renderList(){
$("count").textContent=filtered.length+" results";
$("quarryList").innerHTML=filtered.map(f=>{
const p=f.properties||{},status=p.verification_status||"Unverified",id=String(p.quarry_id||"");
const safeId=id.replace(/\\/g,"\\\\").replace(/'/g,"\\'");
return `<div class="item ${String(selected)===id?"selected":""}" onclick="selectFeature('${safeId}')"><span class="dot ${esc(status.toLowerCase())}"></span><b>${esc(id||"—")}</b><br><small>${esc(p.name||p.mineral||"OSM quarry")} · ${esc(districtOf(p))}</small></div>`;
}).join("");
}
function renderMap(){if(quarryLayer)quarryLayer.remove();quarryLayer=L.geoJSON({type:"FeatureCollection",features:filtered},{style:f=>{const s=f.properties?.verification_status||"Unverified";const color=s==="Confirmed"?"#22a447":s==="Rejected"?"#dc2626":"#ffffff";return{color,weight:selected===f.properties?.quarry_id?4:2,opacity:1,fillColor:color,fillOpacity:s==="Confirmed"?.22:s==="Rejected"?.22:0}},onEachFeature:(f,l)=>{l.bindTooltip(f.properties?.quarry_id||"Quarry");l.on("click",()=>selectFeature(f.properties.quarry_id))}}).addTo(map);if(selected)highlight()}
function selectFeature(id){const f=allFeatures.find(x=>String(x.properties?.quarry_id)===String(id));if(!f)return;suppressHighlightZoom=false;selected=id;const p=f.properties||{};$("empty").classList.add("hidden");$("details").classList.remove("hidden");$("qid").textContent=p.quarry_id||"—";$("qname").textContent=p.name||p.mineral||"OSM quarry";$("rank").textContent=p.osm_rank!=null?"#"+p.osm_rank:"";$("districtVal").textContent=districtOf(p)||"—";$("areaVal").textContent=p.area_ha!=null?p.area_ha+" ha":(p.area_m2!=null?p.area_m2+" m²":"—");$("sourceVal").textContent=p.source||"OSM";$("sourceMeta").innerHTML=Object.entries(p).filter(([k])=>k!=="geometry").slice(0,18).map(([k,v])=>'<b>'+esc(k)+':</b> '+esc(v)).join(" · ");setChoice("isQuarry",p.verification_status||"Unverified");setChoice("hasWater",p.water_verified||"");$("extra").classList.toggle("hidden",!["Confirmed","Yes"].includes(p.verification_status));$("activity").value=p.activity_status||"Unknown";$("waterType").value=p.water_type||"Unknown";$("type").value=p.quarry_type_std||"Unknown";$("confidence").value=p.verification_confidence||"High";$("note").value=p.verification_note||"";highlight();renderList()}
function setChoice(group,v){document.querySelectorAll("#"+group+" button").forEach(b=>b.classList.toggle("selected",b.dataset.v===v))}
function current(){return allFeatures.find(x=>String(x.properties?.quarry_id)===String(selected))}
function collect(){const f=current();if(!f)return null;const p=f.properties||{};p.verification_status=document.querySelector("#isQuarry .selected")?.dataset.v||"Unverified";p.water_verified=document.querySelector("#hasWater .selected")?.dataset.v||"Uncertain";p.activity_status=val("activity");p.water_type=val("waterType");p.quarry_type_std=val("type");p.verification_confidence=val("confidence");p.verification_note=val("note");p.verified_by=currentWorker?.name||"";p.verified_at=new Date().toISOString();return f}
async function save(andNext=true){const f=collect();if(!f)return;const ok=await postForm({action:"saveVerification",feature:f,worker:currentWorker});if(!ok)return;filters();$("apiState").textContent="Verification submitted to Google Sheets";if(andNext)move(1)}
function postForm(payload){return new Promise(resolve=>{const iframe=document.getElementById("apiFrame"),form=document.getElementById("apiForm"),input=document.getElementById("apiPayload");input.value=JSON.stringify(payload);form.action=CONFIG.API_URL;form.target="apiFrame";iframe.onload=()=>{setTimeout(()=>resolve(true),250)};form.submit()})}
function move(dir){if(!filtered.length)return;let i=filtered.findIndex(f=>String(f.properties.quarry_id)===String(selected));selectFeature(filtered[(i<0?0:(i+dir+filtered.length)%filtered.length)].properties.quarry_id)}
function stats(){let p=allFeatures.map(f=>f.properties||{});$("total").textContent=p.length;$("pending").textContent=p.filter(x=>!x.verification_status||x.verification_status==="Unverified"||x.verification_status==="pending").length;$("confirmed").textContent=p.filter(x=>x.verification_status==="Confirmed"||x.verification_status==="Yes").length;$("rejected").textContent=p.filter(x=>x.verification_status==="Rejected"||x.verification_status==="No").length;$("waterCount").textContent=p.filter(x=>x.water_verified==="Yes").length}
function highlight(){if(!quarryLayer)return;quarryLayer.eachLayer(l=>{if(l.feature.properties.quarry_id===selected){l.setStyle({weight:5,fillOpacity:.35});l.bringToFront();if(!suppressHighlightZoom)map.fitBounds(l.getBounds().pad(.5))}})}
function fitAll(){if(quarryLayer){const b=quarryLayer.getBounds();if(b.isValid())map.fitBounds(b.pad(.1))}}
function newQuarry(layer){const id="NEW-"+Date.now();const f={type:"Feature",properties:{quarry_id:id,district:"",source:"Manual",verification_status:"Unverified",water_verified:"Uncertain",geometry_status:"New"},geometry:layer.toGeoJSON().geometry};allFeatures.push(f);drawnItems.addLayer(layer);selectFeature(id)}
function setup(){
const panelToggle=$("togglePanel");
if(panelToggle)panelToggle.onclick=()=>{const collapsed=document.body.classList.toggle("panel-collapsed");panelToggle.textContent=collapsed?"Show verification panel +":"Collapse panel −";panelToggle.setAttribute("aria-expanded",String(!collapsed));panelToggle.title=collapsed?"Show verification panel":"Collapse verification panel";setTimeout(()=>{if(map)map.invalidateSize({pan:false});},220)};
$("loginBtn").onclick=login;
$("loginName").addEventListener("keydown",e=>{if(e.key==="Enter")login()});
["district","status","waterFilter"].forEach(id=>$(id).addEventListener("input",filters));
$("search").addEventListener("input",updateSearchResults);
$("search").addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();searchLocation()}else if(e.key==="Escape")hideSearchResults()});
$("searchPlaces").onclick=searchLocation;
document.addEventListener("click",e=>{if(!e.target.closest("#searchWrap"))hideSearchResults()});
$("reset").onclick=()=>{["district","status","waterFilter","search"].forEach(id=>$(id).value="");if(locationMarker){locationMarker.remove();locationMarker=null}suppressHighlightZoom=false;filters();hideSearchResults()};
document.querySelectorAll("#isQuarry button").forEach(b=>b.onclick=()=>{setChoice("isQuarry",b.dataset.v);$("extra").classList.toggle("hidden",!["Confirmed","Yes"].includes(b.dataset.v))});
document.querySelectorAll("#hasWater button").forEach(b=>b.onclick=()=>setChoice("hasWater",b.dataset.v));
$("save").onclick=()=>save(true);
$("skip").onclick=()=>{setChoice("isQuarry","Uncertain");save(true)};
$("next").onclick=()=>move(1);
$("prev").onclick=()=>move(-1);
$("nextPending").onclick=()=>{const f=allFeatures.find(x=>!x.properties.verification_status||x.properties.verification_status==="Unverified"||x.properties.verification_status==="pending");if(f)selectFeature(f.properties.quarry_id)};
$("drawNew").onclick=()=>new L.Draw.Polygon(map,{allowIntersection:false,showArea:true}).enable();
$("editGeometry").onclick=()=>{const f=current();const l=quarryLayer?.getLayers().find(x=>x.feature.properties.quarry_id===selected);if(!f||!l)return;drawnItems.clearLayers();const e=L.geoJSON(l.toGeoJSON()).getLayers()[0];drawnItems.addLayer(e);e.on("edit",()=>{f.geometry=e.toGeoJSON().geometry;f.properties.geometry_status="Edited"});new L.EditToolbar.Edit(map,{featureGroup:drawnItems}).enable()}
}
window.addEventListener("load",()=>{setup();$("app").classList.add("hidden");$("loginGate").classList.remove("hidden");const saved=localStorage.getItem("workerName");if(saved)$("loginName").value=saved;});