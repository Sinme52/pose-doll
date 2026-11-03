#!/usr/bin/env node
// Fit a pose JSON to MediaPipe world landmarks (written by photo2pose.py).
//   node fit.mjs landmarks.json [--out pose.json] [--heads 7.5] [--name NAME] [--intent TEXT]
import fs from 'node:fs';
import path from 'node:path';
import { fitPose } from './src/fit.js';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const file = args.find((a) => !a.startsWith('--') && !args[args.indexOf(a) - 1]?.startsWith('--'));
if (!file) { console.error('usage: node fit.mjs landmarks.json [--out pose.json] [--heads 7.5]'); process.exit(1); }
const lm = JSON.parse(fs.readFileSync(file, 'utf8'));
const heads = Number(opt('heads', 7.5));
const r = fitPose(lm.world, { build: { headsTall: heads } });
const pose = {
  name: opt('name', path.basename(file).replace(/\.landmarks\.json$|\.json$/, '')),
  intent: opt('intent', ''),
  build: { headsTall: heads },
  camera: { view: 'facing-lower-left' },
  joints: r.pose.joints,
  fit: { source: lm.source || null, meanErrorDeg: r.error.mean, boneErrorDeg: r.error.bones, photoCamera: { azimuth: r.cameraAzimuth, elevation: 5 } },
};
const out = opt('out', file.replace(/\.landmarks\.json$|\.json$/, '') + '.pose.json');
fs.writeFileSync(out, JSON.stringify(pose, null, 2) + '\n');
console.log(JSON.stringify({ out, meanErrorDeg: r.error.mean, photoAzimuth: r.cameraAzimuth }));
