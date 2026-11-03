// Stride B as stride A flipped left-right in the picture (back views).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { createDoll, applyPose, frameCamera, worldPoint } from '../src/doll.js';
import { describePose } from '../src/describe.js';
import { pictureMirrorLegs } from '../src/picture-mirror.js';

const POSES = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'poses');
const load = (n) => ({ ...JSON.parse(fs.readFileSync(path.join(POSES, `${n}.json`), 'utf8')), build: { headsTall: 7.5 } });
const doll = createDoll({ headsTall: 7.5 });
const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
const VIEW = 'facing-upper-left';

function legShape(pose, fromCamOf) {
  applyPose(doll, fromCamOf);
  frameCamera(camera, doll, { view: VIEW });
  applyPose(doll, pose);
  const s = (n) => worldPoint(doll, n).project(camera);
  const out = {};
  for (const side of ['left', 'right']) {
    const hip = s(`${side}HipPt`);
    out[side] = ['KneePt', 'AnklePt'].map((n) => { const p = s(`${side}${n}`); return [p.x - hip.x, p.y - hip.y]; });
  }
  return out;
}

for (const name of ['walk-ready-a', 'walk-a', 'walk-sword-shield-a']) {
  test(`${name}~picture: legs are stride A flipped in the ul picture`, () => {
    const a = load(name);
    const r = pictureMirrorLegs(a, a, VIEW);
    assert.ok(r.error < 0.1, `fit error ${r.error}`);
    const A = legShape(a, a);
    const B = legShape(r.pose, a);
    for (const [from, to] of [['left', 'right'], ['right', 'left']]) {
      A[from].forEach(([x, y], k) => {
        assert.ok(Math.abs(-x - B[to][k][0]) < 0.03 && Math.abs(y - B[to][k][1]) < 0.03,
          `${to} leg point ${k}: mirror of A (${(-x).toFixed(3)}, ${y.toFixed(3)}) vs B (${B[to][k].map((v) => v.toFixed(3))})`);
      });
    }
    assert.equal(r.pose.stride.front, 'right');
    applyPose(doll, r.pose);
    frameCamera(camera, doll, { view: VIEW });
    const d = describePose(doll, camera);
    assert.equal(d.facts.front, 'right');
    assert.equal(d.facts.frontFootPosition, 'UPPER-RIGHT');
    assert.ok(!d.facts.legsCross);
    assert.deepEqual(d.facts.warnings, []);
    assert.deepEqual(d.facts.solesVisible, ['left']);
  });
}
