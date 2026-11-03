// Posable mannequin: body build, joint definitions, pose application and helpers.
// Works in the browser and in Node (no WebGL needed here), so the pose math can be tested headlessly.
//
// Conventions (all angles in degrees, all "left"/"right" are the CHARACTER'S OWN sides):
//  - The doll stands on y = 0 and faces +Z. Its own left is +X.
//  - Length unit is one head height.
import * as THREE from 'three';
import { propDef, registerProps } from './prop-catalog.js';

const R = THREE.MathUtils.degToRad;

const LIMB = (side) => ({
  [`${side}Shoulder`]: {
    label: `${side} shoulder`,
    params: { raise: [0, 180, 0], dir: [-90, 180, 0], twist: [-90, 90, 0] },
  },
  [`${side}Elbow`]: { label: `${side} elbow`, params: { bend: [0, 150, 0], twist: [-90, 90, 0] } },
  [`${side}Wrist`]: {
    label: `${side} hand`,
    params: { bend: [-80, 80, 0], side: [-30, 30, 0], grip: [0, 100, 20], point: [0, 1, 0] },
  },
  [`${side}Hip`]: {
    label: `${side} hip`,
    params: { raise: [0, 150, 0], dir: [-60, 180, 0], twist: [-90, 90, 0] },
  },
  [`${side}Knee`]: { label: `${side} knee`, params: { bend: [0, 160, 0] } },
  [`${side}Ankle`]: { label: `${side} ankle`, params: { bend: [-60, 40, 0] } },
});

// [min, max, default] for every parameter. Anything missing in a pose uses the default.
export const JOINT_DEFS = {
  root: { label: 'whole body', params: { yaw: [-180, 180, 0], pitch: [-90, 90, 0], roll: [-60, 60, 0], lift: [0, 4, 0] } },
  spine: { label: 'waist', params: { bend: [-40, 90, 0], side: [-40, 40, 0], twist: [-60, 60, 0] } },
  chest: { label: 'chest', params: { bend: [-30, 45, 0], side: [-30, 30, 0], twist: [-45, 45, 0] } },
  head: { label: 'head', params: { nod: [-60, 60, 0], turn: [-80, 80, 0], tilt: [-40, 40, 0] } },
  ...LIMB('left'),
  ...LIMB('right'),
};

export const PARAM_HELP = {
  'root.yaw': 'turn the whole body toward its own left (+) / right (-)',
  'root.pitch': 'tilt the whole body forward (+) / backward (-)',
  'root.roll': 'tilt the whole body toward its own left (+) / right (-)',
  'root.lift': 'height of the lowest point above the ground, in head heights (jumps)',
  bend: 'spine/chest: lean forward (+) / back (-); elbow & knee: flex; wrist: toward the palm; ankle: toes up (+) / pointed (-)',
  side: 'spine/chest: lean toward own left (+); wrist: toward the thumb (+)',
  twist: 'spine/chest: turn toward own left (+); shoulder/hip: roll outward (+) / inward (-); elbow: turn the forearm so the palm faces up (+) / down (-)',
  nod: 'head down (+) / up (-)',
  turn: 'head turns toward own left (+) / right (-)',
  tilt: 'head tilts toward own left shoulder (+)',
  raise: 'shoulder/hip: angle away from hanging straight down (0 = down, 90 = horizontal, 180 = straight up)',
  dir: 'shoulder/hip: direction of the raise (0 = forward, 90 = out to its own side, 180 = backward, negative = across the body)',
  grip: 'finger curl, 0 = flat open hand, 100 = fist',
  point: '1 = index finger stays straight (pointing)',
};

export const DEFAULT_BUILD = { headsTall: 7, shoulders: 1, hips: 1, girth: 1 };

export const VIEWS = {
  front: { azimuth: 0, elevation: 10 },
  back: { azimuth: 180, elevation: 10 },
  'left-profile': { azimuth: 90, elevation: 5 }, // shows the character's left side, it faces picture-left
  'right-profile': { azimuth: -90, elevation: 5 },
  'facing-lower-left': { azimuth: 45, elevation: 35 },
  'facing-lower-right': { azimuth: -45, elevation: 35 },
  'facing-upper-left': { azimuth: 135, elevation: 35 },
  'facing-upper-right': { azimuth: -135, elevation: 35 },
  'three-quarter-left': { azimuth: 35, elevation: 10 },
  'three-quarter-right': { azimuth: -35, elevation: 10 },
};

// frame: 'auto' keeps the same scale as a standing pose (consistent sprite frames) and only
// zooms out when a pose would leave the picture; 'fixed' never zooms; 'fit' always fills the frame.
export const DEFAULT_CAMERA = { view: 'facing-lower-left', fov: 30, fill: 0.82, frame: 'auto' };

const COLORS = {
  color: { body: 0xdedbd6, joint: 0x8d8a86, left: 0x2f6fe0, leftJoint: 0x1d4aa0, right: 0xe0422f, rightJoint: 0xa02a1d, mark: 0x333333 },
  plain: { body: 0xd8d6d2, joint: 0x9a9894, left: 0xd8d6d2, leftJoint: 0x9a9894, right: 0xd8d6d2, rightJoint: 0x9a9894, mark: 0x555555 },
};

/** Normalise a pose object: fills defaults, clamps values, resolves the camera view. */
export function normalizePose(pose = {}) {
  const joints = {};
  for (const [name, def] of Object.entries(JOINT_DEFS)) {
    const src = (pose.joints && pose.joints[name]) || {};
    const out = {};
    for (const [p, [min, max, dflt]] of Object.entries(def.params)) {
      const v = Number.isFinite(src[p]) ? src[p] : dflt;
      out[p] = Math.min(max, Math.max(min, v));
    }
    joints[name] = out;
  }
  const unknown = [];
  for (const [name, vals] of Object.entries(pose.joints || {})) {
    if (!JOINT_DEFS[name]) { unknown.push(name); continue; }
    for (const p of Object.keys(vals)) if (!(p in JOINT_DEFS[name].params)) unknown.push(`${name}.${p}`);
  }
  const build = { ...DEFAULT_BUILD, ...(pose.build || {}) };
  const camera = resolveCamera(pose.camera);
  const props = [];
  if (pose.propDefs) unknown.push(...registerProps(pose.propDefs)); // item types defined inside the pose
  (Array.isArray(pose.props) ? pose.props : []).forEach((p, i) => {
    const def = p && propDef(p.type);
    if (!def) { unknown.push(`props[${i}].type=${p && p.type}`); return; }
    const hands = (Array.isArray(p.hands) ? p.hands : [p.hands || 'right']).filter((h) => h === 'left' || h === 'right');
    const [minH, maxH] = def.hands;
    if (hands.length < minH || hands.length > maxH || (hands.length === 2 && hands[0] === hands[1])) {
      unknown.push(`props[${i}].hands (${p.type} takes ${minH === maxH ? minH : `${minH}-${maxH}`} hand${maxH > 1 ? 's' : ''})`);
      return;
    }
    const out = { type: p.type, hands, length: Number.isFinite(p.length) ? p.length : def.length };
    if (Number.isFinite(p.angle)) out.angle = p.angle; // turn the item around the palm (thumb/forearm attach), degrees
    if (Number.isFinite(p.width)) out.width = p.width;
    props.push(out);
  });
  const out = { name: pose.name || 'pose', intent: pose.intent || '', build, camera, joints, props, unknown };
  if (pose.propDefs) out.propDefs = pose.propDefs;
  // which foot is the forward one when the legs do not say it in 3D (set by the picture mirror)
  if (pose.stride && (pose.stride.front === 'left' || pose.stride.front === 'right')) out.stride = { front: pose.stride.front };
  return out;
}

export { CATALOG as PROP_CATALOG, PROP_TYPES, propDef, registerProps } from './prop-catalog.js';

export function resolveCamera(cam = {}) {
  const c = { ...DEFAULT_CAMERA, ...cam };
  const preset = VIEWS[c.view] || VIEWS[DEFAULT_CAMERA.view];
  return {
    ...c,
    azimuth: Number.isFinite(cam.azimuth) ? cam.azimuth : preset.azimuth,
    elevation: Number.isFinite(cam.elevation) ? cam.elevation : preset.elevation,
  };
}

const LEG_JOINTS = ['Hip', 'Knee', 'Ankle'];
const LEG_WORDS = 'legs?|foot|feet|knees?|hips?|ankles?|heels?|toes?|thighs?|shins?';

/** Swap left/right words in a free-text intent: every pair (mode 'all') or only before leg words ('legs'). */
export function swapIntent(text, mode = 'all') {
  if (!text) return text;
  const flip = (w) => ({ left: 'right', right: 'left', Left: 'Right', Right: 'Left', LEFT: 'RIGHT', RIGHT: 'LEFT' })[w] || w;
  if (mode === 'all') return text.replace(/\b(left|right|Left|Right|LEFT|RIGHT)\b/g, flip);
  const re = new RegExp(`\\b(left|right|Left|Right|LEFT|RIGHT)(\\s+(?:${LEG_WORDS})\\b)`, 'g');
  return text.replace(re, (_, w, rest) => flip(w) + rest);
}
const swapSide = (name) => (name.startsWith('left') ? 'right' + name.slice(4) : name.startsWith('right') ? 'left' + name.slice(5) : name);

/**
 * Swap the character's left and right.
 *  mode 'all'  (default): the whole body and the hands holding props swap (a true mirror image).
 *  mode 'legs': only the legs swap (walk frame A -> B while holding something). The waist turn
 *               follows the legs and the chest is counter-turned so arms, head and props stay put.
 */
export function mirrorPose(pose, mode = 'all') {
  if (mode !== 'all' && mode !== 'legs') throw new Error(`mirror mode must be 'all' or 'legs', not ${mode}`);
  const src = pose.joints || {};
  const joints = {};
  if (mode === 'legs') {
    for (const [name, vals] of Object.entries(src)) {
      const isLeg = LEG_JOINTS.some((j) => name.endsWith(j)) && (name.startsWith('left') || name.startsWith('right'));
      joints[isLeg ? swapSide(name) : name] = { ...vals };
    }
    const sp = src.spine || {};
    if (sp.twist || sp.side) {
      const ch = { ...(src.chest || {}) };
      if (sp.twist) ch.twist = (ch.twist || 0) + 2 * sp.twist;
      if (sp.side) ch.side = (ch.side || 0) + 2 * sp.side;
      joints.spine = { ...sp, ...(sp.twist ? { twist: -sp.twist } : {}), ...(sp.side ? { side: -sp.side } : {}) };
      joints.chest = ch;
    }
    return { ...pose, name: `${pose.name || 'pose'}-legs-mirrored`, intent: swapIntent(pose.intent, 'legs'), joints };
  }
  for (const [name, vals] of Object.entries(src)) {
    const v = { ...vals };
    if (name === 'root') { if ('yaw' in v) v.yaw = -v.yaw; if ('roll' in v) v.roll = -v.roll; }
    if (name === 'spine' || name === 'chest') { if ('side' in v) v.side = -v.side; if ('twist' in v) v.twist = -v.twist; }
    if (name === 'head') { if ('turn' in v) v.turn = -v.turn; if ('tilt' in v) v.tilt = -v.tilt; }
    joints[swapSide(name)] = v;
  }
  const out = { ...pose, name: `${pose.name || 'pose'}-mirrored`, intent: swapIntent(pose.intent, 'all'), joints };
  if (Array.isArray(pose.props)) out.props = pose.props.map((p) => ({ ...p, hands: (Array.isArray(p.hands) ? p.hands : [p.hands]).map(swapSide) }));
  return out;
}

function dims(build) {
  const k = Math.max(0.15, (build.headsTall - 1) / 6.5); // body length scale (1 at 7.5 heads)
  const g = (0.5 + 0.5 * Math.sqrt(k)) * build.girth; // girth shrinks slower than length (stubby chibi)
  return {
    k, g,
    neck: 0.3 * k, chest: 1.4 * k, abdomen: 1.15 * k,
    shoulderY: 1.15 * k, shoulderX: 0.95 * Math.max(0.55, Math.sqrt(k)) * build.shoulders,
    hipX: 0.42 * Math.max(0.6, Math.sqrt(k)) * build.hips, hipDrop: 0.12 * k,
    upperArm: 1.35 * k, forearm: 1.2 * k, hand: 0.72 * k,
    thigh: 1.85 * k, shin: 1.6 * k, ankle: 0.2 * k, foot: 1.0 * k,
    rArm: 0.19 * g, rFore: 0.16 * g, rWrist: 0.11 * g, rThigh: 0.3 * g, rKnee: 0.21 * g, rShin: 0.2 * g, rAnkle: 0.12 * g,
    chestW: 1.55 * g * build.shoulders, chestD: 0.85 * g, waistW: 1.05 * g, pelvisW: 1.35 * g * build.hips, pelvisD: 0.85 * g,
  };
}

/**
 * Build a doll. Returns { root, joints, points, meshes, build, d }.
 * style: 'color' (own-left limbs blue, own-right limbs red) or 'plain' (all grey).
 */
export function createDoll(build = DEFAULT_BUILD, style = 'color') {
  build = { ...DEFAULT_BUILD, ...build };
  const d = dims(build);
  const pal = COLORS[style] || COLORS.color;
  const mats = {};
  const mat = (hex) => (mats[hex] ||= new THREE.MeshStandardMaterial({ color: hex, roughness: 0.55, metalness: 0.05 }));
  const meshes = [];
  const joints = {};
  const points = {};

  const add = (parent, geo, color, pos = [0, 0, 0], part = '') => {
    const m = new THREE.Mesh(geo, mat(color));
    m.position.set(...pos);
    m.userData.part = part;
    parent.add(m);
    meshes.push(m);
    return m;
  };
  const ellipsoid = (rx, ry, rz) => new THREE.SphereGeometry(1, 28, 20).scale(rx, ry, rz);
  const sphere = (r) => new THREE.SphereGeometry(r, 20, 14);
  // A tapered segment hanging from its joint along -Y.
  const segment = (parent, len, r1, r2, color, part) =>
    add(parent, new THREE.CylinderGeometry(r1, r2, len, 20), color, [0, -len / 2, 0], part);
  const point = (parent, name, pos) => {
    const o = new THREE.Object3D();
    o.position.set(...pos);
    parent.add(o);
    points[name] = o;
    return o;
  };
  const joint = (parent, name, pos) => {
    const o = new THREE.Group();
    o.name = name;
    o.position.set(...pos);
    parent.add(o);
    joints[name] = o;
    return o;
  };

  const root = new THREE.Group();
  root.name = 'doll';
  const hips = joint(root, 'root', [0, 0, 0]);
  // pelvis
  add(hips, ellipsoid(d.pelvisW / 2, 0.42 * d.k + 0.1, d.pelvisD / 2), pal.body, [0, 0.12 * d.k, 0], 'root');
  point(hips, 'pelvis', [0, 0, 0]);
  const spine = joint(hips, 'spine', [0, 0.4 * d.abdomen, 0]);
  add(spine, ellipsoid(d.waistW / 2, 0.5 * d.abdomen, 0.38 * d.g), pal.body, [0, 0.3 * d.abdomen, 0], 'spine');
  const chest = joint(spine, 'chest', [0, 0.6 * d.abdomen, 0]);
  add(chest, ellipsoid(d.chestW / 2, d.chest / 2, d.chestD / 2), pal.body, [0, d.chest * 0.55, 0], 'chest');
  // sternum mark: shows which way the chest faces
  add(chest, new THREE.BoxGeometry(0.12 * d.g, 0.55 * d.k, 0.05), pal.mark, [0, d.chest * 0.6, d.chestD / 2 - 0.01], 'chest');
  point(chest, 'chestFront', [0, d.chest * 0.6, d.chestD / 2]);
  point(chest, 'chestCenter', [0, d.chest * 0.6, 0]);
  const neckBase = [0, d.chest + 0.02, 0];
  const head = joint(chest, 'head', neckBase);
  add(head, new THREE.CylinderGeometry(0.17 * d.g + 0.04, 0.2 * d.g + 0.04, d.neck + 0.15, 16), pal.joint, [0, (d.neck + 0.15) / 2 - 0.08, 0], 'head');
  const headC = [0, d.neck + 0.5, 0.03];
  add(head, ellipsoid(0.4, 0.5, 0.45), pal.body, headC, 'head');
  // face: nose and a visor band so the facing is always readable
  add(head, new THREE.ConeGeometry(0.06, 0.16, 12).rotateX(Math.PI / 2), pal.mark, [0, headC[1] - 0.02, headC[2] + 0.48], 'head');
  add(head, new THREE.BoxGeometry(0.5, 0.08, 0.1), pal.mark, [0, headC[1] + 0.1, headC[2] + 0.4], 'head');
  point(head, 'headTop', [0, headC[1] + 0.5, headC[2]]);
  point(head, 'headCenter', headC);
  point(head, 'face', [0, headC[1], headC[2] + 0.5]);

  for (const side of ['left', 'right']) {
    const s = side === 'left' ? 1 : -1;
    const c = side === 'left' ? pal.left : pal.right;
    const cj = side === 'left' ? pal.leftJoint : pal.rightJoint;
    // arm
    const sh = joint(chest, `${side}Shoulder`, [s * d.shoulderX, d.shoulderY, 0]);
    add(sh, sphere(d.rArm * 1.25), cj, [0, 0, 0], `${side}Shoulder`);
    segment(sh, d.upperArm, d.rArm, d.rFore * 1.05, c, `${side}Shoulder`);
    point(sh, `${side}ShoulderPt`, [0, 0, 0]);
    const el = joint(sh, `${side}Elbow`, [0, -d.upperArm, 0]);
    add(el, sphere(d.rFore * 1.15), cj, [0, 0, 0], `${side}Elbow`);
    segment(el, d.forearm, d.rFore, d.rWrist, c, `${side}Elbow`);
    point(el, `${side}ElbowPt`, [0, 0, 0]);
    const wr = joint(el, `${side}Wrist`, [0, -d.forearm, 0]);
    add(wr, sphere(d.rWrist * 1.1), cj, [0, 0, 0], `${side}Wrist`);
    point(wr, `${side}WristPt`, [0, 0, 0]);
    // hand: palm faces the body (-s X), thumb points forward (+Z)
    const pw = 0.3 * d.g + 0.05; // palm width (along Z)
    const pt = 0.12 * d.g + 0.03; // thickness (along X)
    const palmLen = d.hand * 0.5;
    add(wr, new THREE.BoxGeometry(pt, palmLen, pw), c, [0, -palmLen / 2 - 0.02, 0], `${side}Wrist`);
    const thumb = new THREE.Group();
    thumb.position.set(-s * pt * 0.2, -0.05, pw * 0.45);
    thumb.rotation.set(R(-35), 0, -s * R(20));
    wr.add(thumb);
    add(thumb, new THREE.BoxGeometry(pt * 0.8, palmLen * 0.8, pt * 0.9), c, [0, -palmLen * 0.4, 0], `${side}Wrist`);
    const fingers = new THREE.Group();
    fingers.position.set(0, -palmLen - 0.02, -pw * 0.15);
    wr.add(fingers);
    add(fingers, new THREE.BoxGeometry(pt * 0.9, d.hand * 0.5, pw * 0.7), c, [0, -d.hand * 0.25, 0], `${side}Wrist`);
    const index = new THREE.Group();
    index.position.set(0, -palmLen - 0.02, pw * 0.36);
    wr.add(index);
    add(index, new THREE.BoxGeometry(pt * 0.8, d.hand * 0.52, pw * 0.26), c, [0, -d.hand * 0.26, 0], `${side}Wrist`);
    wr.userData.fingers = fingers;
    wr.userData.index = index;
    point(wr, `${side}Hand`, [0, -palmLen, 0]);
    point(index, `${side}Fingertip`, [0, -d.hand * 0.52, 0]);

    // leg
    const hp = joint(hips, `${side}Hip`, [s * d.hipX, -d.hipDrop, 0]);
    add(hp, sphere(d.rThigh * 1.05), cj, [0, 0, 0], `${side}Hip`);
    segment(hp, d.thigh, d.rThigh, d.rKnee, c, `${side}Hip`);
    point(hp, `${side}HipPt`, [0, 0, 0]);
    const kn = joint(hp, `${side}Knee`, [0, -d.thigh, 0]);
    add(kn, sphere(d.rKnee * 1.1), cj, [0, 0, 0], `${side}Knee`);
    segment(kn, d.shin, d.rShin, d.rAnkle, c, `${side}Knee`);
    point(kn, `${side}KneePt`, [0, 0, 0]);
    const an = joint(kn, `${side}Ankle`, [0, -d.shin, 0]);
    add(an, sphere(d.rAnkle * 1.2), cj, [0, 0, 0], `${side}Ankle`);
    const fw = 0.3 * d.g + 0.06;
    add(an, new THREE.BoxGeometry(fw, d.ankle * 1.1, d.foot), c, [0, -d.ankle * 0.5, d.foot * 0.3], `${side}Ankle`);
    point(an, `${side}AnklePt`, [0, 0, 0]);
    point(an, `${side}Heel`, [0, -d.ankle * 1.05, -d.foot * 0.2]);
    point(an, `${side}Toe`, [0, -d.ankle * 1.05, d.foot * 0.8]);
  }
  root.updateMatrixWorld(true);
  return { root, joints, points, meshes, build, style, d };
}

const qAxis = (x, y, z, deg) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(x, y, z).normalize(), R(deg));

// Rotation that lifts a limb hanging along -Y by `raise` degrees in the vertical plane
// pointing at `dir` (0 = forward, 90 = toward the limb's own side), then rolls it by `twist`.
function limbQuat(raise, dir, twist, s) {
  const hx = s * Math.sin(R(dir));
  const hz = Math.cos(R(dir));
  const swing = qAxis(-hz, 0, hx, raise);
  return swing.multiply(qAxis(0, 1, 0, s * twist));
}

/** Apply a (normalised or raw) pose to a doll built by createDoll. Grounds the doll on y = 0. */
export function applyPose(doll, rawPose) {
  const pose = rawPose.joints && rawPose.unknown ? rawPose : normalizePose(rawPose);
  const J = pose.joints;
  const j = doll.joints;
  const euler = (o, bend, side, twist) => {
    o.quaternion.copy(qAxis(0, 1, 0, twist)).multiply(qAxis(1, 0, 0, bend)).multiply(qAxis(0, 0, 1, -side));
  };
  euler(j.root, J.root.pitch, J.root.roll, J.root.yaw);
  euler(j.spine, J.spine.bend, J.spine.side, J.spine.twist);
  euler(j.chest, J.chest.bend, J.chest.side, J.chest.twist);
  euler(j.head, J.head.nod, J.head.tilt, J.head.turn);
  for (const side of ['left', 'right']) {
    const s = side === 'left' ? 1 : -1;
    const sh = J[`${side}Shoulder`];
    j[`${side}Shoulder`].quaternion.copy(limbQuat(sh.raise, sh.dir, sh.twist, s));
    j[`${side}Elbow`].quaternion.copy(qAxis(1, 0, 0, -J[`${side}Elbow`].bend)).multiply(qAxis(0, 1, 0, s * J[`${side}Elbow`].twist));
    const w = J[`${side}Wrist`];
    j[`${side}Wrist`].quaternion.copy(qAxis(0, 0, 1, -s * w.bend)).multiply(qAxis(1, 0, 0, -w.side));
    const curl = (w.grip / 100) * 100;
    j[`${side}Wrist`].userData.fingers.quaternion.copy(qAxis(0, 0, 1, -s * curl));
    j[`${side}Wrist`].userData.index.quaternion.copy(qAxis(0, 0, 1, -s * (w.point >= 0.5 ? 0 : curl)));
    const hp = J[`${side}Hip`];
    j[`${side}Hip`].quaternion.copy(limbQuat(hp.raise, hp.dir, hp.twist, s));
    j[`${side}Knee`].quaternion.copy(qAxis(1, 0, 0, J[`${side}Knee`].bend));
    j[`${side}Ankle`].quaternion.copy(qAxis(1, 0, 0, -J[`${side}Ankle`].bend));
  }
  // ground: lowest point of the body sits on y = lift
  j.root.position.set(0, 0, 0);
  doll.root.position.set(0, 0, 0);
  doll.root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(doll.root);
  doll.root.position.y = -box.min.y + J.root.lift;
  doll.root.updateMatrixWorld(true);
  doll.pose = pose;
  return pose;
}

/** Standing height of the doll (for fixed framing). */
export function standingHeight(doll) {
  const d = doll.d;
  return d.hipDrop + d.thigh + d.shin + d.ankle + 0.12 * d.k + 0.4 * d.abdomen + 0.6 * d.abdomen + d.chest + d.neck + 1.0;
}

export function worldPoint(doll, name) {
  return doll.points[name].getWorldPosition(new THREE.Vector3());
}

/** Place a perspective camera according to pose.camera. */
export function frameCamera(camera, doll, cam, extra = []) {
  const c = resolveCamera(cam);
  camera.fov = c.fov;
  const H = standingHeight(doll);
  const bbox = new THREE.Box3().setFromObject(doll.root);
  for (const o of extra) if (o) bbox.union(new THREE.Box3().setFromObject(o));
  const az = R(c.azimuth);
  const el = R(c.elevation);
  const place = (target, dist) => {
    camera.position.set(
      target.x + dist * Math.cos(el) * Math.sin(az),
      target.y + dist * Math.sin(el),
      target.z + dist * Math.cos(el) * Math.cos(az),
    );
    camera.up.set(0, 1, 0);
    camera.lookAt(target);
    camera.near = dist / 50;
    camera.far = dist * 10;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
  };
  if (c.frame === 'fit') {
    const sphere = bbox.getBoundingSphere(new THREE.Sphere());
    place(sphere.center, sphere.radius / Math.tan(R(c.fov) / 2) / c.fill);
    return c;
  }
  // 'fixed' / 'auto': a STANDING figure of this build fills `fill` of the picture height,
  // so every pose of a set is drawn at the same scale (consistent sprite frames).
  const target = new THREE.Vector3(0, H * 0.5, 0);
  // reference silhouette of a standing figure: head top and the toes / heels on the ground
  const d = doll.d;
  const refTop = [new THREE.Vector3(0, H, 0)];
  const refFoot = [];
  for (const x of [-d.hipX * 1.3, d.hipX * 1.3]) for (const z of [-d.foot * 0.25, d.foot * 0.85]) refFoot.push(new THREE.Vector3(x, 0, z));
  const span = () => {
    const ys = (arr) => arr.map((p) => p.clone().project(camera).y);
    const t = Math.max(...ys(refTop));
    const b = Math.min(...ys(refFoot));
    return { t, b, h: (t - b) / 2, mid: (t + b) / 2 };
  };
  const filled = (dist) => { place(target, dist); return span().h; };
  let lo = H * 0.3;
  let hi = H * 200;
  for (let i = 0; i < 40; i++) {
    const mid = Math.sqrt(lo * hi);
    if (filled(mid) > c.fill) lo = mid;
    else hi = mid;
  }
  // centre the standing figure vertically (a few correction steps)
  for (let i = 0; i < 4; i++) {
    place(target, hi);
    target.y += (span().mid * H) / (2 * c.fill);
  }
  let dist = hi;
  place(target, dist);
  if (c.frame === 'auto') {
    // zoom out only when this pose would leave the picture (jumps, raised arms): test real vertices
    const pts = [];
    const v = new THREE.Vector3();
    const collect = (m) => {
      const pos = m.geometry && m.geometry.attributes.position;
      if (!pos) return;
      const step = Math.max(1, Math.floor(pos.count / 60));
      for (let i = 0; i < pos.count; i += step) pts.push(v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld).clone());
    };
    doll.meshes.forEach(collect);
    for (const o of extra) if (o) o.traverse((m) => m.isMesh && collect(m));
    for (let i = 0; i < 80; i++) {
      const out = pts.some((p) => { const q = p.clone().project(camera); return Math.abs(q.x) > 0.995 || Math.abs(q.y) > 0.995; });
      if (!out) break;
      dist *= 1.02;
      place(target, dist);
    }
  }
  return c;
}
