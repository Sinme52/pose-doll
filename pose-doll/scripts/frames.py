#!/usr/bin/env python3
"""Generate a set of animation frames (several poses x several views) and check them the way the game plays them.

  python3 $SKILL/scripts/frames.py --character 'docs/concept-art/sprites-src/clone-akane-{view}.webp' \
      --frames walk-ready-a,stand-ready,walk-ready-b --views dl,ul --heads 7.5 --background transparent \
      --uncross --chain-from stand-ready --candidates 2 --name akane-walk-ready [--dry-run]

Frames are preset names / pose files; add '~legs' or '~all' to mirror one (walk-ready-a~legs), or '~picture'
for stride A's legs flipped left-right in the picture of each view (the best stride B for back views).
A frame written '@path' uses an existing image instead of generating one (e.g. the game's current
standing sprite '@docs/concept-art/sprites-src/clone-akane-{view}.webp'), so the GIF shows what the game will show.
'{view}' in --character, '@' frames, --compare and --consistency is replaced by the view key (dl, ul, dr, ur).

Recommended for walk cycles: --chain-from <standing frame> --candidates 2. In back views stride B crosses the
legs in the picture (the back leg hides most of the forward one); the description says so and the result is
checked. If a result comes out uncrossed (CHECK), pick another candidate, or use the picture mirror of stride A
for that view (--view-frames 'ul=walk-ready-a,stand-ready,walk-ready-a~picture') or --uncross.
  --uncross     back views: legs that would cross / hide each other in the picture are opened at the hips
                (image models redraw crossed legs uncrossed, which turns stride b into stride a)
  --chain-from  the standing frame is generated first and sent as IMAGE 3 to the other frames: they keep its
                weapon design and proportions, and copying its legs (together) does no harm. --chain (the first
                generated frame) can make stride b copy the legs of stride a in back views.
  --candidates  n images per frame; the sheet marks the picked one; edit picks.json ({view: {frame: index}})
                and run the same command again: existing results are reused (no API calls) unless --force.

Checks: warnings from the pose description (crossed legs in back views) are printed before generating;
after generating, the lowest foot of every result is compared with its mannequin, and frames whose mannequins
put the feet on opposite sides but whose results do not are reported (CHECK lines, summary.json "checks").

--export: no API calls and no gpt-image skill needed. Writes, for every frame, the mannequin, OpenPose (picture +
keypoints JSON), depth and mask pictures and prompts for other image generators, listed in EXPORT.md.

Outputs in ./pose-doll-out/frames/<name>/ (or $POSE_DOLL_OUT/frames/<name>/):
  <view>/<frame>.pose.png, <view>/<frame>[_k].png (+ .json with prompt and layout: bbox and foot position)
  sheet.jpg                    every view: mannequins, result candidates (picked ones framed green), --compare frames
  <view>-anim.gif              picked results in game order (--sequence, default a, stand, b, stand for three frames)
  <view>-anim-64px.gif         the same at 64 px (and an x4 enlarged copy) to judge the in-game size
  <view>-anim-compare.gif      new | existing side by side (with --compare)
  <view>-mannequin.gif         the mannequins in game order, also at 64 px (always; check before spending on the API)
  picks.json, summary.json
"""
import argparse
import concurrent.futures as cf
import json
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import pose2image as p2i  # noqa: E402

HERE = Path(__file__).resolve().parent
VIEW_KEYS = {'dl': 'facing-lower-left', 'dr': 'facing-lower-right', 'ul': 'facing-upper-left', 'ur': 'facing-upper-right'}


def parse_frame(spec):
    spec = spec.strip()
    if spec.startswith('@'):
        return {'kind': 'existing', 'path': spec[1:], 'label': Path(spec[1:]).stem}
    name, _, mirror = spec.partition('~')
    label = Path(name).stem + (f'~{mirror}' if mirror else '')
    return {'kind': 'pose', 'pose': name, 'mirror': mirror or None, 'label': label.replace('~', '-')}


def flat(path, size, bg=(232, 232, 232)):
    from PIL import Image
    im = Image.open(path).convert('RGBA')
    if im.size != (size, size):
        im = im.resize((size, size), Image.LANCZOS)
    base = Image.new('RGBA', im.size, bg + (255,))
    base.alpha_composite(im)
    return base.convert('RGB')


def gif(paths, out, size, fps):
    from PIL import Image
    frames = [flat(p, size) for p in paths]
    frames[0].save(out, save_all=True, append_images=frames[1:], duration=int(1000 / fps), loop=0, disposal=2)
    outs = [str(out)]
    if size < 128:  # enlarged copy so the small size can be judged on screen
        big = [f.resize((size * 4, size * 4), Image.NEAREST) for f in frames]
        o2 = Path(str(out).replace('.gif', '-x4.gif'))
        big[0].save(o2, save_all=True, append_images=big[1:], duration=int(1000 / fps), loop=0, disposal=2)
        outs.append(str(o2))
    return outs


def side_by_side_gif(rows, out, size, fps):
    from PIL import Image
    frames = []
    for group in zip(*rows):
        tiles = [flat(p, size) for p in group]
        f = Image.new('RGB', (size * len(tiles), size), (232, 232, 232))
        for i, t in enumerate(tiles):
            f.paste(t, (i * size, 0))
        frames.append(f)
    frames[0].save(out, save_all=True, append_images=frames[1:], duration=int(1000 / fps), loop=0, disposal=2)
    return str(out)


def sheet(grid, labels, out, marks=(), T=320):
    """grid: list of (row label, [paths or None]); marks: {(row, col)} drawn with a green frame (the picked candidate)."""
    from PIL import Image, ImageDraw
    cols = max(len(r[1]) for r in grid)
    W, Hh = 150 + cols * T, len(grid) * T + 24
    img = Image.new('RGB', (W, Hh), 'white')
    d = ImageDraw.Draw(img)
    for c, lab in enumerate(labels):
        d.text((150 + c * T + 6, 6), lab, fill='black')
    for r, (rlab, paths) in enumerate(grid):
        y = 24 + r * T
        d.text((6, y + T // 2), rlab, fill='black')
        for c, p in enumerate(paths):
            if p and Path(p).exists():
                img.paste(flat(p, T, (255, 255, 255)), (150 + c * T, y))
                if (r, c) in marks:
                    d.rectangle([150 + c * T + 2, y + 2, 150 + (c + 1) * T - 3, y + T - 3], outline=(30, 170, 60), width=5)
                    d.text((150 + c * T + 8, y + 8), 'picked', fill=(30, 140, 50))
    img.save(out, quality=85)
    return str(out)


def check_feet(plan_v, picks_ok=True):
    """Compare where the lowest foot is (left/right of the feet) between each mannequin and its result,
    and between pairs of frames. Returns a list of warnings."""
    warns = []
    vals = []
    for it in plan_v:
        if it['kind'] != 'pose' or not it.get('image'):
            vals.append(None)
            continue
        m = p2i.lowest_foot_side(it['pose_png'])
        r = p2i.lowest_foot_side(it['image'])
        it['feet_check'] = {'mannequin': m, 'result': r}
        vals.append((m, r))
        if m is not None and r is not None and abs(m) >= 0.12 and abs(r) >= 0.08 and (m > 0) != (r > 0):
            warns.append(f'{it["label"]}: the lowest foot is on the picture-{"left" if r < 0 else "right"} side of the feet, '
                         f'but on the {"left" if m < 0 else "right"} in the mannequin: the stride may be reversed')
    for i in range(len(vals)):
        for j in range(i + 1, len(vals)):
            if not vals[i] or not vals[j]:
                continue
            (mi, ri), (mj, rj) = vals[i], vals[j]
            if None in (mi, ri, mj, rj):
                continue
            if abs(mi) >= 0.12 and abs(mj) >= 0.12 and (mi > 0) != (mj > 0) and abs(ri) >= 0.08 and abs(rj) >= 0.08 and (ri > 0) == (rj > 0):
                warns.append(f'{plan_v[i]["label"]} and {plan_v[j]["label"]} have their feet on the same side although the mannequins differ: '
                             f'they probably show the same stride (check the back foot / visible sole)')
    return warns


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--character', required=True, help="character image; may contain {view}, e.g. 'clone-akane-{view}.webp'")
    ap.add_argument('--frames', required=True, help='comma list of poses (preset / file, ~legs or ~all to mirror) or @existing-image')
    ap.add_argument('--views', default='dl', help='comma list: dl, ul, dr, ur or full view names')
    ap.add_argument('--view-frames', action='append', default=[],
                    help="frames for one view instead of --frames (same count), e.g. 'ul=walk-ready-a,stand-ready,walk-ready-a~picture'")
    ap.add_argument('--sequence', help='game playback order as frame indexes (default 0,1,2,1 for three frames, else in order)')
    ap.add_argument('--compare', help='comma list of existing frames aligned with --frames ({view} allowed; empty entry = none)')
    ap.add_argument('--chain-from', help='frame label (e.g. stand-ready) generated first; its picked result is IMAGE 3 for the other frames. '
                                         'Use a standing frame: its legs are together, so copying them does no harm')
    ap.add_argument('--chain', action='store_true', help='(older) the first generated frame of each view is IMAGE 3 for the others; '
                                                          'in back views later frames may copy its legs, prefer --chain-from')
    ap.add_argument('--candidates', type=int, default=1, help='images per frame (one request each); pick in picks.json')
    ap.add_argument('--force', action='store_true', help='generate again even if results exist (otherwise existing results are reused)')
    ap.add_argument('--uncross', action='store_true', help='back views: open the hips where the legs would cross / hide each other')
    ap.add_argument('--props-file', help='JSON with extra held-item types (see src/prop-catalog.js)')
    ap.add_argument('--consistency', help='image sent as IMAGE 3 to every frame ({view} allowed)')
    ap.add_argument('--heads', type=float)
    ap.add_argument('--fill', default='auto', help="picture height a standing figure fills (0-1); 'auto' (default): 86%% of the character image's figure height")
    ap.add_argument('--style', default='color', choices=('color', 'plain'))
    ap.add_argument('--rig', help='rigged character GLB to pose instead of the mannequin')
    ap.add_argument('--extra', default='')
    ap.add_argument('--background', default='transparent', choices=('transparent', 'opaque', 'auto'))
    ap.add_argument('--quality', default='medium')
    ap.add_argument('--complexity', choices=('low', 'medium', 'high'),
                    help="how much the model plans before drawing (default: the gpt-image skill's default)")
    ap.add_argument('--model', help="image model ID (default: the gpt-image skill's default model)")
    ap.add_argument('--size', default='1024x1024')
    ap.add_argument('--fps', type=float, default=4)
    ap.add_argument('--gif-sizes', default='256,64')
    ap.add_argument('--name', default='frames')
    ap.add_argument('--out-dir', default=str(p2i.OUT_ROOT / 'frames'))
    ap.add_argument('--dry-run', action='store_true', help='mannequins, sheet and mannequin GIFs only; no API calls')
    ap.add_argument('--export', action='store_true',
                    help='for image generators other than GPT Image (no API, no gpt-image skill): like --dry-run, plus OpenPose / '
                         'depth / mask pictures, OpenPose keypoints and prompts for every frame, listed in EXPORT.md')
    ap.add_argument('--character-desc', help='with --export: a text description of the character for text-to-image prompts')
    args = ap.parse_args()
    if args.export:
        args.dry_run = True

    frames = [parse_frame(s) for s in args.frames.split(',') if s.strip()]
    per_view = {}
    for spec in args.view_frames:
        vk, _, lst = spec.partition('=')
        fr = [parse_frame(x) for x in lst.split(',') if x.strip()]
        if len(fr) != len(frames):
            sys.exit(f'--view-frames {vk}: needs {len(frames)} frames like --frames')
        per_view[vk.strip()] = fr
    views = [v.strip() for v in args.views.split(',') if v.strip()]
    seq = [int(i) for i in args.sequence.split(',')] if args.sequence else ([0, 1, 2, 1] if len(frames) == 3 else list(range(len(frames))))
    if any(i < 0 or i >= len(frames) for i in seq):
        sys.exit(f'--sequence indexes must be 0..{len(frames) - 1}')
    compare = [c.strip() for c in args.compare.split(',')] if args.compare else None
    if compare and len(compare) != len(frames):
        sys.exit('--compare needs one entry per frame (leave an entry empty for none)')
    if args.chain_from and args.chain_from not in [f['label'] for f in frames]:
        sys.exit(f'--chain-from {args.chain_from}: not one of the frames ({", ".join(f["label"] for f in frames)})')
    if args.chain_from and args.consistency:
        sys.exit('use either --chain-from or --consistency')
    root = Path(args.out_dir) / args.name
    sizes = [int(s) for s in args.gif_sizes.split(',') if s.strip()]
    fill_t = lambda t, v: t.replace('{view}', v) if t else t  # noqa: E731
    picks_path = root / 'picks.json'
    picks = json.loads(picks_path.read_text(encoding='utf-8')) if picks_path.exists() else {}
    N = max(1, args.candidates)

    # 1. mannequins (always first, cheap)
    plan = {}
    render_warnings = []
    for v in views:
        view = VIEW_KEYS.get(v, v)
        (root / v).mkdir(parents=True, exist_ok=True)
        # one fixed camera for every frame of a view, so all frames share scale and ground line;
        # if any mannequin touches the picture edge, zoom out a little and draw the whole view again
        fill = p2i.auto_fill(fill_t(args.character, v), margin=0.86) if args.fill == 'auto' else float(args.fill)
        for attempt in range(5):
            plan[v] = []
            view_warnings = []
            for i, f in enumerate(per_view.get(v, frames)):
                item = {'index': i, **f, 'view': view}
                if f['kind'] == 'existing':
                    item['image'] = fill_t(f['path'], v)
                    if not Path(item['image']).exists():
                        sys.exit(f'existing frame not found: {item["image"]}')
                else:
                    pose_png = root / v / f'{f["label"]}.pose.png'
                    r = p2i.render_pose(f['pose'], pose_png, view=view, heads=args.heads, mirror=f['mirror'], rig=args.rig,
                                        style=args.style, size=args.size, fill=fill, frame='fixed', props_file=args.props_file,
                                        uncross=args.uncross, export=args.export, extra=args.extra,
                                        target_background=args.background, character_desc=args.character_desc)
                    item.update(pose_png=str(pose_png), description=r['description'], pose_json=r['pose'],
                                warnings=r.get('warnings') or [], uncrossed=r.get('uncrossed'), fill=fill,
                                export_files=r.get('files'))
                    view_warnings += [f'{v}/{f["label"]}: {w}' for w in item['warnings']]
                    # existing candidates (reused unless --force)
                    cands = [root / v / f'{f["label"]}.png'] if N == 1 else [root / v / f'{f["label"]}_{k + 1}.png' for k in range(N)]
                    if not args.force and all(c.exists() for c in cands):
                        item['candidates'] = [str(c) for c in cands]
                plan[v].append(item)
            edge = False
            for it in plan[v]:
                lay = p2i.layout(it['pose_png']) if it.get('pose_png') else None
                if lay and lay['bbox']:
                    x0, y0, x1, y1 = lay['bbox']
                    W, H = lay['size']
                    edge = edge or x0 <= 1 or y0 <= 1 or x1 >= W - 1 or y1 >= H - 1
            if not edge or args.fill != 'auto':
                break
            fill = round(fill * 0.93, 3)
        render_warnings += view_warnings
        manne = [it.get('pose_png') or it['image'] for it in plan[v]]
        for s in sizes:
            gif([manne[i] for i in seq], root / f'{v}-mannequin{"" if s == sizes[0] else f"-{s}px"}.gif', s, args.fps)
    for w in render_warnings:
        print(f'WARNING {w}', file=sys.stderr)

    def pick(v, it):
        k = picks.get(v, {}).get(it['label'], 0)
        k = k if 0 <= k < len(it['candidates']) else 0
        picks.setdefault(v, {})[it['label']] = k
        it['image'] = it['candidates'][k]
        return it['image']

    # 2. generation
    errors = []
    if not args.dry_run:
        def gen(v, it, cons):
            if it.get('candidates'):
                print(f'{v}/{it["label"]}: reusing {len(it["candidates"])} existing result(s)', file=sys.stderr, flush=True)
                return pick(v, it)
            prompt = p2i.build_prompt(it['description'], rig=bool(args.rig), style=args.style, extra=args.extra,
                                      background=args.background, has_props=bool(it['pose_json'].get('props')),
                                      consistency=bool(cons))
            saved, el = p2i.generate(fill_t(args.character, v), it['pose_png'], prompt, root / v, it['label'],
                                     consistency=cons, model=args.model, quality=args.quality, complexity=args.complexity,
                                     size=args.size,
                                     background=args.background, n=N,
                                     meta={'rig': args.rig, 'pose': it['pose_json'], 'view': it['view']},
                                     release_prompt=p2i.release_prompt_for(it['pose_json'], args.background))
            it['candidates'] = saved
            print(f'{v}/{it["label"]}: {len(saved)} image(s) ({el}s)', file=sys.stderr, flush=True)
            return pick(v, it)

        def run_view(v):
            items = [it for it in plan[v] if it['kind'] == 'pose']
            if args.chain_from:
                anchor = next(it for it in items if it['label'] == args.chain_from)
                ref = gen(v, anchor, None)
                rest = [it for it in items if it is not anchor]
                with cf.ThreadPoolExecutor(max(1, len(rest))) as ex:
                    list(ex.map(lambda it: gen(v, it, ref), rest))
            elif args.chain:
                first = None
                for it in items:
                    img = gen(v, it, first)
                    first = first or img
            else:
                cons = fill_t(args.consistency, v) if args.consistency else None
                with cf.ThreadPoolExecutor(max(1, len(items))) as ex:
                    list(ex.map(lambda it: gen(v, it, cons), items))

        with cf.ThreadPoolExecutor(max(1, len(views))) as ex:
            futs = {ex.submit(run_view, v): v for v in views}
            for fu in cf.as_completed(futs):
                try:
                    fu.result()
                except Exception as e:  # keep the other views going
                    errors.append(f'{futs[fu]}: {e}')
                    print(f'FAIL {futs[fu]}: {e}', file=sys.stderr)
    else:
        for v in views:
            for it in plan[v]:
                if it.get('candidates'):
                    pick(v, it)
    picks_path.write_text(json.dumps(picks, indent=2), encoding='utf-8')

    # 3. checks, sheets and GIFs
    labels = [f['label'] for f in frames]
    grid, outputs, marks, checks = [], {}, set(), {}
    for v in views:
        grid.append((f'{v} mannequin', [it.get('pose_png') or it.get('image') for it in plan[v]]))
        have = [len(it.get('candidates') or []) for it in plan[v] if it['kind'] == 'pose']
        for k in range(max(have or [0])):
            row = []
            for c, it in enumerate(plan[v]):
                cands = it.get('candidates') or ([it['image']] if it['kind'] == 'existing' and k == 0 else [])
                row.append(cands[k] if k < len(cands) else None)
                if it['kind'] == 'pose' and k < len(cands) and picks.get(v, {}).get(it['label'], 0) == k:
                    marks.add((len(grid), c))
            grid.append((f'{v} result #{k + 1}', row))
        if compare:
            grid.append((f'{v} existing', [fill_t(c, v) if c else None for c in compare]))
        checks[v] = check_feet(plan[v])
        for w in checks[v]:
            print(f'CHECK {v}: {w}', file=sys.stderr)
        res = [it.get('image') for it in plan[v]]
        o = {'mannequin_gif': str(root / f'{v}-mannequin.gif')}
        if all(res) and any(it['kind'] == 'pose' for it in plan[v]) and all(it.get('candidates') or it['kind'] == 'existing' for it in plan[v]):
            for s in sizes:
                o[f'gif_{s}'] = gif([res[i] for i in seq], root / f'{v}-anim{"" if s == sizes[0] else f"-{s}px"}.gif', s, args.fps)
            if compare and all(compare):
                o['compare_gif'] = side_by_side_gif([[res[i] for i in seq], [fill_t(compare[i], v) for i in seq]],
                                                    root / f'{v}-anim-compare.gif', sizes[0], args.fps)
        outputs[v] = o
    sheet_path = sheet(grid, labels, root / 'sheet.jpg', marks)
    summary = {'name': args.name, 'sequence': seq, 'frames': labels, 'sheet': sheet_path, 'outputs': outputs, 'errors': errors,
               'warnings': render_warnings, 'checks': checks, 'picks': picks,
               'items': {v: [{k: it.get(k) for k in ('label', 'kind', 'pose_png', 'image', 'candidates', 'view', 'uncrossed', 'warnings', 'feet_check')} |
                             {'layout': p2i.layout(it['image']) if it.get('image') else None} for it in plan[v]] for v in views}}
    (root / 'summary.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding='utf-8')
    if args.export:
        lines = [f'# Pose pack: {args.name}', '',
                 'Pose references for image generators other than GPT Image. Per frame:',
                 '- `<frame>.pose.png` mannequin (blue = own left limbs, red = own right; grey stand-ins = held items)',
                 '  -> give it with your character image to tools that take image references, with the text of `<frame>.pose.prompts.txt` (section 1)',
                 '- `<frame>.pose.openpose.png` / `.openpose.json` -> ControlNet OpenPose;  `<frame>.pose.depth.png` -> ControlNet Depth;'
                 '  `<frame>.pose.mask.png` -> silhouette for inpainting / masks (text prompt: section 2 of the prompts file)',
                 f'- game order of the frames: {", ".join(frames[i]["label"] for i in seq)} (see `<view>-mannequin.gif`)', '']
        for v in views:
            lines += [f'## {v} ({VIEW_KEYS.get(v, v)})', '']
            for it in plan[v]:
                if it['kind'] != 'pose':
                    continue
                files = it.get('export_files') or {}
                lines.append(f'- **{it["label"]}**: ' + ', '.join(f'`{v}/{n}`' for n in files.values()))
                for w in it.get('warnings') or []:
                    lines.append(f'  - note: {w}')
            lines.append('')
        (root / 'EXPORT.md').write_text('\n'.join(lines), encoding='utf-8')
    print(json.dumps({'ok': not errors, 'dir': str(root), 'sheet': sheet_path, 'outputs': outputs, 'errors': errors,
                      'warnings': render_warnings, 'checks': checks, 'picks': str(picks_path)}, ensure_ascii=False, indent=2))
    if errors:
        sys.exit(1)


if __name__ == '__main__':
    if not shutil.which('node'):
        sys.exit('node is required for the pose render')
    main()
