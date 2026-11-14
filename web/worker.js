import {calculate} from './model.js';
self.onmessage=({data})=>{
  try { self.postMessage({id:data.id,result:calculate(data.settings,data.datasets)}); }
  catch(error) {self.postMessage({id:data.id,error:error.message});}
};
