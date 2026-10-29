"""One HTTPS mail request; private request data arrives only over stdin.

Limit TCP segments on this socket to avoid the campus path's large-packet
black hole. Never change host-wide routes, retry an HTTP write, or log payloads.
"""
import base64
import gzip
import http.client
import io
import json
import socket
import ssl
import sys
import time
from urllib.parse import urlsplit

limit = 2 * 1024 * 1024
started = False
connection = None
sock = None
begin = time.monotonic()
try:
    data = json.load(sys.stdin)
    url = urlsplit(data['url'])
    if (url.scheme != 'https' or url.hostname not in
            ('graph.microsoft.com', 'login.microsoftonline.com') or
            url.username or url.password or url.port not in (None, 443)):
        raise ValueError('Unsupported mail destination')
    address = socket.getaddrinfo(url.hostname, 443, socket.AF_INET, socket.SOCK_STREAM)[0][4]
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.settimeout(10)
    sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_MAXSEG, 1200)
    sock.connect(address)
    sock = ssl.create_default_context().wrap_socket(sock, server_hostname=url.hostname)
    sock.settimeout(45)
    connected = time.monotonic() - begin
    connection = http.client.HTTPConnection(url.hostname, timeout=45)
    connection.sock = sock
    body = base64.b64decode(data['body'], validate=True)
    headers = {k: v for k, v in data['headers']}
    headers['Accept-Encoding'] = 'identity'
    started = True
    connection.request(data['method'], url.path + ('?' + url.query if url.query else ''), body, headers)
    response = connection.getresponse()
    content = response.read(limit + 1)
    if len(content) > limit:
        raise ValueError('Mail response too large')
    if response.getheader('Content-Encoding', '').lower() == 'gzip':
        with gzip.GzipFile(fileobj=io.BytesIO(content)) as stream:
            content = stream.read(limit + 1)
        if len(content) > limit:
            raise ValueError('Mail response too large')
    result = {'status': response.status,
              'headers': [(k, v) for k, v in response.getheaders()
                          if k.lower() not in ('content-length', 'content-encoding',
                                               'transfer-encoding', 'connection')],
              'body': base64.b64encode(content).decode(),
              'timing': {'connected': round(connected, 3),
                         'total': round(time.monotonic() - begin, 3)}}
    print(json.dumps(result))
except Exception as error:
    # Do not stringify an exception: it may contain private request context.
    print(json.dumps({'error': type(error).__name__, 'beforeRequest': not started,
                      'total': round(time.monotonic() - begin, 3)}))
    sys.exit(1)
finally:
    if connection:
        connection.close()
    elif sock:
        sock.close()
