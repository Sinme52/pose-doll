// Stride B as the left-right mirror image of stride A IN THE PICTURE, for one camera view.
// A's leg bones are reflected in the vertical plane that contains the camera's line of sight
// (that reflection is exactly a left-right flip of the picture), A's left leg becoming B's right
// leg and vice versa. The upper body, the feet's own angle (ankles) and everything else stay as in B.
// Seen from behind, this turns a forward/backward stride into legs that open sideways in 3D, which
// is what makes the two strides look alike in the picture and keeps the legs from crossing.
import * as THREE from 'three';
import { createDoll, applyPose, frameCamera, normalizePose, worldPoint, JOINT_DEFS } from './doll.js';

/** a, b: poses. view: camera view of the picture. Returns { pose, error (head heights) }. */
export function pictureMirrorLegs(a, b, view) {
  const na = normalizePose(a);
  const cam = view ? { view } : na.camera;
  const doll = createDoll(na.build);
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  applyPose(doll, a);
  frameCamera(camera, doll, cam);
  const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0).setY(0).normalize(); // picture-right, horizontal
  const reflect = (v) => v.clone().sub(right.clone().multiplyScalar(2 * v.dot(right)));
  const target = {};
  for (const [from, to] of [['left', 'right'], ['right', 'left']]) {
    const hip = worldPoint(doll, `${from}HipPt`);
    target[to] = {
      knee: reflect(worldPoint(doll, `${from}KneePt`).sub(hip)),
      ankle: reflect(worldPoint(doll, `${from}AnklePt`).sub(hip)),
      ankleBend: na.joints[`${from}Ankle`].bend,
    };
  }
  const pose = structuredClone(b);
  pose.joints = pose.joints || {};
  const get = (j, p) => pose.joints[j]?.[p] ?? JOINT_DEFS[j].params[p][2];
  const set = (j, p, v) => {
    const [lo, hi] = JOINT_DEFS[j].params[p];
    pose.joints[j] = { ...(pose.joints[j] || {}), [p]: Math.max(lo, Math.min(hi, Math.round(v))) };
  };
  let total = 0;
  for (const side of ['left', 'right']) {
    set(`${side}Ankle`, 'bend', target[side].ankleBend);
    const params = [[`${side}Hip`, 'raise'], [`${side}Hip`, 'dir'], [`${side}Hip`, 'twist'], [`${side}Knee`, 'bend']];
    const cost = () => {
      applyPose(doll, pose);
      const hip = worldPoint(doll, `${side}HipPt`);
      return worldPoint(doll, `${side}KneePt`).sub(hip).distanceToSquared(target[side].knee)
        + worldPoint(doll, `${side}AnklePt`).sub(hip).distanceToSquared(target[side].ankle);
    };
    let best = null;
    for (const dir of [-60, 0, 60, 120, 180]) for (const tw of [-40, 0, 40]) {
      set(`${side}Hip`, 'dir', dir); set(`${side}Hip`, 'raise', 20); set(`${side}Hip`, 'twist', tw); set(`${side}Knee`, 'bend', 20);
      let c = cost();
      for (const step of [16, 8, 4, 2, 1]) {
        for (let pass = 0; pass < 10; pass++) {
          let improved = false;
          for (const [j, p] of params) {
            const cur = get(j, p);
            for (const dv of [step, -step]) {
              set(j, p, cur + dv);
              const cc = cost();
              if (cc < c - 1e-12) { c = cc; improved = true; break; }
              set(j, p, cur);
            }
          }
          if (!improved) break;
        }
      }
      if (!best || c < best.c) best = { c, vals: params.map(([j, p]) => [j, p, get(j, p)]) };
    }
    for (const [j, p, v] of best.vals) set(j, p, v);
    total += best.c;
  }
  // A's forward foot, flipped: B's forward foot is the other one
  const fa = na.joints;
  const aFront = fa.leftHip.dir < 90 && fa.leftHip.raise >= fa.rightHip.raise * 0.5 ? 'left' : 'right';
  pose.stride = { front: aFront === 'left' ? 'right' : 'left' };
  return { pose, error: Math.sqrt(total / 4) };
}
