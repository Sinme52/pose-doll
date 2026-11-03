#!/usr/bin/env node
// Render pose JSON files (or preset names, or inline JSON) to PNG with headless Chromium.
//
//   node render.mjs walk-a                          -> ./pose-doll-out/walk-a.png + .json
//   node render.mjs my-pose.json --view facing-upper-left --heads 6 --out ref.png
//   node render.mjs '{"joints":{"rightShoulder":{"raise":170}}}' --out raise.png
//   node render.mjs walk-a --mirror                  (swap the character's left and right)
//   node render.mjs walk-ready-a --mirror legs       (swap only the legs; hands and held items stay)
//   node render.mjs walk-ready-a --mirror picture --view facing-upper-left
//                                (legs = stride A flipped left-right in this view's picture: stride B for back views)
//
// Options: --out FILE (single pose) | --out-dir DIR (default ./pose-doll-out), --style color|plain,
//   --view NAME | --azimuth DEG --elevation DEG, --fill 0.82, --frame fixed|fit, --heads N,
//   --size WxH (default 1024x1024), --background '#ffffff'|transparent, --ground, --mirror [all|legs],
//   --model rigged.glb  (pose a rigged character model, e.g. a Meshy auto-rig, instead of the mannequin)
//   --uncross  (back views: open the hips if the legs would cross / hide each other in the picture)
//   --export   for image generators other than GPT Image: also write <name>.openpose.png (+ .openpose.json
//              keypoints), <name>.depth.png, <name>.mask.png and <name>.prompts.txt (no API, no skill needed)
//   --layers openpose,depth,mask   (choose the extra pictures yourself)
//   --extra TEXT, --target-background transparent|opaque, --character-desc TEXT   (go into the prompts)
//   --props-file my-weapons.json  (extra held-item types: { "plasma-rifle": { "base": "rifle", "label": "plasma rifle" } })
// Prints one JSON line per pose: { png, sidecar, description, facts }.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { startServer } from './server.mjs';
import { mirrorPose, swapIntent, VIEWS } from './src/doll.js';
import { pictureMirrorLegs } from './src/picture-mirror.js';
import { genericPrompts, promptFile } from './src/prompts.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// outputs and saved poses live in the working directory, never in the skill folder
export const OUT_ROOT = process.env.POSE_DOLL_OUT || path.join(process.cwd(), 'pose-doll-out');
export const PLAYWRIGHT_HOME = process.env.POSE_DOLL_PLAYWRIGHT || path.join(os.homedir(), '.cache', 'pose-doll');
export const SAVED_POSES = process.env.POSE_DOLL_POSES || path.join(process.cwd(), 'pose-doll-poses');

async function loadPlaywright() {
  try { return await import('playwright'); } catch {}
  // PLAYWRIGHT_HOME is where the skill's setup installs it (kept out of the skill folder: an npm install
  // there would prune the bundled three.js)
  for (const base of [PLAYWRIGHT_HOME, process.cwd(), HERE, '/opt/node-tools']) {
    try { return createRequire(path.join(base, 'noop.js'))('playwright'); } catch {}
  }
  throw new Error(`playwright not found: run \`npm install --prefix ${PLAYWRIGHT_HOME} playwright && `
    + `npx --prefix ${PLAYWRIGHT_HOME} playwright install chromium\``);
}

export function parseArgs(argv) {
  const opts = { inputs: [], style: 'color', size: '1024x1024', background: '#ffffff' };
  const flags = new Set(['ground', 'help', 'uncross', 'export']);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--mirror') {
      opts.mirror = ['legs', 'all', 'picture'].includes(argv[i + 1]) ? argv[++i] : 'all';
    } else if (a.startsWith('--')) {
      const k = a.slice(2);
      if (flags.has(k)) opts[k] = true;
      else opts[k] = argv[++i];
    } else opts.inputs.push(a);
  }
  return opts;
}

export function loadPose(arg) {
  if (arg.trim().startsWith('{')) return { pose: JSON.parse(arg), stem: 'pose' };
  const name = arg.endsWith('.json') ? arg : `${arg}.json`;
  // a file path, a pose saved from the editor (./pose-doll-poses), or a preset
  const file = [arg, path.join(SAVED_POSES, name), path.join(HERE, 'poses', name)].find((f) => fs.existsSync(f) && fs.statSync(f).isFile());
  if (!file) throw new Error(`pose not found: ${arg} (not a file, not in ${SAVED_POSES}, not a preset in poses/)`);
  return { pose: JSON.parse(fs.readFileSync(file, 'utf8')), stem: path.basename(file, '.json') };
}

/** Apply command-line overrides to a pose object. */
export function withOverrides(pose, o) {
  let p = structuredClone(pose);
  if (o.mirror && o.mirror !== 'picture') p = mirrorPose(p, o.mirror === true ? 'all' : o.mirror);
  p.camera = { ...(p.camera || {}) };
  if (o.view) {
    if (!VIEWS[o.view]) throw new Error(`unknown view ${o.view}; one of: ${Object.keys(VIEWS).join(', ')}`);
    p.camera.view = o.view;
    delete p.camera.azimuth;
    delete p.camera.elevation;
  }
  for (const k of ['azimuth', 'elevation', 'fill', 'fov']) if (o[k] !== undefined) p.camera[k] = Number(o[k]);
  if (o.frame) p.camera.frame = o.frame;
  if (o.heads) p.build = { ...(p.build || {}), headsTall: Number(o.heads) };
  if (o.mirror === 'picture') {
    // legs flipped left-right in the picture of this view (upper body unchanged)
    const r = pictureMirrorLegs(p, p, p.camera.view && !Number.isFinite(p.camera.azimuth) ? p.camera.view : undefined);
    p = { ...r.pose, name: `${p.name || 'pose'}-picture-mirrored`, intent: swapIntent(p.intent, 'legs') };
  }
  if (o['props-file']) p.propDefs = { ...JSON.parse(fs.readFileSync(o['props-file'], 'utf8')), ...(p.propDefs || {}) };
  return p;
}

export async function renderPoses(items, o = {}) {
  const { chromium } = await loadPlaywright();
  const extra = o.model ? { '/__model.glb': path.resolve(o.model) } : {};
  if (o.model && !fs.existsSync(o.model)) throw new Error(`model not found: ${o.model}`);
  const server = await startServer(0, extra);
  const port = server.address().port;
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const results = [];
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`http://127.0.0.1:${port}/headless.html`);
    await page.waitForFunction('window.ready === true', null, { timeout: 20000 }).catch(() => {
      throw new Error(`headless page failed to start: ${errors.join('; ')}`);
    });
    const [w, h] = String(o.size || '1024x1024').split('x').map(Number);
    for (const { pose, out } of items) {
      const r = await page.evaluate(([p, opts]) => window.renderPose(p, opts), [pose, { width: w, height: h || w, style: o.style || 'color', background: o.background ?? '#ffffff', ground: !!o.ground, model: o.model ? '/__model.glb' : null, uncross: !!o.uncross,
        layers: o.layers ? String(o.layers).split(',').map((x) => x.trim()) : o.export ? ['openpose', 'depth', 'mask'] : [] }]);
      fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
      fs.writeFileSync(out, Buffer.from(r.png.split(',')[1], 'base64'));
      const sidecar = out.replace(/\.png$/i, '') + '.json';
      fs.writeFileSync(sidecar, JSON.stringify({ pose: r.pose || pose, uncrossed: r.uncrossed, warnings: r.warnings, render: { style: o.style || 'color', model: o.model || null, size: `${w}x${h || w}`, camera: r.camera }, description: r.description, facts: r.facts }, null, 2));
      if (r.unknown.length) console.error(`warning: ignored unknown joints/params: ${r.unknown.join(', ')}`);
      for (const w of r.warnings || []) console.error(`warning (${path.basename(out)}): ${w}`);
      const files = { mannequin: path.basename(out) };
      const base = out.replace(/\.png$/i, '');
      for (const k of ['openpose', 'depth', 'mask']) {
        if (r.layers && r.layers[k]) {
          fs.writeFileSync(`${base}.${k}.png`, Buffer.from(r.layers[k].split(',')[1], 'base64'));
          files[k] = path.basename(`${base}.${k}.png`);
        }
      }
      if (r.layers && r.layers.keypoints) {
        fs.writeFileSync(`${base}.openpose.json`, JSON.stringify(r.layers.keypoints));
        files.keypoints = path.basename(`${base}.openpose.json`);
      }
      if (o.export) {
        const prompts = genericPrompts({ description: r.description, intent: (r.pose || pose).intent || '', hasProps: !!((r.pose || pose).props || []).length,
          background: o['target-background'] || 'transparent', extra: o.extra || '', style: o.style || 'color', character: o['character-desc'] || '' });
        fs.writeFileSync(`${base}.prompts.txt`, promptFile(prompts, { openpose: '(none)', keypoints: '(none)', ...files }));
        files.prompts = path.basename(`${base}.prompts.txt`);
        const side = JSON.parse(fs.readFileSync(sidecar, 'utf8'));
        side.export = { files, prompts };
        fs.writeFileSync(sidecar, JSON.stringify(side, null, 2));
      }
      results.push({ png: out, sidecar, description: r.description, facts: r.facts, warnings: r.warnings || [], uncrossed: r.uncrossed, files });
    }
  } finally {
    await browser.close();
    server.close();
  }
  return results;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const o = parseArgs(process.argv.slice(2));
  if (o.help || !o.inputs.length) {
    console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 14).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
    process.exit(o.help ? 0 : 1);
  }
  const items = o.inputs.map((arg) => {
    const { pose, stem } = loadPose(arg);
    const name = stem + (o.mirror === 'legs' ? '-legs-mirrored' : o.mirror === 'picture' ? '-picture-mirrored' : o.mirror ? '-mirrored' : '');
    const out = o.out && o.inputs.length === 1 ? o.out : path.join(o['out-dir'] || OUT_ROOT, `${name}.png`);
    return { pose: withOverrides(pose, o), out };
  });
  renderPoses(items, o).then((rs) => rs.forEach((r) => console.log(JSON.stringify({ png: r.png, sidecar: r.sidecar, description: r.description, warnings: r.warnings, uncrossed: r.uncrossed, files: r.files })))).catch((e) => {
    console.error(String(e.stack || e));
    process.exit(1);
  });
}
