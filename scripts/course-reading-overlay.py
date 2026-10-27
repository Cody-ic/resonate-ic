"""Apply website-only reading controls; archive served files before changes.

Upstream source hashes and archived import manifests remain unchanged.
"""
import hashlib, json, time
from pathlib import Path

root = Path(__file__).resolve().parents[1]
manifest_path = root / 'content/smartwatch-import.json'
manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
base = root / 'public' / manifest['basePath'].lstrip('/')
tag = '<script defer src="/course-reading.js"></script>'
changes = []
for item in manifest['files']:
    path = base / item['path']
    if path.suffix != '.html':
        continue
    original = path.read_bytes()
    if hashlib.sha256(original).hexdigest() != item['servedSha256']:
        raise SystemExit(f'Unexpected served content: {item["path"]}')
    text = original.decode('utf-8')
    if tag not in text:
        updated = text.replace('</head>', tag + '</head>', 1).encode('utf-8')
        if updated == original:
            raise SystemExit(f'No head in {path}')
        changes.append((item, path, original, updated))
if changes:
    backup = root / 'outputs' / f'course-reading-overlay-{time.time_ns()}'
    backup.mkdir(parents=True)
    (backup / manifest_path.name).write_bytes(manifest_path.read_bytes())
    for item, path, original, updated in changes:
        archived = backup / item['path']
        archived.parent.mkdir(parents=True, exist_ok=True)
        archived.write_bytes(original)
        path.write_bytes(updated)
        item['servedSha256'] = hashlib.sha256(updated).hexdigest()
        item['bytes'] = len(updated)
    manifest['displayOverlay'] = 'course-reading-v1'
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    print(json.dumps({'updatedPages':len(changes),'backup':str(backup)}, ensure_ascii=False))
else:
    print('Reading overlay already installed.')
