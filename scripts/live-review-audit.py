"""Audit existing local works through the real service, without publishing content."""
from pathlib import Path
import json
import time
import urllib.request
import urllib.error

BASE = "http://127.0.0.1:5173/api/"
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
destination = Path("outputs") / ("live-review-audit-" + time.strftime("%Y%m%d-%H%M%S") + ".json")
report = {"mode": "normal_review_with_publication_held", "jobs": [], "startedAt": int(time.time() * 1000)}

def call(path, payload=None):
    req = urllib.request.Request(BASE + path, data=json.dumps(payload).encode() if payload is not None else None,
        headers={"Content-Type": "application/json", "Origin": BASE[:-5], "Cookie": "__sites_local_auth=1"})
    with opener.open(req, timeout=75) as response:
        return json.load(response)

def save():
    destination.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

me = call("me")["user"]
assert me["id"] == "local_seedy" and me["admin"], "Expected the existing local administrator"
config = call("config")
assert config["moderation"]["projectPublicationEnabled"] is False, "Publication must be paused"
works = call("me/projects")["items"]
report["before"] = [{"id": p["id"], "headId": p["headId"], "publishedId": p["publishedId"]} for p in works]
report["budgetBefore"] = call("admin/budget")
save()
print(json.dumps({"works": len(works), "report": str(destination), "publicationPaused": True}), flush=True)
for project in works:
    job = call("admin/projects/" + project["id"] + "/audit", {})
    item = {"projectId": project["id"], "title": project["title"], "reviewId": job["reviewId"]}
    report["jobs"].append(item)
    save()
    print(json.dumps({"queued": item}, ensure_ascii=False), flush=True)
    deadline = time.time() + 105
    while time.time() < deadline:
        review = call("reviews/" + job["reviewId"])
        if review["state"] not in ("queued", "running"):
            item["state"] = review["state"]
            item["result"] = review["result"]
            save()
            print(json.dumps({"completed": project["title"], "state": review["state"], "summary": (review.get("result") or {}).get("summary")}, ensure_ascii=False), flush=True)
            break
        time.sleep(2)
    else:
        item["state"] = "still_queued_or_running"
        save()
        raise SystemExit("Audit did not finish; no automatic paid retry was performed.")
after = call("me/projects")["items"]
report["after"] = [{"id": p["id"], "headId": p["headId"], "publishedId": p["publishedId"]} for p in after]
assert sorted(report["before"], key=lambda p: p["id"]) == sorted(report["after"], key=lambda p: p["id"]), "Unexpected publication change"
report["budgetAfter"] = call("admin/budget")
report["notifications"] = call("notifications")
report["completedAt"] = int(time.time() * 1000)
save()
print(json.dumps({"done": True, "jobs": len(report["jobs"]), "notifications": len(report["notifications"]["items"]), "publicationUnchanged": True, "report": str(destination)}, ensure_ascii=False), flush=True)
