#!/usr/bin/env python3
"""Make pose JSON from photos of people (MediaPipe Pose -> joint-angle fit), with a check sheet per photo.

  python3 $SKILL/scripts/photo2pose.py photo1.jpg photo2.jpg --out-dir pose-doll-out/photo [--heads 7.5]

For each photo that shows a whole body:
  <stem>.landmarks.json   MediaPipe world landmarks (33 points, metres) and 2D landmarks
  <stem>.pose.json        fitted pose (joints only; add props / intent yourself). "fit" holds the
                          remaining error per bone and the camera direction of the photo
  <stem>.compare.jpg      the photo with the detected skeleton | the mannequin seen from the photo's direction
The fit only knows joint directions: hand grip, held items and jump height are not detected.
Check every compare.jpg; depth (toward / away from the camera) is the least reliable part.

Needs: pip install mediapipe pillow   (the pose model, ~30 MB, is downloaded on first use into ~/.cache/pose-doll/)
"""
import argparse
import json
import os
import subprocess
import sys
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/latest/pose_landmarker_heavy.task'
KEY = {'shoulders': (11, 12), 'hips': (23, 24), 'knees': (25, 26), 'ankles': (27, 28)}
EDGES = [(11, 12), (11, 13), (13, 15), (12, 14), (14, 16), (11, 23), (12, 24), (23, 24), (23, 25), (25, 27), (24, 26), (26, 28),
         (27, 29), (29, 31), (28, 30), (30, 32), (0, 7), (0, 8)]


def landmarker(model_path):
    try:
        import mediapipe as mp
        from mediapipe.tasks import python as mpt
        from mediapipe.tasks.python import vision
    except ImportError:
        sys.exit('mediapipe is not installed: pip install mediapipe pillow')
    if not Path(model_path).exists():
        Path(model_path).parent.mkdir(parents=True, exist_ok=True)
        print(f'downloading pose model to {model_path}', file=sys.stderr)
        urllib.request.urlretrieve(MODEL_URL, model_path)
    opts = vision.PoseLandmarkerOptions(base_options=mpt.BaseOptions(model_asset_path=str(model_path)),
                                        running_mode=vision.RunningMode.IMAGE, num_poses=1)
    return mp, vision.PoseLandmarker.create_from_options(opts)


def detect(mp, det, path):
    from PIL import Image
    im = Image.open(path).convert('RGB')
    im.thumbnail((1600, 1600))
    import numpy as np
    res = det.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=np.asarray(im)))
    if not res.pose_world_landmarks:
        return None, im
    w = [[l.x, l.y, l.z, l.visibility] for l in res.pose_world_landmarks[0]]
    n = [[l.x, l.y, l.visibility] for l in res.pose_landmarks[0]]
    return {'world': w, 'image': n, 'size': list(im.size)}, im


def sheet(im, lm, fit_png, out):
    from PIL import Image, ImageDraw
    T = 512
    a = im.copy()
    d = ImageDraw.Draw(a)
    W, H = a.size
    pts = [(x * W, y * H, v) for x, y, v in lm['image']]
    for i, j in EDGES:
        if pts[i][2] > 0.3 and pts[j][2] > 0.3:
            col = (60, 110, 230) if (i % 2 == 1 and i > 10) else (230, 70, 50) if i > 10 else (240, 240, 80)
            d.line([pts[i][:2], pts[j][:2]], fill=col, width=max(2, W // 200))
    a.thumbnail((T, T))
    b = Image.open(fit_png).convert('RGB')
    b.thumbnail((T, T))
    s = Image.new('RGB', (T * 2, T), 'white')
    s.paste(a, ((T - a.width) // 2, (T - a.height) // 2))
    s.paste(b, (T + (T - b.width) // 2, (T - b.height) // 2))
    s.save(out, quality=85)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('images', nargs='+')
    ap.add_argument('--out-dir', default=str(Path(os.environ.get('POSE_DOLL_OUT') or Path.cwd() / 'pose-doll-out') / 'photo'))
    ap.add_argument('--heads', type=float, default=7.5)
    ap.add_argument('--model', default=str(Path.home() / '.cache' / 'pose-doll' / 'pose_landmarker_heavy.task'))
    ap.add_argument('--min-vis', type=float, default=0.5, help='skip photos where shoulders/hips/knees/ankles are less visible')
    args = ap.parse_args()
    out = Path(args.out_dir)
    out.mkdir(parents=True, exist_ok=True)
    mp, det = landmarker(args.model)
    results = []
    for img in args.images:
        stem = Path(img).stem
        lm, im = detect(mp, det, img)
        if not lm:
            results.append({'image': img, 'skipped': 'no person found'})
            continue
        low = [k for k, (i, j) in KEY.items() if min(lm['world'][i][3], lm['world'][j][3]) < args.min_vis]
        if low:
            results.append({'image': img, 'skipped': f'not a whole body (low visibility: {", ".join(low)})'})
            continue
        lm['source'] = str(img)
        lpath = out / f'{stem}.landmarks.json'
        lpath.write_text(json.dumps(lm))
        r = subprocess.run(['node', str(HERE / 'fit.mjs'), str(lpath), '--heads', str(args.heads), '--out', str(out / f'{stem}.pose.json')],
                           capture_output=True, text=True)
        if r.returncode:
            results.append({'image': img, 'skipped': f'fit failed: {r.stderr[-400:]}'})
            continue
        fit = json.loads(r.stdout)
        pose = json.loads((out / f'{stem}.pose.json').read_text())
        cam = pose['fit']['photoCamera']
        png = out / f'{stem}.fit.png'
        rr = subprocess.run(['node', str(HERE / 'render.mjs'), str(out / f'{stem}.pose.json'), '--azimuth', str(cam['azimuth']),
                             '--elevation', str(cam['elevation']), '--out', str(png), '--size', '512x512'], capture_output=True, text=True)
        if rr.returncode == 0:
            sheet(im, lm, png, out / f'{stem}.compare.jpg')
        results.append({'image': img, 'pose': str(out / f'{stem}.pose.json'), 'compare': str(out / f'{stem}.compare.jpg'),
                        'meanErrorDeg': fit['meanErrorDeg'], 'photoAzimuth': fit['photoAzimuth']})
        print(f'{stem}: error {fit["meanErrorDeg"]} deg', file=sys.stderr, flush=True)
    det.close()
    print(json.dumps(results, ensure_ascii=False, indent=1))


if __name__ == '__main__':
    main()
