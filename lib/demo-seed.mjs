import { scoreAccount, assignTiers, PRIORITY_VERSION } from './account-priority.mjs?v=ae938a762063';
import { roleGroup } from '../schema.js?v=ae938a762063';

// Fixed invented inputs; this generator never reads or samples a CRM database.
export function seedDemo(store, anchor = new Date()) {
  const day = anchor.toLocaleDateString('en-CA',{timeZone:'America/Phoenix'});
  const shifted = (n) => new Date(Date.parse(`${day}T12:00:00Z`) + n*864e5).toISOString().slice(0,10);
  const adjectives = ['Copper Quail','Juniper Lantern','Canyon Prism','Desert Finch','Mesa Compass','Saguaro Mosaic','Sonoran Willow','Cobalt Arroyo','Amber Orchard','Silver Tortoise'];
  const kinds = ['Community Bank','Credit Union','Health Network','Benefits Group'];
  const segments = ['Bank','Credit union','Healthcare','Insurance'];
  const cities = ['Phoenix','Scottsdale','Tempe','Mesa','Chandler','Gilbert','Tucson','Peoria'];
  const stages = [null,'research','ready','contacted','engaged','discovery','qualified','opportunity','won','nurture','lost','disqualified'];
  const firstNames = ['Avery','Jordan','Morgan','Casey','Riley','Quinn','Reese','Cameron','Taylor','Jamie','Drew','Sage','Parker','Emery','Rowan','Blair','Alex','Finley','Skyler','Hayden'];
  const lastNames = ['Vale','Brookfield','Ashford','Marlow','Fenwick'];
  const titles = ['Chief Information Officer','VP of Technology','Chief Information Security Officer','Director of AI Strategy','Chief Operating Officer','Director of Compliance','Clinical Informatics Director','IT Infrastructure Manager','VP of Operations','Technology Architect'];
  const companies = [], people = [];
  store.savePlan({start:shifted(-21),days:60,name:'Demo Account Executive',goals:{demos:20,qualified:12,opportunities:6},weekly:{touches:50,intros:5,booked:4,demos:3,advanced:6},rates:{cold:10,warm:30}});
  for (let i=0;i<40;i++) {
    const band = i%4;
    const company = store.create('companies',{
      name:`${adjectives[Math.floor(i/4)]} ${kinds[band]} (Demo)`,
      website:`https://example.com/demo/account-${String(i+1).padStart(3,'0')}`,
      source_channel:i<32?'Purchased':'Demo',segment:segments[band],
      industry:band<2?'Financial Services':band===2?'Healthcare & Health Services':'Insurance',
      city:cities[i%cities.length],state:'AZ',country:'United States',
      fit_score:String(55+(i*7)%41),employees:String(80+i*35),revenue_band:'$25M to <$50M',
      hypothesis:band<2?'DEMO research: 500M-1B strong band':band===2?'DEMO research: boss industry #3':'DEMO research: boss_icp_industry=no',
      trigger_event:i%5===0?'Fictional internal workflow pilot approved':null,
      buyer_pain:'Fictional scenario: evaluate a private AI workflow for internal document review.',
      stage:stages[i%stages.length],
    });
    store.run('UPDATE companies SET created_at=?,updated_at=?,stage_entered_at=? WHERE id=?',shifted(-30),shifted(-i%8),shifted(-(i%12)),company.id);
    companies.push(company);
  }
  for (let i=0;i<100;i++) {
    const company = companies[i%40];
    const p = store.create('people',{
      first_name:firstNames[i%20],last_name:lastNames[Math.floor(i/20)],
      title:titles[i%10],company_id:company.id,
      email:`demo-contact-${String(i+1).padStart(3,'0')}@example.com`,
      linkedin_url:null,phone:null,source:'Purchased',
      relationship:i%13===0?'Connection':i%3===0?'Buyer':null,
      how_known:i%13===0?'Fictional professional connection for this demo.':null,
    });
    people.push(p);
  }
  const scores = assignTiers(companies.map((c) => {
    const team = people.filter((p) => p.company_id===c.id).map((p) => ({...p,relationship:p.relationship??'Buyer'}));
    return {...c,tierBefore:c.tier,...scoreAccount(c,team)};
  }),{A:12,B:16});
  for (const c of scores) store.update('companies',c.id,{tier:c.tierAfter,priority:String(c.priority),score_reason:`FICTIONAL DEMO · ${c.reason}`,score_version:PRIORITY_VERSION});
  for (const p of people) {
    const c = companies.find((c) => c.id===p.company_id);
    const connection = people.find((x) => x.company_id===c.id && x.relationship==='Connection' && x.id!==p.id);
    const result = scoreAccount(c,[{...p,relationship:'Buyer'},connection].filter(Boolean));
    store.update('people',p.id,{lead_score:String(result.priority),lead_role:roleGroup(p.title),lead_score_reason:`FICTIONAL DEMO · ${result.reason}`,lead_score_version:PRIORITY_VERSION});
  }
  for (let i=0;i<40;i++) {
    const c=companies[i],p=people[i];
    if (i%4!==0) {
      store.addActivity({company_id:c.id,person_id:p.id,type:'Outreach',channel:'Email',at:shifted(-(i%20+3)),summary:'Fictional workflow introduction',body:'Demo-only sample: asked about a private AI document-review workflow.'});
      if (i%3===0) store.addActivity({company_id:c.id,person_id:p.id,type:'Reply',channel:'Email',at:shifted(-(i%8)),summary:'Fictional prospect asked for a walkthrough',body:'Demo-only sample: interested in reviewing an example workflow with IT and security.'});
    }
    if (i%7===0) store.addActivity({company_id:c.id,person_id:p.id,type:'Meeting',channel:'In person',at:shifted(-(i%12)),summary:'Fictional field visit',body:'Demo scenario: discussed internal approvals and workflow ownership.'});
    if (i%9===0) store.addActivity({company_id:c.id,person_id:p.id,type:'Demo booked',channel:'Video',at:shifted(-3),scheduled_for:shifted(i%3+2),summary:'Fictional product walkthrough scheduled'});
    if (i%11===0) store.addActivity({company_id:c.id,person_id:p.id,type:'Demo held',channel:'Video',at:shifted(-2),summary:'Fictional product walkthrough completed'});
    if (i<20) store.createTask({company_id:c.id,person_id:p.id,title:i%2?'Prepare a fictional demo workflow':'Follow up on the fictional evaluation',due_date:shifted(i%6-2)});
  }
  store.run("INSERT INTO settings(key,value) VALUES ('demo-seeded','100 fictional leads')");
  return {companies:40,people:100};
}
