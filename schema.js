// CRM configuration shared by the server and the browser.
// Add a field by appending it to an entity's `fields` list; the server adds the
// column on its next start. Removing a field hides it but keeps the stored data.
//
// Field types: text, longtext, url, email, phone, date, number, select, company.
// `list: true` shows the field as a table column. `filter: true` adds a filter
// menu to the list (select fields only). `section` groups fields on the record page.

export const BRAND = {
  name: 'Go.AI CRM',
  short: 'Go.AI',
};

// Account stages from lead-generation-process.md, plus Won and Lost as the
// outcomes of Opportunity. Companies with no stage are not in the pipeline.
export const STAGES = [
  { value: 'research', label: 'Research', color: '#8a84ff' },
  { value: 'ready', label: 'Ready', color: '#6c8cff' },
  { value: 'contacted', label: 'Contacted', color: '#3fa7d6' },
  { value: 'engaged', label: 'Engaged', color: '#2bb3a3' },
  { value: 'discovery', label: 'Discovery', color: '#45b36b' },
  { value: 'qualified', label: 'Qualified', color: '#9ab23a' },
  { value: 'opportunity', label: 'Opportunity', color: '#e0a526' },
  { value: 'won', label: 'Won', color: '#2f9e44' },
  { value: 'nurture', label: 'Nurture', color: '#a58bd6' },
  { value: 'lost', label: 'Lost', color: '#9a8f8f' },
  { value: 'disqualified', label: 'Disqualified', color: '#c26a6a' },
];

// "Demo booked" carries the demo date (scheduled_for); "Demo held" is what the demo goal counts.
// "Meeting" is any other meeting, such as an in-person drop-in.
export const ACTIVITY_TYPES = ['Outreach', 'Reply', 'Intro request', 'Call', 'Demo booked', 'Demo held', 'Meeting', 'Note'];
// "In person" activities count as visits on the Insights page.
export const CHANNELS = ['Email', 'LinkedIn', 'Phone', 'Video', 'In person', 'Event', 'Other'];


export const ENTITIES = {
  companies: {
    label: 'Companies',
    singular: 'Company',
    fields: [
      { key: 'name', label: 'Name', type: 'text', required: true, list: true },
      { key: 'stage', label: 'Stage', type: 'select', options: STAGES.map((s) => s.value), list: true, filter: true },
      { key: 'tier', label: 'Priority tier', type: 'select', options: ['A', 'B', 'C', 'Handoff'], list: true, filter: true },
      { key: 'segment', label: 'Segment', type: 'select', options: ['Healthcare', 'Insurance', 'Financial services', 'Bank', 'Credit union', 'Other'], list: true, filter: true },
      { key: 'fit_score', label: 'Fit score', type: 'number', list: true },
      // Written by scripts/rescore.mjs (lib/account-priority.mjs).
      { key: 'priority', label: 'Priority score', type: 'number', section: 'Scoring' },
      { key: 'score_reason', label: 'Why this priority', type: 'text', section: 'Scoring' },
      { key: 'score_version', label: 'Scoring version', type: 'text', section: 'Scoring' },
      { key: 'product_fit', label: 'Product fit', type: 'select', options: ['Go1 Mini', 'Go1', 'Go1 MAX'], filter: true },
      { key: 'website', label: 'Website', type: 'url', list: true },
      { key: 'institution_type', label: 'Institution type', type: 'select', options: ['Bank', 'Credit union', 'Other'] },
      { key: 'charter_number', label: 'FDIC / NCUA number', type: 'text' },
      { key: 'city', label: 'City', type: 'text' },
      { key: 'state', label: 'State', type: 'text', list: true },
      { key: 'country', label: 'Country', type: 'text' },
      { key: 'linkedin_url', label: 'LinkedIn', type: 'url' },
      { key: 'source_channel', label: 'Source', type: 'text' },
      { key: 'industry', label: 'Industry', type: 'text' },
      { key: 'employees', label: 'Employees', type: 'number' },
      { key: 'revenue_band', label: 'Revenue band', type: 'text' },
      { key: 'hypothesis', label: 'Workflow hypothesis', type: 'longtext', section: 'Qualification' },
      { key: 'trigger_event', label: 'Verified trigger', type: 'longtext', section: 'Qualification' },
      { key: 'trigger_url', label: 'Trigger source', type: 'url', section: 'Qualification' },
      { key: 'buyer_pain', label: 'Buyer-confirmed pain', type: 'longtext', section: 'Qualification' },
      { key: 'decision_path', label: 'Decision path', type: 'longtext', section: 'Qualification' },
      { key: 'intro_path', label: 'Introduction path', type: 'text', section: 'Qualification' },
      { key: 'address', label: 'Street address', type: 'text', section: 'Location' },
      { key: 'latitude', label: 'Latitude', type: 'number', section: 'Location' },
      { key: 'longitude', label: 'Longitude', type: 'number', section: 'Location' },
      { key: 'close_reason', label: 'Disqualification / loss reason', type: 'text', section: 'Outcome' },
      { key: 'revisit_date', label: 'Revisit date', type: 'date', section: 'Outcome' },
    ],
  },
  people: {
    label: 'People',
    singular: 'Person',
    fields: [
      { key: 'first_name', label: 'First name', type: 'text', required: true },
      { key: 'last_name', label: 'Last name', type: 'text' },
      { key: 'title', label: 'Title', type: 'text', list: true },
      { key: 'company_id', label: 'Company', type: 'company', list: true },
      { key: 'email', label: 'Email', type: 'email', list: true },
      { key: 'phone', label: 'Phone', type: 'phone' },
      { key: 'linkedin_url', label: 'LinkedIn', type: 'url' },
      { key: 'relationship', label: 'Relationship', type: 'select', options: ['Buyer', 'Introducer', 'Adviser', 'Connection'], list: true, filter: true },
      { key: 'lead_score', label: 'Lead score', type: 'number', list: true },
      { key: 'lead_role', label: 'Lead role', type: 'select', options: ['Technology', 'Strategy & AI', 'Security', 'Risk & compliance', 'Clinical', 'Operations', 'Executive', 'Other', 'Unknown'], filter: true },
      { key: 'lead_score_reason', label: 'Why this lead score', type: 'longtext', section: 'Scoring' },
      { key: 'lead_score_version', label: 'Lead scoring version', type: 'text', section: 'Scoring' },
      { key: 'how_known', label: 'How you know them', type: 'longtext' },
      { key: 'connected_on', label: 'Connected on', type: 'date' },
      { key: 'source', label: 'Source', type: 'text' },
      { key: 'department', label: 'Department', type: 'text' },
    ],
  },
};

// Visit areas group the free-text city field for in-person planning. A company
// belongs to the area whose city appears first in its city text. Out-of-state
// companies and statewide entries fall into their own groups.
export const VISIT_AREAS = [
  { name: 'Phoenix metro', cities: ['Phoenix', 'Scottsdale', 'Tempe', 'Mesa', 'Chandler', 'Gilbert', 'Glendale', 'Peoria', 'Surprise', 'Avondale', 'Goodyear', 'Buckeye', 'Fountain Hills', 'Paradise Valley', 'Cave Creek', 'Carefree', 'Queen Creek', 'Sun City', 'Tolleson', 'Litchfield Park', 'El Mirage', 'Apache Junction', 'Laveen', 'Anthem', 'Youngtown', 'Maricopa County'] },
  { name: 'Tucson metro', cities: ['Tucson', 'Oro Valley', 'Marana', 'Sahuarita', 'Green Valley', 'Vail', 'Pima County'] },
  { name: 'Pinal County', cities: ['Casa Grande', 'Maricopa', 'Florence', 'Coolidge', 'San Tan Valley', 'Eloy', 'Sacaton', 'Pinal County'] },
  { name: 'Northern Arizona', cities: ['Flagstaff', 'Sedona', 'Cottonwood', 'Prescott', 'Prescott Valley', 'Chino Valley', 'Camp Verde', 'Williams', 'Page', 'Winslow', 'Holbrook', 'Show Low', 'Payson', 'Tuba City', 'Chinle', 'Window Rock', 'Fort Defiance', 'Kayenta', 'Ganado', 'Keams Canyon', 'Whiteriver', 'Polacca', 'Springerville', 'Navajo Nation'] },
  { name: 'Western Arizona', cities: ['Yuma', 'Kingman', 'Lake Havasu', 'Bullhead City', 'Parker', 'Wickenburg', 'San Luis', 'Somerton'] },
  { name: 'Southeast Arizona', cities: ['Sierra Vista', 'Douglas', 'Bisbee', 'Nogales', 'Safford', 'Benson', 'Willcox', 'Globe', 'Miami'] },
];

export function visitArea(company) {
  const text = `${company.city ?? ''}`.toLowerCase();
  let best = null;
  for (const area of VISIT_AREAS) {
    for (const city of area.cities) {
      const at = text.search(new RegExp(`\\b${city.toLowerCase()}\\b`));
      if (at >= 0 && (!best || at < best.at)) best = { at, name: area.name };
    }
  }
  if (best) return best.name;
  const state = `${company.state ?? ''}`.trim().toUpperCase();
  if (state && !state.startsWith('AZ')) return 'Out of state';
  return 'Statewide / unspecified';
}

// Visit priority for the Field visits map. Each account scores its tier weight,
// times the warm-path multiplier when you have a LinkedIn connection there, plus
// the buyer bonus when a buyer contact is on file. Accounts visited in person
// within `recentDays` count at `recentFactor` of their score. A city's bubble is
// the sum of its accounts' scores.
export const VISIT_PRIORITY = {
  tierWeights: { A: 5, B: 3, C: 1, Handoff: 0 },
  warmMultiplier: 1.5,
  buyerBonus: 1,
  recentDays: 90,
  recentFactor: 0.5,
};

export function visitScore(account, today) {
  const p = VISIT_PRIORITY;
  let score = (p.tierWeights[account.tier] ?? 0) * (account.connections?.length ? p.warmMultiplier : 1);
  if (account.buyers?.length) score += p.buyerBonus;
  if (account.last_visit && today) {
    const days = (Date.parse(`${today}T00:00:00Z`) - Date.parse(account.last_visit)) / 864e5;
    if (days <= p.recentDays) score *= p.recentFactor;
  }
  return Math.round(score * 10) / 10;
}

// Buyer-role groups for coverage analysis. A title takes the first group whose
// pattern matches, so order matters (a CISO is Security, not Technology).
export const ROLE_GROUPS = [
  { name: 'Security', pattern: /ciso|security|cyber/i },
  { name: 'Risk & compliance', pattern: /risk|compliance|privacy|hipaa|audit/i },
  { name: 'Clinical', pattern: /medical|clinical|cmio|nursing|informatics|chief of staff|\bcmo\b/i },
  { name: 'Strategy & AI', pattern: /strateg|\bai\b|artificial intelligence|innovation|transformation|analytics/i },
  { name: 'Technology', pattern: /\bcio\b|\bcto\b|\bcdo\b|information|technology|\bit\b|infrastructure|digital|data|systems/i },
  { name: 'Executive', pattern: /\bceo\b|\bcoo\b|chief executive|president|chief operat|operations officer|chief administrat|executive director|superintendent|general manager|vice president|\bevp\b|\bsvp\b/i },
];
export const roleGroup = (title) => ROLE_GROUPS.find((g) => g.pattern.test(title ?? ''))?.name ?? 'Other';

// The Today page's 60-day plan. These are starting placeholders; the plan you save on
// the Today page is stored in the database and replaces them.
//   weekly.touches   logged activities other than notes and bookings (outreach, replies, calls, meetings, intros)
//   weekly.intros    "Intro request" activities
//   weekly.booked    "Demo booked" activities
//   weekly.advanced  accounts moved forward a stage (adding an account to Research does not count)
//   goals.*          totals since the start date: demos held, accounts that reached
//                    Qualified or later, and accounts that reached Opportunity or Won
//   rates.*          planning assumptions (percent) for how many accounts turn into a demo:
//                    cold accounts given a full 3-touch sequence, and intro requests. Today
//                    uses them to turn the demos still needed into accounts to start.
export const PLAN_DEFAULTS = {
  start: null,
  days: 60,
  weekly: { touches: 40, intros: 3, booked: 2, advanced: 5 },
  goals: { demos: 15, qualified: 4, opportunities: 2 },
  rates: { cold: 5, warm: 25 },
};
export const PLAN_LABELS = {
  weekly: { touches: 'Touches', intros: 'Intro requests', booked: 'Demos booked', advanced: 'Accounts moved forward' },
  goals: { demos: 'Demos held', qualified: 'Accounts qualified', opportunities: 'Opportunities created' },
  rates: { cold: 'Cold accounts that become a demo (%)', warm: 'Intro requests that become a demo (%)' },
};

export const stageLabel = (value) => STAGES.find((s) => s.value === value)?.label ?? '';
export const stageColor = (value) => STAGES.find((s) => s.value === value)?.color ?? '#b9b3c4';
export const personName = (p) => [p?.first_name, p?.last_name].filter(Boolean).join(' ') || 'Unnamed';
