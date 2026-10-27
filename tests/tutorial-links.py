"""Check copied content integrity and all relative HTML targets/anchors."""
import hashlib, json
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote,urlsplit
root=Path(__file__).resolve().parents[1]
metadata=json.loads((root/'content/smartwatch-import.json').read_text(encoding='utf-8'))
base=root/'public'/metadata['basePath'].lstrip('/')
class Page(HTMLParser):
    def __init__(self):super().__init__();self.refs=[];self.ids=set()
    def handle_starttag(self,tag,attrs):
        attrs=dict(attrs)
        if attrs.get('id'):self.ids.add(attrs['id'])
        if tag in ['a','link'] and attrs.get('href'):self.refs.append(attrs['href'])
        if tag in ['script','img','iframe','source'] and attrs.get('src'):self.refs.append(attrs['src'])
pages={}
for path in base.rglob('*.html'):
    parser=Page();parser.feed(path.read_text(encoding='utf-8'));pages[path.resolve()]=parser
errors=[];links=0
for path,page in pages.items():
    for raw in page.refs:
        url=urlsplit(raw)
        if url.scheme or url.netloc:continue
        if url.path.startswith('/'):
            if not url.path.startswith(metadata['basePath']):continue
            target=(root/'public'/unquote(url.path).lstrip('/')).resolve()
        else:target=(path.parent/unquote(url.path)).resolve() if url.path else path
        links+=1
        if not target.is_file():errors.append(f'{path.relative_to(base)} -> {raw}')
        elif url.fragment and target in pages and unquote(url.fragment) not in pages[target].ids:errors.append(f'missing anchor {path.name} -> {raw}')
for entry in metadata['files']:
    assert hashlib.sha256((base/entry['path']).read_bytes()).hexdigest()==entry['servedSha256'],entry['path']
assert not errors,'\n'.join(errors[:30])
print(json.dumps({'htmlPages':len(pages),'localLinksAndAssets':links,'sourceFilesWithMatchingServedHashes':len(metadata['files']),'brokenLinks':0},ensure_ascii=False))
