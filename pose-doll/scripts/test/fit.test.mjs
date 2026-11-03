// The photo fit recovers a known pose from synthetic MediaPipe-style landmarks.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { createDoll, applyPose, worldPoint } from '../src/doll.js';
import { fitPose, MP, landmarksToBody } from '../src/fit.js';

const POSES = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'poses');
const load = (n) => JSON.parse(fs.readFileSync(path.join(POSES, `${n}.json`), 'utf8'));

// landmarks of a posed doll, as MediaPipe would report them (y down, z away from the camera), turned by `yaw`
function fakeLandmarks(pose, yawDeg) {
  const doll = createDoll({ headsTall: 7.5 });
  applyPose(doll, pose);
  const P = (n) => worldPoint(doll, n);
  const hq = doll.joints.head.getWorldQuaternion(new THREE.Quaternion());
  const ear = (s) => P('headCenter').add(new THREE.Vector3(0.38 * s, 0, 0).applyQuaternion(hq));
  const hand = (side, s) => P(`${side}Hand`).add(new THREE.Vector3(0, 0, 0.12 * s).applyQuaternion(doll.joints[`${side}Wrist`].getWorldQuaternion(new THREE.Quaternion())));
  const pts = {
    nose: P('face'), lEar: ear(1), rEar: ear(-1), lShoulder: P('leftShoulderPt'), rShoulder: P('rightShoulderPt'),
    lElbow: P('leftElbowPt'), rElbow: P('rightElbowPt'), lWrist: P('leftWristPt'), rWrist: P('rightWristPt'),
    lIndex: hand('left', 1), lPinky: hand('left', -1), rIndex: hand('right', 1), rPinky: hand('right', -1),
    lHip: P('leftHipPt'), rHip: P('rightHipPt'), lKnee: P('leftKneePt'), rKnee: P('rightKneePt'),
    lAnkle: P('leftAnklePt'), rAnkle: P('rightAnklePt'), lHeel: P('leftHeel'), rHeel: P('rightHeel'), lFoot: P('leftToe'), rFoot: P('rightToe'),
  };
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(yawDeg));
  const world = Array.from({ length: 33 }, () => [0, 0, 0, 0]);
  for (const [k, i] of Object.entries(MP)) {
    const v = pts[k].clone().applyQuaternion(q).multiplyScalar(0.23); // metres-ish
    world[i] = [v.x, -v.y, -v.z, 0.99];
  }
  return { world, doll };
}

test('landmarks are turned so the body faces +Z with its own left at +X', () => {
  const { world } = fakeLandmarks({}, 70);
  const { points, cameraAzimuth } = landmarksToBody(world);
  assert.ok(points.lHip.x > 0 && points.rHip.x < 0);
  assert.ok(Math.abs(points.lHip.z) < 1e-6);
  assert.ok(Math.abs(cameraAzimuth - -70) < 1 || Math.abs(cameraAzimuth - 290) < 1, `azimuth ${cameraAzimuth}`);
});

for (const name of ['walk-ready-a', 'run', 'crouch', 'sword-shield-ready']) {
  test(`fit recovers ${name}`, () => {
    const src = load(name);
    const { world } = fakeLandmarks(src, 35);
    const r = fitPose(world, { build: { headsTall: 7.5 } });
    assert.ok(r.error.mean <= 4, `mean bone error ${r.error.mean} deg: ${JSON.stringify(r.error.bones)}`);
    const worst = Math.max(...Object.values(r.error.bones));
    assert.ok(worst <= 12, `worst bone ${worst} deg`);
  });
}
