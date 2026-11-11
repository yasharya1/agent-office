/* Theme: the default office. An invented cast with generic job titles.
   Every sprite is drawn in code from the look fields below (see finishLook and drawPerson in office.js).
   Copy this file to web/themes/<name>.js and set "theme": "<name>" in config.json to make your own. */
'use strict';
(() => {
const SK = { a: '#f6d5bd', b: '#ecc19c', c: '#dba57c', d: '#bf875c', e: '#9a6440', f: '#774b2d', g: '#5c3820' };
// key: { name, title, look }. Hair styles, tops, facial hair and glasses are listed in office.js (hairFront, torso).
const CAST = {
  morgan: { name: 'Morgan Hale', title: 'Scout', look: { skin: SK.c, hair: '#2a2a30', style: 'short', shirt: '#e9eef4', top: 'blazer', topC: '#2f5d62', mug: '#f2c14e' } },
  rosa: { name: 'Rosa Ibarra', title: 'Front Desk', look: { skin: SK.d, hair: '#2b1a12', style: 'ponytail', shirt: '#fdf6e8', top: 'cardigan', topC: '#5b8c5a', mug: '#e48fb0' } },
  // leads: one per session, seated in the bullpen
  theo: { name: 'Theo Lindqvist', title: 'Lead', look: { skin: SK.a, hair: '#d9b25f', style: 'spiky', shirt: '#4a6fa5', short: true, mug: '#3d6fb5' } },
  priya: { name: 'Priya Raman', title: 'Lead', look: { skin: SK.e, hair: '#141012', style: 'long', shirt: '#c2504a', top: 'top', mug: '#f4f1e8' } },
  sam: { name: 'Sam Okoye', title: 'Lead', look: { skin: SK.g, hair: '#121010', style: 'buzz', shirt: '#f0e6d2', top: 'sweater', topC: '#3d6b4f', collarC: '#ffffff', mug: '#d07a4a' } },
  marta: { name: 'Marta Kowalczyk', title: 'Lead', look: { skin: SK.a, hair: '#7a3b22', style: 'bob', glasses: 'round', glassC: '#3a4f7a', shirt: '#b7c9e2', top: 'top', mug: '#5aa36a' } },
  dev: { name: 'Dev Malhotra', title: 'Lead', look: { skin: SK.d, hair: '#1d1510', style: 'curly', facial: 'beard', facialC: '#1d1510', shirt: '#6b6b78', top: 'polo', short: true, mug: '#2e2e36' } },
  lena: { name: 'Lena Hoffmann', title: 'Lead', look: { skin: SK.b, hair: '#c88a3e', style: 'bun', shirt: '#e9e4d8', top: 'vest', topC: '#8a6bb8', mug: '#8a6bb8' } },
  // research: the back room
  ines: { name: 'Ines Duarte', title: 'Researcher', look: { skin: SK.c, hair: '#4b2e1d', style: 'curlylong', shirt: '#f2d6a2', top: 'top', mug: '#d94f3d' } },
  hana: { name: 'Hana Sato', title: 'Researcher', look: { skin: SK.b, hair: '#16141a', style: 'bob', glasses: 'rect', glassC: '#26262c', shirt: '#dfe9e1', top: 'cardigan', topC: '#4aa3a3', mug: '#4aa3a3' } },
  kofi: { name: 'Kofi Mensah', title: 'Researcher', look: { skin: SK.f, hair: '#151010', style: 'short', shirt: '#e3b8a0', tie: '#3d5a80', mug: '#f2c14e' } },
  // builders: the workshop downstairs
  bruno: { name: 'Bruno Costa', title: 'Build Lead', look: { skin: SK.c, hair: '#3a2a1e', style: 'balding', facial: 'mustache', facialC: '#3a2a1e', shirt: '#b8734a', top: 'work', mug: '#7a5a3a' } },
  ade: { name: 'Ade Bello', title: 'Builder', look: { skin: SK.g, hair: '#141010', style: 'short', shirt: '#d9a441', top: 'work', mug: '#d9a441' } },
  yuki: { name: 'Yuki Tanaka', title: 'Builder', look: { skin: SK.b, hair: '#1b1b1f', style: 'side', shirt: '#7aa34a', top: 'jacket', topC: '#4f5a3a', mug: '#5aa36a' } },
  finn: { name: 'Finn Larsen', title: 'Builder', look: { skin: SK.a, hair: '#e3c069', style: 'tousled', facial: 'stubble', shirt: '#5e7e9e', top: 'work', mug: '#9aa3ae' } },
  zara: { name: 'Zara Haddad', title: 'Builder', look: { skin: SK.d, hair: '#2a1d16', style: 'ponytail', shirt: '#d86f3c', top: 'work', mug: '#d86f3c' } },
  // reviewers: second bullpen row
  walt: { name: 'Walt Ferreira', title: 'Reviewer', look: { skin: SK.b, hair: '#e9e1d2', style: 'neat', older: true, glasses: 'round', glassC: '#6b3d22', shirt: '#cfdcea', top: 'sweater', topC: '#6a4a5a', collarC: '#f2efe8', mug: '#f4f1e8' } },
  nadia: { name: 'Nadia Petrova', title: 'Reviewer', look: { skin: SK.a, hair: '#2a1d16', style: 'wavy', shirt: '#f1e8dc', top: 'blazer', topC: '#7a2f3f', mug: '#c2504a' } },
  // debuggers, planners, guides, generalists, the contractor
  omar: { name: 'Omar Saleh', title: 'Debugger', look: { skin: SK.d, hair: '#1a1410', style: 'neat', facial: 'goatee', facialC: '#1a1410', shirt: '#3d5a80', top: 'polo', short: true, mug: '#3d5a80' } },
  lin: { name: 'Lin Zhou', title: 'Debugger', look: { skin: SK.b, hair: '#141014', style: 'bob', glasses: 'rect', glassC: '#2a2420', shirt: '#a8d0c4', top: 'top', mug: '#2e2e36' } },
  grace: { name: 'Grace Adeyemi', title: 'Planner', look: { skin: SK.f, hair: '#1a1210', style: 'curlybob', shirt: '#f6f4ec', top: 'blazer', topC: '#1f4e6b', mug: '#f4f1e8' } },
  henrik: { name: 'Henrik Berg', title: 'Planner', look: { skin: SK.a, hair: '#9c9ca2', style: 'swept', facial: 'beard', facialC: '#9c9ca2', shirt: '#f2f2ee', top: 'suit', topC: '#4a4038', tie: '#a0703c', mug: '#2e2e36' } },
  joy: { name: 'Joy Castillo', title: 'Guide', look: { skin: SK.c, hair: '#5a3a5e', style: 'messy', shirt: '#f2b8c6', top: 'cardigan', topC: '#9b59d0', mug: '#9b59d0' } },
  arlo: { name: 'Arlo Reyes', title: 'Guide', look: { skin: SK.d, hair: '#2a1d16', style: 'shaggy', shirt: '#9ecbff', top: 'top', mug: '#3d6fb5' } },
  tess: { name: 'Tess Moreau', title: 'Generalist', look: { skin: SK.a, hair: '#b5432c', style: 'long', shirt: '#4f8f8a', top: 'top', mug: '#f2c14e' } },
  kai: { name: 'Kai Nakamura', title: 'Generalist', look: { skin: SK.b, hair: '#1b1b1f', style: 'spiky', shirt: '#f2c14e', short: true, mug: '#2e2e36' } },
  bea: { name: 'Bea Lund', title: 'Generalist', look: { skin: SK.a, hair: '#e9e1d2', style: 'bun', older: true, shirt: '#a593c2', top: 'cardigan', topC: '#5a6a8a', mug: '#e48fb0' } },
  raf: { name: 'Rafael Ortiz', title: 'Generalist', look: { skin: SK.d, hair: '#22170f', style: 'slick', shirt: '#eae6dd', tie: '#3f6b3a', mug: '#5aa36a' } },
  cleo: { name: 'Cleo Banks', title: 'Generalist', look: { skin: SK.f, hair: '#2a1a12', style: 'curly', shirt: '#e07b9b', top: 'top', mug: '#d94f3d' } },
  idris: { name: 'Idris Kaya', title: 'Generalist', look: { skin: SK.c, hair: '#2a2a30', style: 'neat', facial: 'stubble', shirt: '#6a7a8c', top: 'jacket', topC: '#2f3a52', mug: '#9aa3ae' } },
  quinn: { name: 'Quinn Harper', title: 'Contractor', look: { skin: SK.b, hair: '#6e4426', style: 'side', shirt: '#2f323b', top: 'jacket', topC: '#4a4a56', mug: '#2e2e36' } },
};

// Idle quips: short and original. Keys are cast keys.
const QUIPS = {
  morgan: ['Who needs a hand?', 'Big week. Good week.'],
  rosa: ['Front desk, how can I help?'],
  theo: ['Ship it.'],
  priya: ['One more test, then lunch.'],
  sam: ['Coffee first.'],
  walt: ['Looks good to me. Mostly.'],
  kofi: ['Interesting...'],
  bruno: ['Measure twice, cut once.'],
  henrik: ['Let us not boil the ocean.'],
};
// What the scout says while it walks the bullpen.
const SCOUT_QUIPS = ['What is everybody working on?', 'Just walking around.', 'Anything stuck?', 'I see a quick win.', 'Keep it up.', 'This could be a good one.'];

// Pools. Order inside a pool is the order characters are handed out.
const POOLS = {
  top: ['theo', 'priya', 'sam', 'marta', 'dev', 'lena'],
  research: ['ines', 'hana', 'kofi'],
  builder: ['bruno', 'ade', 'yuki', 'finn', 'zara'],
  reviewer: ['walt', 'nadia'],
  debugger: ['omar', 'lin'],
  plan: ['grace', 'henrik'],
  guide: ['joy', 'arlo'],
  annex: ['tess', 'kai', 'bea', 'raf', 'cleo', 'idris'],
};
POOLS.codex = ['quinn'].concat(POOLS.annex);

window.AO_THEME = {
  id: 'default',
  brand: { title: 'Agent Office', place: 'Main floor', store: 'agent-office', sign: ['AGENT OFFICE', 'BUILDING THINGS'] },
  cast: CAST,
  quips: QUIPS,
  scoutQuips: SCOUT_QUIPS,
  pools: POOLS,
  // subagent type -> pool; anything else lands in the annex
  poolOfType: { explorer: 'research', Explore: 'research', researcher: 'research', builder: 'builder', reviewer: 'reviewer', debugger: 'debugger', Plan: 'plan', 'claude-code-guide': 'guide' },
  // Who sits where on the floor plan. Seat keys are cast keys.
  slots: {
    scout: 'morgan', recep: 'rosa',
    pairFront: 'priya', pairBack: 'theo', duo: ['dev', 'marta'], row1: ['sam', 'lena'], row2: ['walt', 'nadia'],
    acc: ['hana', 'ines', 'kofi'], conf: ['grace', 'henrik'],
    annexHead: ['tess', 'quinn', 'joy'],
    annexExtras: ['arlo', 'kai', 'bea', 'raf', 'cleo', 'idris', 'omar', 'lin'],
    crew: ['ade', 'yuki', 'finn', 'zara'], foreman: 'bruno',
  },
  // Desk props per character: [prop, x offset, 'nosip' to hide it while they drink]. No entry: a mug.
  // Props: mug, bossMug (printed mug), plant, papers, crossword, cat, candyJar, flowers, candyDish.
  props: {
    morgan: [['bossMug', 40, 'nosip'], ['plant', 47], ['papers', 22]],
    marta: [['flowers', 27]], hana: [['cat', 26]], kofi: [['candyJar', 26]], dev: [['crossword', 20]],
    bruno: [['papers', 30], ['mug', 38, 'nosip']],
  },
  labels: { acc: 'Research', annex: 'Annex', crew: 'Workshop', conf: 'Planning room', kitchen: 'Kitchen', foreman: 'Build lead' },
  recepNote: 'Not an agent. Answers the phone when an agent needs you.',
};
})();
