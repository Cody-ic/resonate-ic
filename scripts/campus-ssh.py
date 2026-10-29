"""Run one explicit SSH command using an existing trusted host key.

Password stays in memory and is entered on the terminal, never in arguments.
This helper does not install a host key or write a credential.
"""
import argparse
import getpass
import sys
from pathlib import Path
import paramiko

parser=argparse.ArgumentParser()
parser.add_argument('--host',required=True)
parser.add_argument('--port',type=int,default=22)
parser.add_argument('--user',required=True)
parser.add_argument('--command-file',type=Path,required=True)
parser.add_argument('--upload',nargs=2,action='append',default=[],metavar=('LOCAL','REMOTE'))
parser.add_argument('--download',nargs=2,action='append',default=[],metavar=('REMOTE','LOCAL'))
args=parser.parse_args()
password=getpass.getpass('SSH password (hidden): ')
client=paramiko.SSHClient()
client.load_system_host_keys()
known=Path.home()/'.ssh'/'known_hosts'
if known.exists():client.load_host_keys(str(known))
client.set_missing_host_key_policy(paramiko.RejectPolicy())
try:
 client.connect(args.host,port=args.port,username=args.user,password=password,
                look_for_keys=False,allow_agent=False,timeout=20,auth_timeout=30,banner_timeout=30)
 password=None
 with client.open_sftp() as sftp:
  for local,remote in args.upload:
   sftp.put(local,remote)
   sftp.chmod(remote,0o600)
  for remote,local in args.download:
   Path(local).parent.mkdir(parents=True,exist_ok=True)
   sftp.get(remote,local)
 stdin,stdout,stderr=client.exec_command('bash -s',timeout=1800)
 stdin.write(args.command_file.read_text(encoding='utf-8'))
 stdin.channel.shutdown_write()
 for line in stdout:sys.stdout.write(line)
 sys.stderr.write(stderr.read().decode('utf-8',errors='replace'))
 raise SystemExit(stdout.channel.recv_exit_status())
finally:
 password=None
 client.close()
