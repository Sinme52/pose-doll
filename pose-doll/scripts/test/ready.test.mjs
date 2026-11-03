// Tests for legs-only mirroring, held props, richer descriptions and camera framing.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { createDoll, applyPose, normalizePose, mirrorPose, swapIntent, worldPoint, frameCamera } from '../src/doll.js';
import { buildProps, dollHand } from '../src/props.js';
import { describePose } from '../src/describe.js';

const POSES = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'poses');
const load = (n) => JSON.parse(fs.readFileSync(path.join(POSES, `${n}.json`), 'utf8'));
const doll = createDoll({ headsTall: 7.5 });
const ARMS = ['leftShoulder', 'rightShoulder', 'leftElbow', 'rightElbow', 'leftWrist', 'rightWrist', 'head'];

function posed(pose, view = 'facing-lower-left') {
  const p = applyPose(doll, pose);
  const hand = (side) => dollHand(doll, side);
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(doll.joints.chest.getWorldQuaternion(new THREE.Quaternion()));
  const { group, info } = buildProps(p.props, hand, up);
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  frameCamera(camera, doll, { view }, [group]);
  return { pose: p, info, camera, d: describePose(doll, camera, { props: info }) };
}

test('legs-only mirror swaps the legs and keeps arms, head and props', () => {
  const a = load('walk-ready-a');
  const b = mirrorPose(a, 'legs');
  for (const j of ARMS) assert.deepEqual(b.joints[j], a.joints[j], j);
  assert.deepEqual(b.props, a.props);
  assert.deepEqual(b.joints.rightHip, a.joints.leftHip);
  assert.deepEqual(b.joints.leftKnee, a.joints.rightKnee);
  assert.deepEqual(normalizePose(mirrorPose(b, 'legs')).joints, normalizePose(a).joints);
  assert.match(b.intent, /own right leg forward/);
});

test('legs-only mirror keeps the upper body facing the same way', () => {
  const a = load('walk-ready-a');
  applyPose(doll, a);
  const qa = doll.joints.chest.getWorldQuaternion(new THREE.Quaternion());
  applyPose(doll, mirrorPose(a, 'legs'));
  const qb = doll.joints.chest.getWorldQuaternion(new THREE.Quaternion());
  assert.ok(qa.angleTo(qb) < THREE.MathUtils.degToRad(2), `chest turned by ${THREE.MathUtils.radToDeg(qa.angleTo(qb)).toFixed(1)} deg`);
  const ha = posed(a).info[0];
  const hb = posed(mirrorPose(a, 'legs')).info[0];
  assert.ok(ha.axis.angleTo(hb.axis) < THREE.MathUtils.degToRad(3), 'rifle direction stays');
});

test('full mirror moves held items to the other hands; walk-ready-b preset equals the legs mirror', () => {
  const a = load('walk-ready-a');
  assert.deepEqual(mirrorPose(a, 'all').props[0].hands, ['left', 'right']);
  assert.deepEqual(normalizePose(load('walk-ready-b')).joints, normalizePose(mirrorPose(a, 'legs')).joints);
  assert.throws(() => mirrorPose(a, 'arms'));
});

test('swapIntent flips every side, or only the leg words', () => {
  const t = 'right hand on the grip, left hand under the barrel; own left leg forward, right foot behind';
  assert.equal(swapIntent(t, 'legs'), 'right hand on the grip, left hand under the barrel; own right leg forward, left foot behind');
  assert.equal(swapIntent(t, 'all'), 'left hand on the grip, right hand under the barrel; own right leg forward, left foot behind');
});

test('props are validated', () => {
  const p = normalizePose({ props: [{ type: 'rifle', hands: ['right', 'left'] }, { type: 'banana' }, { type: 'rifle', hands: ['left', 'left'] }] });
  assert.equal(p.props.length, 1);
  assert.equal(p.props[0].length, 4);
  assert.equal(p.unknown[0], 'props[1].type=banana');
  assert.match(p.unknown[1], /^props\[2\]\.hands/);
});

test('a two-handed rifle runs from the grip hand through the support hand', () => {
  const { info } = posed(load('walk-ready-a'));
  const r = info[0];
  const grip = worldPoint(doll, 'rightHand');
  const support = worldPoint(doll, 'leftHand');
  const toSupport = support.clone().sub(grip).normalize();
  assert.ok(r.axis.angleTo(toSupport) < 1e-3);
  assert.ok(r.muzzle.distanceTo(grip) > support.distanceTo(grip), 'muzzle is beyond the support hand');
  assert.ok(r.back.distanceTo(grip) > 0.5, 'stock behind the grip hand');
});

test('descriptions say which hand is in front, what the hands hold and where the muzzle points', () => {
  const { d } = posed(load('walk-ready-a'));
  assert.match(d.text, /Hands: the picture-(LEFT|RIGHT) hand is further forward/);
  assert.match(d.text, /hand closed around the rifle's grip/);
  assert.match(d.text, /hand supporting the rifle/);
  assert.match(d.text, /Held item: a rifle held in both hands: the picture-\w+ hand \(the character's own RIGHT hand\) on the grip/);
  assert.match(d.text, /the muzzle points [^;]*\(-?\d+ degrees from level\)/);
  // without a prop, a closed hand is still reported as holding something
  const bare = posed({ joints: { rightWrist: { grip: 80 } } }).d;
  assert.match(bare.text, /hand closed around a held object/);
});

test('walking frames: both feet on the ground, heel strike in front and a lifted heel behind', () => {
  for (const [name, front, back] of [['walk-ready-a', 'left', 'right'], ['walk-ready-b', 'right', 'left'], ['walk-a', 'left', 'right']]) {
    for (const view of ['facing-lower-left', 'facing-upper-left']) {
      const { d } = posed(load(name), view);
      const L = d.facts.legs;
      assert.ok(L[front].onGround && L[back].onGround, `${name} ${view}: both feet on the ground`);
      assert.match(L[front].contact, /heel strike/, `${name} front foot`);
      assert.match(L[back].contact, /heel (slightly )?lifted|heel raised high/, `${name} back foot`);
      assert.ok(L[front].forward > L[back].forward);
    }
  }
});

test('fixed framing: same scale for every frame, standing figure fills the requested height', () => {
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  const heads = [];
  for (const n of ['walk-ready-a', 'stand-ready', 'walk-ready-b']) {
    applyPose(doll, load(n));
    frameCamera(camera, doll, { view: 'facing-lower-left', fill: 0.8, frame: 'fixed' });
    heads.push(camera.position.clone());
  }
  assert.ok(heads[0].distanceTo(heads[1]) < 1e-9 && heads[1].distanceTo(heads[2]) < 1e-9, 'camera does not move between frames');
  applyPose(doll, load('stand'));
  frameCamera(camera, doll, { view: 'front', fill: 0.8, frame: 'fixed' });
  const top = worldPoint(doll, 'headTop').project(camera).y;
  const foot = Math.min(worldPoint(doll, 'leftHeel').project(camera).y, worldPoint(doll, 'leftToe').project(camera).y);
  assert.ok(Math.abs((top - foot) / 2 - 0.8) < 0.03, `filled ${((top - foot) / 2).toFixed(3)}`);
});
