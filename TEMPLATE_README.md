# Ollama Chat — Template Guide

This document explains the file structure and how to customize the Ollama Chat frontend.

## File Structure

```
ollama-chat/
├── app.py                      # FastAPI backend (all API routes, DB, tool calling)
├── templates/
│   ├── index.html              # HTML layout only (no inline CSS or JS)
│   ├── style.css               # All CSS styles (themes, layout, components)
│   ├── app.js                  # All JavaScript (app logic, API calls, rendering)
│   └── README.md               # Guide for customizing the frontend
├── Dockerfile
├── docker-compose.example.yml  # Template for docker-compose.yml
├── .gitignore
├── LICENSE
├── README.md
└── TEMPLATE_README.md          # This file
```
## templates/index.html

The HTML file contains:
- **HTML layout** — login screen, sidebar, chat area, modals
- **JavaScript** — all frontend logic (API calls, rendering, streaming, settings)

The HTML links to the CSS file via:
```html
<link rel="stylesheet" href="/static/style.css">
```

The backend serves files from `templates/` at the `/static/` path, so any CSS
or JS file you add to the `templates/` directory can be linked as `/static/filename`.

### Key JavaScript sections in index.html

| Section | What it does |
|---------|-------------|
| `Init / Auth` | Login flow, localStorage session, user management |
| `Models` | Loads model list, capability tags, model dropdown |
| `Model Settings` | Show/hide models modal |
| `Settings` | Connection settings (Ollama URL, SearXNG URL, default model) |
| `Projects` | Create/edit/delete projects, agent profiles |
| `Chats` | Create/select/delete/pin chats |
| `Files` | Upload, delete, view files in projects |
| `Rendering` | Sidebar, messages, project view, search results |
| `Compare Mode` | Side-by-side model comparison |
| `Chat actions` | Send message, stream response, regenerate, edit message |
| `Project Modal` | New/edit project with agent profile fields |
| `Utils` | escapeHtml, formatDate, formatSize helpers |

## templates/style.css

All styling lives here. Organized by section:

| Section | Description |
|---------|------------|
| Theme variables | CSS custom properties for dark/light themes |
| Login screen | Login card styling |
| Sidebar | Navigation, tabs, model selector, user info |
| List items | Chat/project list rows, pin/delete actions |
| Search | Search bar and results |
| Main area | Header, chat title, action buttons |
| Messages | Message bubbles, avatars, code blocks, timestamps |
| Typing/Tool indicators | Streaming animation, web search indicators |
| Welcome | Empty state with suggestion cards |
| Input | Textarea and send button |
| Compare mode | Side-by-side panel layout |
| Project view | Project header, file grid, chat grid |
| Modal | All modal dialogs (project, settings, file viewer) |
| Scrollbar | Custom scrollbar styling |
| Media queries | Mobile responsive rules |

## Customizing the Theme

All colors are CSS variables defined at the top of `style.css`:

```css
:root[data-theme="dark"] {
    --bg: #1a1a2e;
    --accent: #7c4dff;
    --border: #2a2a4a;
    /* ... etc */
}
:root[data-theme="light"] {
    --bg: #f5f5f7;
    --accent: #7c4dff;
    /* ... etc */
}
```

To change the accent color, just update `--accent` and `--accent-hover` in both
theme blocks. All buttons, highlights, and active states will update automatically.

## Adding New Features

### Adding a new API endpoint

1. Add the route in `app.py` (follow existing patterns)
2. Add the frontend call in `index.html` using the `api()` helper:
```javascript
const resp = await api('/api/new-endpoint', { method: 'POST', body: JSON.stringify({...}) });
```

### Adding a new modal

1. Add the modal HTML in `index.html` (follow the existing modal pattern)
2. Add show/close/save functions in the JavaScript
3. Add any new CSS classes in `style.css`

### Adding a new tool for AI

1. Add the tool function in `app.py` (like `web_search`)
2. Add it to the `TOOLS` list
3. Add it to `execute_tool()` function
4. Add the model name to `TOOL_CAPABLE_MODELS` if it supports tool calling

## Serving Static Files

The backend mounts the `templates/` directory at `/static/`:
```python
app.mount("/static", StaticFiles(directory=str(Path(__file__).parent / "templates")), name="static")
```

This means any file in `templates/` is accessible at `/static/filename`. Currently:
- `/static/style.css` — the stylesheet
- `/static/index.html` — also accessible but the root `/` route serves it instead

If you want to split JavaScript into a separate file, create `templates/app.js`
and link it in `index.html`:
```html
<script src="/static/app.js"></script>
```