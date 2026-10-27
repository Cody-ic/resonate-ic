"""Extract readable course text for bounded, server-side review tools; never execute HTML."""
from pathlib import Path
from html.parser import HTMLParser
import hashlib
import json
import re

ROOT = Path(__file__).resolve().parents[1]
class Text(HTMLParser):
    def __init__(self):
        super().__init__()
        self.parts = []
        self.skip = 0
    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style", "nav"):
            self.skip += 1
        if tag in ("p", "div", "li", "pre", "h1", "h2", "h3", "h4", "br", "tr", "section"):
            self.parts.append("\n")
    def handle_endtag(self, tag):
        if tag in ("script", "style", "nav"):
            self.skip = max(0, self.skip - 1)
        if tag in ("p", "div", "li", "pre", "h1", "h2", "h3", "h4", "tr", "section"):
            self.parts.append("\n")
    def handle_data(self, data):
        if not self.skip:
            self.parts.append(data)

texts, sources = {}, {}
for course in json.loads((ROOT / "content/trusted-courses.json").read_text(encoding="utf-8")):
    key = course["courseId"] + ":" + course["revisionId"]
    lessons, manifest = {}, {}
    base = (ROOT / "public" / course["basePath"].lstrip("/")).resolve()
    for lesson, relative in course["lessonPaths"].items():
        source = (base / relative).resolve()
        if not source.is_relative_to(base):
            raise ValueError("Course source escaped its fixed version directory")
        raw = source.read_bytes()
        parser = Text()
        parser.feed(raw.decode("utf-8"))
        value = re.sub(r"\n[ \t]*\n+", "\n", "".join(parser.parts)).strip()
        lessons[lesson] = value
        manifest[lesson] = {"path": source.relative_to(ROOT).as_posix(), "sha256": hashlib.sha256(raw).hexdigest(), "textSha256": hashlib.sha256(value.encode()).hexdigest()}
    texts[key], sources[key] = lessons, manifest
for name, value in (("trusted-course-review-texts.json", texts), ("trusted-course-review-sources.json", sources)):
    (ROOT / "content" / name).write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print("Course review text import complete:", sum(len(v) for v in texts.values()), "chapters")
