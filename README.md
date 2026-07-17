# Ollama Chat

Multi-user chat interface for Ollama with projects, file context, and searchable history.

## Features

- **Invite-only registration** — admin generates tokens, new users need one to sign up
- **Default admin account** — starts with `admin` / `admin123`
- **Two-factor authentication** (TOTP) — Google Authenticator, Authy, Aegis, etc.
- **Admin panel** — user management, role control, invite tokens (admin-only)
- **Projects** with file context (PDF, text, code)
- **Searchable message history** (full-text search)
- **Agent profiles** per project (custom system prompt + model)
- **Model management** with capabilities tagging
- **Theme** support (dark/light)
- **SearXNG integration** for web search tool

## Quick Start

### Docker Compose (recommended)

```bash
git clone <your-repo-url> ollama-chat
cd ollama-chat
docker compose up -d
# Open http://localhost:8000
# Default login: admin / admin123
```

### Manual / Development

```bash
pip install fastapi uvicorn httpx pypdf python-multipart bcrypt pyotp
uvicorn app:app --host 0.0.0.0 --port 8000
```

## Security

### Authentication Flow

1. **Admin creates invite tokens** in the admin panel
2. New users enter username, password, **and invite token** to register
3. No open registration — only invited users can create accounts

### Default Admin

- Username: `admin` / Password: `admin123`
- Cannot be deleted or demoted from admin
- **Change the password immediately** after first login

### Reset Admin Password

If you forget the admin password, reset it to default:

```bash
# Inside the container:
python app.py --reset-admin

# Or via docker:
docker compose exec ollama-chat python app.py --reset-admin
```

This resets the admin password to `admin123` and disables 2FA on the account.

### Two-Factor Authentication

1. Open **Settings** (⚙ icon) → **Two-Factor Authentication**
2. Click **Enable 2FA**, scan QR code with any TOTP app
3. Enter the 6-digit code to verify and enable
4. On subsequent logins, you'll be prompted for the code after your password

### Exposing to the Internet

For public access, put this behind a reverse proxy with SSL:

1. **Reverse proxy** (Nginx Proxy Manager, Caddy, Traefik) with HTTPS
2. **2FA** (built-in TOTP) for all user accounts
3. **Invite-only registration** prevents random signups
4. **Rate limiting** via the proxy or fail2ban

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `OLLAMA_BASE_URL` | `http://host.docker.internal:11434` | Ollama API endpoint |
| `DEFAULT_MODEL` | `llama3.2` | Default model for new chats |
| `DATA_DIR` | `/app/data` | Database directory |
| `UPLOAD_DIR` | `/app/uploads` | File upload directory |
| `DEFAULT_ADMIN_USER` | `admin` | Default admin username |
| `DEFAULT_ADMIN_PASS` | `admin123` | Default admin password |

## Project Structure

```
├── app.py              # FastAPI backend
├── static/
│   ├── index.html      # Main HTML
│   ├── app.js          # Frontend logic
│   └── style.css       # Styles
├── Dockerfile
├── docker-compose.yml
└── .gitignore
```

## License

Private — all rights reserved.