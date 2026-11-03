// Back views: feet described where they really are, crossed legs detected and opened, visible soles named.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { createDoll, applyPose, frameCamera } from '../src/doll.js';
import { describePose } from '../src/describe.js';
import { uncrossLegs } from '../src/uncross.js';

const POSES = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'poses');
const load = (n) => JSON.parse(fs.readFileSync(path.join(POSES, `${n}.json`), 'utf8'));
const doll = createDoll({ headsTall: 7.5 });
const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
const look = (pose, view) => { applyPose(doll, pose); frameCamera(camera, doll, { view }); return describePose(doll, camera); };

test('ul walk-b: the stride check names the real picture position of the crossed feet', () => {
  const d = look(load('walk-b'), 'facing-upper-left');
  assert.equal(d.facts.front, 'right');
  assert.ok(d.facts.legsCross, 'legs cross');
  assert.equal(d.facts.frontFootPosition, 'UPPER-LEFT');
  const stride = d.lines.find((l) => l.startsWith('Stride check'));
  assert.doesNotMatch(stride, /picture-RIGHT side/);
  assert.match(stride, /FORWARD foot is the character's own RIGHT \(red\) foot; in the picture it is at the UPPER-LEFT/);
  assert.match(stride, /legs CROSS in the picture/);
  assert.ok(d.facts.warnings.some((w) => /legs cross .* back view/.test(w)));
  // the nearer back leg hides the forward one
  assert.equal(d.facts.hiddenLeg, 'right');
  assert.match(stride, /back leg \(own LEFT \(blue\)\) is the nearer one .* HIDES MOST of the forward leg \(own RIGHT \(red\)\)/);
  assert.match(stride, /Draw only one fully visible leg \(the LEFT one\)/);
});

test('front views report crossing in the text but do not warn', () => {
  const d = look(load('walk-a'), 'facing-lower-left');
  assert.deepEqual(d.facts.warnings, []);
  assert.equal(d.facts.backView, false);
});

test('back views say which boot shows its sole: the lifted back foot', () => {
  for (const [name, back] of [['walk-a', 'right'], ['walk-ready-a', 'right']]) {
    const d = look(load(name), 'facing-upper-left');
    assert.deepEqual(d.facts.solesVisible, [back], name);
    assert.match(d.text, new RegExp(`Only one boot shows its sole to the viewer: the character's own ${back.toUpperCase()} \\(red\\) one \\(the back foot, heel lifted\\)`));
  }
  const front = look(load('walk-a'), 'facing-lower-left');
  assert.doesNotMatch(front.text, /shows its sole/);
});

test('uncross opens crossed back-view strides and keeps both feet on the ground', () => {
  for (const name of ['walk-b', 'walk-ready-b', 'walk-sword-shield-b']) {
    const r = uncrossLegs({ ...load(name), camera: { view: 'facing-upper-left' }, build: { headsTall: 7.5 } });
    assert.ok(r.changed, name);
    const d = look(r.pose, 'facing-upper-left');
    assert.ok(!d.facts.legsCross && !d.facts.feetOverlap, `${name}: still crossing`);
    assert.deepEqual(d.facts.warnings, [], name);
    assert.match(d.facts.legs.right.contact, /heel strike/, `${name}: front foot down`);
    assert.ok(d.facts.legs.right.forward > d.facts.legs.left.forward + 0.1, `${name}: stride kept`);
    assert.deepEqual(d.facts.solesVisible, ['left'], `${name}: the back (left) sole shows`);
    assert.ok(r.pose.joints.rightHip.dir <= 75 && r.pose.joints.leftHip.dir >= 115);
  }
});

test('uncross leaves front views and uncrossed poses alone', () => {
  for (const [name, view] of [['walk-a', 'facing-lower-left'], ['walk-b', 'facing-lower-left'], ['walk-a', 'facing-upper-left'], ['stand', 'facing-upper-left']]) {
    const r = uncrossLegs({ ...load(name), camera: { view }, build: { headsTall: 7.5 } });
    assert.equal(r.changed, false, `${name} ${view}`);
  }
});
