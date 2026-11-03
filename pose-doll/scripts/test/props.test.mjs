// Held-item catalog: every type builds, blades / shields sit the right way, run-time definitions.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { createDoll, applyPose, normalizePose, mirrorPose, worldPoint, frameCamera, PROP_TYPES, propDef, registerProps } from '../src/doll.js';
import { buildProps, dollHand, propShape } from '../src/props.js';
import { describePose } from '../src/describe.js';

const POSES = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'poses');
const load = (n) => JSON.parse(fs.readFileSync(path.join(POSES, `${n}.json`), 'utf8'));
const doll = createDoll({ headsTall: 7.5 });
const deg = (r) => THREE.MathUtils.radToDeg(r);

function posed(pose, view = 'front') {
  const p = applyPose(doll, pose);
  const up = new THREE.Vector3(0, 1, 0);
  const { group, info } = buildProps(p.props, (s) => dollHand(doll, s), up);
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  frameCamera(camera, doll, { view }, [group]);
  return { p, info, group, d: describePose(doll, camera, { props: info }) };
}

test('every catalog item resolves and builds', () => {
  for (const t of PROP_TYPES) {
    const d = propDef(t);
    for (const k of ['label', 'category', 'hands', 'attach', 'length', 'tip', 'parts']) assert.ok(d[k] !== undefined, `${t}.${k}`);
    assert.ok(['gun', 'blade', 'shield', 'pole'].includes(d.category), t);
    assert.ok(['axis', 'thumb', 'strap'].includes(d.attach), t);
    const g = propShape(d, d.length, d.width);
    assert.ok(g.children.length > 0, t);
    assert.ok(g.children.some((m) => m.material.color.getHex() === 0xff8a1f), `${t} has an orange marker`);
  }
  assert.equal(propDef('sword-1h').category, 'blade');
  assert.deepEqual(propDef('sword-1h').hands, [1, 1]);
  assert.equal(propDef('sword-2h').label, 'two-handed sword');
});

test('hand counts are enforced per item', () => {
  const p = normalizePose({ props: [{ type: 'sword', hands: ['right', 'left'] }, { type: 'shield', hands: ['left', 'right'] }, { type: 'greatsword', hands: ['right', 'left'] }] });
  assert.equal(p.props.length, 1);
  assert.equal(p.props[0].type, 'greatsword');
  assert.match(p.unknown[0], /sword takes 1 hand/);
});

test('one-handed sword leaves the thumb side of the fist; angle 180 gives a reverse grip', () => {
  const pose = { joints: { rightShoulder: { raise: 20, dir: 10 }, rightElbow: { bend: 90 }, rightWrist: { grip: 90 } }, props: [{ type: 'sword', hands: ['right'] }] };
  const { info } = posed(pose);
  const thumb = new THREE.Vector3(0, 0, 1).applyQuaternion(dollHand(doll, 'right').quat);
  assert.ok(info[0].axis.angleTo(thumb) < 1e-6);
  assert.ok(info[0].axis.y > 0.7, 'blade up with the forearm forward');
  const rev = posed({ ...pose, props: [{ type: 'sword', hands: ['right'], angle: 180 }] });
  assert.ok(rev.info[0].axis.y < -0.7, 'reverse grip points down');
  assert.match(rev.d.text, /reverse grip/);
});

test('two-handed sword: blade runs from the lower hand through the upper hand', () => {
  const { info, d } = posed(load('greatsword-guard'));
  const g = info[0];
  const R = worldPoint(doll, 'rightHand');
  const L = worldPoint(doll, 'leftHand');
  assert.ok(g.axis.angleTo(R.clone().sub(L).normalize()) < 1e-3, 'axis from the left (lower) hand to the right hand');
  assert.ok(g.muzzle.distanceTo(R) < g.muzzle.distanceTo(L), 'the tip is beyond the upper hand');
  assert.ok(g.axis.z > 0.5 && g.axis.y > 0.4, `points forward and up (${g.axis.toArray().map((v) => v.toFixed(2))})`);
  assert.match(d.text, /two-handed sword gripped with both hands on the hilt/);
});

test('shield is strapped to the forearm and faces out of the back of the arm', () => {
  const { info, d } = posed(load('sword-shield-ready'));
  const sh = info.find((i) => i.category === 'shield');
  const blade = info.find((i) => i.category === 'blade');
  assert.ok(sh.normal.z > 0.9, `shield faces forward (${sh.normal.toArray().map((v) => v.toFixed(2))})`);
  const fore = dollHand(doll, 'left');
  const mid = fore.elbow.clone().lerp(fore.wrist, 0.55);
  assert.ok(sh.center.distanceTo(mid) < 0.5, 'centred on the forearm');
  assert.ok(blade.axis.y > 0.8, 'sword held upright');
  assert.match(d.text, /round shield strapped to the picture-\w+ forearm \(the character's own LEFT arm\)/);
  assert.match(d.text, /front face \(orange boss\) faces [^.]*toward the viewer/);
});

test('elbow twist turns the palm', () => {
  applyPose(doll, { joints: { leftElbow: { bend: 90, twist: 0 } } });
  const palm0 = new THREE.Vector3(-1, 0, 0).applyQuaternion(dollHand(doll, 'left').quat);
  applyPose(doll, { joints: { leftElbow: { bend: 90, twist: 90 } } });
  const palm1 = new THREE.Vector3(-1, 0, 0).applyQuaternion(dollHand(doll, 'left').quat);
  assert.ok(palm0.y > -0.2 && palm0.y < 0.2, 'palm faces inward');
  assert.ok(palm1.y > 0.9, 'supinated: palm up');
});

test('full mirror moves the sword and the shield to the other hands; legs mirror keeps them', () => {
  const a = load('walk-sword-shield-a');
  assert.deepEqual(mirrorPose(a, 'all').props.map((p) => p.hands[0]), ['left', 'right']);
  assert.deepEqual(load('walk-sword-shield-b').props, a.props);
  assert.deepEqual(normalizePose(load('walk-sword-shield-b')).joints, normalizePose(mirrorPose(a, 'legs')).joints);
});

test('new item types can be defined in a pose (propDefs) and are checked', () => {
  const pose = { propDefs: { 'plasma-rifle': { base: 'rifle', label: 'plasma rifle', length: 4.4 }, broken: { label: 'nothing' }, loop: { base: 'loop' } },
    props: [{ type: 'plasma-rifle', hands: ['right', 'left'] }] };
  const p = normalizePose(pose);
  assert.equal(p.props[0].length, 4.4);
  assert.equal(propDef('plasma-rifle').label, 'plasma rifle');
  assert.ok(p.unknown.some((u) => /propDefs\.broken: missing/.test(u)));
  assert.ok(p.unknown.some((u) => /propDefs\.loop: .*bad base/.test(u)));
  assert.equal(propDef('broken'), null);
  assert.deepEqual(registerProps({ ok: { base: 'sword', label: 'short sword', length: 3 } }), []);
  const { d } = posed({ joints: { rightShoulder: { raise: 15, dir: 20 }, rightElbow: { bend: 80 }, leftShoulder: { raise: 48, dir: -22 }, leftElbow: { bend: 30 } }, props: [{ type: 'plasma-rifle', hands: ['right', 'left'] }] });
  assert.match(d.text, /a plasma rifle held in both hands/);
});
