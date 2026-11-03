import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { createDoll, applyPose, normalizePose, mirrorPose, worldPoint, frameCamera, JOINT_DEFS } from '../src/doll.js';
import { describePose } from '../src/describe.js';

const POSES = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'poses');
const doll = createDoll();
const pt = (n) => worldPoint(doll, n);
const near = (a, b, eps = 0.05) => Math.abs(a - b) < eps;

function view(pose, cam) {
  applyPose(doll, pose);
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  frameCamera(camera, doll, cam || pose.camera);
  return describePose(doll, camera);
}

test('normalizePose fills defaults, clamps and reports unknown keys', () => {
  const p = normalizePose({ joints: { leftElbow: { bend: 999 }, leftKnee: { wiggle: 1 }, tail: {} } });
  assert.equal(p.joints.leftElbow.bend, JOINT_DEFS.leftElbow.params.bend[1]);
  assert.equal(p.joints.rightElbow.bend, 0);
  assert.deepEqual(p.unknown.sort(), ['leftKnee.wiggle', 'tail']);
});

test('the doll stands on the ground and faces +Z with its own left at +X', () => {
  applyPose(doll, {});
  const minY = new THREE.Box3().setFromObject(doll.root).min.y;
  assert.ok(near(minY, 0, 1e-6));
  assert.ok(pt('leftShoulderPt').x > 0 && pt('rightShoulderPt').x < 0);
  assert.ok(pt('face').z > pt('headCenter').z);
});

test('limb raise/dir: forward, out to the side and straight up', () => {
  applyPose(doll, { joints: { leftShoulder: { raise: 90, dir: 0 } } });
  let d = pt('leftHand').sub(pt('leftShoulderPt'));
  assert.ok(d.z > 1 && near(d.y, 0, 0.1) && near(d.x, 0, 0.1), `forward ${d.toArray()}`);
  applyPose(doll, { joints: { rightShoulder: { raise: 90, dir: 90 } } });
  d = pt('rightHand').sub(pt('rightShoulderPt'));
  assert.ok(d.x < -1 && near(d.y, 0, 0.1), `out ${d.toArray()}`);
  applyPose(doll, { joints: { leftShoulder: { raise: 180 } } });
  assert.ok(pt('leftHand').y > pt('headTop').y);
});

test('knees bend backward, elbows forward, ankle bend lifts the toes', () => {
  applyPose(doll, { joints: { leftKnee: { bend: 90 }, rightElbow: { bend: 90 }, rightAnkle: { bend: 30 } } });
  assert.ok(pt('leftAnklePt').z < pt('leftKneePt').z - 0.5);
  assert.ok(pt('rightHand').z > pt('rightElbowPt').z + 0.5);
  assert.ok(pt('rightToe').y > pt('rightHeel').y);
});

test('mirroring twice gives the same pose; mirroring swaps the stride', () => {
  const walk = JSON.parse(fs.readFileSync(path.join(POSES, 'walk-a.json'), 'utf8'));
  assert.deepEqual(normalizePose(mirrorPose(mirrorPose(walk))).joints, normalizePose(walk).joints);
  const a = view(walk);
  const b = view(mirrorPose(walk));
  assert.ok(a.facts.legs.left.forward > a.facts.legs.right.forward);
  assert.ok(b.facts.legs.right.forward > b.facts.legs.left.forward);
});

test('description names limbs by where they appear in the picture', () => {
  const front = view({}, { view: 'front' });
  assert.equal(front.facts.arms.right.picture, 'picture-LEFT');
  assert.match(front.facts.facing, /faces the viewer/);
  const back = view({}, { view: 'back' });
  assert.equal(back.facts.arms.right.picture, 'picture-RIGHT');
  const dl = view({}, { view: 'facing-lower-left' });
  assert.match(dl.facts.facing, /LOWER-LEFT/);
  const ul = view({}, { view: 'facing-upper-left' });
  assert.match(ul.facts.facing, /UPPER-LEFT/);
  const raised = view({ joints: { rightShoulder: { raise: 175 } } }, { view: 'front' });
  assert.match(raised.text, /picture-LEFT arm \(the character's own RIGHT arm[^)]*\): hand raised high above the head/);
});

test('every preset is valid', () => {
  for (const f of fs.readdirSync(POSES).filter((f) => f.endsWith('.json'))) {
    const p = JSON.parse(fs.readFileSync(path.join(POSES, f), 'utf8'));
    assert.deepEqual(normalizePose(p).unknown, [], f);
    assert.ok(p.intent, `${f} needs an intent`);
    const d = view(p);
    assert.ok(d.text.length > 50, f);
  }
});
