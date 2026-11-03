// Small server for the pose editor (and the headless renderer). No dependencies.
//   node server.mjs [--port 5178] [--save-dir ./pose-doll-poses]
// The editor's "save to project" button writes <name>.json into the save directory
// (default: ./pose-doll-poses in the directory the server was started from), where
// render.mjs / frames.py / pose2image.py find it by name. Only 127.0.0.1 is served.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const TYPES = { '.glb': 'model/gltf-binary', '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg' };
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

const send = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };

// extra: { '/url-path': '/absolute/file' } serves files from outside the tool folder (e.g. a model GLB)
export function startServer(port = 0, extra = {}, saveDir = process.env.POSE_DOLL_POSES || path.join(process.cwd(), 'pose-doll-poses')) {
  const listDir = (d) => (fs.existsSync(d) ? fs.readdirSync(d).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).sort() : []);
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (url === '/api/info') return send(res, 200, { saveDir, presets: listDir(path.join(ROOT, 'poses')), saved: listDir(saveDir) });
    if (url === '/api/save' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => { body += c; if (body.length > 2e6) req.destroy(); });
      req.on('end', () => {
        try {
          const { name, pose } = JSON.parse(body);
          if (!NAME.test(name || '')) return send(res, 400, { ok: false, error: 'name: letters, digits, . _ - (max 64)' });
          if (!pose || typeof pose !== 'object' || !pose.joints) return send(res, 400, { ok: false, error: 'pose JSON with joints expected' });
          fs.mkdirSync(saveDir, { recursive: true });
          const file = path.join(saveDir, `${name}.json`);
          fs.writeFileSync(file, `${JSON.stringify({ ...pose, name }, null, 2)}\n`);
          return send(res, 200, { ok: true, path: file });
        } catch (e) {
          return send(res, 400, { ok: false, error: String(e.message || e) });
        }
      });
      return;
    }
    if (url === '/poses/') return send(res, 200, [...new Set([...listDir(saveDir), ...listDir(path.join(ROOT, 'poses'))])].map((n) => `${n}.json`));
    let file = extra[url] || path.normalize(path.join(ROOT, url === '/' ? '/index.html' : url));
    if (!extra[url] && !file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
    // saved poses come first, presets after
    const m = url.match(/^\/poses\/([^/]+\.json)$/);
    if (m && fs.existsSync(path.join(saveDir, m[1]))) file = path.join(saveDir, m[1]);
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); res.end('not found'); return; }
      res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
      res.end(data);
    });
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
  const port = Number(arg('port', process.env.PORT || 5178));
  const saveDir = path.resolve(arg('save-dir', process.env.POSE_DOLL_POSES || path.join(process.cwd(), 'pose-doll-poses')));
  startServer(port, {}, saveDir).then(() => {
    console.log(`pose-doll editor: http://localhost:${port}/`);
    console.log(`poses saved from the editor go to: ${saveDir}`);
  });
}
