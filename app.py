"""
Ollama Chat - Multi-user, projects, file context, searchable history.
FastAPI backend with SQLite storage. Users are name-based (no passwords).
"""
import os
import json
import sqlite3
import hashlib
import time
import uuid
from pathlib import Path
from typing import Optional
import httpx
from fastapi import FastAPI, Request, UploadFile, File, HTTPException, Query
from fastapi.responses import HTMLResponse, StreamingResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="Ollama Chat")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

OLLAMA_BASE_URL = os.environ.get("OLLAMA_BASE_URL", "http://host.docker.internal:11434")
DEFAULT_MODEL = os.environ.get("DEFAULT_MODEL", "llama3.2")
DATA_DIR = Path(os.environ.get("DATA_DIR", "/app/data"))
DB_PATH = DATA_DIR / "chat.db"
UPLOAD_DIR = Path(os.environ.get("UPLOAD_DIR", "/app/uploads"))
DATA_DIR.mkdir(parents=True, exist_ok=True)
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

app.mount("/files", StaticFiles(directory=str(UPLOAD_DIR)), name="files")

# ---------------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------------

def get_db():
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn

def init_db():
    db = get_db()
    db.executescript("""
    CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        theme TEXT DEFAULT 'dark',
        hidden_models TEXT DEFAULT '',
        ollama_url TEXT DEFAULT '',
        searxng_url TEXT DEFAULT '',
        default_model TEXT DEFAULT '',
        created REAL NOT NULL
    );

    CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT DEFAULT '',
        color TEXT DEFAULT '#7c4dff',
        agent_name TEXT DEFAULT '',
        agent_prompt TEXT DEFAULT '',
        agent_model TEXT DEFAULT '',
        pinned INTEGER DEFAULT 0,
        created REAL NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS chats (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        project_id TEXT,
        title TEXT NOT NULL DEFAULT 'New Chat',
        model TEXT DEFAULT '',
        pinned INTEGER DEFAULT 0,
        created REAL NOT NULL,
        updated REAL NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        chat_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created REAL NOT NULL,
        FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS files (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        filename TEXT NOT NULL,
        filepath TEXT NOT NULL,
        filetype TEXT DEFAULT '',
        filesize INTEGER DEFAULT 0,
        content_hash TEXT DEFAULT '',
        extracted_text TEXT DEFAULT '',
        created REAL NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
        content, chat_id, user_id, project_id
    );

    CREATE INDEX IF NOT EXISTS idx_chats_user ON chats(user_id);
    CREATE INDEX IF NOT EXISTS idx_chats_project ON chats(project_id);
    CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id);
    CREATE INDEX IF NOT EXISTS idx_files_project ON files(project_id);
    CREATE INDEX IF NOT EXISTS idx_projects_user ON projects(user_id);
    """)
    db.commit()
    db.close()

init_db()

# Migrate existing DB: add columns if missing
def migrate_db():
    db = get_db()
    # users: hidden_models, ollama_url, searxng_url, default_model
    for col in ["hidden_models", "ollama_url", "searxng_url", "default_model"]:
        default = "''"
        try:
            db.execute(f"SELECT {col} FROM users LIMIT 0")
        except sqlite3.OperationalError:
            db.execute(f"ALTER TABLE users ADD COLUMN {col} TEXT DEFAULT {default}")
    # projects: agent_name, agent_prompt, agent_model, pinned
    for col in ["agent_name", "agent_prompt", "agent_model"]:
        try:
            db.execute(f"SELECT {col} FROM projects LIMIT 0")
        except sqlite3.OperationalError:
            db.execute(f"ALTER TABLE projects ADD COLUMN {col} TEXT DEFAULT ''")
    try:
        db.execute("SELECT pinned FROM projects LIMIT 0")
    except sqlite3.OperationalError:
        db.execute("ALTER TABLE projects ADD COLUMN pinned INTEGER DEFAULT 0")
    # chats: pinned
    try:
        db.execute("SELECT pinned FROM chats LIMIT 0")
    except sqlite3.OperationalError:
        db.execute("ALTER TABLE chats ADD COLUMN pinned INTEGER DEFAULT 0")
    db.commit()
    db.close()

migrate_db()

def new_id():
    return uuid.uuid4().hex[:16]


# ---------------------------------------------------------------------------
# Auth helpers
# ---------------------------------------------------------------------------

def get_or_create_user(username: str) -> dict:
    """Get user by username, create if doesn't exist. Returns user dict."""
    username = username.strip()
    if not username:
        raise HTTPException(status_code=400, detail="Username required")
    db = get_db()
    user = db.execute("SELECT * FROM users WHERE username=?", (username,)).fetchone()
    if user:
        result = dict(user)
    else:
        uid = new_id()
        db.execute(
            "INSERT INTO users (id, username, theme, created) VALUES (?, ?, 'dark', ?)",
            (uid, username, time.time())
        )
        db.commit()
        result = {"id": uid, "username": username, "theme": "dark", "created": time.time()}
    db.close()
    return result

def require_user(request: Request) -> dict:
    """Extract user from X-User-Id header or query param. Create if new."""
    user_id = request.headers.get("X-User-Id") or request.query_params.get("user_id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Not logged in")
    db = get_db()
    user = db.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
    db.close()
    if not user:
        raise HTTPException(status_code=401, detail="Invalid user")
    return dict(user)


# ---------------------------------------------------------------------------
# File text extraction
# ---------------------------------------------------------------------------

def extract_text(filepath: str, filetype: str) -> str:
    try:
        if filetype in ('.txt', '.md', '.py', '.js', '.ts', '.json', '.yaml', '.yml',
                        '.html', '.css', '.csv', '.xml', '.sh', '.go', '.rs', '.java',
                        '.c', '.cpp', '.h', '.rb', '.php', '.sql', '.toml', '.ini', '.cfg'):
            with open(filepath, 'r', errors='ignore') as f:
                return f.read()[:50000]
        elif filetype == '.pdf':
            try:
                from pypdf import PdfReader
                reader = PdfReader(filepath)
                text = ""
                for page in reader.pages[:50]:
                    text += page.extract_text() or ""
                return text[:50000]
            except ImportError:
                return "[PDF text extraction requires pypdf]"
        else:
            return f"[Binary file: {filetype}]"
    except Exception as e:
        return f"[Error extracting text: {e}]"


def get_project_context(project_id: str, max_chars: int = 8000) -> str:
    db = get_db()
    files = db.execute(
        "SELECT filename, extracted_text FROM files WHERE project_id=? ORDER BY created DESC", (project_id,)
    ).fetchall()
    project = db.execute("SELECT name, description FROM projects WHERE id=?", (project_id,)).fetchone()
    db.close()
    if not files and not project:
        return ""
    parts = []
    if project:
        parts.append(f"Project: {project['name']}")
        if project["description"]:
            parts.append(f"Description: {project['description']}")
    if files:
        parts.append("Attached files:")
        remaining = max_chars - len("\n".join(parts)) - 200
        for f in files:
            text = f["extracted_text"] or ""
            if not text or text.startswith("[Binary"):
                parts.append(f"- {f['filename']}: [binary file, not indexed]")
                continue
            chunk = text[:min(remaining, 2000)]
            remaining -= len(chunk)
            parts.append(f"--- {f['filename']} ---\n{chunk}")
            if remaining <= 100:
                break
    return "\n\n".join(parts)


# ---------------------------------------------------------------------------
# Routes: Pages
# ---------------------------------------------------------------------------

@app.get("/", response_class=HTMLResponse)
async def index():
    html_path = Path(__file__).parent / "templates" / "index.html"
    return HTMLResponse(html_path.read_text(encoding="utf-8"))


# ---------------------------------------------------------------------------
# Routes: Auth
# ---------------------------------------------------------------------------

@app.post("/api/login")
async def login(request: Request):
    """Login or register by username. No password."""
    body = await request.json()
    username = body.get("username", "").strip()
    if not username:
        return JSONResponse({"error": "Username required"}, status_code=400)
    if len(username) > 30:
        return JSONResponse({"error": "Username too long (max 30 chars)"}, status_code=400)
    user = get_or_create_user(username)
    return {"user_id": user["id"], "username": user["username"], "theme": user["theme"]}


@app.get("/api/me")
async def get_me(request: Request):
    """Get current user info."""
    user = require_user(request)
    return user


@app.put("/api/theme")
async def update_theme(request: Request):
    """Update user's theme preference."""
    user = require_user(request)
    body = await request.json()
    theme = body.get("theme", "dark")
    if theme not in ("dark", "light"):
        theme = "dark"
    db = get_db()
    db.execute("UPDATE users SET theme=? WHERE id=?", (theme, user["id"]))
    db.commit()
    db.close()
    return {"ok": True, "theme": theme}


# ---------------------------------------------------------------------------
# Routes: Settings (per-user connection config)
# ---------------------------------------------------------------------------

def get_user_ollama_url(user: dict) -> str:
    return user.get("ollama_url") or OLLAMA_BASE_URL

def get_user_searxng_url(user: dict) -> str:
    return user.get("searxng_url") or SEARXNG_URL

def get_user_default_model(user: dict) -> str:
    return user.get("default_model") or DEFAULT_MODEL


@app.get("/api/settings")
async def get_settings(request: Request):
    user = require_user(request)
    return {
        "ollama_url": get_user_ollama_url(user),
        "searxng_url": get_user_searxng_url(user),
        "default_model": get_user_default_model(user),
        "env_ollama_url": OLLAMA_BASE_URL,
        "env_searxng_url": SEARXNG_URL,
        "env_default_model": DEFAULT_MODEL,
        "using_custom_ollama": bool(user.get("ollama_url")),
        "using_custom_searxng": bool(user.get("searxng_url")),
        "using_custom_model": bool(user.get("default_model")),
    }


@app.put("/api/settings")
async def update_settings(request: Request):
    user = require_user(request)
    body = await request.json()
    db = get_db()
    fields, values = [], []
    for k in ("ollama_url", "searxng_url", "default_model"):
        if k in body:
            val = body[k].strip() if isinstance(body[k], str) else ""
            fields.append(f"{k}=?")
            values.append(val)
    if fields:
        values.append(user["id"])
        db.execute(f"UPDATE users SET {','.join(fields)} WHERE id=?", values)
        db.commit()
    db.close()
    return {"ok": True}


@app.get("/api/settings/test-ollama")
async def test_ollama_connection(request: Request):
    user = require_user(request)
    url = get_user_ollama_url(user)
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(f"{url}/api/tags")
            resp.raise_for_status()
            data = resp.json()
            models = [m["name"] for m in data.get("models", [])]
            return {"status": "ok", "url": url, "model_count": len(models), "models": models[:10]}
    except Exception as e:
        return JSONResponse({"status": "error", "url": url, "error": str(e)}, status_code=502)


@app.get("/api/settings/test-searxng")
async def test_searxng_connection(request: Request):
    user = require_user(request)
    url = get_user_searxng_url(user)
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(f"{url}/search", params={"q": "test", "format": "json"})
            resp.raise_for_status()
            data = resp.json()
            results = data.get("results", [])
            return {"status": "ok", "url": url, "result_count": len(results)}
    except Exception as e:
        return JSONResponse({"status": "error", "url": url, "error": str(e)}, status_code=502)


# ---------------------------------------------------------------------------
# Model capabilities database
# ---------------------------------------------------------------------------

# Capabilities: coding, writing, research, thinking, vision, tools, video, fiction, nonfiction
MODEL_CAPS = {
    # GLM family - general purpose, strong at writing and research
    "glm-5.2:cloud":      ["writing", "research", "fiction", "nonfiction", "tools"],
    "glm-5:cloud":        ["writing", "research", "fiction", "nonfiction", "tools"],
    "glm-5.1:cloud":      ["writing", "research", "fiction", "nonfiction", "tools"],
    # DeepSeek - coding and reasoning focused
    "deepseek-v4-flash:cloud": ["coding", "tools", "research"],
    "deepseek-v4-pro:cloud":   ["coding", "thinking", "research", "tools"],
    "deepseek-v3.2:cloud":     ["coding", "research", "writing"],
    # Kimi - coding and general, some support vision
    "kimi-k2.7-code:cloud": ["coding", "research", "vision", "tools"],
    "kimi-k2.6:cloud":      ["coding", "research", "writing", "vision", "tools"],
    "kimi-k2.5:cloud":      ["writing", "research", "vision", "tools"],
    # Qwen coders - coding focused
    "qwen3-coder-next:cloud":  ["coding", "research", "tools"],
    "qwen3-coder:480b-cloud":  ["coding", "research", "tools"],
    "qwen3.5:397b-cloud":      ["coding", "research", "writing", "tools"],
    "qwen2.5-coder:3b":       ["coding"],
    # Gemini - multimodal, fast, general purpose
    "gemini-3-flash-preview:cloud": ["writing", "research", "vision", "tools"],
    # MiniMax - general purpose
    "minimax-m3:cloud":    ["writing", "research", "fiction", "nonfiction", "vision", "tools"],
    "minimax-m2.7:cloud":  ["writing", "research", "fiction", "nonfiction", "tools"],
    "minimax-m2.5:cloud":  ["writing", "research", "fiction", "nonfiction", "tools"],
    # Mistral family
    "ministral-3:14b-cloud": ["coding", "research", "writing", "vision", "tools"],
    "devstral-2:123b-cloud": ["coding", "research", "tools"],
    # Nemotron - NVIDIA reasoning models
    "nemotron-3-super:cloud": ["thinking", "research", "coding", "tools"],
    # Gemma
    "gemma4:31b-cloud":    ["writing", "research", "fiction", "nonfiction", "vision", "tools"],
    # RNJ
    "rnj-1:8b-cloud":      ["writing", "coding"],
    "rnj-1:8b":            ["writing", "coding"],
    # Small local models
    "qwen2:1.5b":          ["coding"],
    "tinyllama:latest":    ["writing"],
    "llama3.2:3b":         ["writing", "coding"],
    "phi3:3.8b":           ["coding", "writing"],
}

# Display labels for each capability
CAP_LABELS = {
    "coding":     "💻 Code",
    "writing":    "✍️ Writing",
    "research":   "🔬 Research",
    "thinking":   "🧠 Thinking",
    "vision":     "👁️ Vision",
    "tools":      "🔧 Tools",
    "video":      "🎬 Video",
    "fiction":    "📖 Fiction",
    "nonfiction": "📰 Non-fiction",
}

def guess_caps(model_name: str) -> list:
    """Guess capabilities from model name when not in database."""
    caps = []
    name = model_name.lower()
    if "coder" in name or "code" in name or "coding" in name:
        caps.append("coding")
    if "flash" in name or "mini" in name or "tiny" in name:
        caps.append("writing")
    if "pro" in name or "ultra" in name or "super" in name:
        caps.append("thinking")
    if "vision" in name or "gemini" in name:
        caps.append("vision")
    if not caps:
        caps = ["writing", "research"]
    return caps


# ---------------------------------------------------------------------------
# Routes: Models & Health
# ---------------------------------------------------------------------------

@app.get("/api/models")
async def list_models(request: Request):
    user = require_user(request)
    ollama_url = get_user_ollama_url(user)
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(f"{ollama_url}/api/tags")
            resp.raise_for_status()
            data = resp.json()
            all_models = [m["name"] for m in data.get("models", [])]
        # Filter hidden models for this user
        hidden = set(user.get("hidden_models", "").split(",")) if user.get("hidden_models") else set()
        # Add capabilities for each model
        all_with_caps = [{"name": m, "caps": MODEL_CAPS.get(m, MODEL_CAPS.get(m.split(":")[0], guess_caps(m)))} for m in all_models]
        visible_with_caps = [m for m in all_with_caps if m["name"] not in hidden]
        default_m = get_user_default_model(user)
        return {"models": visible_with_caps, "all_models": all_with_caps, "default": default_m}
    except Exception as e:
        return JSONResponse({"error": f"Cannot connect to Ollama: {e}"}, status_code=502)


@app.get("/api/models/hidden")
async def get_hidden_models(request: Request):
    user = require_user(request)
    hidden = user.get("hidden_models", "")
    return {"hidden": [m for m in hidden.split(",") if m] if hidden else []}


@app.put("/api/models/hidden")
async def set_hidden_models(request: Request):
    user = require_user(request)
    body = await request.json()
    hidden_list = body.get("hidden", [])
    hidden_str = ",".join(hidden_list)
    db = get_db()
    db.execute("UPDATE users SET hidden_models=? WHERE id=?", (hidden_str, user["id"]))
    db.commit()
    db.close()
    return {"ok": True, "hidden": hidden_list}


@app.get("/api/models/cap-labels")
async def get_cap_labels():
    return {"labels": CAP_LABELS}


@app.get("/api/health")
async def health(request: Request):
    try:
        user = require_user(request)
        url = get_user_ollama_url(user)
    except Exception:
        url = OLLAMA_BASE_URL
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(f"{url}/api/tags")
            resp.raise_for_status()
            return {"status": "ok", "ollama": "connected"}
    except Exception:
        return {"status": "degraded", "ollama": "unreachable"}


# ---------------------------------------------------------------------------
# Routes: Projects (user-scoped)
# ---------------------------------------------------------------------------

@app.get("/api/projects")
async def list_projects(request: Request):
    user = require_user(request)
    db = get_db()
    rows = db.execute(
        "SELECT * FROM projects WHERE user_id=? ORDER BY created DESC", (user["id"],)
    ).fetchall()
    result = []
    for r in rows:
        chat_count = db.execute("SELECT COUNT(*) as c FROM chats WHERE project_id=? AND user_id=?", (r["id"], user["id"])).fetchone()["c"]
        file_count = db.execute("SELECT COUNT(*) as c FROM files WHERE project_id=? AND user_id=?", (r["id"], user["id"])).fetchone()["c"]
        result.append({**dict(r), "chat_count": chat_count, "file_count": file_count})
    db.close()
    return {"projects": result}


@app.post("/api/projects")
async def create_project(request: Request):
    user = require_user(request)
    body = await request.json()
    pid = new_id()
    db = get_db()
    db.execute(
        "INSERT INTO projects (id, user_id, name, description, color, agent_name, agent_prompt, agent_model, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (pid, user["id"], body.get("name", "Untitled"), body.get("description", ""), body.get("color", "#7c4dff"),
         body.get("agent_name", ""), body.get("agent_prompt", ""), body.get("agent_model", ""), time.time())
    )
    db.commit()
    db.close()
    return {"id": pid}


@app.put("/api/projects/{pid}")
async def update_project(pid: str, request: Request):
    user = require_user(request)
    body = await request.json()
    db = get_db()
    row = db.execute("SELECT user_id FROM projects WHERE id=?", (pid,)).fetchone()
    if not row or row["user_id"] != user["id"]:
        raise HTTPException(status_code=403, detail="Not your project")
    fields, values = [], []
    for k in ("name", "description", "color", "agent_name", "agent_prompt", "agent_model"):
        if k in body:
            fields.append(f"{k}=?")
            values.append(body[k])
    if fields:
        values.append(pid)
        db.execute(f"UPDATE projects SET {','.join(fields)} WHERE id=?", values)
        db.commit()
    db.close()
    return {"ok": True}


@app.delete("/api/projects/{pid}")
async def delete_project(pid: str, request: Request):
    user = require_user(request)
    db = get_db()
    row = db.execute("SELECT user_id FROM projects WHERE id=?", (pid,)).fetchone()
    if not row or row["user_id"] != user["id"]:
        raise HTTPException(status_code=403, detail="Not your project")
    files = db.execute("SELECT filepath FROM files WHERE project_id=?", (pid,)).fetchall()
    for f in files:
        try: os.remove(f["filepath"])
        except OSError: pass
    db.execute("DELETE FROM projects WHERE id=?", (pid,))
    db.commit()
    db.close()
    return {"ok": True}


# ---------------------------------------------------------------------------
# Routes: Chats (user-scoped)
# ---------------------------------------------------------------------------

@app.get("/api/chats")
async def list_chats(request: Request, project_id: Optional[str] = None):
    user = require_user(request)
    db = get_db()
    if project_id:
        rows = db.execute(
            "SELECT * FROM chats WHERE user_id=? AND project_id=? ORDER BY pinned DESC, updated DESC", (user["id"], project_id)
        ).fetchall()
    else:
        rows = db.execute(
            "SELECT * FROM chats WHERE user_id=? ORDER BY pinned DESC, updated DESC", (user["id"],)
        ).fetchall()
    db.close()
    return {"chats": [dict(r) for r in rows]}


@app.post("/api/chats")
async def create_chat(request: Request):
    user = require_user(request)
    body = await request.json()
    cid = new_id()
    db = get_db()
    now = time.time()
    db.execute(
        "INSERT INTO chats (id, user_id, project_id, title, model, created, updated) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (cid, user["id"], body.get("project_id"), body.get("title", "New Chat"), body.get("model", ""), now, now)
    )
    db.commit()
    db.close()
    return {"id": cid}


@app.get("/api/chats/{cid}")
async def get_chat(cid: str, request: Request):
    user = require_user(request)
    db = get_db()
    chat = db.execute("SELECT * FROM chats WHERE id=? AND user_id=?", (cid, user["id"])).fetchone()
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")
    msgs = db.execute("SELECT * FROM messages WHERE chat_id=? ORDER BY created ASC", (cid,)).fetchall()
    db.close()
    return {"chat": dict(chat), "messages": [dict(m) for m in msgs]}


@app.put("/api/chats/{cid}")
async def update_chat(cid: str, request: Request):
    user = require_user(request)
    body = await request.json()
    db = get_db()
    row = db.execute("SELECT user_id FROM chats WHERE id=?", (cid,)).fetchone()
    if not row or row["user_id"] != user["id"]:
        raise HTTPException(status_code=403, detail="Not your chat")
    fields, values = [], []
    for k in ("title", "model", "project_id"):
        if k in body:
            fields.append(f"{k}=?")
            values.append(body[k])
    fields.append("updated=?")
    values.append(time.time())
    values.append(cid)
    db.execute(f"UPDATE chats SET {','.join(fields)} WHERE id=?", values)
    db.commit()
    db.close()
    return {"ok": True}


@app.delete("/api/chats/{cid}")
async def delete_chat(cid: str, request: Request):
    user = require_user(request)
    db = get_db()
    row = db.execute("SELECT user_id FROM chats WHERE id=?", (cid,)).fetchone()
    if not row or row["user_id"] != user["id"]:
        raise HTTPException(status_code=403, detail="Not your chat")
    db.execute("DELETE FROM chats WHERE id=?", (cid,))
    db.commit()
    db.close()
    return {"ok": True}


@app.put("/api/chats/{cid}/pin")
async def toggle_pin_chat(cid: str, request: Request):
    user = require_user(request)
    db = get_db()
    row = db.execute("SELECT pinned FROM chats WHERE id=? AND user_id=?", (cid, user["id"])).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Chat not found")
    new_val = 0 if row["pinned"] else 1
    db.execute("UPDATE chats SET pinned=? WHERE id=?", (new_val, cid))
    db.commit()
    db.close()
    return {"ok": True, "pinned": new_val}


@app.get("/api/chats/{cid}/export")
async def export_chat(cid: str, request: Request, format: str = "markdown"):
    user = require_user(request)
    db = get_db()
    chat = db.execute("SELECT * FROM chats WHERE id=? AND user_id=?", (cid, user["id"])).fetchone()
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")
    msgs = db.execute("SELECT * FROM messages WHERE chat_id=? ORDER BY created ASC", (cid,)).fetchall()
    db.close()
    if format == "json":
        export_data = {
            "title": chat["title"],
            "model": chat["model"],
            "created": chat["created"],
            "messages": [{"role": m["role"], "content": m["content"], "created": m["created"]} for m in msgs]
        }
        return JSONResponse(export_data, headers={
            "Content-Disposition": f'attachment; filename="{chat["title"]}.json"'
        })
    # Markdown
    lines = [f"# {chat['title']}\n"]
    for m in msgs:
        role_label = "🧑 User" if m["role"] == "user" else "🤖 Assistant"
        lines.append(f"### {role_label}\n\n{m['content']}\n")
    md = "\n---\n\n".join(lines)
    return JSONResponse({"content": md, "filename": chat["title"] + ".md"})


@app.put("/api/chats/{cid}/messages/{mid}")
async def edit_message(cid: str, mid: str, request: Request):
    user = require_user(request)
    body = await request.json()
    db = get_db()
    chat = db.execute("SELECT user_id FROM chats WHERE id=? AND user_id=?", (cid, user["id"])).fetchone()
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")
    db.execute("UPDATE messages SET content=? WHERE id=? AND chat_id=?", (body.get("content", ""), mid, cid))
    # Also update FTS
    db.execute("DELETE FROM messages_fts WHERE content IN (SELECT content FROM messages WHERE id=?)", (mid,))
    db.execute("INSERT INTO messages_fts (content, chat_id, user_id, project_id) "
               "SELECT m.content, m.chat_id, c.user_id, COALESCE(c.project_id, '') "
               "FROM messages m JOIN chats c ON m.chat_id=c.id WHERE m.id=?", (mid,))
    db.execute("UPDATE chats SET updated=? WHERE id=?", (time.time(), cid))
    db.commit()
    db.close()
    return {"ok": True}


@app.delete("/api/chats/{cid}/messages/{mid}")
async def delete_message(cid: str, mid: str, request: Request):
    user = require_user(request)
    db = get_db()
    chat = db.execute("SELECT user_id FROM chats WHERE id=? AND user_id=?", (cid, user["id"])).fetchone()
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")
    db.execute("DELETE FROM messages WHERE id=? AND chat_id=?", (mid, cid))
    db.commit()
    db.close()
    return {"ok": True}


# ---------------------------------------------------------------------------
# Routes: Messages
# ---------------------------------------------------------------------------

@app.post("/api/chats/{cid}/messages")
async def add_message(cid: str, request: Request):
    user = require_user(request)
    body = await request.json()
    db = get_db()
    chat = db.execute("SELECT user_id, project_id FROM chats WHERE id=? AND user_id=?", (cid, user["id"])).fetchone()
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")
    mid = new_id()
    db.execute(
        "INSERT INTO messages (id, chat_id, role, content, created) VALUES (?, ?, ?, ?, ?)",
        (mid, cid, body["role"], body["content"], time.time())
    )
    db.execute(
        "INSERT INTO messages_fts (content, chat_id, user_id, project_id) VALUES (?, ?, ?, ?)",
        (body["content"], cid, user["id"], chat["project_id"] or "")
    )
    db.execute("UPDATE chats SET updated=? WHERE id=?", (time.time(), cid))
    db.commit()
    db.close()
    return {"id": mid}


# ---------------------------------------------------------------------------
# Routes: Search (user-scoped)
# ---------------------------------------------------------------------------

@app.get("/api/search")
async def search(request: Request, q: str = Query(""), project_id: Optional[str] = None):
    user = require_user(request)
    if not q.strip():
        return {"results": []}
    db = get_db()
    if project_id:
        rows = db.execute(
            "SELECT m.id, m.chat_id, m.role, m.content, m.created, c.title, c.project_id "
            "FROM messages_fts f JOIN messages m ON m.content = f.content "
            "JOIN chats c ON m.chat_id = c.id "
            "WHERE messages_fts MATCH ? AND f.user_id=? AND f.project_id=? "
            "ORDER BY rank LIMIT 50",
            (q, user["id"], project_id)
        ).fetchall()
    else:
        rows = db.execute(
            "SELECT m.id, m.chat_id, m.role, m.content, m.created, c.title, c.project_id "
            "FROM messages_fts f JOIN messages m ON m.content = f.content "
            "JOIN chats c ON m.chat_id = c.id "
            "WHERE messages_fts MATCH ? AND f.user_id=? "
            "ORDER BY rank LIMIT 50",
            (q, user["id"])
        ).fetchall()
    db.close()
    results = []
    for r in rows:
        snippet = r["content"]
        if len(snippet) > 200:
            ql = q.lower()
            pos = snippet.lower().find(ql)
            if pos >= 0:
                start = max(0, pos - 50)
                snippet = ("..." if start > 0 else "") + snippet[start:start+150] + "..."
        results.append({
            "message_id": r["id"], "chat_id": r["chat_id"], "chat_title": r["title"],
            "project_id": r["project_id"], "role": r["role"],
            "snippet": snippet, "created": r["created"],
        })
    return {"results": results}


# ---------------------------------------------------------------------------
# Routes: Files (user-scoped)
# ---------------------------------------------------------------------------

@app.get("/api/files/{project_id}")
async def list_files(project_id: str, request: Request):
    user = require_user(request)
    db = get_db()
    rows = db.execute(
        "SELECT id, project_id, filename, filetype, filesize, created FROM files WHERE project_id=? AND user_id=? ORDER BY created DESC",
        (project_id, user["id"])
    ).fetchall()
    db.close()
    return {"files": [dict(r) for r in rows]}


@app.post("/api/files/{project_id}")
async def upload_file(project_id: str, request: Request, file: UploadFile = File(...)):
    user = require_user(request)
    db = get_db()
    proj = db.execute("SELECT user_id FROM projects WHERE id=?", (project_id,)).fetchone()
    if not proj or proj["user_id"] != user["id"]:
        raise HTTPException(status_code=403, detail="Not your project")
    db.close()
    if not file.filename:
        raise HTTPException(status_code=400, detail="No file provided")
    ext = Path(file.filename).suffix.lower()
    fid = new_id()
    safe_name = f"{fid}{ext}"
    filepath = UPLOAD_DIR / safe_name
    content = await file.read()
    with open(filepath, "wb") as f:
        f.write(content)
    extracted = extract_text(str(filepath), ext)
    h = hashlib.sha256(content).hexdigest()[:16]
    db = get_db()
    db.execute(
        "INSERT INTO files (id, project_id, user_id, filename, filepath, filetype, filesize, content_hash, extracted_text, created) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (fid, project_id, user["id"], file.filename, str(filepath), ext, len(content), h, extracted, time.time())
    )
    db.commit()
    db.close()
    return {"id": fid, "filename": file.filename, "filesize": len(content)}


@app.delete("/api/files/{fid}")
async def delete_file(fid: str, request: Request):
    user = require_user(request)
    db = get_db()
    row = db.execute("SELECT filepath, user_id FROM files WHERE id=?", (fid,)).fetchone()
    if not row or row["user_id"] != user["id"]:
        raise HTTPException(status_code=403, detail="Not your file")
    try: os.remove(row["filepath"])
    except OSError: pass
    db.execute("DELETE FROM files WHERE id=?", (fid,))
    db.commit()
    db.close()
    return {"ok": True}


@app.get("/api/files/{fid}/content")
async def get_file_content(fid: str, request: Request):
    user = require_user(request)
    db = get_db()
    row = db.execute("SELECT * FROM files WHERE id=? AND user_id=?", (fid, user["id"])).fetchone()
    db.close()
    if not row:
        raise HTTPException(status_code=404, detail="File not found")
    filepath = row["filepath"]
    if not os.path.exists(filepath):
        raise HTTPException(status_code=404, detail="File not found on disk")
    ext = row["filetype"]
    # Return text-based files as text, binary info otherwise
    if ext in ('.txt', '.md', '.py', '.js', '.ts', '.json', '.yaml', '.yml',
               '.html', '.css', '.csv', '.xml', '.sh', '.go', '.rs', '.java',
               '.c', '.cpp', '.h', '.rb', '.php', '.sql', '.toml', '.ini', '.cfg'):
        with open(filepath, 'r', errors='replace') as f:
            return {"content": f.read()[:50000], "type": "text", "filename": row["filename"]}
    elif ext == '.pdf':
        return {"content": row["extracted_text"] or "[No text extracted]", "type": "pdf", "filename": row["filename"]}
    else:
        return {"content": f"[Binary file: {row['filename']} ({row['filesize']} bytes)]", "type": "binary", "filename": row["filename"]}


# ---------------------------------------------------------------------------
# Web search tool (SearXNG)
# ---------------------------------------------------------------------------

SEARXNG_URL = os.environ.get("SEARXNG_URL", "http://host.docker.internal:9090")

async def web_search(query: str, searxng_url: str = None, num_results: int = 5) -> str:
    """Search the web via SearXNG and return formatted results."""
    if not searxng_url:
        searxng_url = SEARXNG_URL
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(
                f"{SEARXNG_URL}/search",
                params={"q": query, "format": "json"}
            )
            resp.raise_for_status()
            data = resp.json()
            results = data.get("results", [])[:num_results]
            if not results:
                return f"No web search results found for: {query}"
            lines = [f"Web search results for '{query}':\n"]
            for i, r in enumerate(results, 1):
                title = r.get("title", "Untitled")
                url = r.get("url", "")
                content = r.get("content", "") or ""
                lines.append(f"{i}. {title}\n   URL: {url}\n   {content[:300]}")
            return "\n\n".join(lines)
    except Exception as e:
        return f"Web search failed: {e}"

# Tool definitions for Ollama
TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "web_search",
            "description": "Search the web for current information, news, documentation, or any topic. Use this when the user asks about current events, recent information, or anything you don't have enough knowledge about. Returns titles, URLs, and snippets from search results.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "The search query"
                    }
                },
                "required": ["query"]
            }
        }
    }
]

async def execute_tool(tool_name: str, args: dict, user: dict) -> str:
    """Execute a tool by name and return the result string."""
    if tool_name == "web_search":
        searxng_url = get_user_searxng_url(user)
        return await web_search(args.get("query", ""), searxng_url)
    return f"Unknown tool: {tool_name}"

# Models that support tool calling
TOOL_CAPABLE_MODELS = {
    "glm-5.2:cloud", "glm-5:cloud", "glm-5.1:cloud",
    "deepseek-v4-flash:cloud", "deepseek-v4-pro:cloud",
    "kimi-k2.7-code:cloud", "kimi-k2.6:cloud", "kimi-k2.5:cloud",
    "gemini-3-flash-preview:cloud",
    "qwen3.5:397b-cloud", "qwen3-coder-next:cloud", "qwen3-coder:480b-cloud",
    "minimax-m3:cloud", "minimax-m2.7:cloud", "minimax-m2.5:cloud",
    "nemotron-3-super:cloud",
    "ministral-3:14b-cloud", "devstral-2:123b-cloud",
    "gemma4:31b-cloud",
}

def model_supports_tools(model: str) -> bool:
    return model in TOOL_CAPABLE_MODELS


# ---------------------------------------------------------------------------
# Chat with Ollama (streaming, with project context + tool calling)
# ---------------------------------------------------------------------------

@app.post("/api/chat")
async def chat(request: Request):
    user = require_user(request)
    body = await request.json()
    model = body.get("model", get_user_default_model(user))
    messages = body.get("messages", [])
    project_id = body.get("project_id")
    ollama_url = get_user_ollama_url(user)

    if project_id:
        db = get_db()
        proj = db.execute("SELECT user_id, agent_prompt, agent_model, agent_name FROM projects WHERE id=?", (project_id,)).fetchone()
        db.close()
        if proj and proj["user_id"] == user["id"]:
            # Use agent model if set
            if proj["agent_model"]:
                model = proj["agent_model"]
            # Use agent system prompt if set
            if proj["agent_prompt"]:
                agent_sys = {"role": "system", "content": proj["agent_prompt"]}
                if proj["agent_name"]:
                    agent_sys["content"] = f"You are {proj['agent_name']}. {proj['agent_prompt']}"
                messages = [agent_sys] + messages
            context = get_project_context(project_id)
            if context:
                messages = [{"role": "system", "content": f"You have access to the following project context:\n\n{context}"}] + messages

    use_tools = model_supports_tools(model)

    # Add system instruction for tool-using models
    if use_tools and messages and messages[0].get("role") == "system":
        messages[0]["content"] += "\n\nYou have access to a web_search tool. Use it when you need current information. After receiving search results, summarize them for the user. Do not call the same search more than once."
    elif use_tools:
        messages.insert(0, {"role": "system", "content": "You have access to a web_search tool. Use it when you need current information. After receiving search results, summarize them for the user. Do not call the same search more than once."})

    async def stream_generator():
        nonlocal messages
        try:
            if not use_tools:
                # Simple streaming (no tool calling)
                async with httpx.AsyncClient(timeout=120.0) as client:
                    async with client.stream("POST", f"{ollama_url}/api/chat",
                        json={"model": model, "messages": messages, "stream": True}) as resp:
                        resp.raise_for_status()
                        async for line in resp.aiter_lines():
                            if line:
                                yield f"data: {line}\n\n"
                return

            # Tool-calling loop: send request, check for tool calls, execute, repeat
            max_tool_rounds = 3
            seen_queries = set()
            for round_num in range(max_tool_rounds):
                async with httpx.AsyncClient(timeout=120.0) as client:
                    resp = await client.post(
                        f"{ollama_url}/api/chat",
                        json={"model": model, "messages": messages, "stream": False, "tools": TOOLS}
                    )
                    resp.raise_for_status()
                    data = resp.json()
                    msg = data.get("message", {})

                    tool_calls = msg.get("tool_calls", [])
                    content = msg.get("content", "") or ""

                    if tool_calls:
                        # Notify frontend that a tool is being called
                        for tc in tool_calls:
                            fn = tc.get("function", {})
                            tool_name = fn.get("name", "unknown")
                            tool_args = fn.get("arguments", {})
                            if isinstance(tool_args, str):
                                try:
                                    tool_args = json.loads(tool_args)
                                except Exception:
                                    tool_args = {"raw": tool_args}

                            # Send tool-call event to frontend
                            tool_event = {
                                "type": "tool_call",
                                "tool": tool_name,
                                "args": tool_args
                            }
                            yield f"data: {json.dumps(tool_event)}\n\n"

                            # Execute the tool
                            query_str = tool_args.get("query", "")
                            if tool_name == "web_search" and query_str in seen_queries:
                                result = f"You already searched for '{query_str}'. Use the previous results. Do not search again."
                            else:
                                seen_queries.add(query_str)
                                result = await execute_tool(tool_name, tool_args, user)

                            # Send tool result to frontend
                            result_event = {
                                "type": "tool_result",
                                "tool": tool_name,
                                "result": result[:2000]
                            }
                            yield f"data: {json.dumps(result_event)}\n\n"

                            # Append assistant message with tool call + tool response to conversation
                            messages.append(msg)
                            messages.append({
                                "role": "tool",
                                "content": result
                            })
                        # Continue loop - send back to model for next response
                    else:
                        # No tool calls - stream the final content to frontend
                        # We already have the full content, stream it word by word
                        if content:
                            # Send content as a simulated stream
                            words = content.split(" ")
                            for i, word in enumerate(words):
                                chunk = word + (" " if i < len(words) - 1 else "")
                                fake_response = {
                                    "message": {"content": chunk, "role": "assistant"},
                                    "done": i >= len(words) - 1
                                }
                                yield f"data: {json.dumps(fake_response)}\n\n"
                        return

            # If we hit max rounds, send a note
            yield f'data: {{"error": "Reached maximum tool call rounds ({max_tool_rounds})"}}\n\n'

        except httpx.ConnectError:
            yield f'data: {{"error": "Cannot connect to Ollama at {ollama_url}"}}\n\n'
        except Exception as e:
            yield f'data: {{"error": "{str(e)}"}}\n\n'

    return StreamingResponse(stream_generator(), media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no"})


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", "8000")))