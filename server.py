import json
import os
import subprocess
import threading
import uuid
from datetime import date, datetime
from pathlib import Path

from flask import Flask, jsonify, render_template, request

BASE_DIR        = Path(__file__).parent
TASKS_FILE      = BASE_DIR / "data" / "tasks.json"
COUNTDOWNS_FILE = BASE_DIR / "data" / "countdowns.json"
DEVICES_FILE    = BASE_DIR / "data" / "devices.json"
MONTHLY_DIR     = BASE_DIR / "data" / "monthly"
NOTES_DIR       = BASE_DIR / "data" / "notes"

QUICK_ROOTS = [
    r"E:\1.projects",
    r"F:\LWW",
]

# 法定节假日（首日）；如需更新请直接编辑此列表
HOLIDAYS = [
    {"name": "中秋节", "date": "2026-09-25"},
    {"name": "国庆节", "date": "2026-10-01"},
    {"name": "元旦",   "date": "2027-01-01"},
    {"name": "春节",   "date": "2027-02-06"},
    {"name": "清明节", "date": "2027-04-05"},
    {"name": "劳动节", "date": "2027-05-01"},
    {"name": "端午节", "date": "2027-05-30"},
    {"name": "中秋节", "date": "2027-09-15"},
    {"name": "国庆节", "date": "2027-10-01"},
]

app        = Flask(__name__)
lock       = threading.Lock()
cdown_lock = threading.Lock()
notes_lock = threading.Lock()
dev_lock   = threading.Lock()


# ── File helpers ─────────────────────────────────────────────────────────────

def _read_notes(task_id):
    p = NOTES_DIR / f"{task_id}.json"
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else []

def _write_notes(task_id, notes):
    NOTES_DIR.mkdir(exist_ok=True)
    (NOTES_DIR / f"{task_id}.json").write_text(
        json.dumps(notes, ensure_ascii=False, indent=2), encoding="utf-8")

def _read(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)

def _write(path, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

def now_iso():
    return datetime.now().isoformat(timespec="seconds")


# ── Pages ────────────────────────────────────────────────────────────────────

@app.route("/")
def index():
    return render_template("index.html", quick_roots=QUICK_ROOTS)


# ── Tasks API ────────────────────────────────────────────────────────────────

@app.route("/api/tasks", methods=["GET"])
def get_tasks():
    with lock:
        tasks = _read(TASKS_FILE)
    for t in tasks:
        p = NOTES_DIR / f"{t['id']}.json"
        t["note_count"] = len(json.loads(p.read_text(encoding="utf-8"))) if p.exists() else 0
    return jsonify(tasks)


@app.route("/api/tasks", methods=["POST"])
def create_task():
    body = request.get_json()
    task = {
        "id":       str(uuid.uuid4()),
        "title":    body.get("title", "").strip(),
        "desc":     body.get("desc", "").strip(),
        "status":   "todo",
        "folder":   body.get("folder", "").strip(),
        "tags":     [t.strip() for t in body.get("tags", []) if t.strip()],
        "due_date":  (body.get("due_date") or "").strip() or None,
        "priority":  body.get("priority", "medium"),
        "subtasks": [
            {"id": str(uuid.uuid4()), "title": s.get("title", "").strip(), "done": False,
             "priority": s.get("priority", "medium")}
            for s in body.get("subtasks", []) if s.get("title", "").strip()
        ],
        "created":  now_iso(),
        "updated":  now_iso(),
        "done_at":  None,
    }
    if not task["title"]:
        return jsonify({"error": "title required"}), 400
    with lock:
        tasks = _read(TASKS_FILE)
        tasks.append(task)
        _write(TASKS_FILE, tasks)
    return jsonify(task), 201


@app.route("/api/tasks/<task_id>", methods=["PUT"])
def update_task(task_id):
    body = request.get_json()
    with lock:
        tasks = _read(TASKS_FILE)
        for t in tasks:
            if t["id"] == task_id:
                for field in ("title", "desc", "folder", "tags", "due_date", "priority"):
                    if field in body:
                        t[field] = body[field] or None if field == "due_date" else body[field]
                if "subtasks" in body:
                    t["subtasks"] = body["subtasks"]
                if "status" in body:
                    t["status"] = body["status"]
                    if body["status"] == "done" and t.get("done_at") is None:
                        t["done_at"] = now_iso()
                    elif body["status"] != "done":
                        t["done_at"] = None
                t["updated"] = now_iso()
                _write(TASKS_FILE, tasks)
                return jsonify(t)
    return jsonify({"error": "not found"}), 404


@app.route("/api/tasks/<task_id>", methods=["DELETE"])
def delete_task(task_id):
    with lock:
        tasks = _read(TASKS_FILE)
        new_tasks = [t for t in tasks if t["id"] != task_id]
        if len(new_tasks) == len(tasks):
            return jsonify({"error": "not found"}), 404
        _write(TASKS_FILE, new_tasks)
    return jsonify({"ok": True})


# ── Folder API ───────────────────────────────────────────────────────────────

@app.route("/api/open_folder", methods=["POST"])
def open_folder():
    path = request.get_json().get("path", "").strip()
    if not path or not os.path.isdir(path):
        return jsonify({"error": "路径不存在"}), 400
    subprocess.Popen(["explorer", path])
    return jsonify({"ok": True})


@app.route("/api/list_dirs")
def list_dirs():
    root = request.args.get("root", "").strip()
    if not root:
        return jsonify({
            "current": "",
            "parent":  None,
            "dirs":    [{"name": os.path.basename(r) or r, "path": r} for r in QUICK_ROOTS if os.path.isdir(r)],
        })
    if not os.path.isdir(root):
        return jsonify({"error": "路径不存在"}), 400
    root_path = Path(root)
    try:
        dirs = sorted(
            [e.name for e in os.scandir(root_path) if e.is_dir() and not e.name.startswith(".")],
            key=str.lower,
        )
    except PermissionError:
        dirs = []
    parent = str(root_path.parent)
    if root_path in [Path(r) for r in QUICK_ROOTS]:
        parent = None
    return jsonify({
        "current": str(root_path),
        "parent":  parent,
        "dirs":    [{"name": d, "path": str(root_path / d)} for d in dirs],
    })


# ── Holidays API ─────────────────────────────────────────────────────────────

@app.route("/api/holidays")
def get_holidays():
    today = date.today()
    result = []
    for h in HOLIDAYS:
        d = date.fromisoformat(h["date"])
        days = (d - today).days
        if days >= 0:
            result.append({"name": h["name"], "date": h["date"], "days": days})
    result.sort(key=lambda x: x["days"])
    return jsonify(result[:6])  # 最近 6 个


# ── Countdowns API ───────────────────────────────────────────────────────────

@app.route("/api/countdowns", methods=["GET"])
def get_countdowns():
    with cdown_lock:
        items = _read(COUNTDOWNS_FILE)
    today = date.today()
    for item in items:
        d = date.fromisoformat(item["date"])
        item["days"] = (d - today).days
    items.sort(key=lambda x: x["days"])
    return jsonify(items)


@app.route("/api/countdowns", methods=["POST"])
def create_countdown():
    body  = request.get_json()
    label = body.get("label", "").strip()
    dt    = body.get("date", "").strip()
    if not label or not dt:
        return jsonify({"error": "label and date required"}), 400
    item = {"id": str(uuid.uuid4()), "label": label, "date": dt}
    with cdown_lock:
        items = _read(COUNTDOWNS_FILE)
        items.append(item)
        _write(COUNTDOWNS_FILE, items)
    item["days"] = (date.fromisoformat(dt) - date.today()).days
    return jsonify(item), 201


@app.route("/api/countdowns/<item_id>", methods=["DELETE"])
def delete_countdown(item_id):
    with cdown_lock:
        items = _read(COUNTDOWNS_FILE)
        new_items = [i for i in items if i["id"] != item_id]
        if len(new_items) == len(items):
            return jsonify({"error": "not found"}), 404
        _write(COUNTDOWNS_FILE, new_items)
    return jsonify({"ok": True})


# ── Devices ──────────────────────────────────────────────────────────────────

@app.route("/api/devices", methods=["GET"])
def list_devices():
    with dev_lock:
        return jsonify(_read(DEVICES_FILE))


@app.route("/api/devices", methods=["POST"])
def create_device():
    body = request.get_json()
    name = (body.get("name") or "").strip()
    if not name:
        return jsonify({"error": "name required"}), 400
    device = {
        "id":      str(uuid.uuid4()),
        "name":    name,
        "serial":  (body.get("serial") or "").strip(),
        "retired": False,
        "created": date.today().isoformat(),
        "records": [],
    }
    with dev_lock:
        devices = _read(DEVICES_FILE)
        devices.append(device)
        _write(DEVICES_FILE, devices)
    return jsonify(device), 201


@app.route("/api/devices/<dev_id>/record", methods=["POST"])
def add_device_record(dev_id):
    body   = request.get_json()
    action = (body.get("action") or "").strip()
    person = (body.get("person") or "").strip()
    if action not in ("借出", "归还"):
        return jsonify({"error": "action must be 借出 or 归还"}), 400
    record = {
        "id":     str(uuid.uuid4()),
        "action": action,
        "person": person,
        "date":   date.today().isoformat(),
    }
    with dev_lock:
        devices = _read(DEVICES_FILE)
        for d in devices:
            if d["id"] == dev_id:
                d["records"].append(record)
                _write(DEVICES_FILE, devices)
                return jsonify(d)
    return jsonify({"error": "not found"}), 404


@app.route("/api/devices/<dev_id>", methods=["PUT"])
def update_device(dev_id):
    body = request.get_json()
    with dev_lock:
        devices = _read(DEVICES_FILE)
        for d in devices:
            if d["id"] == dev_id:
                if "retired" in body:
                    d["retired"] = bool(body["retired"])
                _write(DEVICES_FILE, devices)
                return jsonify(d)
    return jsonify({"error": "not found"}), 404


@app.route("/api/devices/<dev_id>", methods=["DELETE"])
def delete_device(dev_id):
    with dev_lock:
        devices = _read(DEVICES_FILE)
        new_list = [d for d in devices if d["id"] != dev_id]
        if len(new_list) == len(devices):
            return jsonify({"error": "not found"}), 404
        _write(DEVICES_FILE, new_list)
    return jsonify({"ok": True})


# ── Monthly Summary ──────────────────────────────────────────────────────────

@app.route("/api/monthly_summary", methods=["POST"])
def monthly_summary():
    body = request.get_json() or {}
    target = body.get("month")
    if target:
        year, month = int(target[:4]), int(target[5:7])
    else:
        now = datetime.now()
        year, month = now.year, now.month

    with lock:
        tasks = _read(TASKS_FILE)

    done_tasks  = [t for t in tasks if t.get("done_at") and t["status"] == "done"
                   and datetime.fromisoformat(t["done_at"]).year == year
                   and datetime.fromisoformat(t["done_at"]).month == month]
    doing_tasks = [t for t in tasks if t["status"] == "doing"]
    todo_tasks  = [t for t in tasks if t["status"] == "todo"]

    tag_count: dict[str, int] = {}
    for t in done_tasks:
        for tag in t.get("tags", []):
            tag_count[tag] = tag_count.get(tag, 0) + 1

    lines = [f"# {year}年{month}月 工作总结", "", f"## 完成任务（共 {len(done_tasks)} 项）"]
    for t in sorted(done_tasks, key=lambda x: x["done_at"]):
        days     = max(1, (datetime.fromisoformat(t["done_at"]) - datetime.fromisoformat(t["created"])).days)
        tags_str = " ".join(f"[{tag}]" for tag in t.get("tags", []))
        due_str  = f" 截止:{t['due_date']}" if t.get("due_date") else ""
        lines.append(f"- [x] {t['title']} — 耗时 {days} 天{due_str} {tags_str}".rstrip())

    if tag_count:
        lines += ["", "## 按标签统计", "| 标签 | 完成数 |", "|------|--------|"]
        for tag, cnt in sorted(tag_count.items(), key=lambda x: -x[1]):
            lines.append(f"| {tag} | {cnt} |")

    if doing_tasks:
        lines += ["", "## 仍在进行中"]
        for t in doing_tasks:
            lines.append(f"- [ ] {t['title']}")

    if todo_tasks:
        lines += ["", "## 待办积压"]
        for t in todo_tasks:
            lines.append(f"- [ ] {t['title']}")

    content  = "\n".join(lines) + "\n"
    out_file = MONTHLY_DIR / f"{year:04d}-{month:02d}.md"
    MONTHLY_DIR.mkdir(exist_ok=True)
    out_file.write_text(content, encoding="utf-8")
    return jsonify({"ok": True, "file": str(out_file)})


# ── Notes API ────────────────────────────────────────────────────────────────

@app.route("/api/tasks/<task_id>/notes", methods=["GET"])
def get_notes(task_id):
    with notes_lock:
        return jsonify(_read_notes(task_id))

@app.route("/api/tasks/<task_id>/notes", methods=["POST"])
def add_note(task_id):
    body   = request.get_json()
    text   = body.get("text", "").strip()
    images = body.get("images", [])
    if not text and not images:
        return jsonify({"error": "empty"}), 400
    note = {"id": str(uuid.uuid4()), "text": text, "images": images, "created": now_iso()}
    with notes_lock:
        notes = _read_notes(task_id)
        notes.append(note)
        _write_notes(task_id, notes)
    return jsonify(note), 201

@app.route("/api/tasks/<task_id>/notes/<note_id>", methods=["DELETE"])
def delete_note(task_id, note_id):
    with notes_lock:
        notes = _read_notes(task_id)
        new_notes = [n for n in notes if n["id"] != note_id]
        if len(new_notes) == len(notes):
            return jsonify({"error": "not found"}), 404
        _write_notes(task_id, new_notes)
    return jsonify({"ok": True})


# ── Shutdown ─────────────────────────────────────────────────────────────────

@app.route("/shutdown")
def shutdown():
    os.kill(os.getpid(), 9)


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=8765, debug=False)
