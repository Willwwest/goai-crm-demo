// Account priority: how likely an account is to turn into a demo for the effort it takes.
//
//   priority = 100 × fit × icp × access × timing × local
//
// fit     Grok's Go1 fit score (0-100, unverified research) as a share. Missing counts as 0.5.
// icp     Where the account sits on the manager's industry list, read from the research
//         note: banks and credit unions first (by asset band), healthcare third, and
//         insurers, TPAs and benefit trusts not on the list. Off-list accounts top out at B.
// access  How reachable a decision maker is: the best buyer's role group times how they
//         can be reached, or a warm path through someone you know, plus a bonus for both.
//         An account with nobody to contact keeps a floor so it can still rank for research.
// timing  A verified trigger event counts in full; without one the account is neutral.
// local   Phoenix and Tucson metro accounts can also be visited in person.
//
// Tiers come from rank, not fixed cut-offs: A is the top slice you can work in two to
// three weeks, B the next, C the rest. Handoff accounts (partner lane) keep their tier.
// The weights are version 1, fixed until there are outcomes to fit them against.
import { roleGroup, visitArea } from '../schema.js';

export const PRIORITY_VERSION = 'v1-2026-10';
// [pattern in the research note, factor, label], first match wins.
export const ICP = [
  [/boss_icp_industry=no/, 0.5, 'not on the ICP list'],
  [/1B\+ sweet spot/, 1, 'ICP: $1B+ institution'],
  [/500M-1B strong band/, 0.9, 'ICP: $500M–1B institution'],
  [/100M-500M test band/, 0.75, 'ICP: $100–500M institution'],
  [/boss industry #3/, 0.85, 'ICP: healthcare (#3)'],
];
const ICP_UNKNOWN = 0.7;
export const WEIGHTS = {
  role: { Technology: 1, Executive: 0.85, 'Strategy & AI': 0.85, Security: 0.8, 'Risk & compliance': 0.7, Clinical: 0.6, Other: 0.45 },
  reach: { email: 1, linkedin: 0.85, none: 0.55 },
  warm: 0.75,
  both: 0.15,
  floor: 0.15,
  trigger: 1,
  noTrigger: 0.8,
  local: 1.05,
  missingFit: 0.5,
};
export const TIER_SIZES = { A: 90, B: 180 };

const reachOf = (p) => (p.email ? 'email' : p.linkedin_url ? 'linkedin' : 'none');
const REACH_WORDS = { email: 'email on file', linkedin: 'LinkedIn on file', none: 'no contact details' };

// Scores one account. `people` are its Buyer and Connection contacts.
export function scoreAccount(company, people = []) {
  const fitValue = company.fit_score == null || company.fit_score === '' ? null : Number(company.fit_score);
  const fit = fitValue == null || !Number.isFinite(fitValue) ? WEIGHTS.missingFit : Math.min(1, Math.max(0, fitValue / 100));
  const [, icp, icpLabel] = ICP.find(([re]) => re.test(company.hypothesis ?? '')) ?? [null, ICP_UNKNOWN, 'ICP unknown'];
  let best = null;
  for (const p of people.filter((x) => x.relationship === 'Buyer')) {
    const role = roleGroup(p.title);
    const reach = reachOf(p);
    const value = (WEIGHTS.role[role] ?? WEIGHTS.role.Other) * WEIGHTS.reach[reach];
    if (!best || value > best.value) best = { value, role, reach, person: p };
  }
  const connection = people.find((x) => x.relationship === 'Connection') ?? null;
  const buyerAccess = best?.value ?? 0;
  const warmAccess = connection ? WEIGHTS.warm : 0;
  const access = Math.min(1, Math.max(WEIGHTS.floor, Math.max(buyerAccess, warmAccess) + (best && connection ? WEIGHTS.both : 0)));
  const timing = String(company.trigger_event ?? '').trim() ? WEIGHTS.trigger : WEIGHTS.noTrigger;
  const area = visitArea(company);
  const local = area === 'Phoenix metro' || area === 'Tucson metro' ? WEIGHTS.local : 1;
  const priority = Math.round(100 * fit * icp * access * timing * local * 10) / 10;

  const reason = [
    company.segment,
    fitValue == null ? 'no fit score' : `Go1 fit ${fitValue}`,
    icpLabel,
    best ? `${best.role.toLowerCase()} buyer, ${REACH_WORDS[best.reach]}` : 'no buyer on file',
    connection && `warm path via ${[connection.first_name, connection.last_name].filter(Boolean).join(' ')}`,
    timing === WEIGHTS.trigger && 'verified trigger',
    local > 1 && area,
  ].filter(Boolean).join(' · ');
  return { priority, fit, icp, access, timing, local, reason, offList: ICP[0][0].test(company.hypothesis ?? ''), needsBuyer: !best && fit * icp >= 0.6 };
}

// Ranks scored accounts into tiers. Handoff accounts keep Handoff; off-list accounts top out at B.
export function assignTiers(scored, sizes = TIER_SIZES) {
  const ranked = scored.filter((s) => s.tierBefore !== 'Handoff').sort((a, b) => b.priority - a.priority || b.fit - a.fit);
  let a = 0;
  ranked.forEach((s, i) => {
    s.rank = i + 1;
    if (a < sizes.A && !s.offList) { s.tierAfter = 'A'; a++; } else s.tierAfter = i < sizes.A + sizes.B ? 'B' : 'C';
  });
  for (const s of scored) if (s.tierBefore === 'Handoff') { s.rank = null; s.tierAfter = 'Handoff'; }
  return scored;
}
