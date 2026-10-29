"""Encrypted, quiesced campus backup. Restore always uses a new directory."""
import argparse
import importlib.util
import json
from pathlib import Path
import secrets
import subprocess
import tempfile
import zipfile
import stat
import shutil
import os
import sqlite3
from contextlib import closing

spec=importlib.util.spec_from_file_location('backup_core',Path(__file__).with_name('local-backup.py'))
core=importlib.util.module_from_spec(spec);spec.loader.exec_module(core)
p=argparse.ArgumentParser()
p.add_argument('command',choices=['backup','restore'])
p.add_argument('--shared',type=Path,required=True)
p.add_argument('--archive',type=Path,required=True)
p.add_argument('--target',type=Path)
a=p.parse_args();os.umask(0o077)
shared=a.shared.resolve();key=shared/'backup-key'
if not key.exists():
    if a.command!='backup':raise ValueError('Backup key is required')
    with key.open('x') as f:f.write(secrets.token_urlsafe(48))
    key.chmod(0o600)
secret=key.read_bytes().strip()
if len(secret)<32:raise ValueError('Invalid backup key')
if a.command=='backup':
    if subprocess.run(['systemctl','--user','is-active','--quiet','resonate-campus.service']).returncode==0:
        raise ValueError('Stop the campus service before backing up')
    with tempfile.TemporaryDirectory(prefix='campus-backup-',dir=shared) as tmp:
        payload=Path(tmp)/'payload.zip';manifest={}
        with zipfile.ZipFile(payload,'x',zipfile.ZIP_DEFLATED) as z:
            paths=[shared/'app.env']
            for name in ['state','tls']:paths.extend(x for x in (shared/name).rglob('*') if x.is_file())
            for file in paths:
                if file.name.endswith(('-wal','-shm')):continue
                if file.is_symlink() or shared not in file.resolve().parents:raise ValueError('Unexpected backup path')
                name=file.relative_to(shared).as_posix()
                selected=file
                if file.suffix=='.sqlite':
                    selected=Path(tmp)/('snapshot-'+str(len(manifest))+'.sqlite')
                    with closing(sqlite3.connect('file:'+file.as_posix()+'?mode=ro',uri=True)) as src,closing(sqlite3.connect(selected)) as dst:src.backup(dst)
                record={'sha256':core.sha(selected),'bytes':selected.stat().st_size}
                if file.suffix=='.sqlite':record['tables']=core.tables(selected)
                manifest[name]=record;z.write(selected,name)
            z.writestr('campus-manifest.json',json.dumps(manifest))
        a.archive.parent.mkdir(parents=True,exist_ok=True)
        core.crypt(payload,a.archive,secret)
        a.archive.chmod(0o600)
        print(json.dumps({'encrypted':True,'files':len(manifest),'archiveSha256':core.sha(a.archive)}))
else:
    if not a.target or a.target.exists():raise ValueError('Restore target must be a new directory')
    target=a.target.resolve();target.parent.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='campus-restore-',dir=target.parent) as tmp:
        payload=Path(tmp)/'payload.zip';core.crypt(a.archive,payload,secret,decrypt=True)
        with zipfile.ZipFile(payload) as z:
            seen=set()
            for item in z.infolist():
                name=Path(item.filename)
                if name.is_absolute() or '..' in name.parts or '\\' in item.filename or item.filename in seen or stat.S_ISLNK(item.external_attr>>16):raise ValueError('Unsafe archive member')
                seen.add(item.filename)
            folder=Path(tmp)/'restored';z.extractall(folder)
        manifest=json.loads((folder/'campus-manifest.json').read_text())
        for name,record in manifest.items():
            file=folder/name
            if core.sha(file)!=record['sha256']:raise ValueError('Restore hash mismatch')
            if 'tables' in record and core.tables(file)!=record['tables']:raise ValueError('Restore database mismatch')
        # Restored credentials are quarantined; no provider can send/spend by accident.
        (folder/'app.env').rename(folder/'recovery-secrets.original.env')
        (folder/'app.env').write_text('MAIL_DELIVERY_MODE="off"\nPLATFORM_AUTH_ENABLED="false"\nPROJECT_PUBLICATION_ENABLED="false"\n')
        shutil.move(folder,target)
        print(json.dumps({'verifiedFiles':len(manifest),'outboundDisabled':True,'target':str(target)}))
