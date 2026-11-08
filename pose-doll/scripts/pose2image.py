#!/usr/bin/env python3
"""Draw a character in a mannequin pose with GPT Image (images/edits with two or three input images).

  1. renders the pose with render.mjs (PNG + an English description of the pose in picture terms)
  2. sends [character image, pose image, (optional) consistency image] + a prompt giving each image its role
  3. saves the result, a sidecar JSON (prompt, pose, description, layout) and a side-by-side check sheet

Examples:
  python3 $SKILL/scripts/pose2image.py --character docs/concept-art/sprites-src/clone-akane-dl.webp --pose run
  python3 $SKILL/scripts/pose2image.py --character akane.webp --pose my-pose.json --view facing-upper-left \
      --background transparent --extra "She holds the pulse rifle in both hands."
  python3 $SKILL/scripts/pose2image.py --character akane.webp --pose walk-ready-a --mirror legs --dry-run
  python3 $SKILL/scripts/pose2image.py --character akane.webp --pose walk-ready-b --consistency pose-doll-out/akane--walk-ready-a.png

For a whole set of animation frames (sheet, GIF in game order, comparison) use frames.py.
Needs the gpt-image skill (or the older gpt-image-2-5) with its OPENAI_IMAGE_API_KEY, and Node + Playwright
for the pose render. The model is the skill's default unless --model is given.
"""
import argparse
import glob
import importlib.util
import io
import json
import os
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
# outputs go to the working directory, never into the skill folder
OUT_ROOT = Path(os.environ.get('POSE_DOLL_OUT') or Path.cwd() / 'pose-doll-out')

# print JSON as UTF-8 on Windows too (callers such as Claude read it as UTF-8, not cp932)
for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, 'reconfigure'):
        _stream.reconfigure(encoding='utf-8')


def utf8_env():
    """Environment for child Python processes: make them write UTF-8 to pipes, as node does.
    On Windows, text pipes and text files otherwise use the ANSI code page (cp932 on Japanese
    Windows), which breaks on non-ASCII paths such as a folder under ドキュメント."""
    return {**os.environ, 'PYTHONIOENCODING': 'utf-8'}


PROMPT = """You are given {n_images} images.
IMAGE 1 is the CHARACTER reference. Copy this character exactly: identical face, hairstyle and hair color, outfit, armor, colors, body proportions and build, accessories, equipment and any weapon, and the same art style and rendering quality.
IMAGE 2 is only a POSE reference: a featureless jointed artist's mannequin. Take ONLY the body pose, the limb positions and the camera angle and framing from it. Copy nothing else from it: not its grey/blue/red colors, not its ball joints, not its smooth plastic surface, not its face markings, not its stick-like body shape or proportions.{color_note}{prop_note}{consistency_note}
Task: draw the character from IMAGE 1 in exactly the pose of IMAGE 2, seen from the same camera angle, at the same size and position in the picture as the mannequin.
Pose details (picture-left / picture-right mean the left and right edges of the image): {description}
{extra}{keep_note}
Output a single full-body character, {background}, no text, no frame, no mannequin."""

MODEL_PROMPT = """You are given {n_images} images.
IMAGE 1 is the CHARACTER reference. Copy this character exactly: identical face, hairstyle and hair color, outfit, armor, colors, body proportions and build, accessories, equipment and any weapon, and the same art style and rendering quality.
IMAGE 2 is a rough 3D render of the SAME character, already standing in the target pose. Take the body pose, the limb positions, the silhouette and the camera angle and framing from IMAGE 2, but take every visual detail and the painted rendering style from IMAGE 1 (the 3D render has simplified, lower-quality textures and stiff hands: do not copy those).{prop_note}{consistency_note}
Task: draw the character from IMAGE 1 in exactly the pose of IMAGE 2, seen from the same camera angle, at the same size and position in the picture.
Pose details (picture-left / picture-right mean the left and right edges of the image): {description}
{extra}{keep_note}
Output a single full-body character, {background}, no text, no frame."""

COLOR_NOTE = " On the mannequin, the BLUE limbs are the character's own LEFT arm and leg, and the RED limbs are the character's own RIGHT arm and leg."
PROP_NOTE = (" The grey objects in IMAGE 2 (with an orange marker on the muzzle, the blade tip or the front of a shield)"
             " are only stand-ins for the items the character holds: follow IMAGE 2 for which hand holds each item, where,"
             " and which way it points or faces, even where this differs from how it is held in IMAGE 1, but draw the"
             " character's real items from IMAGE 1 with their own design, size and colors. Items IMAGE 1 does not have"
             " are drawn to match the character's style and the description below.")
CONSISTENCY_NOTE = (" IMAGE 3 is another frame of the same animation, already drawn for this character. Match it exactly in"
                    " its looks: the same weapon and equipment design, size and colors, the same body proportions, the same"
                    " figure size in the picture, the same line work and shading. Take NOTHING about the pose from IMAGE 3:"
                    " not the stance, not which leg is in front, not where the feet are; the pose comes only from IMAGE 2"
                    " and the pose details below.")
KEEP_PLAIN = "Keep everything the character carries in IMAGE 1, held naturally in this new pose."
KEEP_PROPS = "Keep everything else the character wears or carries in IMAGE 1."
BACKGROUND = {'transparent': 'fully transparent background, no ground, no cast shadow',
              'opaque': 'plain light background', 'auto': 'simple background'}


# image skills, newest first: gpt-image, then the older gpt-image-2-5
SKILL_NAMES = ('gpt-image', 'gpt-image-2-5')
FALLBACK_MODEL = 'gpt-image-2.5-sunburst'  # only for old skills without 'edit' that also lack DEFAULT_MODEL


def skill_script_candidates():
    """Every gpt_image.py found, in the order they are tried (GPT_IMAGE_SCRIPT first)."""
    paths = [os.environ['GPT_IMAGE_SCRIPT']] if os.environ.get('GPT_IMAGE_SCRIPT') else []
    for name in SKILL_NAMES:
        rel = f'{name}/scripts/gpt_image.py'
        paths += glob.glob(str(Path(__file__).resolve().parents[2] / rel))  # installed next to this skill
        paths += glob.glob(str(Path.home() / '.claude/skills' / rel))
        paths += sorted(glob.glob(f'/root/.claude/skills/synced/*/{rel}'))
        paths += sorted(glob.glob(str(Path.home() / '.claude/skills/**' / rel), recursive=True))
    return list(dict.fromkeys(paths))


def skill_script():
    """Path of the image skill's scripts/gpt_image.py (GPT_IMAGE_SCRIPT overrides the search)."""
    paths = skill_script_candidates()
    if not paths:
        sys.exit('gpt-image skill script not found; set GPT_IMAGE_SCRIPT=/path/to/gpt_image.py '
                 '(or use --export to make pose packs for other image generators)')
    return paths[0]


def skill_name(script):
    """Folder name of the skill a gpt_image.py belongs to (e.g. gpt-image)."""
    return Path(script).resolve().parents[1].name


_EDIT_SUPPORT = {}


def skill_has_edit(script):
    """True if the skill offers the public 'edit' command (generation from reference images)."""
    if script not in _EDIT_SUPPORT:
        r = subprocess.run([sys.executable, script, 'edit', '--help'], capture_output=True, text=True,
                           encoding='utf-8', env=utf8_env())
        _EDIT_SUPPORT[script] = r.returncode == 0 and '--image' in r.stdout
    return _EDIT_SUPPORT[script]


def load_skill():
    """Older skills without 'edit': import the script to reuse its HTTP helpers."""
    spec = importlib.util.spec_from_file_location('gpt_image', skill_script())
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def as_png(path):
    """Bytes of the image as PNG (the edits endpoint is happiest with PNG)."""
    try:
        from PIL import Image
    except ImportError:
        return Path(path).read_bytes(), 'image/' + Path(path).suffix.lstrip('.').replace('jpg', 'jpeg')
    buf = io.BytesIO()
    Image.open(path).convert('RGBA').save(buf, 'PNG')
    return buf.getvalue(), 'image/png'


def render_pose(pose, out_png, *, view=None, heads=None, mirror=None, rig=None, style='color', size='1024x1024',
                azimuth=None, elevation=None, fill=None, frame=None, props_file=None, uncross=False,
                export=False, extra='', target_background=None, character_desc=None):
    """Render one pose with render.mjs; returns its JSON line (png, sidecar, description)."""
    cmd = ['node', str(HERE / 'render.mjs'), pose, '--out', str(out_png), '--style', style, '--size', size]
    if view:
        cmd += ['--view', view]
    if heads:
        cmd += ['--heads', str(heads)]
    if mirror:
        cmd += ['--mirror', mirror]
    if rig:
        cmd += ['--model', rig]
    if fill:
        cmd += ['--fill', str(fill)]
    if frame:
        cmd += ['--frame', frame]
    if props_file:
        cmd += ['--props-file', str(props_file)]
    if uncross:
        cmd.append('--uncross')
    if export:  # extra pictures and prompts for other image generators
        cmd.append('--export')
        if extra:
            cmd += ['--extra', extra]
        if target_background:
            cmd += ['--target-background', target_background]
        if character_desc:
            cmd += ['--character-desc', character_desc]
    if azimuth is not None:
        cmd += ['--azimuth', str(azimuth)]
    if elevation is not None:
        cmd += ['--elevation', str(elevation)]
    res = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8')
    if res.returncode != 0:
        raise RuntimeError(f'pose render failed:\n{res.stderr}')
    if res.stderr.strip():
        print(res.stderr.strip(), file=sys.stderr)  # includes 'warning (...): ...' lines
    out = json.loads(res.stdout.strip().splitlines()[-1])
    out['pose'] = json.load(open(out['sidecar'], encoding='utf-8'))['pose']
    return out


def build_prompt(description, *, rig=False, style='color', extra='', background='opaque', has_props=False, consistency=False):
    template = MODEL_PROMPT if rig else PROMPT
    return template.format(
        n_images='three' if consistency else 'two',
        color_note=COLOR_NOTE if style == 'color' and not rig else '',
        prop_note=PROP_NOTE if has_props else '',
        consistency_note=CONSISTENCY_NOTE if consistency else '',
        description=description,
        extra=(extra.strip() + '\n') if extra.strip() else '',
        keep_note=KEEP_PROPS if has_props else KEEP_PLAIN,
        background=BACKGROUND[background],
    )


def layout(path):
    """Bounding box of the figure and where its feet are, in pixels: {size, bbox, foot, center_x}."""
    try:
        from PIL import Image, ImageChops
    except ImportError:
        return None
    im = Image.open(path).convert('RGBA')
    alpha = im.getchannel('A')
    if alpha.getextrema()[0] < 250:  # has transparency
        mask = alpha.point(lambda a: 255 if a > 24 else 0)
    else:  # opaque: compare with the corner colour
        bg = Image.new('RGB', im.size, im.getpixel((2, 2))[:3])
        diff = ImageChops.difference(im.convert('RGB'), bg).convert('L')
        mask = diff.point(lambda d: 255 if d > 28 else 0)
    box = mask.getbbox()
    if not box:
        return {'size': list(im.size), 'bbox': None, 'foot': None, 'center_x': None}
    x0, y0, x1, y1 = box
    band = mask.crop((x0, max(y0, y1 - max(2, (y1 - y0) // 40)), x1, y1))
    xs = [x for x in range(band.width) for y in range(band.height) if band.getpixel((x, y))]
    foot_x = x0 + (sum(xs) / len(xs) if xs else band.width / 2)
    cols = mask.crop(box).resize((x1 - x0, 1))  # column coverage
    cov = [cols.getpixel((x, 0)) for x in range(cols.width)]
    tot = sum(cov) or 1
    cx = x0 + sum(i * c for i, c in enumerate(cov)) / tot
    return {'size': list(im.size), 'bbox': [x0, y0, x1, y1], 'foot': [round(foot_x, 1), y1], 'center_x': round(cx, 1)}


def _mask(path):
    from PIL import Image, ImageChops
    im = Image.open(path).convert('RGBA')
    alpha = im.getchannel('A')
    if alpha.getextrema()[0] < 250:
        return alpha.point(lambda a: 255 if a > 24 else 0)
    bg = Image.new('RGB', im.size, im.getpixel((2, 2))[:3])
    return ImageChops.difference(im.convert('RGB'), bg).convert('L').point(lambda d: 255 if d > 28 else 0)


def lowest_foot_side(path, band=0.2):
    """Which side of the feet area the lowest foot (the one nearest the viewer) is on:
    (x_lowest - centre of the feet band) / width of the band, -0.5..0.5. Negative = picture-left.
    The band is the lowest `band` of the figure, so arms and held items do not shift it. None if unknown."""
    try:
        from PIL import Image  # noqa: F401
    except ImportError:
        return None
    m = _mask(path)
    box = m.getbbox()
    if not box:
        return None
    x0, y0, x1, y1 = box
    h = y1 - y0
    feet = m.crop((x0, int(y1 - band * h), x1, y1))
    fb = feet.getbbox()
    if not fb:
        return None
    lo = feet.crop((fb[0], max(0, feet.height - max(2, int(0.03 * h))), fb[2], feet.height))
    cols = list(lo.resize((lo.width, 1)).getdata())
    tot = sum(cols)
    if not tot:
        return None
    xl = sum(i * c for i, c in enumerate(cols)) / tot
    w = fb[2] - fb[0]
    return round((xl - w / 2) / max(1, w), 3)


def auto_fill(character, default=0.82, margin=0.97):
    """Camera fill that makes a standing mannequin about as tall in the picture as the character image (times margin)."""
    lay = layout(character)
    if not lay or not lay['bbox']:
        return default
    h = (lay['bbox'][3] - lay['bbox'][1]) / lay['size'][1]
    return round(min(0.97, max(0.3, h * margin)), 3)


def generate(character, pose_png, prompt, out_dir, stem, *, consistency=None, model=None,
             quality='medium', complexity=None, size='1024x1024', background='opaque', n=1, meta=None, release_prompt=None):
    """Generate with the gpt-image skill (or the older gpt-image-2-5); returns (saved image paths, seconds).
    model None = the skill's own default model; complexity None = the API default.
    Uses the skill's public 'edit' command when it has one, else its HTTP helpers directly (older skills).
    POSE_DOLL_GPT_MODE=cli|direct forces one way. Every sidecar JSON also gets the layout of the result."""
    script = skill_script()
    mode = os.environ.get('POSE_DOLL_GPT_MODE') or ('cli' if skill_has_edit(script) else 'direct')
    extra = {'character': str(character), 'pose_png': str(pose_png), 'consistency': str(consistency) if consistency else None,
             **(meta or {})}
    if mode == 'cli':
        saved, elapsed = _generate_cli(script, [character, pose_png] + ([consistency] if consistency else []), prompt,
                                       out_dir, stem, model=model, quality=quality, complexity=complexity, size=size,
                                       background=background, n=n, extra=extra, release_prompt=release_prompt)
    else:
        saved, elapsed = _generate_direct(character, pose_png, consistency, prompt, out_dir, stem, model=model,
                                          quality=quality, complexity=complexity, size=size, background=background, n=n, extra=extra)
    for s in saved:
        side = Path(s).with_suffix('.json')
        if side.exists():
            d = json.loads(side.read_text(encoding='utf-8'))
            d['layout'] = layout(s)
            d['pose_layout'] = layout(pose_png)
            d['via'] = f'{skill_name(script)} skill ({"edit command" if mode == "cli" else "direct HTTP helpers"})'
            side.write_text(json.dumps(d, ensure_ascii=False, indent=2), encoding='utf-8')
    return saved, elapsed


def _generate_cli(script, images, prompt, out_dir, stem, *, model, quality, complexity, size, background, n, extra, release_prompt):
    import tempfile
    with tempfile.TemporaryDirectory() as tmp:
        sent = []
        for i, p in enumerate(images):  # the same PNG conversion as before, so results do not change
            data, mime = as_png(p)
            q = Path(tmp) / f'input{i + 1}.{"png" if mime == "image/png" else Path(p).suffix.lstrip(".")}'
            q.write_bytes(data)
            sent.append(str(q))
        metaf = Path(tmp) / 'meta.json'
        metaf.write_text(json.dumps({**extra, 'input_files': [str(p) for p in images]}, ensure_ascii=False), encoding='utf-8')
        cmd = [sys.executable, script, 'edit']
        for p in sent:
            cmd += ['--image', p]
        cmd += ['--prompt', prompt, '--quality', quality, '--size', size, '--format', 'png',
                '--n', str(n), '--name', stem, '--out-dir', str(out_dir), '--meta-json', str(metaf)]
        if model:  # otherwise the skill's own default model
            cmd += ['--model', model]
        if complexity:  # otherwise the skill's own default
            cmd += ['--complexity', complexity]
        if background != 'auto':
            cmd += ['--background', background]
        if release_prompt:
            cmd += ['--release-prompt', release_prompt]
        r = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8', env=utf8_env())
    if r.returncode != 0:
        try:
            msg = json.loads(r.stderr.strip().splitlines()[-1])['error']
        except (ValueError, KeyError, IndexError):
            msg = r.stderr.strip()[-800:]
        raise RuntimeError(f'{skill_name(script)} edit failed: {msg}')
    out = json.loads(r.stdout)
    saved = [str(p) for p in out['files']]
    for s in saved:  # input_images in the sidecar point at temporary copies: record the real files
        side = Path(s).with_suffix('.json')
        if side.exists():
            d = json.loads(side.read_text(encoding='utf-8'))
            d['input_images'] = d.pop('input_files', d.get('input_images'))
            side.write_text(json.dumps(d, ensure_ascii=False, indent=2), encoding='utf-8')
    return saved, out.get('elapsed_sec')


def _generate_direct(character, pose_png, consistency, prompt, out_dir, stem, *, model, quality, complexity, size, background, n, extra):
    gi = load_skill()
    key = gi.load_api_key()
    model = model or getattr(gi, 'DEFAULT_MODEL', FALLBACK_MODEL)
    images = [('character.png', character), ('pose.png', pose_png)] + ([('consistency.png', consistency)] if consistency else [])
    files = []
    for name, p in images:
        data, mime = as_png(p)
        files.append(('image[]', name, data, mime))
    fields = [('model', model), ('prompt', prompt), ('quality', quality), ('size', size),
              ('output_format', 'png'), ('n', str(n))]
    if background != 'auto':
        fields.append(('background', background))
    if complexity:
        fields.append(('complexity', complexity))
    body, ctype = gi._multipart(fields, files)
    payload, rid, elapsed = gi._post(f'{gi.base_url()}/images/edits', body, ctype, key)
    full = {'prompt': prompt, 'model': model, 'quality': quality, 'size': size, 'background': background,
            'request_id': rid, 'elapsed_sec': round(elapsed, 1), **extra}
    saved = [str(s) for s in gi.save_results(payload, Path(out_dir), stem, 'png', full)]
    return saved, round(elapsed, 1)


def release_prompt_for(pose_json, background='opaque'):
    """Plain description of a pose result, for a later 'release' at xhigh (no IMAGE 1 / IMAGE 2 wording)."""
    intent = (pose_json or {}).get('intent') or 'the character in the pose of this picture'
    bg = {'transparent': 'transparent background', 'opaque': 'plain light background', 'auto': 'simple background'}.get(background, '')
    return f'Full-body game character: {intent.rstrip(".")}. Single character, {bg}, no text, no frame.'


def check_sheet(paths, out):
    try:
        from PIL import Image
    except ImportError:
        return None
    T = 512
    sheet = Image.new('RGB', (T * len(paths), T), 'white')
    for i, p in enumerate(paths):
        im = Image.open(p).convert('RGBA')
        im.thumbnail((T, T))
        bg = Image.new('RGBA', (T, T), (255, 255, 255, 255))
        bg.alpha_composite(im, ((T - im.width) // 2, (T - im.height) // 2))
        sheet.paste(bg.convert('RGB'), (i * T, 0))
    sheet.save(out, quality=88)
    return str(out)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--character', required=True, help='character reference image')
    ap.add_argument('--pose', required=True, help='pose JSON file, preset name in poses/, or inline JSON')
    ap.add_argument('--view', help='camera view preset (overrides the pose file)')
    ap.add_argument('--azimuth', type=float)
    ap.add_argument('--elevation', type=float)
    ap.add_argument('--heads', type=float, help='mannequin height in heads; match the character (e.g. 7.5 realistic, 3 chibi)')
    ap.add_argument('--mirror', nargs='?', const='all', choices=('all', 'legs', 'picture'),
                    help="swap the character's left and right: 'all' (default; held items change hands), 'legs' (only the legs) or "
                         "'picture' (legs flipped left-right in this view's picture: stride B for back views)")
    ap.add_argument('--style', default='color', choices=('color', 'plain'))
    ap.add_argument('--fill', help="how much of the picture height a standing figure fills (0-1), or 'auto' to match the character image")
    ap.add_argument('--rig', help='rigged character GLB (e.g. Meshy auto-rig) to pose instead of the mannequin')
    ap.add_argument('--props-file', help='JSON with extra held-item types (see src/prop-catalog.js)')
    ap.add_argument('--consistency', help='an already generated frame of this character, sent as IMAGE 3 to keep details identical')
    ap.add_argument('--uncross', action='store_true', help='back views: open the hips when the legs would cross / hide each other')
    ap.add_argument('--extra', default='', help='extra instructions; must agree with the pose (or say what should change from IMAGE 1)')
    ap.add_argument('--size', default='1024x1024')
    ap.add_argument('--background', default='opaque', choices=('transparent', 'opaque', 'auto'))
    ap.add_argument('--quality', default='medium')
    ap.add_argument('--complexity', choices=('low', 'medium', 'high'),
                    help="how much the model plans before drawing (default: the gpt-image skill's default)")
    ap.add_argument('--model', help="image model ID (default: the gpt-image skill's default model)")
    ap.add_argument('--n', type=int, default=1)
    ap.add_argument('--out-dir', default=str(OUT_ROOT), help='default: ./pose-doll-out (or $POSE_DOLL_OUT)')
    ap.add_argument('--name', help='output file stem')
    ap.add_argument('--dry-run', action='store_true', help='render the pose and print the prompt, no API call')
    args = ap.parse_args()

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    pose_stem = Path(args.pose).stem if not args.pose.strip().startswith('{') else 'pose'
    suffix = {'all': '-mirrored', 'legs': '-legs-mirrored', 'picture': '-picture-mirrored'}.get(args.mirror, '')
    stem = args.name or f'{Path(args.character).stem}--{pose_stem}{suffix}{"-rig" if args.rig else ""}'
    pose_png = out_dir / f'{stem}.pose.png'
    try:
        r = render_pose(args.pose, pose_png, view=args.view, heads=args.heads, mirror=args.mirror, rig=args.rig,
                        style=args.style, size=args.size, azimuth=args.azimuth, elevation=args.elevation,
                        fill=auto_fill(args.character) if args.fill == 'auto' else args.fill, props_file=args.props_file,
                        uncross=args.uncross)
    except RuntimeError as e:
        sys.exit(str(e))
    prompt = build_prompt(r['description'], rig=bool(args.rig), style=args.style, extra=args.extra, background=args.background,
                          has_props=bool(r['pose'].get('props')), consistency=bool(args.consistency))
    if args.dry_run:
        print(json.dumps({'pose_png': str(pose_png), 'prompt': prompt}, ensure_ascii=False, indent=2))
        return
    try:
        saved, elapsed = generate(args.character, pose_png, prompt, out_dir, stem, consistency=args.consistency, model=args.model,
                                  quality=args.quality, complexity=args.complexity, size=args.size, background=args.background, n=args.n,
                                  meta={'rig': args.rig, 'pose': r['pose']},
                                  release_prompt=release_prompt_for(r['pose'], args.background))
    except (RuntimeError, OSError, ValueError) as e:  # API / network errors: one line, no traceback
        print(json.dumps({'ok': False, 'error': str(e), 'pose_png': str(pose_png)}, ensure_ascii=False), file=sys.stderr)
        sys.exit(1)
    refs = [args.character, pose_png] + ([args.consistency] if args.consistency else [])
    sheets = [check_sheet(refs + [s], Path(s).with_suffix('.check.jpg')) for s in saved]
    print(json.dumps({'ok': True, 'files': saved, 'pose_png': str(pose_png), 'check_sheets': sheets,
                      'elapsed_sec': elapsed}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
