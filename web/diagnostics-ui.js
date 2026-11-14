import {checkConnection} from './api.js';
import {localConnectionReport} from './connection.js';
import {BROWSER_DOWNLOADS,HOSTED} from './runtime.js';
export const diagnosticsHtml=id=>BROWSER_DOWNLOADS?'':`<details class="connection-details" id="${id}"><summary>Connection diagnostics</summary><p class="help">Checks contact ${HOSTED?'this website’s server':'the local server'} without downloading map or weather data. The report stays in your browser and contains request stages, response byte counts and app versions. Coordinates, request bodies, costs and scene geometry are excluded.</p><div class="object-actions"><button type="button" class="small-button" data-check-connection>Run connection checks</button><button type="button" class="small-button" data-save-connection>Save diagnostic report</button></div><pre data-connection-output role="status">No connection check has been run.</pre></details>`;
export function installDiagnostics(container){
  if(!container)return;
  let report=localConnectionReport();
  const output=container.querySelector('[data-connection-output]');
  function show(){
    const records=report.observations||[];
    output.textContent=[`App ${report.client_build}`,report.probes?.map(p=>`${p.ok?'PASS':'FAIL'}  ${p.name}${p.error?': '+p.error:''}`).join('\n'),
      ...records.slice(-12).map(r=>`${r.stage} / ${r.transport}: HTTP ${r.status}, received ${r.received_bytes} bytes${r.expected_bytes!==null?`, expected ${r.expected_bytes}`:''}, ${r.protocol||'server identity missing'}\n  ${r.request_id}`),
      report.server?.records?.filter(r=>r.browser?.some(b=>b.received_bytes===0)).map(r=>`Server comparison: ${r.stage}, wrote ${r.written_bytes??'not seen'} bytes; browser reported an empty body.`).join('\n')].filter(Boolean).join('\n\n');
  }
  if(report.observations.some(r=>!r.received_bytes)){container.open=true;show();}
  container.querySelector('[data-check-connection]').onclick=async e=>{
    e.target.disabled=true;
    try{report=await checkConnection(name=>output.textContent=`Checking ${name}…`);show();}
    catch(error){output.textContent=error.message;}
    finally{e.target.disabled=false;}
  };
  container.querySelector('[data-save-connection]').onclick=()=>{
    const a=document.createElement('a'),url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'}));
    a.href=url;a.download='solstice-connection-diagnostics.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
}
