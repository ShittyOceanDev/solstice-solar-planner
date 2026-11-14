// Never expose parser exceptions or upstream response bodies as product errors.
import {newRequestId,requestStage,observeResponse,localConnectionReport} from './connection.js';
import {BROWSER_DOWNLOADS,HOSTED} from './runtime.js';
import {browserMapArea,browserWeatherYear} from './providers.js';
const serverUpdateMessage=HOSTED?'The website server is unavailable or out of date. Reload the page and retry shortly.':'Restart the local Solstice server, then reload this page to enable map generation.';
function parseText(raw,response,label){
  let data;
  try { data=JSON.parse(raw); }
  catch {
    if(response.status===404||response.status===501)throw Error(serverUpdateMessage);
    const error=Error(`${label} server returned ${raw.trim()?'an incomplete or invalid':'an empty'} response (HTTP ${response.status}). Your current project is unchanged.`);
    error.emptyResponse=!raw.trim();error.connectionFailure=true;throw error;
  }
  if(!response.ok)throw Error(typeof data?.error==='string'?data.error:`${label} request failed (HTTP ${response.status}). Please retry.`);
  if(!data||typeof data!=='object'||Array.isArray(data))throw Error(`${label} server returned unexpected data. Please retry.`);
  return data;
}
export async function readJson(response, label='Data',observe) {
  let raw;
  try { raw=await response.text(); }
  catch {observe?.(response,'');const error=Error(`${label} response was interrupted. Your current project is unchanged.`);error.connectionFailure=true;throw error;}
  observe?.(response,raw);return parseText(raw,response,label);
}

function xhrJson(url,options,label,signal,observe) {
  return new Promise((resolve,reject)=>{
    const xhr=new XMLHttpRequest();
    const cancel=()=>xhr.abort();
    const cleanup=()=>signal.removeEventListener('abort',cancel);
    xhr.open(options.method||'GET',url,true);
    new Headers(options.headers).forEach((value,key)=>xhr.setRequestHeader(key,value));
    xhr.onload=()=>{
      cleanup();if(!xhr.status)return reject(TypeError('Local connection failed'));
      const response={status:xhr.status,ok:xhr.status>=200&&xhr.status<300,headers:{get:name=>xhr.getResponseHeader?.(name)||null}};
      observe?.(response,xhr.responseText);
      try{resolve(parseText(xhr.responseText,response,label));}catch(error){reject(error);}
    };
    xhr.onerror=()=>{cleanup();reject(TypeError('Local connection failed'));};
    xhr.onabort=()=>{cleanup();reject(new DOMException('Cancelled','AbortError'));};
    signal.addEventListener('abort',cancel,{once:true});
    if(signal.aborted){cleanup();reject(new DOMException('Cancelled','AbortError'));return;}
    xhr.send(options.body??null);
  });
}

export async function requestJson(url,options={},label='Data') {
  const requestId=newRequestId(),stage=requestStage(url),started=Date.now();
  const observation=transport=>(response,raw)=>observeResponse(response,raw,{requestId,stage,transport,started});
  const controller=new AbortController(),parent=options.signal;
  const cancel=()=>controller.abort();
  parent?.addEventListener('abort',cancel,{once:true});
  if(parent?.aborted)controller.abort();
  const timeout=setTimeout(cancel,options.timeoutMs??20000);
  try {
    const {timeoutMs,...requestOptions}=options;
    requestOptions.headers=new Headers(options.headers);requestOptions.headers.set('X-Solstice-Request',requestId);
    const response=await fetch(url,{...requestOptions,cache:'no-store',signal:controller.signal});
    try{return await readJson(response,label,observation('fetch'));}
    catch(error){
      if(error.emptyResponse&&typeof XMLHttpRequest!=='undefined')return await xhrJson(url,requestOptions,label,controller.signal,observation('xhr'));
      throw error;
    }
  } catch(error) {
    if(parent?.aborted)throw new DOMException('Cancelled','AbortError');
    if(controller.signal.aborted){const timeoutError=Error(`${label} request timed out. Your current project is unchanged.`);timeoutError.connectionFailure=true;error=timeoutError;}
    if(error instanceof TypeError){const networkError=Error(HOSTED?'Could not reach the website server. A free host may be waking up; retry shortly.':'Could not reach the local Solstice server. Check that it is running.');networkError.connectionFailure=true;error=networkError;}
    if(error.connectionFailure){error.message+=` Step: ${stage}. Reference: ${requestId}. Open Connection diagnostics for the trace.`;error.requestId=requestId;}
    throw error;
  } finally {clearTimeout(timeout);parent?.removeEventListener('abort',cancel);}
}

function pause(ms,signal) {
  return new Promise((resolve,reject)=>{
    const cancel=()=>{clearTimeout(timer);reject(new DOMException('Cancelled','AbortError'));};
    const timer=setTimeout(()=>{signal?.removeEventListener('abort',cancel);resolve();},ms);
    signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)cancel();
  });
}

export async function loadMapArea(area,{signal,onProgress=()=>{},pollMs=1000}={}) {
  if(BROWSER_DOWNLOADS)return browserMapArea(area,{signal,onProgress,useReadApiFallback:!HOSTED});
  const health=await requestJson('/api/health',{signal},'Server');
  if(!health.map_jobs||health.api_version&&health.api_version<4)throw Error(serverUpdateMessage);
  const job=await requestJson('/api/surroundings/jobs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(area),signal},'Map');
  const data=await waitForJob(job,'/api/surroundings/jobs',{signal,onProgress,pollMs,label:'Map'});
  if(!Array.isArray(data?.elements)&&!Array.isArray(data?.features)||!data?.meta)throw Error('The map provider returned unexpected data. Please retry; your current scene is unchanged.');
  return data;
}

export async function loadWeatherYear(location,year,{signal,onProgress=()=>{},pollMs=1000}={}) {
  if(BROWSER_DOWNLOADS)return browserWeatherYear(location,year,{signal,onProgress});
  const health=await requestJson('/api/health',{signal},'Server');
  if(!health.weather_jobs)throw Error(serverUpdateMessage);
  const {lat,lon,grid}=location;
  const job=await requestJson('/api/weather/jobs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({lat,lon,grid,year}),signal},'Weather');
  const data=await waitForJob(job,'/api/weather/jobs',{signal,onProgress,pollMs,label:'Weather'});
  if(data?.meta?.year!==year||!Array.isArray(data?.hourly?.time))throw Error('The weather provider returned unexpected data. Please retry; existing weather is unchanged.');
  return data;
}

async function waitForJob(job,path,{signal,onProgress,pollMs,label}) {
  if(!/^[a-f0-9]{32}$/.test(job.job||''))throw Error(`The server did not start a ${label.toLowerCase()} lookup. Please retry shortly.`);
  const start=Date.now();let failures=0;
  while(true) {
    if(Date.now()-start>900000)throw Error(`${label} download is taking too long. Please retry to reconnect to the lookup. Your current project is unchanged.`);
    let state;
    try { state=await requestJson(`${path}/${job.job}`,{signal},label);failures=0; }
    catch(error) {if(error.name==='AbortError'||++failures>2)throw error;onProgress(`${label} connection interrupted; reconnecting to the same lookup…`);await pause(pollMs,signal);continue;}
    if(state.status==='complete') {
      if(state.data?._solstice_transfer!=='json-parts-v1')return state.data;
      const transfer=state.data;
      if(!Number.isInteger(transfer.parts)||transfer.parts<1||transfer.parts>2000||transfer.bytes>80_000_000)throw Error('The download exceeds the supported model size.');
      const pieces=[];
      for(let offset=0;offset<transfer.parts;offset+=4){
        await Promise.all(Array.from({length:Math.min(4,transfer.parts-offset)},async(_,i)=>{
          const index=offset+i;let part;
          for(let attempt=0;attempt<3;attempt++){
            try{part=await requestJson(`${path}/${job.job}/parts/${index}`,{signal},label);break;}
            catch(error){if(error.name==='AbortError'||attempt===2)throw error;}
          }
          if(part.index!==index||part.parts!==transfer.parts||typeof part.text!=='string'||part.text.length>65536)throw Error('A download segment was incomplete. Your current project is unchanged.');
          pieces[index]=part.text;
        }));
        onProgress(`Receiving ${label==='Map'?'building and tree models':'historical weather'} · ${Math.round(Math.min(offset+4,transfer.parts)/transfer.parts*100)}%`);
      }
      const raw=pieces.join(''),bytes=new TextEncoder().encode(raw);
      if(bytes.length!==transfer.bytes)throw Error('The download was truncated. Your current project is unchanged.');
      if(globalThis.crypto?.subtle){
        const digest=await crypto.subtle.digest('SHA-256',bytes),hash=[...new Uint8Array(digest)].map(v=>v.toString(16).padStart(2,'0')).join('');
        if(hash!==transfer.sha256)throw Error('Download integrity check failed. Your current project is unchanged.');
      }
      try{return JSON.parse(raw);}catch{throw Error('The downloaded data is incomplete. Your current project is unchanged.');}
    }
    if(state.status==='error')throw Error(state.error||`${label} download failed. Please retry later.`);
    if(state.status!=='loading')throw Error(`${label} lookup expired. Please retry.`);
    onProgress(`Loading ${label==='Map'?'public building and tree data':'historical hourly weather'} · ${Math.floor((Date.now()-start)/1000)} seconds. Busy providers can take a few minutes. Your current project is unchanged.`);
    await pause(pollMs,signal);
  }
}

export async function checkConnection(onProgress=()=>{}){
  const probes=[];let server;
  for(const [name,url,options] of [
    ['Server identity','/api/health',{}],
    ['Small GET reply','/api/diagnostics/probe?size=64',{}],
    ['POST reply','/api/diagnostics/probe',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"probe":true}'}],
    ['64 KB reply','/api/diagnostics/probe?size=65536',{}],
    ...(!HOSTED?[['512 KB reply','/api/diagnostics/probe?size=524288',{}]]:[])
  ]){
    onProgress(name);
    try{const value=await requestJson(url,options,'Connection');probes.push({name,ok:true,protocol:value.protocol||null,version:value.api_version||null});}
    catch(error){probes.push({name,ok:false,error:error.message});}
  }
  try{server=await requestJson('/api/diagnostics',{},'Connection');}catch(error){server={error:error.message};}
  return {...localConnectionReport(),probes,server};
}
