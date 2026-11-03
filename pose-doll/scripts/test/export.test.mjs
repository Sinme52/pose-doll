// Export for other image generators: OpenPose keypoints and tool-neutral prompts.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { createDoll, applyPose, frameCamera } from '../src/doll.js';
import { describePose } from '../src/describe.js';
import { openposeKeypoints, openposeJson, COCO_NAMES, LIMBS } from '../src/openpose.js';
import { genericPrompts, promptFile } from '../src/prompts.js';

const POSES = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'poses');
const load = (n) => JSON.parse(fs.readFileSync(path.join(POSES, `${n}.json`), 'utf8'));
const doll = createDoll({ headsTall: 7.5 });
const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
const kpsOf = (pose, view) => { applyPose(doll, pose); frameCamera(camera, doll, { view }); return openposeKeypoints(doll, camera, 512, 512); };
const K = Object.fromEntries(COCO_NAMES.map((n, i) => [n, i]));

test('OpenPose keypoints follow the COCO-18 order and the character\'s own sides', () => {
  const k = kpsOf(load('stand'), 'front');
  assert.equal(k.length, 18);
  assert.ok(k[K.r_shoulder][0] < k[K.l_shoulder][0], 'front view: own right shoulder on picture-left');
  assert.ok(k[K.nose][1] < k[K.neck][1] && k[K.neck][1] < k[K.r_hip][1] && k[K.r_hip][1] < k[K.r_ankle][1], 'top to bottom');
  assert.ok(k.every(([x, y, c]) => c === 1 && x > 0 && x < 512 && y > 0 && y < 512), 'all visible and inside the picture');
  assert.equal(LIMBS.length, 17);
});

test('back views leave out the face points', () => {
  const k = kpsOf(load('walk-ready-a'), 'facing-upper-left');
  assert.equal(k[K.nose][2], 0);
  assert.equal(k[K.r_eye][2], 0);
  assert.equal(k[K.l_eye][2], 0);
  assert.equal(k[K.neck][2], 1);
  const back = kpsOf(load('stand'), 'back');
  assert.ok(back[K.r_shoulder][0] > back[K.l_shoulder][0], 'back view: own right shoulder on picture-right');
});

test('OpenPose JSON has 18 x 3 numbers per person, hidden points as zeros', () => {
  const k = kpsOf(load('walk-ready-a'), 'facing-upper-left');
  const j = openposeJson(k, 512, 512);
  assert.equal(j.people[0].pose_keypoints_2d.length, 54);
  assert.deepEqual(j.people[0].pose_keypoints_2d.slice(0, 3), [0, 0, 0]);
  assert.equal(j.canvas_width, 512);
});

test('prompts for other tools carry the pose description but no GPT-specific image numbering', () => {
  const pose = load('walk-ready-a');
  applyPose(doll, pose);
  frameCamera(camera, doll, { view: 'facing-lower-left' });
  const d = describePose(doll, camera);
  const p = genericPrompts({ description: d.text, intent: pose.intent, hasProps: true, extra: 'She holds the rifle.', character: 'a red-haired soldier' });
  assert.ok(p.referencePrompt.includes(d.text));
  assert.doesNotMatch(p.referencePrompt, /IMAGE \d/);
  assert.match(p.referencePrompt, /BLUE limbs .* own LEFT/);
  assert.match(p.referencePrompt, /orange marker/);
  assert.match(p.textPrompt, /^a red-haired soldier, walking mid-stride/);
  assert.doesNotMatch(p.textPrompt, /\.,/);
  assert.match(p.negativePrompt, /extra limbs/);
  const file = promptFile(p, { mannequin: 'a.png', openpose: 'a.openpose.png', keypoints: 'a.openpose.json', depth: 'a.depth.png' });
  assert.match(file, /ControlNet OpenPose: a\.openpose\.png/);
});
