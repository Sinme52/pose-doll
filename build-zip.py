#!/usr/bin/env python3
"""Build dist/pose-doll.zip, the skill package to upload or unzip into a skills folder.

  python3 build-zip.py          # (re)build dist/pose-doll.zip
  python3 build-zip.py --check  # exit 1 if dist/pose-doll.zip is missing or out of date

The zip holds the pose-doll/ folder (SKILL.md, LICENSE, scripts/) without tests and caches.
It is reproducible: entries are sorted and carry a fixed date, so rebuilding unchanged
files gives the same bytes and no git diff. Rebuild and commit it whenever pose-doll/ changes.
--check compares the entries (names and uncompressed contents), not the compressed bytes,
which can differ between zlib builds (as on CI runners).
"""
import argparse
import io
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SKILL = ROOT / 'pose-doll'
OUT = ROOT / 'dist' / 'pose-doll.zip'
FIXED_DATE = (2026, 1, 1, 0, 0, 0)
SKIP_DIRS = {'test', '__pycache__', 'pose-doll-out', 'pose-doll-poses'}
SKIP_NAMES = {'.DS_Store', 'package-lock.json'}


def skill_files():
    files = []
    for p in sorted(SKILL.rglob('*')):
        rel = p.relative_to(SKILL)
        if not p.is_file() or SKIP_DIRS.intersection(rel.parts[:-1]) or p.name in SKIP_NAMES or p.suffix == '.pyc':
            continue
        # under scripts/node_modules only the bundled three.js subset belongs to the skill
        if rel.parts[:2] == ('scripts', 'node_modules') and (len(rel.parts) < 4 or rel.parts[2] != 'three'):
            continue
        files.append(p)
    return files


def build_bytes():
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for p in skill_files():
            info = zipfile.ZipInfo(('pose-doll' / p.relative_to(SKILL)).as_posix(), FIXED_DATE)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16  # same on every OS (scripts are run with python3 / node)
            # text files are stored with LF line endings even when checked out with CRLF (Windows)
            data = p.read_bytes()
            if p.suffix in {'.md', '.py', '.mjs', '.js', '.json', '.html', '.txt'} or p.name == 'LICENSE':
                data = data.replace(b'\r\n', b'\n')
            z.writestr(info, data, compresslevel=9)
    return buf.getvalue()


def entries(data):
    """[(name, uncompressed bytes)] of a zip, for comparing two builds independently of the compressor."""
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        return [(i.filename, z.read(i)) for i in z.infolist()]


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument('--check', action='store_true', help='only check that dist/pose-doll.zip is up to date')
    args = ap.parse_args()
    data = build_bytes()
    if args.check:
        if OUT.exists() and entries(OUT.read_bytes()) == entries(data):
            print(f'{OUT.relative_to(ROOT)} is up to date')
            return
        print(f'{OUT.relative_to(ROOT)} is out of date: run python3 build-zip.py and commit it', file=sys.stderr)
        sys.exit(1)
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_bytes(data)
    with zipfile.ZipFile(OUT) as z:
        n = len(z.namelist())
    print(f'wrote {OUT.relative_to(ROOT)} ({n} files, {len(data) // 1024} KB)')


if __name__ == '__main__':
    main()
