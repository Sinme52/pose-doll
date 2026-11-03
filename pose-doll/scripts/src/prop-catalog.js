// Catalog of held items. Add a new item by adding an entry; most new guns only need
// { base: 'rifle', label, length } and inherit everything else.
//
// Fields
//   label      words used in the pose description ("assault rifle", "two-handed sword", ...)
//   category   'gun' | 'blade' | 'shield' | 'pole'  (decides the wording of the description)
//   hands      [min, max] number of hands that may hold it
//   attach     how it is placed:
//                'axis'    hands[0] holds the grip; the item runs through hands[1] (guns, two-handed swords, spears)
//                'thumb'   one fist; the item leaves the thumb side of the fist (one-handed swords, axes, daggers)
//                'strap'   strapped to the forearm, front facing out of the back of the arm (shields)
//   oneHand    for 'axis' items held in one hand: 'forearm' (continue the forearm line) or 'thumb'
//   length     size in head heights: along the item for guns/blades/poles, height for shields
//   width      shields only: width in head heights
//   grip       where hands[0] holds it, as a fraction of the length from the back end (pommel / stock)
//   support    where hands[1] usually holds it (only used to decide which way the item points)
//   tip        name of the marked end: 'muzzle', 'blade tip', 'point', 'front' (shields)
//   angle      (in a pose, not here) turns a 'thumb' or 'strap' item around the back of the hand, degrees;
//              e.g. 180 holds a dagger point-down (reverse grip)
//   parts      geometry. x: [from, to] as fractions of the length (blades/guns/poles), other sizes in head heights.
//              shapes: box {x, h, w, y, z}, cyl {x, r, r2, y, z}, ball {x, r}, blade {x, w, t, tipLen (fraction of the blade;
//                      the point is drawn orange as the tip marker unless tipMat: false)},
//                      disc {r, t, x, y}, plate {h, w, t}, kite {h, w, t}  (shields: built facing +Y, long side along X;
//                      for shield parts x / y are offsets in head heights)
//              mat: 'dark' (default), 'steel', 'wood', 'tip' (orange marker)
// Item-local frame: +X along the item toward the tip, +Y 'up' (guns: top; blades: the edge toward the fingers),
// +Z the side. Shields: +Y is the outward face, +X the long side (pointing like the thumb), +Z along the forearm.

const GUN_LONG = [
  { shape: 'box', x: [0, 0.25], h: 0.3, w: 0.12, y: -0.03 }, // stock
  { shape: 'box', x: [0.24, 0.62], h: 0.36, w: 0.16 }, // receiver
  { shape: 'box', x: [0.3, 0.36], h: 0.42, w: 0.1, y: -0.3 }, // pistol grip
  { shape: 'box', x: [0.42, 0.5], h: 0.5, w: 0.1, y: -0.35 }, // magazine
  { shape: 'cyl', x: [0.6, 0.97], r: 0.06, y: 0.04 }, // barrel
  { shape: 'cyl', x: [0.97, 1], r: 0.08, y: 0.04, mat: 'tip' }, // muzzle
];

export const CATALOG = {
  // ---------------------------------------------------------------- guns
  rifle: { label: 'rifle', category: 'gun', hands: [1, 2], attach: 'axis', oneHand: 'forearm', length: 4.0, grip: 0.3, support: 0.6, tip: 'muzzle', parts: GUN_LONG },
  'assault-rifle': { base: 'rifle', label: 'assault rifle' },
  carbine: { base: 'rifle', label: 'carbine', length: 3.3 },
  smg: {
    base: 'rifle', label: 'submachine gun', length: 2.6, grip: 0.35, support: 0.65,
    parts: [
      { shape: 'box', x: [0, 0.2], h: 0.2, w: 0.08, y: -0.02 },
      { shape: 'box', x: [0.2, 0.75], h: 0.34, w: 0.15 },
      { shape: 'box', x: [0.32, 0.4], h: 0.4, w: 0.1, y: -0.3 },
      { shape: 'box', x: [0.5, 0.57], h: 0.55, w: 0.09, y: -0.4 },
      { shape: 'cyl', x: [0.75, 0.96], r: 0.05, y: 0.03 },
      { shape: 'cyl', x: [0.96, 1], r: 0.07, y: 0.03, mat: 'tip' },
    ],
  },
  shotgun: {
    base: 'rifle', label: 'shotgun', length: 4.4, grip: 0.28, support: 0.62,
    parts: [
      { shape: 'box', x: [0, 0.27], h: 0.32, w: 0.12, y: -0.04 },
      { shape: 'box', x: [0.26, 0.5], h: 0.32, w: 0.15 },
      { shape: 'box', x: [0.29, 0.35], h: 0.4, w: 0.1, y: -0.28 },
      { shape: 'cyl', x: [0.5, 0.97], r: 0.08, y: 0.06 },
      { shape: 'cyl', x: [0.55, 0.72], r: 0.08, y: -0.1, mat: 'wood' }, // pump
      { shape: 'cyl', x: [0.97, 1], r: 0.1, y: 0.06, mat: 'tip' },
    ],
  },
  sniper: {
    base: 'rifle', label: 'sniper rifle', length: 5.3, grip: 0.27, support: 0.55,
    parts: [
      { shape: 'box', x: [0, 0.24], h: 0.32, w: 0.12, y: -0.04 },
      { shape: 'box', x: [0.23, 0.55], h: 0.3, w: 0.14 },
      { shape: 'box', x: [0.27, 0.32], h: 0.4, w: 0.1, y: -0.28 },
      { shape: 'cyl', x: [0.3, 0.5], r: 0.09, y: 0.3 }, // scope
      { shape: 'cyl', x: [0.55, 0.98], r: 0.05, y: 0.02 },
      { shape: 'cyl', x: [0.98, 1], r: 0.07, y: 0.02, mat: 'tip' },
    ],
  },
  lmg: {
    base: 'rifle', label: 'light machine gun', length: 4.8, grip: 0.3, support: 0.62,
    parts: [
      { shape: 'box', x: [0, 0.24], h: 0.32, w: 0.13, y: -0.03 },
      { shape: 'box', x: [0.23, 0.6], h: 0.4, w: 0.2 },
      { shape: 'box', x: [0.3, 0.36], h: 0.42, w: 0.1, y: -0.32 },
      { shape: 'box', x: [0.4, 0.55], h: 0.45, w: 0.32, y: -0.38 }, // box magazine
      { shape: 'cyl', x: [0.6, 0.97], r: 0.08, y: 0.04 },
      { shape: 'cyl', x: [0.97, 1], r: 0.1, y: 0.04, mat: 'tip' },
    ],
  },
  launcher: {
    base: 'rifle', label: 'rocket launcher', length: 5.3, grip: 0.42, support: 0.62,
    parts: [
      { shape: 'cyl', x: [0, 1], r: 0.24 },
      { shape: 'box', x: [0.4, 0.45], h: 0.45, w: 0.1, y: -0.4 },
      { shape: 'box', x: [0.58, 0.63], h: 0.4, w: 0.1, y: -0.38 },
      { shape: 'cyl', x: [0.97, 1], r: 0.27, mat: 'tip' },
    ],
  },
  pistol: {
    label: 'pistol', category: 'gun', hands: [1, 2], attach: 'axis', oneHand: 'forearm', length: 1.0, grip: 0.15, support: 0.15, tip: 'muzzle',
    parts: [
      { shape: 'box', x: [0, 0.92], h: 0.22, w: 0.12, y: 0.1 },
      { shape: 'box', x: [0, 0.3], h: 0.55, w: 0.12, y: -0.2 },
      { shape: 'box', x: [0.92, 1], h: 0.16, w: 0.1, y: 0.1, mat: 'tip' },
    ],
  },
  revolver: { base: 'pistol', label: 'revolver', length: 1.2 },

  // ---------------------------------------------------------------- blades
  sword: {
    label: 'one-handed sword', category: 'blade', hands: [1, 1], attach: 'thumb', length: 4.0, grip: 0.1, support: 0.03, tip: 'blade tip',
    parts: [
      { shape: 'ball', x: 0, r: 0.08 },
      { shape: 'cyl', x: [0.01, 0.17], r: 0.05 },
      { shape: 'box', x: [0.17, 0.19], h: 0.6, w: 0.1 }, // cross-guard
      { shape: 'blade', x: [0.19, 1], w: 0.22, t: 0.04, tipLen: 0.1, mat: 'steel' },
    ],
  },
  'sword-1h': { base: 'sword' },
  dagger: { base: 'sword', label: 'dagger', length: 1.5, grip: 0.18, parts: [
    { shape: 'ball', x: 0, r: 0.06 },
    { shape: 'cyl', x: [0.02, 0.32], r: 0.045 },
    { shape: 'box', x: [0.32, 0.36], h: 0.32, w: 0.08 },
    { shape: 'blade', x: [0.36, 1], w: 0.16, t: 0.03, tipLen: 0.3, mat: 'steel' },
  ] },
  greatsword: {
    label: 'two-handed sword', category: 'blade', hands: [1, 2], attach: 'axis', oneHand: 'thumb', length: 6.6, grip: 0.16, support: 0.06, tip: 'blade tip',
    parts: [
      { shape: 'ball', x: 0, r: 0.1 },
      { shape: 'cyl', x: [0.01, 0.2], r: 0.055, mat: 'wood' },
      { shape: 'box', x: [0.2, 0.22], h: 0.9, w: 0.12 },
      { shape: 'blade', x: [0.22, 1], w: 0.3, t: 0.05, tipLen: 0.08, mat: 'steel' },
    ],
  },
  'sword-2h': { base: 'greatsword' },
  katana: { base: 'greatsword', label: 'katana', length: 4.6, grip: 0.2, support: 0.06, parts: [
    { shape: 'cyl', x: [0, 0.26], r: 0.05, mat: 'wood' },
    { shape: 'cyl', x: [0.26, 0.28], r: 0.14 },
    { shape: 'blade', x: [0.28, 1], w: 0.14, t: 0.035, tipLen: 0.07, mat: 'steel' },
  ] },
  axe: { base: 'sword', label: 'axe', length: 3.2, grip: 0.2, tip: 'axe head', parts: [
    { shape: 'cyl', x: [0, 0.95], r: 0.06, mat: 'wood' },
    { shape: 'box', x: [0.8, 0.98], h: 0.7, w: 0.06, y: 0.3, mat: 'steel' },
    { shape: 'cyl', x: [0.95, 1], r: 0.08, mat: 'tip' },
  ] },

  // ---------------------------------------------------------------- shields (strapped to a forearm)
  shield: {
    label: 'round shield', category: 'shield', hands: [1, 1], attach: 'strap', length: 3.1, tip: 'front',
    parts: [
      { shape: 'disc', r: 1.55, t: 0.12, mat: 'wood' },
      { shape: 'disc', r: 0.3, t: 0.2, y: 0.08, mat: 'tip' }, // boss on the front face
    ],
  },
  'round-shield': { base: 'shield' },
  buckler: { base: 'shield', label: 'small buckler', length: 1.6, parts: [
    { shape: 'disc', r: 0.8, t: 0.1 },
    { shape: 'disc', r: 0.22, t: 0.18, y: 0.06, mat: 'tip' },
  ] },
  'kite-shield': { base: 'shield', label: 'kite shield', length: 4.4, width: 2.4, parts: [
    { shape: 'kite', h: 4.4, w: 2.4, t: 0.12, mat: 'wood' },
    { shape: 'disc', r: 0.25, t: 0.2, y: 0.08, x: 0.25, mat: 'tip' },
  ] },
  'tower-shield': { base: 'shield', label: 'tower shield', length: 5.7, width: 2.6, parts: [
    { shape: 'plate', h: 5.7, w: 2.6, t: 0.14, mat: 'wood' },
    { shape: 'disc', r: 0.28, t: 0.22, y: 0.08, mat: 'tip' },
  ] },
  'energy-shield': { base: 'shield', label: 'energy shield', length: 3.4 },

  // ---------------------------------------------------------------- poles
  rod: {
    label: 'staff', category: 'pole', hands: [1, 2], attach: 'axis', oneHand: 'forearm', length: 5.0, grip: 0.45, support: 0.7, tip: 'front end',
    parts: [
      { shape: 'cyl', x: [0, 0.97], r: 0.05, mat: 'wood' },
      { shape: 'cyl', x: [0.97, 1], r: 0.07, mat: 'tip' },
    ],
  },
  staff: { base: 'rod', length: 7.0 },
  spear: { base: 'rod', label: 'spear', length: 8.5, grip: 0.35, support: 0.6, tip: 'spear point', parts: [
    { shape: 'cyl', x: [0, 0.9], r: 0.05, mat: 'wood' },
    { shape: 'blade', x: [0.9, 1], w: 0.18, t: 0.04, tipLen: 0.5, mat: 'tip' },
  ] },
};

const resolved = {};
/** Full definition of an item type (with `base` inheritance applied), or null if unknown. */
export function propDef(type) {
  if (resolved[type]) return resolved[type];
  const own = CATALOG[type];
  if (!own) return null;
  const chain = [own];
  const seen = new Set([type]);
  let cur = own;
  while (cur.base) {
    if (seen.has(cur.base) || !CATALOG[cur.base]) throw new Error(`prop '${type}': bad base '${cur.base}'`);
    seen.add(cur.base);
    cur = CATALOG[cur.base];
    chain.unshift(cur);
  }
  const def = Object.assign({}, ...chain);
  delete def.base;
  def.type = type;
  resolved[type] = def;
  return def;
}

export const PROP_TYPES = Object.keys(CATALOG);

const REQUIRED = ['label', 'category', 'hands', 'attach', 'length', 'tip', 'parts'];
/**
 * Add or replace item types at run time (from a pose's "propDefs" or a --props-file).
 * Returns a list of problems (empty when everything was registered).
 */
export function registerProps(defs = {}) {
  const problems = [];
  for (const [type, def] of Object.entries(defs || {})) {
    if (!def || typeof def !== 'object') { problems.push(`propDefs.${type}: not an object`); continue; }
    const prev = CATALOG[type];
    CATALOG[type] = { ...def };
    for (const k of Object.keys(resolved)) delete resolved[k];
    let full;
    try {
      full = propDef(type);
    } catch (e) {
      full = null;
      problems.push(`propDefs.${type}: ${e.message}`);
    }
    const missing = full ? REQUIRED.filter((k) => full[k] === undefined) : [];
    if (full && (full.attach !== 'strap' && full.grip === undefined)) missing.push('grip');
    if (!full || missing.length) {
      if (full) problems.push(`propDefs.${type}: missing ${missing.join(', ')} (give them, or a "base" that has them)`);
      if (prev) CATALOG[type] = prev; else delete CATALOG[type];
      for (const k of Object.keys(resolved)) delete resolved[k];
      continue;
    }
    if (!PROP_TYPES.includes(type)) PROP_TYPES.push(type);
  }
  return problems;
}
