// Back views: open the hips when the legs would cross or hide each other in the picture.
// Image models redraw crossed legs uncrossed (each foot on its own hip's side), which turns
// stride B into stride A; opening the hips gives a picture they draw as intended.
import * as THREE from 'three';
import { createDoll, applyPose, frameCamera, normalizePose } from './doll.js';
import { describePose } from './describe.js';

const bad = (f) => f.backView && f.front && (f.legsCross || f.feetOverlap || Math.abs(f.feetDx) < 0.04);

/** Returns { pose, changed, steps, facts }. Only poses seen from behind are changed. */
export function uncrossLegs(rawPose) {
  let pose = structuredClone(rawPose);
  pose.joints = pose.joints || {};
  const norm = normalizePose(pose);
  const doll = createDoll(norm.build);
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  const look = (p) => { applyPose(doll, p); frameCamera(camera, doll, normalizePose(p).camera); return describePose(doll, camera).facts; };
  let facts = look(pose);
  if (!bad(facts)) return { pose, changed: false, steps: 0, facts };
  const front = facts.front;
  const back = front === 'left' ? 'right' : 'left';
  const J = norm.joints;
  const [f0, b0, fr, br] = [J[`${front}Hip`].dir, J[`${back}Hip`].dir, J[`${front}Hip`].raise, J[`${back}Hip`].raise];
  let steps = 0;
  for (; steps < 8 && bad(facts); steps++) {
    // open sideways, and raise a little more so the stride along the walking direction is kept
    const fd = Math.min(75, f0 + 10 * (steps + 1));
    const bd = Math.max(115, b0 - 8 * (steps + 1));
    pose = structuredClone(pose);
    pose.joints[`${front}Hip`] = { ...(pose.joints[`${front}Hip`] || {}), dir: fd, raise: Math.round(fr + 0.06 * (fd - f0)) };
    pose.joints[`${back}Hip`] = { ...(pose.joints[`${back}Hip`] || {}), dir: bd, raise: Math.round(br + 0.05 * (b0 - bd)) };
    facts = look(pose);
  }
  if (pose.intent && !/do not cross/.test(pose.intent)) pose.intent += ' (legs opened outward so that they do not cross in this back view)';
  return { pose, changed: true, steps, facts };
}
