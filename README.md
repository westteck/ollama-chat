# Ollama Chat

A self-hosted, ChatGPT-style web interface for [Ollama](https://ollama.com), built with FastAPI and Docker. Features multi-user support, project organization, file context (RAG), web search via SearXNG, model comparison, and per-project AI agent profiles.

![Ollama Chat](https://img.shields.io/badge/Ollama-Chat-7c4dff)

## Features

- **ChatGPT-style interface** — Clean, dark/light theme, streaming responses, markdown rendering
- **Multi-user** — Username-based login (no passwords), per-user settings and model visibility
- **Projects** — Organize chats into projects with file context, custom colors, and agent profiles
- **Agent Profiles** — Per-project system prompts, preferred models, and AI personality
- **Web Search** — Integrated SearXNG tool calling — models can search the web for current info
- **Model Management** — 27+ cloud model support, capability tags (coding, writing, vision, tools), hide/show models
- **Model Comparison** — Side-by-side comparison of two models on the same prompt
- **File Upload & Viewer** — Upload files to projects, view text/code/PDF content inline, automatic text extraction for RAG context
- **Search** — Full-text search across all your conversations
- **Export** — Export conversations as Markdown
- **Pinning** — Pin important conversations to the top
- **Edit & Regenerate** — Edit messages and resend, regenerate AI responses
- **Copy code blocks** — One-click copy on all code blocks
- **Message timestamps** — Hover to see when messages were sent
- **Per-user connection settings** — Each user can configure their own Ollama and SearXNG URLs

## Quick Start

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/) and Docker Compose
- [Ollama](https://ollama.com) running on your machine (or accessible via network)

### 1. Clone and configure

```bash
git clone https://github.com/westteck/ollama-chat.git
cd ollama-chat
cp docker-compose.example.yml docker-compose.yml
```

Edit `docker-compose.yml` to match your setup:
- `OLLAMA_BASE_URL` — URL of your Ollama instance (default: `http://host.docker.internal:11434`)
- `DEFAULT_MODEL` — Default model to select (default: `llama3.2`)
- `SEARXNG_URL` — URL of your SearXNG instance for web search (optional)

### 2. Build and run

```bash
docker compose up -d --build
```

Open `http://localhost:3011` in your browser.

### 3. Pull some models

Make sure you have models in Ollama:

```bash
ollama pull llama3.2
# or cloud models
ollama pull glm-5.2:cloud
ollama pull deepseek-v4-flash:cloud
```

The app automatically discovers all available models from your Ollama instance.

## Optional: SearXNG Setup

For web search functionality, you need a [SearXNG](https://searxng.org) instance with JSON output enabled.

### Quick SearXNG with Docker

```bash
docker run -d --name searxng -p 9090:8080 searxng/searxng:latest
```

Then enable JSON format in SearXNG settings:
```bash
docker exec searxng sed -i '/^  formats:$/a\    - json' /etc/searxng/settings.yml
docker restart searxng
```

Set `SEARXNG_URL=http://host.docker.internal:9090` in your docker-compose.yml.

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `OLLAMA_BASE_URL` | `http://host.docker.internal:11434` | Ollama API URL |
| `DEFAULT_MODEL` | `llama3.2` | Default model for new chats |
| `DATA_DIR` | `/app/data` | SQLite database location |
| `UPLOAD_DIR` | `/app/uploads` | Uploaded files location |
| `SEARXNG_URL` | `http://host.docker.internal:9090` | SearXNG URL for web search |

### Volumes

- `./data:/app/data` — SQLite database (chat.db)
- `./uploads:/app/uploads` — Uploaded project files

### Per-user settings

Each user can configure their own Ollama URL, SearXNG URL, and default model from the Settings page (gear icon in the header). User settings override the server defaults.

## Model Capabilities

The app shows capability tags next to each model:

| Tag | Description |
|-----|-------------|
| 💻 Code | Programming, code generation |
| ✍️ Writing | General text generation |
| 🔬 Research | Research, analysis, summarization |
| 🧠 Thinking | Reasoning, step-by-step problem solving |
| 👁️ Vision | Can accept and analyze images |
| 🔧 Tools | Supports tool calling (web search) |
| 📖 Fiction | Creative writing, storytelling |
| 📰 Non-fiction | Articles, documentation, factual writing |

## Agent Profiles

Each project can have an agent profile that defines:
- **Agent Name** — A persona name (e.g. "Python Expert")
- **System Prompt** — Custom instructions for the AI
- **Preferred Model** — Override the dropdown model for this project

## Tech Stack

- **Backend:** FastAPI (Python), SQLite, httpx
- **Frontend:** Vanilla HTML/CSS/JS, marked.js for markdown
- **Containerization:** Docker, Docker Compose
- **Search:** SearXNG (optional)
- **LLM:** Ollama

## Project Structure

```
ollama-chat/
├── app.py                 # FastAPI backend
├── templates/
│   └── index.html         # Single-file frontend
├── Dockerfile
├── docker-compose.yml     # Your config (not in repo)
├── docker-compose.example.yml  # Template for config
├── .gitignore
├── LICENSE
└── README.md
```

## License

MIT — see [LICENSE](LICENSE)

## Contributing

Pull requests welcome! This is a custom-built alternative to heavier solutions like Open WebUI, designed to be lightweight, self-hosted, and easy to customize.