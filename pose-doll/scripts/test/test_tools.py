"""Python side: layout measurement, frame parsing and prompts (no API calls)."""
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import frames  # noqa: E402
import pose2image as p2i  # noqa: E402

try:
    from PIL import Image, ImageDraw
except ImportError:  # pragma: no cover
    Image = None


class Layout(unittest.TestCase):
    @unittest.skipIf(Image is None, 'Pillow missing')
    def test_transparent_and_opaque(self):
        with tempfile.TemporaryDirectory() as d:
            im = Image.new('RGBA', (100, 100), (0, 0, 0, 0))
            ImageDraw.Draw(im).rectangle((30, 10, 60, 90), fill=(200, 50, 50, 255))
            im.save(f'{d}/t.png')
            lay = p2i.layout(f'{d}/t.png')
            self.assertEqual(lay['bbox'], [30, 10, 61, 91])
            self.assertEqual(lay['foot'][1], 91)
            self.assertAlmostEqual(lay['foot'][0], 45.5, delta=1)
            op = Image.new('RGB', (100, 100), (250, 250, 250))
            ImageDraw.Draw(op).rectangle((20, 5, 40, 70), fill=(10, 10, 10))
            op.save(f'{d}/o.png')
            self.assertEqual(p2i.layout(f'{d}/o.png')['bbox'], [20, 5, 41, 71])


class Frames(unittest.TestCase):
    def test_parse(self):
        self.assertEqual(frames.parse_frame('walk-ready-a~legs')['mirror'], 'legs')
        self.assertEqual(frames.parse_frame('walk-ready-a~legs')['label'], 'walk-ready-a-legs')
        e = frames.parse_frame('@sprites/clone-akane-{view}.webp')
        self.assertEqual(e['kind'], 'existing')

    def test_prompt_roles(self):
        p = p2i.build_prompt('desc', has_props=True, consistency=True)
        self.assertIn('three images', p)
        self.assertIn('IMAGE 3', p)
        self.assertIn('stand-in', p)
        self.assertNotIn('IMAGE 3', p2i.build_prompt('desc'))


if __name__ == '__main__':
    unittest.main()


class FeetChecks(unittest.TestCase):
    @unittest.skipIf(Image is None, 'Pillow missing')
    def test_lowest_foot_side(self):
        with tempfile.TemporaryDirectory() as d:
            for name, low_x in (('left', 30), ('right', 70)):
                im = Image.new('RGBA', (100, 200), (0, 0, 0, 0))
                dr = ImageDraw.Draw(im)
                dr.rectangle((40, 10, 60, 150), fill=(200, 200, 200, 255))  # body
                dr.rectangle((low_x - 5, 150, low_x + 5, 190), fill=(200, 0, 0, 255))  # lowest foot
                other = 100 - low_x
                dr.rectangle((other - 5, 150, other + 5, 175), fill=(0, 0, 200, 255))  # the other, higher foot
                im.save(f'{d}/{name}.png')
            self.assertLess(p2i.lowest_foot_side(f'{d}/left.png'), -0.15)
            self.assertGreater(p2i.lowest_foot_side(f'{d}/right.png'), 0.15)

    def test_check_feet_flags_same_stride(self):
        values = {'a.pose': 0.37, 'b.pose': -0.14, 'a.png': 0.3, 'b.png': 0.28, 's.pose': 0.0, 's.png': 0.0}
        orig = p2i.lowest_foot_side
        p2i.lowest_foot_side = lambda path: values[path]
        try:
            plan = [{'kind': 'pose', 'label': 'walk-a', 'pose_png': 'a.pose', 'image': 'a.png'},
                    {'kind': 'pose', 'label': 'stand', 'pose_png': 's.pose', 'image': 's.png'},
                    {'kind': 'pose', 'label': 'walk-b', 'pose_png': 'b.pose', 'image': 'b.png'}]
            w = frames.check_feet(plan)
            self.assertTrue(any('walk-b: the lowest foot' in x for x in w), w)
            self.assertTrue(any('walk-a and walk-b' in x for x in w), w)
            values['b.png'] = -0.2
            self.assertEqual(frames.check_feet(plan), [])
        finally:
            p2i.lowest_foot_side = orig


FAKE_SKILL = r'''
import argparse, base64, json, sys
from pathlib import Path
PNG = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")
HAS_EDIT = %(has_edit)s
DEFAULT_MODEL = "gpt-image-test-default"
CALLS = Path(%(calls)r)
def load_api_key(): return "sk-test"
def base_url(): return "http://mock"
def _multipart(fields, files): return json.dumps({"fields": fields, "files": [[f[0], f[1], len(f[2]), f[3]] for f in files]}).encode(), "x"
def _post(url, body, ctype, key):
    CALLS.write_text(json.dumps({"mode": "direct", "url": url, **json.loads(body)}))
    n = int(dict(json.loads(body)["fields"])["n"])
    return {"data": [{"b64_json": base64.b64encode(PNG).decode()}] * n}, "req", 1.0
def save_results(payload, out_dir, stem, fmt, meta):
    out_dir.mkdir(parents=True, exist_ok=True); saved = []
    for i, _ in enumerate(payload["data"]):
        p = out_dir / (stem + (f"_{i+1}" if len(payload["data"]) > 1 else "") + ".png"); p.write_bytes(PNG)
        p.with_suffix(".json").write_text(json.dumps(meta)); saved.append(p)
    return saved
if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "edit" and HAS_EDIT:
        ap = argparse.ArgumentParser(); ap.add_argument("cmd"); ap.add_argument("--image", action="append")
        for k in ("--prompt", "--quality", "--model", "--size", "--format", "--n", "--name", "--out-dir", "--meta-json", "--background", "--release-prompt", "--complexity"):
            ap.add_argument(k)
        a = ap.parse_args()
        CALLS.write_text(json.dumps({"mode": "cli", **{k: v for k, v in vars(a).items()}}))
        extra = json.loads(Path(a.meta_json).read_text())
        meta = {"kind": "edit", "prompt": a.prompt, "input_images": a.image, "release_prompt": a.release_prompt}
        for k, v in extra.items(): meta.setdefault(k, v)
        saved = save_results({"data": [1] * int(a.n)}, Path(a.out_dir), a.name, "png", meta)
        print(json.dumps({"ok": True, "files": [str(p) for p in saved], "elapsed_sec": 2.0})); sys.exit(0)
    sys.exit(2)
'''


class SkillIntegration(unittest.TestCase):
    """pose2image talks to the gpt-image skill: its public 'edit' command when it has one, else its helpers."""

    def _run(self, has_edit, **kw):
        with tempfile.TemporaryDirectory() as d:
            calls = f'{d}/calls.json'
            script = f'{d}/gpt_image.py'
            Path(script).write_text(FAKE_SKILL % {'has_edit': has_edit, 'calls': calls})
            Image.new('RGBA', (64, 64), (200, 0, 0, 255)).save(f'{d}/char.webp')
            Image.new('RGB', (64, 64), (255, 255, 255)).save(f'{d}/pose.png')
            old = os.environ.get('GPT_IMAGE_SCRIPT')
            os.environ['GPT_IMAGE_SCRIPT'] = script
            p2i._EDIT_SUPPORT.clear()
            try:
                saved, _ = p2i.generate(f'{d}/char.webp', f'{d}/pose.png', 'PROMPT', f'{d}/out', 'frame', consistency=f'{d}/pose.png',
                                        n=2, background='transparent', meta={'view': 'ul'}, release_prompt='a knight walking', **kw)
            finally:
                if old is None:
                    os.environ.pop('GPT_IMAGE_SCRIPT', None)
                else:
                    os.environ['GPT_IMAGE_SCRIPT'] = old
            call = json.loads(Path(calls).read_text())
            sides = [json.loads(Path(s).with_suffix('.json').read_text()) for s in saved]
            return call, saved, sides

    @unittest.skipIf(Image is None, 'Pillow missing')
    def test_uses_the_edit_command_when_the_skill_has_it(self):
        call, saved, sides = self._run(True)
        self.assertEqual(call['mode'], 'cli')
        self.assertEqual(len(call['image']), 3)
        self.assertTrue(all(p.endswith('.png') for p in call['image']), 'inputs converted to PNG like before')
        self.assertEqual((call['prompt'], call['n'], call['background'], call['release_prompt']), ('PROMPT', '2', 'transparent', 'a knight walking'))
        self.assertEqual([Path(s).name for s in saved], ['frame_1.png', 'frame_2.png'])
        self.assertEqual(sides[0]['view'], 'ul')
        self.assertTrue(sides[0]['input_images'][0].endswith('char.webp'), 'sidecar names the real input files')
        self.assertIn('edit command', sides[0]['via'])
        self.assertIn('layout', sides[0])

    @unittest.skipIf(Image is None, 'Pillow missing')
    def test_falls_back_to_the_helpers_for_older_skills(self):
        call, saved, sides = self._run(False)
        self.assertEqual(call['mode'], 'direct')
        self.assertTrue(call['url'].endswith('/images/edits'))
        self.assertEqual(len(call['files']), 3)
        self.assertEqual(len(saved), 2)
        self.assertIn('direct', sides[0]['via'])
        self.assertEqual(dict(call['fields'])['model'], 'gpt-image-test-default', "the skill's own default model")
        self.assertNotIn('complexity', dict(call['fields']))

    @unittest.skipIf(Image is None, 'Pillow missing')
    def test_model_is_left_to_the_skill_unless_given(self):
        call, _, _ = self._run(True)
        self.assertIsNone(call['model'], 'no --model: the gpt-image skill picks its default (GPT Image 2.6)')
        self.assertIsNone(call['complexity'])
        call, _, sides = self._run(True, model='gpt-image-2.5-sunburst', complexity='low')
        self.assertEqual((call['model'], call['complexity']), ('gpt-image-2.5-sunburst', 'low'))

    @unittest.skipIf(Image is None, 'Pillow missing')
    def test_direct_mode_passes_the_given_model_and_complexity(self):
        call, _, _ = self._run(False, model='m-x', complexity='high')
        self.assertEqual((dict(call['fields'])['model'], dict(call['fields'])['complexity']), ('m-x', 'high'))


class SkillDiscovery(unittest.TestCase):
    """The newer gpt-image skill is preferred; the older gpt-image-2-5 still works."""

    def _find(self, names):
        with tempfile.TemporaryDirectory() as home:
            for n in names:
                q = Path(home) / '.claude/skills' / n / 'scripts'
                q.mkdir(parents=True)
                (q / 'gpt_image.py').write_text('')
            old = {k: os.environ.get(k) for k in ('HOME', 'GPT_IMAGE_SCRIPT')}
            os.environ['HOME'] = home
            os.environ.pop('GPT_IMAGE_SCRIPT', None)
            try:
                found = [c for c in p2i.skill_script_candidates() if c.startswith(home)]
            finally:
                for k, v in old.items():
                    if v is None:
                        os.environ.pop(k, None)
                    else:
                        os.environ[k] = v
            return [p2i.skill_name(c) for c in found]

    def test_prefers_gpt_image_over_gpt_image_2_5(self):
        self.assertEqual(self._find(['gpt-image-2-5', 'gpt-image'])[0], 'gpt-image')

    def test_falls_back_to_gpt_image_2_5(self):
        self.assertEqual(self._find(['gpt-image-2-5']), ['gpt-image-2-5'])

    def test_env_override_comes_first(self):
        old = os.environ.get('GPT_IMAGE_SCRIPT')
        os.environ['GPT_IMAGE_SCRIPT'] = '/somewhere/my-image/scripts/gpt_image.py'
        try:
            self.assertEqual(p2i.skill_script(), '/somewhere/my-image/scripts/gpt_image.py')
        finally:
            if old is None:
                os.environ.pop('GPT_IMAGE_SCRIPT', None)
            else:
                os.environ['GPT_IMAGE_SCRIPT'] = old
