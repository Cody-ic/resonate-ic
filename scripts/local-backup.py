"""Encrypted, quiesced backup of the LOCAL Cloudflare emulator only.
No network/provider requests. Production cloud exports need provider adapters.
"""
from contextlib import closing
import argparse
import base64
import getpass
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import socket
import sqlite3
import stat
import sys
import tempfile
import zipfile
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.primitives.kdf.scrypt import Scrypt

MAGIC = b'RESONATE1\n'
CHUNK = 1024 * 1024
DISABLED = {'MAIL_DELIVERY_MODE': 'off', 'MAIL_REQUIRE_EMAIL_VERIFICATION': 'false',
            'PROJECT_AI_MONTHLY_MAX_CALLS': '0', 'DISCUSSION_AI_MONTHLY_MAX_CALLS': '0',
            'PLATFORM_AUTH_ENABLED': 'false', 'PROJECT_PUBLICATION_ENABLED': 'false', 'ADMIN_USER_IDS': ''}


def sha(path):
    h = hashlib.sha256()
    with path.open('rb') as f:
        for b in iter(lambda: f.read(CHUNK), b''): h.update(b)
    return h.hexdigest()


def tables(path):
    with closing(sqlite3.connect(path)) as c:
        if c.execute('PRAGMA integrity_check').fetchone()[0] != 'ok': raise ValueError('SQLite integrity failure')
        return {t: c.execute('SELECT COUNT(*) FROM "' + t.replace('"', '""') + '"').fetchone()[0]
                for (t,) in c.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")}


def password(args):
    value = sys.stdin.readline().rstrip('\r\n') if args.password_stdin else getpass.getpass('Backup password (at least 16 characters): ')
    if len(value) < 16: raise ValueError('Backup password must have at least 16 characters')
    if args.command == 'backup' and not args.password_stdin and value != getpass.getpass('Confirm backup password: '): raise ValueError('Passwords differ')
    return value.encode('utf-8')


def crypt(source, target, secret, decrypt=False):
    with source.open('rb') as src, target.open('xb') as dst:
        if decrypt:
            header = src.read(len(MAGIC) + 28)
            if len(header) != len(MAGIC) + 28 or not header.startswith(MAGIC): raise ValueError('Invalid archive header')
            salt, iv = header[len(MAGIC):len(MAGIC)+16], header[-12:]
            src.seek(-16, 2); tag = src.read(16); remaining = src.tell() - len(header) - 16; src.seek(len(header))
        else:
            salt, iv = os.urandom(16), os.urandom(12); header = MAGIC + salt + iv; dst.write(header)
        key = Scrypt(salt=salt, length=32, n=2**14, r=8, p=1).derive(secret)
        cipher = Cipher(algorithms.AES(key), modes.GCM(iv, tag) if decrypt else modes.GCM(iv))
        operation = cipher.decryptor() if decrypt else cipher.encryptor(); operation.authenticate_additional_data(header)
        while True:
            block = src.read(min(CHUNK, remaining)) if decrypt else src.read(CHUNK)
            if not block: break
            if decrypt: remaining -= len(block)
            dst.write(operation.update(block))
        dst.write(operation.finalize())
        if not decrypt: dst.write(operation.tag)
    try: target.chmod(0o600)
    except OSError: pass


def verify(root):
    manifest = json.loads((root / '.backup-manifest.json').read_text(encoding='utf-8'))
    databases = blobs = 0
    for name, record in manifest['files'].items():
        path = root / ('recovery-secrets.original.env' if name == '.dev.vars' else name)
        if not path.is_file() or sha(path) != record['sha256']: raise ValueError('Restored file digest mismatch: ' + name)
        if 'tables' in record:
            if tables(path) != record['tables']: raise ValueError('Restored database count mismatch: ' + name)
            databases += 1
        if '/r2/' in name and not name.endswith('.sqlite'): blobs += 1
    return {'verifiedFiles': len(manifest['files']), 'verifiedDatabases': databases, 'verifiedR2BlobFiles': blobs,
            'mailAuthorizationBytesRestored': '.dev.vars' in manifest['files'],
            'scope': 'file hashes and SQLite integrity/counts; no provider token refresh or email sent'}


def main():
    p = argparse.ArgumentParser(description=__doc__); sub = p.add_subparsers(dest='command', required=True)
    b = sub.add_parser('backup'); b.add_argument('--source', required=True); b.add_argument('--out', required=True)
    b.add_argument('--port', type=int, default=5173); b.add_argument('--quiesced', action='store_true'); b.add_argument('--password-stdin', action='store_true')
    r = sub.add_parser('restore'); r.add_argument('--archive', required=True); r.add_argument('--target', required=True); r.add_argument('--password-stdin', action='store_true')
    v = sub.add_parser('verify'); v.add_argument('--target', required=True)
    args = p.parse_args()
    if args.command == 'verify': print(json.dumps(verify(Path(args.target).resolve()), ensure_ascii=False)); return
    secret = password(args)
    if args.command == 'backup':
        source, out = Path(args.source).resolve(), Path(args.out).resolve()
        if not args.quiesced: raise ValueError('Stop ALL data writers and pass --quiesced')
        with socket.socket() as sock:
            sock.settimeout(1)
            if sock.connect_ex(('127.0.0.1', args.port)) == 0: raise ValueError('Site port is still listening; stop the site before backup')
        if out.exists(): raise ValueError('Archive already exists; overwriting is forbidden')
        state = source / '.wrangler/state'
        if not state.is_dir() or not (source / '.dev.vars').is_file(): raise ValueError('Local state and private environment are required')
        out.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix='resonate-backup-', dir=out.parent) as temporary:
            temp = Path(temporary); files = {}
            inputs = [source / '.dev.vars', *sorted(state.rglob('*'))]
            with zipfile.ZipFile(temp / 'payload.zip', 'x', compression=zipfile.ZIP_DEFLATED) as z:
                for path in inputs:
                    if path.is_symlink(): raise ValueError('Symlink in runtime state is not supported')
                    if not path.is_file() or path.name.endswith(('-wal', '-shm', '-journal')): continue
                    name = path.relative_to(source).as_posix(); selected = path; record = {}
                    if path.suffix == '.sqlite':
                        selected = temp / ('snapshot-' + str(len(files)) + '.sqlite')
                        with closing(sqlite3.connect(path)) as src, closing(sqlite3.connect(selected)) as dst: src.backup(dst)
                        record['tables'] = tables(selected)
                    record['sha256'] = sha(selected); record['bytes'] = selected.stat().st_size; files[name] = record; z.write(selected, name)
                z.writestr('.backup-manifest.json', json.dumps({'version': 1, 'files': files}, ensure_ascii=False))
            crypt(temp / 'payload.zip', temp / 'archive', secret)
            # No overwrite, including races after initial existence check.
            with out.open('xb') as dst, (temp / 'archive').open('rb') as src: shutil.copyfileobj(src, dst)
            out.chmod(0o600)
        print(json.dumps({'archiveCreated': True, 'files': len(files), 'encrypted': 'AES-256-GCM', 'archiveSha256': sha(out)}))
    else:
        target = Path(args.target).resolve()
        if target.exists(): raise ValueError('Restore target must not exist; source data is never overwritten')
        target.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix='resonate-restore-', dir=target.parent) as temporary:
            payload = Path(temporary) / 'payload.zip'; crypt(Path(args.archive).resolve(), payload, secret, decrypt=True)
            with zipfile.ZipFile(payload) as z:
                names = set()
                for item in z.infolist():
                    path = PurePosixPath(item.filename)
                    if item.filename in names or path.is_absolute() or '..' in path.parts or '\\' in item.filename or ':' in item.filename or stat.S_ISLNK(item.external_attr >> 16): raise ValueError('Unsafe archive path')
                    if item.file_size > 8*1024**3: raise ValueError('Oversize archive member')
                    names.add(item.filename)
                if '.backup-manifest.json' not in names: raise ValueError('Missing backup manifest')
                z.extractall(Path(temporary) / 'restored')
            restored = Path(temporary) / 'restored'
            (restored / '.dev.vars').rename(restored / 'recovery-secrets.original.env')
            result = verify(restored)
            raw = (restored / 'recovery-secrets.original.env').read_text(encoding='utf-8')
            import re
            for key, value in DISABLED.items():
                raw = re.sub(r'^' + key + r'=.*\n?', '', raw, flags=re.M)
                raw += '\n' + key + '=' + json.dumps(value) + '\n'
            (restored / '.dev.vars').write_text(raw, encoding='utf-8')
            (restored / '.gitignore').write_text('*\n', encoding='utf-8')
            restored.rename(target)
            result['outboundDisabled'] = True; print(json.dumps(result))


if __name__ == '__main__':
    try: main()
    except Exception as e:
        # Do not emit credential-bearing file contents or provider data.
        print('Backup operation failed: ' + (str(e) if isinstance(e, ValueError) else type(e).__name__), file=sys.stderr)
        sys.exit(1)
