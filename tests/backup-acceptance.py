from contextlib import closing
"""Synthetic backup safety checks. No real keys or network requests."""
from pathlib import Path
import json
import os
import sqlite3
import subprocess
import sys
import tempfile

script = Path('scripts/local-backup.py').resolve()
checks = []


def run(*args, ok=True, secret='isolated-backup-password-123456'):
    p = subprocess.run([sys.executable, str(script), *args], input=secret+'\n', text=True, capture_output=True)
    assert (p.returncode == 0) == ok, p.stderr
    assert secret not in p.stdout+p.stderr
    return p


with tempfile.TemporaryDirectory(prefix='backup-acceptance-') as temporary:
    root = Path(temporary); source = root / 'source'; state = source / '.wrangler/state/v3/r2'; state.mkdir(parents=True)
    (source / '.dev.vars').write_text('BETTER_AUTH_SECRET="synthetic-key"\nMAIL_DELIVERY_MODE="live"\nPROJECT_AI_MONTHLY_MAX_CALLS="5"\n', encoding='utf-8')
    with closing(sqlite3.connect(state / 'bucket.sqlite')) as c: c.execute('CREATE TABLE entries(id TEXT)'); c.execute("INSERT INTO entries VALUES('fixture')"); c.commit()
    (state / 'blob').write_bytes(os.urandom(4000))
    archive = root / 'data.resbackup'
    run('backup','--source',str(source),'--out',str(archive),'--port','59999','--password-stdin',ok=False)
    checks.append('requires explicit quiescence')
    run('backup','--source',str(source),'--out',str(archive),'--port','59999','--quiesced','--password-stdin')
    assert b'synthetic-key' not in archive.read_bytes(); checks.append('archive encrypted')
    run('restore','--archive',str(archive),'--target',str(root/'wrong'),'--password-stdin',ok=False,secret='wrong-backup-password-123456')
    assert not (root/'wrong').exists(); checks.append('wrong password leaves no restore')
    target = root/'restored'; run('restore','--archive',str(archive),'--target',str(target),'--password-stdin')
    result = json.loads(run('verify','--target',str(target)).stdout)
    assert result['verifiedDatabases']==1 and result['verifiedR2BlobFiles']==1
    safe = (target/'.dev.vars').read_text(); assert 'MAIL_DELIVERY_MODE="off"' in safe and 'PROJECT_AI_MONTHLY_MAX_CALLS="0"' in safe
    checks.append('database and blobs restored with outbound disabled')
    run('restore','--archive',str(archive),'--target',str(target),'--password-stdin',ok=False); checks.append('existing target cannot be overwritten')
    (target/'.wrangler/state/v3/r2/blob').write_bytes(b'tampered')
    run('verify','--target',str(target),ok=False); checks.append('file tampering detected')
    corrupted=root/'corrupt.resbackup';data=bytearray(archive.read_bytes());data[-20]^=1;corrupted.write_bytes(data)
    run('restore','--archive',str(corrupted),'--target',str(root/'corrupt'),'--password-stdin',ok=False); assert not (root/'corrupt').exists();checks.append('authenticated archive tampering rejected')
print(json.dumps({'passed':len(checks),'checks':checks,'realDataUsed':False}))
