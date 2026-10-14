import { demoRequest } from './demo-api.mjs?v=ae938a762063';
export const api = {get:(p)=>demoRequest('GET',p),post:(p,b={})=>demoRequest('POST',p,b),patch:(p,b)=>demoRequest('PATCH',p,b),put:(p,b)=>demoRequest('PUT',p,b),del:(p)=>demoRequest('DELETE',p)};
export function qs(params) {const s=new URLSearchParams();for(const [k,v] of Object.entries(params))if(v!==''&&v!=null)s.set(k,v);return s.size?'?'+s:'';}
