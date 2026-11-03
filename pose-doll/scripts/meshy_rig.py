#!/usr/bin/env python3
"""OPTIONAL: make a rigged 3D model of a character with Meshy, for use with --model / --rig.

The pose-doll tool works without this. Meshy costs credits (about 40 per character:
image-to-3d 30 + remesh 5 + rigging 5, observed 2026-11-03), so nothing is submitted
unless --yes is given; without it the script only checks the login and prints the plan.

Pipeline:
  0. (with --character) pose2image.py --pose a-pose: front view, A-pose, no weapon (GPT Image, medium)
  1. meshy image-to-3d  --pose-mode a-pose, textured
  2. meshy remesh       --target-polycount 30000 (image-to-3d output is far above the rigging limit)
  3. meshy rigging      Mixamo-style bones
  4. download the rigged GLB (+ optional walking/running clips) into ./pose-doll-out/models/

Examples:
  python3 $SKILL/scripts/meshy_rig.py --character akane-dl.webp --name akane            # plan only
  python3 $SKILL/scripts/meshy_rig.py --character akane-dl.webp --name akane --yes      # run
  python3 $SKILL/scripts/meshy_rig.py --image apose.png --name mio --yes --clips walking

Re-running with the same --name resumes: finished stages are reused from ./pose-doll-out/meshy/<name>/state.json.
Needs Node.js 22.12+ (meshy-cli 0.4.0 via npm exec) and a Meshy login:
  npm exec --yes --package=meshy-cli@0.4.0 -- meshy auth login --device
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT_ROOT = Path(os.environ.get('POSE_DOLL_OUT') or Path.cwd() / 'pose-doll-out')
CLI_VERSION = '0.4.0'
OBSERVED_CREDITS = {'image-to-3d': 30, 'remesh': 5, 'rigging': 5}  # actual charges seen on 2026-11-03
NO_WEAPON = ("Front view, facing straight at the viewer. Both hands are empty and open: the character is NOT holding "
             "any weapon or tool (leave held items out entirely; keep all worn clothing, armor and accessories). "
             "Neutral calm expression. Even, flat studio lighting, no strong shadows.")


def runner():
    exe = shutil.which('meshy')
    if exe:
        v = subprocess.run([exe, '--version'], capture_output=True, text=True).stdout.strip()
        if v.endswith(CLI_VERSION):
            return [exe]
    return ['npm', 'exec', '--yes', f'--package=meshy-cli@{CLI_VERSION}', '--', 'meshy']


def meshy(args, *, v1=True, check=True):
    cmd = RUN + args + (['--output-schema', 'v1'] if v1 else []) + ['--format', 'json', '--no-update-check']
    res = subprocess.run(cmd, capture_output=True, text=True)
    try:
        data = json.loads(res.stdout)
    except json.JSONDecodeError:
        sys.exit(f'meshy {" ".join(args[:2])} failed (exit {res.returncode}):\n{res.stderr[-1500:]}')
    if check and v1 and not data.get('ok'):
        sys.exit(f'meshy {" ".join(args[:2])} failed: {json.dumps(data.get("error"), ensure_ascii=False)}')
    return data, res.returncode


def log(msg):
    print(msg, file=sys.stderr, flush=True)


class Job:
    def __init__(self, name):
        self.ws = Path.cwd()  # write boundary for the CLI: everything stays inside the working directory
        self.dir = OUT_ROOT / 'meshy' / name
        self.dir.mkdir(parents=True, exist_ok=True)
        self.state_path = self.dir / 'state.json'
        self.state = json.loads(self.state_path.read_text()) if self.state_path.exists() else {'tasks': {}, 'credits': {}}

    def save(self):
        self.state_path.write_text(json.dumps(self.state, indent=2))

    @property
    def project(self):
        return self.state.get('project_dir')

    def stage(self, resource, create_args, stage):
        """Submit (once) and wait for one Meshy task; returns its task snapshot path."""
        tid = self.state['tasks'].get(resource)
        common = ['--workspace', str(self.ws)]
        if not tid:
            extra = ['--project', self.project, '--stage', stage] + common if self.project else []
            data, _ = meshy([resource, 'create'] + create_args + ['--async'] + extra)
            tid = data['result']['submission']['task_id']
            self.state['tasks'][resource] = tid
            self.save()
            log(f'{resource}: submitted {tid}')
        if not self.project:
            data, _ = meshy(['project', 'init', '--root', str(self.dir / 'project'), '--name', self.dir.name,
                             '--task-id', tid, '--task-type', resource] + common)
            self.state['project_dir'] = data['result']['project_dir']
            self.save()
        log(f'{resource}: waiting for {tid} (usually a few minutes)')
        data, code = meshy([resource, 'wait', tid, '--timeout', '900', '--project', self.project, '--stage', stage] + common, check=False)
        task = (data.get('result') or {}).get('task') or {}
        if not data.get('ok') or task.get('status') != 'SUCCEEDED':
            sys.exit(f'{resource} {tid} did not succeed (exit {code}): {json.dumps(data.get("error") or task.get("task_error"), ensure_ascii=False)}\n'
                     f'Re-run the same command to resume waiting; the task is not submitted again.')
        self.state['credits'][resource] = task.get('consumed_credits')
        self.save()
        log(f'{resource}: done, {task.get("consumed_credits")} credits')
        return str(Path(self.project) / f'task_{tid}.json')

    def download(self, task_json, asset, out, stage):
        args = ['download', '--task-json', task_json, '--output', str(out), '--project', self.project,
                '--stage', stage, '--workspace', str(self.ws)]
        args += ['--asset', asset] if asset else ['--model-format', 'glb']
        if Path(out).exists():
            args.append('--overwrite')
        meshy(args)
        return str(out)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument('--character', help='character image; an A-pose front view is made from it first (GPT Image)')
    src.add_argument('--image', help='ready A-pose front-view image of the character (skips the GPT step)')
    ap.add_argument('--name', required=True, help='short id, e.g. akane -> pose-doll-out/models/akane-rigged.glb')
    ap.add_argument('--heads', type=float, default=7.5, help='heads tall for the A-pose mannequin (with --character)')
    ap.add_argument('--polycount', type=int, default=30000)
    ap.add_argument('--height', type=float, default=1.7, help='character height in metres for rigging')
    ap.add_argument('--clips', default='', help='also download bundled clips: walking,running')
    ap.add_argument('--out', help='rigged GLB path (default ./pose-doll-out/models/<name>-rigged.glb)')
    ap.add_argument('--tasks', default='', help='reuse existing Meshy tasks, e.g. image-to-3d=ID,remesh=ID,rigging=ID')
    ap.add_argument('--yes', action='store_true', help='actually submit paid Meshy tasks')
    args = ap.parse_args()

    global RUN
    RUN = runner()
    auth, code = meshy(['auth', 'status'], v1=False, check=False)
    if not (auth.get('authenticated') and auth.get('verified')):
        sys.exit('Not logged in to Meshy. Log in first (opens a browser approval):\n'
                 f'  {" ".join(RUN)} auth login --device\n'
                 '(an AI agent should follow the meshy-3d-generation skill for the login flow)')
    bal, _ = meshy(['balance'])
    job = Job(args.name)
    for kv in filter(None, args.tasks.split(',')):
        k, v = kv.split('=', 1)
        job.state['tasks'].setdefault(k.strip(), v.strip())
    todo = [r for r in ('image-to-3d', 'remesh', 'rigging') if r not in job.state['tasks']]
    plan = {
        'name': args.name,
        'balance': bal['result']['balance'],
        'stages_to_submit': todo,
        'estimated_credits': sum(OBSERVED_CREDITS[r] for r in todo),
        'estimate_source': 'charges observed 2026-11-03; current prices: https://docs.meshy.ai/en/api/pricing',
        'gpt_image_step': bool(args.character) and 'image-to-3d' in todo,
        'reused_tasks': job.state['tasks'],
    }
    if not args.yes:
        print(json.dumps({'plan': plan, 'next': 'nothing was submitted; add --yes to run'}, ensure_ascii=False, indent=2))
        return
    if plan['balance'] < plan['estimated_credits']:
        sys.exit(f'Not enough Meshy credits: balance {plan["balance"]}, need about {plan["estimated_credits"]}')

    # 0. A-pose front view
    image = args.image
    if 'image-to-3d' in todo and args.character:
        log('making an A-pose front view with GPT Image')
        res = subprocess.run([sys.executable, str(HERE / 'pose2image.py'), '--character', args.character, '--pose', 'a-pose',
                              '--heads', str(args.heads), '--name', f'{args.name}-apose', '--out-dir', str(job.dir),
                              '--background', 'opaque', '--extra', NO_WEAPON], capture_output=True, text=True)
        if res.returncode != 0:
            sys.exit(f'A-pose image failed:\n{res.stderr[-1500:]}')
        image = json.loads(res.stdout)['files'][0]
        log(f'A-pose image: {image}  (check it: front view, A-pose, no held items)')

    # 1-3. Meshy stages
    t1 = job.stage('image-to-3d', ['--image-url', str(image), '--model-type', 'standard', '--pose-mode', 'a-pose',
                                   '--should-texture', 'true', '--enable-pbr', 'true', '--texture-resolution', '2k',
                                   '--remove-lighting', 'true', '--target-formats', 'glb'], 'geometry')
    preview = job.download(t1, 'thumbnail.primary', job.dir / 'preview.png', 'preview')
    t2 = job.stage('remesh', ['--input-task-id', job.state['tasks']['image-to-3d'], '--topology', 'triangle',
                              '--target-polycount', str(args.polycount), '--target-formats', 'glb'], 'remesh')
    t3 = job.stage('rigging', ['--input-task-id', job.state['tasks']['remesh'], '--height-meters', str(args.height)], 'rigging')

    # 4. deliver
    out = Path(args.out or OUT_ROOT / 'models' / f'{args.name}-rigged.glb').resolve()
    out.parent.mkdir(parents=True, exist_ok=True)
    files = [job.download(t3, 'result.rigged_character_glb_url', out, 'delivered')]
    for clip in filter(None, args.clips.split(',')):
        files.append(job.download(t3, f'result.basic_animations.{clip.strip()}_glb_url', out.with_name(f'{args.name}-{clip.strip()}.glb'), 'delivered'))
    out.chmod(0o644)
    sidecar = out.with_suffix('.json')
    sidecar.write_text(json.dumps({
        'name': args.name, 'file': out.name, 'made_with': f'Meshy (meshy-cli {CLI_VERSION}) via meshy_rig.py',
        'source_image': str(image or args.character),
        'pipeline': [{'stage': r, 'task_id': job.state['tasks'][r], 'credits': job.state['credits'].get(r)} for r in ('image-to-3d', 'remesh', 'rigging')],
        'notes': 'Bind pose is the A-pose. Use with: render.mjs --model / pose2image.py --rig',
    }, ensure_ascii=False, indent=2))
    print(json.dumps({'ok': True, 'files': files, 'sidecar': str(sidecar), 'preview': preview,
                      'credits': job.state['credits']}, ensure_ascii=False, indent=2))


RUN = []

if __name__ == '__main__':
    main()
