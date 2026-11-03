// Fit mannequin joint angles to 3D body landmarks (MediaPipe Pose "world landmarks", 33 points).
// The landmarks are turned so the body faces +Z, then every joint angle is searched (coordinate
// descent) so that the mannequin's bones point the same way as the landmark bones.
import * as THREE from 'three';
import { createDoll, applyPose, normalizePose, worldPoint, JOINT_DEFS } from './doll.js';

// MediaPipe Pose landmark indices
export const MP = {
  nose: 0, lEar: 7, rEar: 8, lShoulder: 11, rShoulder: 12, lElbow: 13, rElbow: 14, lWrist: 15, rWrist: 16,
  lPinky: 17, rPinky: 18, lIndex: 19, rIndex: 20, lHip: 23, rHip: 24, lKnee: 25, rKnee: 26,
  lAnkle: 27, rAnkle: 28, lHeel: 29, rHeel: 30, lFoot: 31, rFoot: 32,
};

const V = (a) => new THREE.Vector3(a[0], a[1], a[2]);
const mid = (a, b) => a.clone().add(b).multiplyScalar(0.5);

/**
 * world: [[x, y, z, visibility], ...] in MediaPipe world coordinates (metres, x right, y down, z away from the camera).
 * Returns { points (name -> Vector3 in doll space, facing +Z), vis (name -> 0..1), cameraAzimuth }.
 */
export function landmarksToBody(world) {
  // to Y-up with +Z toward the camera
  const P = world.map(([x, y, z]) => new THREE.Vector3(x, -y, -z));
  const vis = world.map((w) => (w.length > 3 ? w[3] : 1));
  const g = (k) => P[MP[k]];
  // yaw: the hip line (own right -> own left) becomes +X, so the body faces +Z
  const across = g('lHip').clone().sub(g('rHip')).add(g('lShoulder').clone().sub(g('rShoulder'))).setY(0);
  const yaw = Math.atan2(across.z, across.x); // rotate by +yaw about Y maps `across` onto +X
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
  const origin = mid(g('lHip'), g('rHip'));
  const points = {};
  const v = {};
  for (const [k, i] of Object.entries(MP)) {
    points[k] = P[i].clone().sub(origin).applyQuaternion(q);
    v[k] = vis[i];
  }
  const cam = new THREE.Vector3(0, 0, 1).applyQuaternion(q); // where the camera sits, seen from the body
  return { points, vis: v, cameraAzimuth: THREE.MathUtils.radToDeg(Math.atan2(cam.x, cam.z)) };
}

// bone list: [weight, landmark from, landmark to, doll point from, doll point to]
// landmark entries may be a name or [a, b] (midpoint)
const BONES = [
  [3, 'rHip', 'lHip', 'rightHipPt', 'leftHipPt', 'torso'],
  [3, ['lHip', 'rHip'], ['lShoulder', 'rShoulder'], 'pelvis', ['leftShoulderPt', 'rightShoulderPt'], 'torso'],
  [3, 'rShoulder', 'lShoulder', 'rightShoulderPt', 'leftShoulderPt', 'torso'],
  [1.5, ['lShoulder', 'rShoulder'], ['lEar', 'rEar'], ['leftShoulderPt', 'rightShoulderPt'], 'headCenter', 'torso'],
  [1.5, ['lEar', 'rEar'], 'nose', 'headCenter', 'face', 'torso'],
  [2, 'lShoulder', 'lElbow', 'leftShoulderPt', 'leftElbowPt', 'leftArm'],
  [2, 'rShoulder', 'rElbow', 'rightShoulderPt', 'rightElbowPt', 'rightArm'],
  [2, 'lElbow', 'lWrist', 'leftElbowPt', 'leftWristPt', 'leftArm'],
  [2, 'rElbow', 'rWrist', 'rightElbowPt', 'rightWristPt', 'rightArm'],
  [0.5, 'lWrist', ['lIndex', 'lPinky'], 'leftWristPt', 'leftHand', 'leftArm'],
  [0.5, 'rWrist', ['rIndex', 'rPinky'], 'rightWristPt', 'rightHand', 'rightArm'],
  [2, 'lHip', 'lKnee', 'leftHipPt', 'leftKneePt', 'leftLeg'],
  [2, 'rHip', 'rKnee', 'rightHipPt', 'rightKneePt', 'rightLeg'],
  [2, 'lKnee', 'lAnkle', 'leftKneePt', 'leftAnklePt', 'leftLeg'],
  [2, 'rKnee', 'rAnkle', 'rightKneePt', 'rightAnklePt', 'rightLeg'],
  [1, 'lHeel', 'lFoot', 'leftHeel', 'leftToe', 'leftLeg'],
  [1, 'rHeel', 'rFoot', 'rightHeel', 'rightToe', 'rightLeg'],
];

// the parameters searched (grip / point / lift are left to the user)
const SEARCH = [];
for (const [j, def] of Object.entries(JOINT_DEFS)) {
  for (const p of Object.keys(def.params)) {
    if (['grip', 'point', 'lift'].includes(p)) continue;
    if (j.endsWith('Wrist') && p === 'side') continue;
    SEARCH.push([j, p]);
  }
}

/**
 * Fit joint angles. Returns { pose, error: { total, bones: {name: degrees} }, cameraAzimuth }.
 * opts: { build, base (pose to start from), regularize (default 0.000002 per degree^2), passes }
 */
export function fitPose(world, opts = {}) {
  const { points, vis, cameraAzimuth } = landmarksToBody(world);
  const doll = createDoll(opts.build || { headsTall: 7.5 });
  const lm = (k) => (Array.isArray(k) ? mid(points[k[0]], points[k[1]]) : points[k]);
  const lv = (k) => (Array.isArray(k) ? Math.min(vis[k[0]], vis[k[1]]) : vis[k]);
  const dp = (k) => (Array.isArray(k) ? mid(worldPoint(doll, k[0]), worldPoint(doll, k[1])) : worldPoint(doll, k));
  const targets = BONES.map(([w, a, b, da, db, group]) => {
    const dir = lm(b).clone().sub(lm(a));
    const conf = Math.max(0, Math.min(1, (Math.min(lv(a), lv(b)) - 0.2) / 0.6));
    return { w: w * conf, dir: dir.lengthSq() > 1e-10 ? dir.normalize() : null, da, db, group, name: `${da}->${db}` };
  }).filter((t) => t.dir && t.w > 0);

  const pose = { joints: structuredClone(opts.base?.joints || {}), props: [] };
  const reg = opts.regularize ?? 0.000002;
  const get = (j, p) => pose.joints[j]?.[p] ?? JOINT_DEFS[j].params[p][2];
  const set = (j, p, v) => {
    const [lo, hi] = JOINT_DEFS[j].params[p];
    pose.joints[j] = { ...(pose.joints[j] || {}), [p]: Math.max(lo, Math.min(hi, v)) };
  };
  const costOf = (bones, params) => {
    applyPose(doll, pose);
    let c = 0;
    for (const t of bones) {
      const d = dp(t.db).sub(dp(t.da)).normalize();
      c += t.w * (1 - d.dot(t.dir));
    }
    for (const [j, p] of params) {
      const v = get(j, p) - JOINT_DEFS[j].params[p][2];
      c += reg * v * v;
    }
    if (params.some(([j]) => j === 'spine' || j === 'chest')) {
      // keep the bend shared between waist and chest instead of piling it into one joint
      for (const p of ['bend', 'side', 'twist']) c += reg * 2 * (get('spine', p) - get('chest', p)) ** 2;
    }
    return c;
  };
  const descend = (bones, params, steps = [24, 12, 6, 3, 1]) => {
    let best = costOf(bones, params);
    for (const step of steps) {
      for (let pass = 0; pass < (opts.passes || 6); pass++) {
        let improved = false;
        for (const [j, p] of params) {
          const cur = get(j, p);
          for (const dv of [step, -step]) {
            set(j, p, cur + dv);
            const c = costOf(bones, params);
            if (c < best - 1e-9) { best = c; improved = true; break; }
            set(j, p, cur);
          }
        }
        if (!improved) break;
      }
    }
    return best;
  };
  const P = (j) => SEARCH.filter(([jj]) => jj === j);

  // 1. torso: pelvis, spine, chest, head
  const torsoBones = targets.filter((t) => t.group === 'torso');
  const torsoParams = [...P('root'), ...P('spine'), ...P('chest'), ...P('head')];
  descend(torsoBones, torsoParams);

  // 2. limbs, each on its own: analytic start in the parent's frame, then several twists
  const limb = (side, kind) => {
    const s = side === 'left' ? 1 : -1;
    const L = side === 'left' ? 'l' : 'r';
    const [j1, j2, j3] = kind === 'arm' ? [`${side}Shoulder`, `${side}Elbow`, `${side}Wrist`] : [`${side}Hip`, `${side}Knee`, `${side}Ankle`];
    const [a, b, c] = kind === 'arm' ? [`${L}Shoulder`, `${L}Elbow`, `${L}Wrist`] : [`${L}Hip`, `${L}Knee`, `${L}Ankle`];
    if (Math.min(vis[a], vis[b]) < 0.3) return;
    applyPose(doll, pose);
    const parent = (kind === 'arm' ? doll.joints.chest : doll.joints.root).getWorldQuaternion(new THREE.Quaternion()).invert();
    const d1 = points[b].clone().sub(points[a]).normalize().applyQuaternion(parent);
    const d2 = points[c].clone().sub(points[b]).normalize().applyQuaternion(parent);
    const raise = THREE.MathUtils.radToDeg(Math.acos(Math.max(-1, Math.min(1, -d1.y))));
    let dir = THREE.MathUtils.radToDeg(Math.atan2(s * d1.x, d1.z));
    if (dir < -90) dir += 360; // the joint range is -90..180 (backward swings come out as -180..-90)
    const bend = THREE.MathUtils.radToDeg(d1.angleTo(d2));
    const bones = targets.filter((t) => t.group === side + (kind === 'arm' ? 'Arm' : 'Leg'));
    const params = [...P(j1), ...P(j2), ...P(j3)];
    let best = null;
    const starts = kind === 'arm' ? [-80, -40, 0, 40, 80].flatMap((t) => [-45, 0, 45].map((e) => [t, e])) : [-40, 0, 40].map((t) => [t, 0]);
    for (const [tw, etw] of starts) {
      set(j1, 'raise', raise);
      set(j1, 'dir', raise < 3 ? 0 : dir);
      set(j1, 'twist', tw);
      set(j2, 'bend', bend);
      if (kind === 'arm') set(j2, 'twist', etw);
      const c = descend(bones, params, [12, 6, 3, 1]);
      if (!best || c < best.c) best = { c, vals: params.map(([j, p]) => [j, p, get(j, p)]) };
    }
    for (const [j, p, v] of best.vals) set(j, p, v);
  };
  for (const side of ['left', 'right']) { limb(side, 'arm'); limb(side, 'leg'); }

  // 3. everything together, fine steps
  descend(targets, SEARCH, [3, 1]);

  // tidy: integers, drop zeros
  const joints = {};
  for (const [j, vals] of Object.entries(pose.joints)) {
    const o = {};
    for (const [p, v] of Object.entries(vals)) if (Math.round(v) !== 0) o[p] = Math.round(v);
    if (Object.keys(o).length) joints[j] = o;
  }
  applyPose(doll, { joints });
  const bones = {};
  let total = 0;
  for (const t of targets) {
    const d = dp(t.db).sub(dp(t.da)).normalize();
    const e = THREE.MathUtils.radToDeg(d.angleTo(t.dir));
    bones[t.name] = Math.round(e);
    total += e * t.w;
  }
  const wsum = targets.reduce((s, t) => s + t.w, 0) || 1;
  return { pose: normalizeOut(joints), error: { mean: Math.round(total / wsum), bones }, cameraAzimuth: Math.round(cameraAzimuth) };
}

function normalizeOut(joints) {
  normalizePose({ joints }); // validates the names
  return { joints };
}
