"""Store server-only review credentials without echoing them or changing auth secrets."""
from pathlib import Path
from getpass import getpass
import json

path = Path(".dev.vars")
lines = path.read_text(encoding="utf-8").splitlines() if path.exists() else []
updates = {
    "PROJECT_REVIEW_API_KEY": getpass("Project review key (hidden): ").strip(),
    "DISCUSSION_REVIEW_API_KEY": getpass("Discussion review key (hidden): ").strip(),
    "PROJECT_REVIEW_MODEL": "deepseek-flash",
    "DISCUSSION_REVIEW_MODEL": "deepseek-flash",
    "PROJECT_PUBLICATION_ENABLED": "false",
    "PROJECT_AI_MONTHLY_MAX_CALLS": "5000",
    "PROJECT_AI_MONTHLY_BUDGET_MICROS": "30000000",
    "DISCUSSION_AI_MONTHLY_MAX_CALLS": "5000",
    "DISCUSSION_AI_MONTHLY_BUDGET_MICROS": "30000000",
    "AI_TOTAL_MONTHLY_BUDGET_MICROS": "50000000",
    "AI_INPUT_CNY_PER_MTOK": "2",
    "AI_OUTPUT_CNY_PER_MTOK": "8",
}
for key in ("PROJECT_REVIEW_API_KEY", "DISCUSSION_REVIEW_API_KEY"):
    value = updates[key]
    if not value.startswith("sk-") or len(value) < 20 or any(c in value for c in '\r\n"\' '):
        raise SystemExit("Invalid credential format; file not changed.")
existing = {line.split("=", 1)[0].strip(): line.split("=", 1)[1] for line in lines if "=" in line}
if not existing.get("ADMIN_USER_IDS"):
    updates["ADMIN_USER_IDS"] = "local_seedy"
written = set()
result = []
for line in lines:
    key = line.split("=", 1)[0].strip() if "=" in line else None
    if key in updates:
        if key not in written:
            result.append(key + "=" + updates[key])
            written.add(key)
    else:
        result.append(line)
result.extend(key + "=" + value for key, value in updates.items() if key not in written)
path.write_text("\n".join(result) + "\n", encoding="utf-8")
print(json.dumps({"configured": True, "publication_enabled": False, "monthly_cny_per_lane": 30, "monthly_cny_total": 50, "credentials_shown": False}))
