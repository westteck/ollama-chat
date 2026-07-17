# Ollama Chat

Multi-user chat interface for Ollama with projects, file context, and searchable history.

## Features

- **Multi-user** with username/password auth
- **Two-factor authentication** (TOTP) — Google Authenticator, Authy, Aegis, etc.
- **Projects** with file context (PDF, text, code)
- **Searchable message history** (full-text search)
- **Agent profiles** per project (custom system prompt + model)
- **Model management** with capabilities tagging
- **Theme** support (dark/light)
- **SearXNG integration** for web search tool

## Quick Start

### Docker Compose (recommended)

```bash
# Clone and configure
git clone <your-repo-url> ollama-chat
cd ollama-chat

# Edit environment variables if needed
# OLLAMA_BASE_URL — your Ollama instance URL (default: http://host.docker.internal:11434)
# DEFAULT_MODEL — default model name (default: llama3.2)

# Start
docker compose up -d

# Open http://localhost:8000
# First user to register becomes admin
```

### Manual / Development

```bash
pip install fastapi uvicorn httpx pypdf python-multipart bcrypt pyotp
uvicorn app:app --host 0.0.0.0 --port 8000
```

## Two-Factor Authentication

1. Log in and open **Settings** (⚙ icon)
2. Click **Enable 2FA** in the Two-Factor Authentication section
3. Scan the QR code with any TOTP authenticator app
4. Enter the 6-digit code to verify and enable
5. On subsequent logins, you'll be prompted for your authenticator code after password

## Exposing to the Internet

For public access, put this behind a reverse proxy (Nginx Proxy Manager, Caddy, Traefik) with SSL:

1. **Reverse proxy** with HTTPS (Let's Encrypt via DNS challenge)
2. **2FA** (built-in TOTP) for user authentication
3. **Rate limiting** via the proxy or fail2ban
4. Optionally restrict admin endpoints at the proxy level

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `OLLAMA_BASE_URL` | `http://host.docker.internal:11434` | Ollama API endpoint |
| `DEFAULT_MODEL` | `llama3.2` | Default model for new chats |
| `DATA_DIR` | `/app/data` | Database directory |
| `UPLOAD_DIR` | `/app/uploads` | File upload directory |

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