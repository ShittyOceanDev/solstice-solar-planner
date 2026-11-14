import {HOSTED} from './runtime.js';
export const CLIENT_BUILD='2026.11.14.1';
const observations=[];
export const newRequestId=()=>`r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,10)}`;
export function requestStage(url){
  const path=String(url).split('?')[0];
  if(path.includes('/parts/'))return path.includes('weather')?'weather-part':'map-part';
  if(path.startsWith('/api/surroundings/jobs/'))return 'map-poll';
  if(path.startsWith('/api/weather/jobs/'))return 'weather-poll';
  return {'/api/surroundings/jobs':'map-start','/api/weather/jobs':'weather-start','/api/health':'health'}[path]||'connection-check';
}
export function observeResponse(response,raw,{requestId,stage,transport,started}){
  const headers=response.headers,protocol=headers?.get?.('X-Solstice-Protocol')||'';
  const length=headers?.get?.('Content-Length');
  const expected=length!==null&&length!==undefined&&/^\d+$/.test(length)?+length:null;
  const entry={request_id:requestId,stage,transport,status:response.status,received_bytes:new TextEncoder().encode(raw).length,expected_bytes:expected,
    protocol,echoed_request:headers?.get?.('X-Solstice-Request')||'',server_instance:headers?.get?.('X-Solstice-Instance')||'',content_type:headers?.get?.('Content-Type')||'',elapsed_ms:Date.now()-started};
  observations.push(entry);if(observations.length>60)observations.shift();
  if(!HOSTED&&!raw.trim()&&!stage.startsWith('connection')&&typeof window!=='undefined'){
    const {request_id,transport,status,received_bytes,protocol,expected_bytes}=entry;
    // Local-only evidence: no coordinates, source area, URL, body or scene data.
    fetch('/api/diagnostics/client',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({request_id,transport,status,received_bytes,protocol,expected_bytes}),keepalive:true}).catch(()=>{});
  }
  return entry;
}
export function localConnectionReport(){
  return {client_build:CLIENT_BUILD,browser:typeof navigator==='undefined'?'test':navigator.userAgent,origin:typeof location==='undefined'?'test':location.origin,observations:observations.map(value=>({...value}))};
}
