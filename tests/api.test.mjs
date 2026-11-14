import test from 'node:test';
import assert from 'node:assert/strict';
import {readJson,requestJson,loadMapArea,loadWeatherYear} from '../web/api.js';
import {localConnectionReport} from '../web/connection.js';

test('empty, truncated and non-JSON API responses produce readable retry messages',async()=>{
  for(const body of ['', '{"elements":', '<html>Bad gateway</html>']) {
    await assert.rejects(readJson(new Response(body),'Map'),error=>/response.*HTTP 200/i.test(error.message)&&error.connectionFailure&&!/Unexpected|JSON/.test(error.message));
  }
  await assert.rejects(readJson(new Response('',{status:404}),'Map'),/Restart the local Solstice server/);
  await assert.rejects(readJson(new Response('{"error":"Providers are busy"}',{status:502}),'Map'),/Providers are busy/);
});

test('slow map downloads use short polling requests and recover an empty poll without repeating the download',async()=>{
  const original=globalThis.fetch,requests=[],job='a'.repeat(32);
  const replies=[{map_jobs:true},{job},null,{status:'loading'},{status:'complete',data:{elements:[],meta:{cached:true}}}];
  globalThis.fetch=async(url,options)=>{requests.push({url,options});const data=replies.shift();return new Response(data===null?'':JSON.stringify(data));};
  try {
    const data=await loadMapArea({row:7126,col:5882},{pollMs:0});assert.equal(data.meta.cached,true);
    assert.equal(requests.filter(r=>r.options.method==='POST').length,1);
    assert.deepEqual(JSON.parse(requests[1].options.body),{row:7126,col:5882});
    assert.equal(requests.filter(r=>r.url.endsWith(job)).length,3);
  }finally{globalThis.fetch=original;}
});

test('obsolete backend and failed map job leave a clear actionable message',async()=>{
  const original=globalThis.fetch;
  try {
    globalThis.fetch=async()=>new Response('{"ok":true}');
    await assert.rejects(loadMapArea({row:7126,col:5882}),/Restart.*server/);
    const replies=[{map_jobs:true},{job:'b'.repeat(32)},{status:'error',error:'Provider area incomplete'}];
    globalThis.fetch=async()=>new Response(JSON.stringify(replies.shift()));
    await assert.rejects(loadMapArea({row:7126,col:5882},{pollMs:0}),/Provider area incomplete/);
  }finally{globalThis.fetch=original;}
});

test('closing a map lookup cancels polling',async()=>{
  const original=globalThis.fetch,controller=new AbortController();
  const replies=[{map_jobs:true},{job:'c'.repeat(32)},{status:'loading'}];
  globalThis.fetch=async()=>new Response(JSON.stringify(replies.shift()));
  try{await assert.rejects(loadMapArea({row:7126,col:5882},{signal:controller.signal,onProgress:()=>controller.abort()}),{name:'AbortError'});}
  finally{globalThis.fetch=original;}
});

test('a fetch response with a missing body recovers through native HTTP with the same request fields',async()=>{
  const original=globalThis.fetch,originalXHR=globalThis.XMLHttpRequest,requests=[];
  globalThis.fetch=async()=>new Response('');
  globalThis.XMLHttpRequest=class {
    open(method,url){this.method=method;this.url=url;this.headers={};}
    setRequestHeader(key,value){this.headers[key]=value;}
    send(body){requests.push({method:this.method,url:this.url,headers:this.headers,body});this.status=202;this.responseText='{"job":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","status":"loading"}';queueMicrotask(()=>this.onload());}
    abort(){this.onabort();}
  };
  try{
    const body=JSON.stringify({row:7000,col:6000});
    const data=await requestJson('/api/surroundings/jobs',{method:'POST',headers:{'Content-Type':'application/json'},body},'Map');
    assert.equal(data.status,'loading');assert.equal(requests.length,1);assert.equal(requests[0].method,'POST');assert.equal(requests[0].url,'/api/surroundings/jobs');assert.equal(requests[0].body,body);assert.equal(requests[0].headers['content-type'],'application/json');assert.match(requests[0].headers['x-solstice-request'],/^r-/);
  }finally{globalThis.fetch=original;globalThis.XMLHttpRequest=originalXHR;}
});

test('weather download uses a deduplicated background job with only weather request fields',async()=>{
  const original=globalThis.fetch,requests=[],job='d'.repeat(32);
  const replies=[{weather_jobs:true},{job},{status:'loading'},{status:'complete',data:{meta:{year:2025},hourly:{time:[1]}}}];
  globalThis.fetch=async(url,options)=>{requests.push({url,options});return new Response(JSON.stringify(replies.shift()));};
  try{
    const data=await loadWeatherYear({lat:52.5,lon:13.4,grid:.1,name:'Example project',timezone:'Europe/Berlin'},2025,{pollMs:0});
    assert.equal(data.meta.year,2025);
    assert.equal(requests[1].url,'/api/weather/jobs');
    assert.deepEqual(JSON.parse(requests[1].options.body),{lat:52.5,lon:13.4,grid:.1,year:2025});
    assert.equal(requests.filter(r=>r.options.method==='POST').length,1);
  }finally{globalThis.fetch=original;}
});

test('large map data is reconstructed only after all bounded pieces pass integrity checks',async()=>{
  const original=globalThis.fetch,job='e'.repeat(32),raw=JSON.stringify({elements:[{name:'x'.repeat(200000)}],meta:{source_id:'osm'}}),bytes=new TextEncoder().encode(raw);
  const sha=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');
  const pieces=Array.from({length:Math.ceil(raw.length/65536)},(_,i)=>raw.slice(i*65536,(i+1)*65536));
  const requested=[];
  globalThis.fetch=async(url)=>{
    requested.push(url);
    if(url==='/api/health')return new Response('{"map_jobs":true,"api_version":4}');
    if(url==='/api/surroundings/jobs')return new Response(JSON.stringify({job}));
    if(url.endsWith(job))return new Response(JSON.stringify({status:'complete',data:{_solstice_transfer:'json-parts-v1',parts:pieces.length,bytes:bytes.length,sha256:sha}}));
    const index=+url.split('/').at(-1);return new Response(JSON.stringify({index,parts:pieces.length,text:pieces[index]}));
  };
  try{const data=await loadMapArea({row:7126,col:5882},{pollMs:0});assert.equal(data.elements[0].name.length,200000);assert.equal(requested.filter(url=>url.includes('/parts/')).length,pieces.length);}
  finally{globalThis.fetch=original;}
});

test('failed responses name the exact stage and retain only connection metadata in the trace',async()=>{
  const original=globalThis.fetch;globalThis.fetch=async()=>new Response('',{headers:{'Content-Length':'2048','X-Solstice-Protocol':'solstice-json-4'}});
  try{
    await assert.rejects(requestJson('/api/surroundings/jobs/private-job',{},'Map'),/Step: map-poll.*Reference: r-/);
    const entry=localConnectionReport().observations.at(-1);
    assert.equal(entry.stage,'map-poll');assert.equal(entry.received_bytes,0);assert.equal(entry.expected_bytes,2048);
    assert.equal(JSON.stringify(entry).includes('private-job'),false);
  }finally{globalThis.fetch=original;}
});
