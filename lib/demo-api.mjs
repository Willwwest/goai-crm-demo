import { Store } from './store.mjs';
import { seedDemo } from './demo-seed.mjs';
import { STORAGE_KEY } from './demo-platform.mjs';
const store = new Store(':memory:');
if (!store.get("SELECT 1 FROM settings WHERE key='demo-seeded'")) seedDemo(store);
store.db.save();

export function resetDemo() {
  try { sessionStorage.removeItem(STORAGE_KEY); } catch {}
  location.hash = '/';
  location.reload();
}

const routes = [
  ['GET',/^\/api\/health$/,()=>({ok:true,demo:true})],
  ['GET',/^\/api\/dashboard$/,(u)=>store.dashboard(u.searchParams.get('today'))],
  ['GET',/^\/api\/search$/,(u)=>store.search(u.searchParams.get('q'))],
  ['GET',/^\/api\/analytics$/,(u)=>store.analytics(u.searchParams.get('today'),u.searchParams.get('tz'))],
  ['GET',/^\/api\/today$/,(u)=>store.today(u.searchParams.get('today'),u.searchParams.get('tz'))],
  ['GET',/^\/api\/plan$/,()=>store.getPlan()],
  ['PUT',/^\/api\/plan$/,(u,m,b)=>store.savePlan(b)],
  ['GET',/^\/api\/(companies|people)$/,(u,m)=>store.list(m[1],Object.fromEntries(u.searchParams))],
  ['POST',/^\/api\/(companies|people)$/,(u,m,b)=>store.create(m[1],b)],
  ['POST',/^\/api\/(companies|people)\/bulk$/,(u,m,b)=>store.bulkUpdate(m[1],b.ids,b.patch)],
  ['GET',/^\/api\/(companies|people)\/([\w-]+)$/,(u,m)=>store.detail(m[1],m[2])],
  ['PATCH',/^\/api\/(companies|people)\/([\w-]+)$/,(u,m,b)=>store.update(m[1],m[2],b)],
  ['DELETE',/^\/api\/(companies|people)\/([\w-]+)$/,(u,m)=>store.remove(m[1],m[2])],
  ['POST',/^\/api\/activities$/,(u,m,b)=>store.addActivity(b)],
  ['PATCH',/^\/api\/activities\/([\w-]+)$/,(u,m,b)=>store.updateActivity(m[1],b)],
  ['DELETE',/^\/api\/activities\/([\w-]+)$/,(u,m)=>store.removeActivity(m[1])],
  ['POST',/^\/api\/demos\/([\w-]+)$/,(u,m,b)=>store.changeDemo(m[1],b)],
  ['GET',/^\/api\/tasks$/,(u)=>store.listTasks({status:u.searchParams.get('status')??'open',limit:u.searchParams.get('limit')})],
  ['POST',/^\/api\/tasks$/,(u,m,b)=>store.createTask(b)],
  ['PATCH',/^\/api\/tasks\/([\w-]+)$/,(u,m,b)=>store.updateTask(m[1],b)],
  ['DELETE',/^\/api\/tasks\/([\w-]+)$/,(u,m)=>store.removeTask(m[1])],
  ['POST',/^\/api\/import\//,()=>{throw new Error('CSV import is disabled in the public demo. Use the fictional records provided.');}],
  ['GET',/^\/api\/ai\/status$/,()=>({enabled:true,ready:true,loaded:true,model:'Scripted demo samples'})],
  ['POST',/^\/api\/ai\/warm$/,()=>({loaded:true})],
  ['POST',/^\/api\/ai\/(draft|brief|notes|read-reply|update)$/,(u,m,b)=>sampleAi(m[1],b)],
];

function sampleAi(task,input) {
  const company = input.company_id ? store.find('companies',input.company_id) : null;
  const person = input.person_id ? store.find('people',input.person_id) : null;
  const answer = {subject:'Demo sample: private AI workflow walkthrough',body:`Hi ${person?.first_name??'there'},\n\nThis is a scripted demo example for ${company?.name??'a fictional account'}. Would a 20-minute walkthrough of an internal document-review workflow be useful?\n\nDemo Account Executive`};
  if (task==='draft') return answer;
  if (task==='read-reply') return {intent:'interested',summary:'Demo sample: fictional prospect is open to a walkthrough.',outcome:'reply',demo_date:null,next_step:'Offer two walkthrough times',due_in_days:1,answer};
  if (task==='notes') return {outcome:'note',summary:'Demo-only meeting notes',details:String(input.text??''),next_step:'Confirm the workflow owner',due_in_days:2,pain:'',decision:''};
  if (task==='update') return {text:`Scripted demo summary\n\n${String(input.facts??'Fictional pipeline review.')}\n\nAll activity and results in this demo are fictional.`};
  return {summary:'Scripted demo brief for a fictional account.',goals:['Identify the workflow owner and an example document.','Agree on one pilot success criterion.'],questions:['Who owns the workflow?','What approval is required for a pilot?'],show:['An illustrative internal document-review workflow.','A fictional IT and security approval path.'],ask:'A follow-up with the workflow owner.',risks:['All information is fictional and unverified.']};
}

export async function demoRequest(method,path,body={}) {
  if (!path.startsWith('/api/')) throw new Error('Demo requests must stay within the local demo');
  const url = new URL(path,'https://example.invalid');
  for (const [verb,pattern,handler] of routes) {
    const match = pattern.exec(url.pathname);
    if (method!==verb || !match) continue;
    const data = handler(url,match,body);
    if (method!=='GET') store.db.save();
    return data;
  }
  throw new Error('This feature is not available in the public demo.');
}

export function exportDemo(kind) {
  if (!['companies','people','activities','tasks'].includes(kind)) throw new Error('Unknown demo export');
  const url=URL.createObjectURL(new Blob([store.exportCsv(kind)],{type:'text/csv;charset=utf-8'}));
  const link=document.createElement('a');link.href=url;link.download=`fictional-demo-${kind}.csv`;link.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
