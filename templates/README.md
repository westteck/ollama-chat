# Templates — Customization Guide

This folder contains the frontend for Ollama Chat. Everything is split across two files:

| File | Contains |
|------|----------|
| `index.html` | HTML layout + all JavaScript (app logic, API calls, rendering) |
| `style.css` | All CSS styling (themes, layout, components, animations) |

No build step. No npm. No framework. Just edit and refresh.

---

## Quick Start

1. Change something in `index.html` or `style.css`
2. Rebuild the container:

```bash
docker compose up -d --build
```

3. Refresh your browser (Ctrl+Shift+R for hard refresh)

That's it. No compilation, no bundling.

---

## style.css

### Change the accent color

At the top of the file, update `--accent` and `--accent-hover` in both theme blocks:

```css
:root[data-theme="dark"] {
    --accent: #7c4dff;       /* change this */
    --accent-hover: #651fff; /* and this (slightly darker) */
    --accent-dim: rgba(124,77,255,0.15); /* and this (with transparency) */
}
```

All buttons, highlights, active states, and badges update automatically.

### Change the background

Update `--bg` in both theme blocks:

```css
:root[data-theme="dark"] {
    --bg: #1a1a2e;         /* main background */
    --bg-sidebar: #16213e; /* sidebar */
    --bg-chat: #0f0f23;    /* chat area */
}
```

### Change the sidebar width

```css
.sidebar { width: 280px; }              /* default width */
.sidebar.collapsed { margin-left: -280px; }  /* must match */
```

Both values must be the same or the collapse animation breaks.

### Change the message max width

```css
.message { max-width: 768px; }  /* wider = more reading width */
```

### Change font size

```css
.message .content { font-size: 15px; }  /* message text */
.input-wrapper textarea { font-size: 15px; }  /* input text */
```

### Add a new component style

Just add CSS at the bottom of the file. Use the existing CSS variables for colors:

```css
.my-new-component {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    color: var(--text);
    padding: 12px;
}
```

Using `var()` instead of hardcoded colors means your component automatically works in both dark and light themes.

### CSS sections reference

| Section | Line range (approx) | What it covers |
|---------|----------------------|----------------|
| Theme variables | 1-24 | Dark/light color definitions |
| Base/reset | 26-28 | Global resets, body font |
| Login screen | 30-42 | Login card, input, button |
| Sidebar | 44-69 | Width, header, tabs, footer, user info |
| New button | 71-73 | The "+ New Chat" button |
| List items | 75-88 | Chat/project rows, hover, active, pin, actions |
| Search | 90-101 | Search bar and results |
| Main area | 103-119 | Header, title, status, buttons |
| Messages | 121-156 | Bubbles, avatars, code blocks, timestamps, copy |
| Typing/tool | 148-156 | Streaming dots, web search indicators |
| Welcome | 158-167 | Empty state suggestions |
| Input | 169-180 | Textarea and send button |
| Compare mode | 182-187 | Side-by-side panels |
| Project view | 189-215 | Project header, file grid, chat grid, agent badge |
| File viewer | 217-218 | Modal file content display |
| Modal | 220-237 | All modal dialogs, inputs, buttons |
| Scrollbar | 239-243 | Custom scrollbar styling |
| Media queries | 245-248 | Mobile responsive rules |

---

## index.html

### Structure

The file has three parts:

1. **HTML layout** (lines 1-410 approx) — login screen, sidebar, chat area, modals
2. **JavaScript** (lines 412 to end) — all app logic in one `<script>` block

### Change the app name/title

In the HTML, search and replace "Ollama Chat" with your name. It appears in:
- `<title>` tag (browser tab)
- `.sidebar-header h1` (sidebar logo)
- `.login-card h1` (login screen)

### Change the welcome suggestions

Find the `showWelcome()` function in the JavaScript:

```javascript
function showWelcome() {
    document.getElementById('messages').innerHTML = `
        <div class="welcome">
            <h2>Hi ${escapeHtml(username)}!</h2>
            <p>Start a conversation with Ollama, or organize chats into projects</p>
            <div class="suggestions">
                <div class="suggestion" onclick="sendSuggestion('Your prompt here')">
                    <div class="label">Label</div>
                    <div class="desc">Description text</div>
                </div>
                <!-- add more suggestions here -->
            </div>
        </div>`;
}
```

### Change the sidebar tabs

Find the tabs in the HTML:

```html
<div class="sidebar-tabs">
    <div class="sidebar-tab active" data-tab="chats" onclick="switchTab('chats')">Chats</div>
    <div class="sidebar-tab" data-tab="projects" onclick="switchTab('projects')">Projects</div>
    <div class="sidebar-tab" data-tab="search" onclick="switchTab('search')">Search</div>
</div>
```

Rename them or remove one. The `switchTab()` function and `renderSidebar()` handle which content shows.

### Add a new header button

In the HTML, find the `.main-header` div:

```html
<button class="header-btn" onclick="myNewFunction()" title="My Button">X</button>
```

Then add the function in the JavaScript section.

### JavaScript sections reference

| Function | What it does |
|----------|-------------|
| `window.onload` | Auto-login from localStorage |
| `doLogin()` / `loginWithId()` | Auth flow |
| `loadModels()` | Fetch model list from backend |
| `loadChats()` / `loadProjects()` | Load sidebar data |
| `sendMessage()` | Send message, save to DB, stream response |
| `streamResponse()` | Handle SSE stream from backend |
| `sendCompareMessage()` | Side-by-side model comparison |
| `renderMessages()` | Render chat messages |
| `createMessageElement()` | Build a message DOM element |
| `showProject()` | Render project view (files, chats, agent) |
| `showSettings()` | Open settings modal |
| `toggleCompare()` | Enter/exit compare mode |
| `editMessage()` | Inline edit of user messages |
| `regenerateResponse()` | Delete last response and re-stream |
| `exportChat()` | Download chat as Markdown |
| `togglePinChat()` | Pin/unpin a conversation |
| `openModelSettings()` | Show/hide models modal |
| `api()` | Helper for all API calls (adds auth header) |

### Add a new API call

Use the `api()` helper — it automatically adds the user ID header:

```javascript
const resp = await api('/api/my-endpoint', {
    method: 'POST',
    body: JSON.stringify({ key: 'value' })
});
const data = await resp.json();
```

For FormData (file uploads), pass `headers: {}` to skip JSON content-type:

```javascript
const formData = new FormData();
formData.append('file', fileObj);
await api('/api/upload', { method: 'POST', body: formData, headers: {} });
```

---

## Common Customizations

### Remove a feature

1. Remove the HTML element (button, modal, tab)
2. Remove the JavaScript function
3. Remove any associated CSS classes from `style.css`
4. The backend endpoints can stay — they won't hurt anything

### Add a new modal

1. Add HTML in `index.html`:
```html
<div class="modal-overlay" id="myModal" style="display:none;">
    <div class="modal">
        <h3>My Modal</h3>
        <!-- content here -->
        <div class="modal-actions">
            <button class="modal-btn secondary" onclick="document.getElementById('myModal').style.display='none'">Cancel</button>
            <button class="modal-btn primary" onclick="saveMyModal()">Save</button>
        </div>
    </div>
</div>
```

2. Add JavaScript:
```javascript
function openMyModal() {
    document.getElementById('myModal').style.display = 'flex';
}
function saveMyModal() {
    // do something
    document.getElementById('myModal').style.display = 'none';
}
```

No new CSS needed — modals are already styled.

### Split JavaScript into a separate file

Create `templates/app.js`, move the `<script>` contents there, and in `index.html` replace the inline script with:

```html
<script src="/static/app.js"></script>
```

The backend already serves any file in `templates/` at `/static/`.

---

## Tips

- Always hard-refresh (Ctrl+Shift+R) after changes — the browser caches aggressively
- Test both dark and light themes after CSS changes
- The `api()` helper is your friend — always use it instead of raw `fetch()` for authenticated endpoints
- CSS variables (`var(--name)`) make your styles work in both themes automatically
- No need to restart the backend for HTML/CSS-only changes — just rebuild and refresh