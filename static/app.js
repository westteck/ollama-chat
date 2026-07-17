/* ==========================================================================
   Ollama Chat — Application JavaScript
   ==========================================================================
   This file contains all frontend logic for the Ollama Chat web interface.
   It handles: authentication, model management, chat streaming, projects,
   file uploads, search, settings, and UI rendering.

   Loaded via: <script src="/static/app.js"></script> in index.html
   ========================================================================== */

// ---------------------------------------------------------------------------
// Global State
// ---------------------------------------------------------------------------

let userId = null;        // Current user's DB ID (set on login)
let username = '';        // Current user's display name
let userRole = 'user';   // Current user's role ('admin' or 'user')
let userTheme = 'dark';   // Current theme ('dark' or 'light')

let currentModel = '';    // Currently selected model name
let currentTab = 'chats'; // Active sidebar tab ('chats', 'projects', 'search')
let currentChatId = null; // ID of the open chat (null = no chat open)
let currentProjectId = null; // ID of the active project (null = no project)

let isStreaming = false;  // True while an AI response is streaming
let chats = [];           // Array of all user's chats
let projects = [];        // Array of all user's projects
let searchResults = [];   // Array of search results

let selectedColor = '#7c4dff'; // Currently selected color for new project
let compareMode = false;  // True when side-by-side model comparison is active
let editingProjectId = null; // ID of project being edited (null = new project)
let allModelsList = [];   // Full list of models from Ollama (for dropdowns)

// Color palette for projects
const colors = ['#7c4dff', '#4caf50', '#ff9800', '#f44336', '#2196f3', '#e91e63', '#00bcd4', '#8bc34a'];


// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

/**
 * On page load, check if the user has a saved session in localStorage.
 * If so, auto-login. Otherwise show the login screen.
 */
window.onload = async () => {
    // Check for invite token in URL hash: /#invite=xxx
    const hash = window.location.hash;
    const inviteMatch = hash.match(/invite=([A-Za-z0-9_-]+)/);
    if (inviteMatch) {
        showLogin();
        const inviteEl = document.getElementById('inviteToken');
        const inviteLabel = document.getElementById('inviteLabel');
        if (inviteEl) { inviteEl.value = inviteMatch[1]; inviteEl.style.display = ''; }
        if (inviteLabel) { inviteLabel.style.display = ''; }
        window.location.hash = '';
    }
    // Check if initial setup is needed (no users yet — shouldn't happen, admin is auto-created)
    try {
        const setupResp = await fetch('/api/setup-status');
        const setupData = await setupResp.json();
        if (setupData.setup_needed) {
            // Fresh install — show login with hint about default admin
            showLogin();
            const errEl = document.getElementById('loginError');
            if (errEl) errEl.textContent = '';
            const hintEl = document.createElement('div');
            hintEl.style.cssText = 'font-size:12px;color:var(--text-muted);margin-top:8px;text-align:center;';
            hintEl.textContent = 'Default login: admin / admin123';
            document.querySelector('.login-card').appendChild(hintEl);
            return;
        }
    } catch (e) { /* proceed to normal login */ }
    const saved = localStorage.getItem('ollama-chat-user');
    if (saved) {
        try {
            const user = JSON.parse(saved);
            await loginWithId(user.user_id);
        } catch (e) { showLogin(); }
    } else { showLogin(); }
};

/** Show the login screen and hide the main app. */
function showLogin() {
    document.getElementById('loginScreen').style.display = 'flex';
    document.getElementById('mainApp').style.display = 'none';
    document.getElementById('loginInput').focus();
}

/** Hide the login screen and show the main app.
 *  On mobile, start with the sidebar collapsed (drawer closed). */
function showApp() {
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('mainApp').style.display = 'flex';
    // Collapse sidebar by default on mobile
    if (window.matchMedia('(max-width: 768px)').matches) {
        document.getElementById('sidebar').classList.add('collapsed');
    }
}


// ---------------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------------

/**
 * Handle login form submission.
 * Sends the username to the backend, which creates the user if new.
 * Saves the session to localStorage for auto-login next time.
 */
async function doLogin() {
    const name = document.getElementById('loginInput').value.trim();
    const password = document.getElementById('loginPassword').value;
    const totpCode = document.getElementById('totpCode').value.trim();
    const inviteEl = document.getElementById('inviteToken');
    const inviteToken = inviteEl ? inviteEl.value.trim() : '';
    const errEl = document.getElementById('loginError');
    const totpEl = document.getElementById('totpCode');
    errEl.textContent = '';
    if (!name) { errEl.textContent = 'Please enter your username'; return; }
    if (!password) { errEl.textContent = 'Please enter your password'; return; }
    // If TOTP input is visible, require a code
    if (totpEl.style.display !== 'none' && !totpCode) {
        errEl.textContent = 'Please enter your authenticator code';
        return;
    }
    try {
        const resp = await fetch('/api/login', {
            method: 'POST', headers: {'Content-Type':'application/json'},
            body: JSON.stringify({ username: name, password: password, totp_code: totpCode, invite_token: inviteToken })
        });
        const data = await resp.json();
        if (data.error) {
            // If TOTP is required, show the code input
            if (data.totp_required) {
                errEl.textContent = '';
                totpEl.style.display = '';
                totpEl.focus();
                document.getElementById('loginBtn').textContent = 'Verify →';
                return;
            }
            // If invite token is required, show the invite field
            if (data.invite_required) {
                errEl.textContent = '';
                if (inviteEl) inviteEl.style.display = '';
                const inviteLabel = document.getElementById('inviteLabel');
                if (inviteLabel) inviteLabel.style.display = '';
                inviteEl.focus();
                return;
            }
            errEl.textContent = data.error;
            // Reset TOTP state on real errors
            totpEl.style.display = 'none';
            totpEl.value = '';
            document.getElementById('loginBtn').textContent = 'Continue →';
            return;
        }
        localStorage.setItem('ollama-chat-user', JSON.stringify(data));
        await loginWithId(data.user_id);
    } catch (e) { errEl.textContent = 'Connection error'; }
}

/**
 * Log in with a known user ID (used for auto-login from localStorage).
 * Fetches user info, applies theme, loads all data, and shows the app.
 */
async function loginWithId(uid) {
    try {
        const resp = await fetch(`/api/me?user_id=${uid}`);
        const data = await resp.json();
        if (data.error) { showLogin(); return; }
        userId = data.id; username = data.username; userRole = data.role || 'user'; userTheme = data.theme || 'dark';
        applyTheme(userTheme);
        document.getElementById('userNameDisplay').textContent = username;
        document.getElementById('userAvatar').textContent = username.charAt(0).toUpperCase();
        showApp();
        // Load all data in sequence
        await loadModels();
        await loadProjects();
        await loadChats();
        renderSidebar();
        showWelcome();
        updateStatusText();
    } catch (e) { showLogin(); }
}

/** Log out: clear localStorage and show login screen. */
function doLogout() {
    localStorage.removeItem('ollama-chat-user');
    userId = null; username = '';
    showLogin();
    document.getElementById('loginInput').value = '';
    document.getElementById('loginPassword').value = '';
    // Reset TOTP login state
    const totpEl = document.getElementById('totpCode');
    if (totpEl) { totpEl.value = ''; totpEl.style.display = 'none'; }
    // Reset invite token state
    const inviteEl = document.getElementById('inviteToken');
    if (inviteEl) { inviteEl.value = ''; inviteEl.style.display = 'none'; }
    const inviteLabel = document.getElementById('inviteLabel');
    if (inviteLabel) inviteLabel.style.display = 'none';
    const loginBtn = document.getElementById('loginBtn');
    if (loginBtn) loginBtn.textContent = 'Continue →';
}


// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------

/** Apply the dark or light theme by setting the data-theme attribute on <html>. */
function applyTheme(theme) {
    userTheme = theme;
    document.documentElement.setAttribute('data-theme', theme);
    document.getElementById('themeBtn').textContent = theme === 'dark' ? '☀️' : '🌙';
}

/** Toggle between dark and light theme. Saves preference to backend. */
async function toggleTheme() {
    const newTheme = userTheme === 'dark' ? 'light' : 'dark';
    applyTheme(newTheme);
    await fetch('/api/theme', { method: 'PUT', headers: {'Content-Type':'application/json','X-User-Id':userId},
        body: JSON.stringify({ theme: newTheme }) });
}


// ---------------------------------------------------------------------------
// Status Text
// ---------------------------------------------------------------------------

/** Update the status text in the header showing who is chatting with which model. */
function updateStatusText() {
    const el = document.getElementById('statusText');
    const model = currentModel || 'Ollama';
    el.innerHTML = `${escapeHtml(username)} is chatting with <span class="model-name">${escapeHtml(model)}</span>`;
}


// ---------------------------------------------------------------------------
// API Helper
// ---------------------------------------------------------------------------

/**
 * Wrapper around fetch() that automatically adds the X-User-Id auth header.
 * Also sets Content-Type to application/json for non-FormData requests.
 * Use this for ALL authenticated API calls.
 */
async function api(path, opts = {}) {
    const headers = opts.headers || {};
    headers['X-User-Id'] = userId;
    // Don't set Content-Type for FormData — the browser sets it with boundary
    if (opts.body && !(opts.body instanceof FormData) && !headers['Content-Type']) {
        headers['Content-Type'] = 'application/json';
    }
    const resp = await fetch(path, { ...opts, headers });
    return resp;
}


// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------

let capLabels = {}; // Cached capability labels (e.g. {coding: "💻 Code", ...})

/** Fetch the capability label mappings from the backend. Cached after first call. */
async function loadCapLabels() {
    try {
        const resp = await fetch('/api/models/cap-labels');
        const data = await resp.json();
        capLabels = data.labels || {};
    } catch (e) {}
}

/**
 * Load the model list from the backend and populate the dropdown.
 * Models include capability tags (coding, writing, vision, etc.).
 * Also populates the agent model select in the project modal.
 */
async function loadModels() {
    try {
        if (!Object.keys(capLabels).length) await loadCapLabels();
        const resp = await fetch('/api/models', { headers: {'X-User-Id': userId} });
        const data = await resp.json();
        const sel = document.getElementById('modelSelect');
        if (data.error) { sel.innerHTML = `<option value="">Error</option>`; return; }
        allModelsList = data.all_models || data.models || [];
        sel.innerHTML = '';
        // Add each model to the dropdown with capability tags in the text
        data.models.forEach(m => {
            const name = typeof m === 'string' ? m : m.name;
            const caps = typeof m === 'string' ? [] : (m.caps || []);
            const opt = document.createElement('option');
            opt.value = name;
            opt.textContent = name + (caps.length ? '  ' + caps.map(c => capLabels[c] || c).join(' ') : '');
            if (name === data.default) opt.selected = true;
            sel.appendChild(opt);
        });
        currentModel = sel.value || data.default;
        updateStatusText();
        // Also populate the agent model dropdown in the project modal
        const agentSel = document.getElementById('agentModel');
        if (agentSel) {
            agentSel.innerHTML = '<option value="">Use dropdown model</option>';
            allModelsList.forEach(m => {
                const name = typeof m === 'string' ? m : m.name;
                const opt = document.createElement('option');
                opt.value = name; opt.textContent = name;
                agentSel.appendChild(opt);
            });
        }
    } catch (e) { document.getElementById('modelSelect').innerHTML = `<option value="">Failed</option>`; }
}

/** Update currentModel when the dropdown selection changes. */
function changeModel() { currentModel = document.getElementById('modelSelect').value; updateStatusText(); }


// ---------------------------------------------------------------------------
// Model Settings (show/hide models)
// ---------------------------------------------------------------------------

/**
 * Open the model settings modal.
 * Shows a checklist of all models with capability tags.
 * Checked models are visible in the dropdown, unchecked are hidden.
 */
async function openModelSettings() {
    if (!Object.keys(capLabels).length) await loadCapLabels();
    const resp = await fetch('/api/models', { headers: {'X-User-Id': userId} });
    const data = await resp.json();
    if (data.error) { alert('Cannot connect to Ollama'); return; }
    // Fetch which models the user has hidden
    const hiddenResp = await fetch('/api/models/hidden', { headers: {'X-User-Id': userId} });
    const hiddenData = await hiddenResp.json();
    const hiddenSet = new Set(hiddenData.hidden || []);
    const list = document.getElementById('modelSettingsList');
    list.innerHTML = '';
    const allModels = data.all_models || data.models || [];
    // Build a row for each model with checkbox, name, and capability tags
    allModels.forEach(m => {
        const name = typeof m === 'string' ? m : m.name;
        const caps = typeof m === 'string' ? [] : (m.caps || []);
        const row = document.createElement('label');
        row.style.cssText = 'display:flex;align-items:flex-start;gap:10px;padding:10px 12px;cursor:pointer;border-radius:8px;flex-wrap:wrap;';
        row.onmouseenter = () => row.style.background = 'var(--bg-sidebar)';
        row.onmouseleave = () => row.style.background = '';
        const cb = document.createElement('input');
        cb.type = 'checkbox'; cb.value = name;
        cb.checked = !hiddenSet.has(name);
        cb.style.cssText = 'width:18px;height:18px;accent-color:var(--accent);margin-top:2px;flex-shrink:0;';
        const textDiv = document.createElement('div');
        textDiv.style.cssText = 'flex:1;min-width:0;';
        const nameSpan = document.createElement('div');
        nameSpan.textContent = name;
        nameSpan.style.cssText = 'font-size:14px;font-weight:500;';
        textDiv.appendChild(nameSpan);
        // Add capability tag chips
        if (caps.length) {
            const capsDiv = document.createElement('div');
            capsDiv.style.cssText = 'margin-top:4px;display:flex;flex-wrap:wrap;gap:4px;';
            caps.forEach(c => {
                const tag = document.createElement('span');
                tag.textContent = capLabels[c] || c;
                tag.style.cssText = 'font-size:10px;padding:2px 6px;border-radius:4px;background:var(--accent-dim);color:var(--accent);';
                capsDiv.appendChild(tag);
            });
            textDiv.appendChild(capsDiv);
        }
        row.appendChild(cb);
        row.appendChild(textDiv);
        list.appendChild(row);
    });
    document.getElementById('modelSettingsModal').style.display = 'flex';
}

/** Close the model settings modal. */
function closeModelSettings() { document.getElementById('modelSettingsModal').style.display = 'none'; }

/** Save which models are hidden and reload the dropdown. */
async function saveModelSettings() {
    const checkboxes = document.querySelectorAll('#modelSettingsList input[type=checkbox]');
    const hidden = [];
    checkboxes.forEach(cb => { if (!cb.checked) hidden.push(cb.value); });
    await fetch('/api/models/hidden', {
        method: 'PUT', headers: {'Content-Type':'application/json','X-User-Id':userId},
        body: JSON.stringify({ hidden })
    });
    closeModelSettings();
    await loadModels();
}


// ---------------------------------------------------------------------------
// Sidebar Tabs
// ---------------------------------------------------------------------------

/** Switch between Chats, Projects, and Search tabs in the sidebar. */
function switchTab(tab) {
    currentTab = tab;
    document.querySelectorAll('.sidebar-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
    document.getElementById('searchBar').style.display = tab === 'search' ? 'block' : 'none';
    renderSidebar();
}


// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

/** Load all projects for the current user from the backend. */
async function loadProjects() {
    const resp = await api('/api/projects');
    const data = await resp.json();
    projects = data.projects || [];
}

/**
 * Create a new project with optional agent profile.
 * @param {string} name - Project name
 * @param {string} desc - Description
 * @param {string} color - Hex color for the project
 * @param {object} agent - Optional {name, prompt, model} for agent profile
 */
async function createProject(name, desc, color, agent) {
    const body = { name, description: desc, color };
    if (agent) { body.agent_name = agent.name || ''; body.agent_prompt = agent.prompt || ''; body.agent_model = agent.model || ''; }
    const resp = await api('/api/projects', { method: 'POST', body: JSON.stringify(body) });
    const data = await resp.json();
    await loadProjects(); renderSidebar(); return data.id;
}

/** Update an existing project's fields (name, description, color, agent settings). */
async function updateProject(id, body) {
    await api(`/api/projects/${id}`, { method: 'PUT', body: JSON.stringify(body) });
    await loadProjects(); renderSidebar();
}

/** Delete a project and all its files. Asks for confirmation first. */
async function deleteProject(id) {
    if (!confirm('Delete this project and all its files?')) return;
    await api(`/api/projects/${id}`, { method: 'DELETE' });
    if (currentProjectId === id) { currentProjectId = null; showWelcome(); }
    await loadProjects(); await loadChats(); renderSidebar();
}

/**
 * Open the project modal in edit mode.
 * Populates the form with the existing project's data including agent fields.
 */
function editProject(id) {
    const p = projects.find(x => x.id === id); if (!p) return;
    editingProjectId = id;
    document.getElementById('modalTitle').textContent = 'Edit Project';
    document.getElementById('projectName').value = p.name;
    document.getElementById('projectDesc').value = p.description || '';
    selectedColor = p.color || '#7c4dff';
    renderColorPicker();
    document.getElementById('agentName').value = p.agent_name || '';
    document.getElementById('agentPrompt').value = p.agent_prompt || '';
    document.getElementById('agentModel').value = p.agent_model || '';
    document.getElementById('saveProjectBtn').textContent = 'Update';
    document.getElementById('projectModal').style.display = 'flex';
}


// ---------------------------------------------------------------------------
// Chats
// ---------------------------------------------------------------------------

/** Load all chats for the current user (sorted by pinned then updated). */
async function loadChats() {
    const resp = await api('/api/chats');
    const data = await resp.json();
    chats = data.chats || [];
}

/**
 * Create a new chat, optionally inside a project.
 * @param {string|null} projectId - Project ID or null for a general chat
 * @param {string} title - Chat title (defaults to 'New Chat')
 */
async function createChat(projectId = null, title = 'New Chat') {
    const resp = await api('/api/chats', { method: 'POST', body: JSON.stringify({ project_id: projectId, title, model: currentModel }) });
    const data = await resp.json();
    await loadChats(); return data.id;
}

/**
 * Open a chat: load its messages and render them.
 * Shows the export button when a chat is open.
 */
async function selectChat(id) {
    const resp = await api(`/api/chats/${id}`);
    const data = await resp.json();
    const chat = data.chat;
    currentChatId = id; currentProjectId = chat.project_id;
    renderSidebar(); renderMessages(data.messages);
    document.getElementById('chatTitle').textContent = chat.title;
    document.getElementById('exportBtn').style.display = 'inline-block';
    updateProjectBadge();
    closeSidebarIfMobile();
}

/** Delete a chat. If it's the current chat, go back to welcome screen. */
async function deleteChat(id) {
    await api(`/api/chats/${id}`, { method: 'DELETE' });
    if (currentChatId === id) { currentChatId = null; showWelcome(); document.getElementById('exportBtn').style.display = 'none'; }
    await loadChats(); renderSidebar();
}

/** Toggle the pinned state of a chat (pinned chats appear at the top). */
async function togglePinChat(id) {
    await api(`/api/chats/${id}/pin`, { method: 'PUT' });
    await loadChats(); renderSidebar();
}


// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

/**
 * Export the current chat as a Markdown file.
 * Fetches the formatted markdown from the backend and triggers a download.
 */
async function exportChat() {
    if (!currentChatId) return;
    const resp = await api(`/api/chats/${currentChatId}/export?format=markdown`);
    const data = await resp.json();
    const blob = new Blob([data.content], { type: 'text/markdown' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = data.filename;
    a.click(); URL.revokeObjectURL(a.href);
}


// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

let searchTimer; // Debounce timer for search input

/**
 * Search across all messages. Debounced with 300ms delay.
 * Updates searchResults and re-renders the sidebar.
 */
async function doSearch() {
    clearTimeout(searchTimer);
    const q = document.getElementById('searchInput').value.trim();
    if (!q) { searchResults = []; renderSidebar(); return; }
    searchTimer = setTimeout(async () => {
        const resp = await api(`/api/search?q=${encodeURIComponent(q)}`);
        const data = await resp.json();
        searchResults = data.results || [];
        renderSidebar();
    }, 300);
}


// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

/**
 * Upload a file to a project.
 * Creates a hidden file input, triggers it, and sends the file as FormData.
 */
async function uploadFile(projectId) {
    const input = document.createElement('input');
    input.type = 'file';
    input.onchange = async () => {
        const file = input.files[0]; if (!file) return;
        const formData = new FormData(); formData.append('file', file);
        // Pass headers: {} to skip JSON content-type for FormData
        await api(`/api/files/${projectId}`, { method: 'POST', body: formData, headers: {} });
        await showProject(projectId);
    };
    input.click();
}

/** Delete a file from a project and refresh the project view. */
async function deleteFile(fid, pid) {
    await api(`/api/files/${fid}`, { method: 'DELETE' });
    await showProject(pid);
}

/**
 * Open the file viewer modal to display a file's content.
 * Text files show with monospace formatting; PDFs show extracted text.
 */
async function viewFile(fid) {
    const resp = await api(`/api/files/${fid}/content`);
    const data = await resp.json();
    document.getElementById('fileViewerTitle').textContent = data.filename || 'File';
    document.getElementById('fileViewerContent').textContent = data.content || '[No content]';
    document.getElementById('fileViewerModal').style.display = 'flex';
}


// ---------------------------------------------------------------------------
// Rendering — Sidebar
// ---------------------------------------------------------------------------

/** Render the sidebar content based on the active tab. */
function renderSidebar() {
    const el = document.getElementById('sidebarContent');
    if (currentTab === 'chats') el.innerHTML = renderChatsTab();
    else if (currentTab === 'projects') el.innerHTML = renderProjectsTab();
    else if (currentTab === 'search') el.innerHTML = renderSearchTab();
}

/**
 * Render the Chats tab: pinned chats first, then general (unassigned),
 * then chats grouped by project.
 */
function renderChatsTab() {
    let html = `<button class="new-btn" onclick="newChat()">+ New Chat</button>`;
    // Pinned chats section
    const pinned = chats.filter(c => c.pinned);
    if (pinned.length) {
        html += `<div style="padding:4px 8px;font-size:12px;color:var(--text-dim);text-transform:uppercase;margin-top:8px;">📌 Pinned</div>`;
        html += pinned.map(c => chatListItem(c)).join('');
    }
    // General (no project) chats
    const unpinnedUngrouped = chats.filter(c => !c.project_id && !c.pinned);
    if (unpinnedUngrouped.length) {
        html += `<div style="padding:4px 8px;font-size:12px;color:var(--text-dim);text-transform:uppercase;margin-top:8px;">General</div>`;
        html += unpinnedUngrouped.map(c => chatListItem(c)).join('');
    }
    // Chats grouped by project
    projects.forEach(p => {
        const pChats = chats.filter(c => c.project_id === p.id && !c.pinned);
        if (pChats.length) {
            html += `<div style="padding:4px 8px;font-size:12px;color:${p.color};text-transform:uppercase;margin-top:8px;display:flex;align-items:center;gap:6px;">
                <span style="width:8px;height:8px;background:${p.color};border-radius:2px;"></span>${escapeHtml(p.name)}</div>`;
            html += pChats.map(c => chatListItem(c)).join('');
        }
    });
    if (!chats.length) html += `<div style="padding:16px;text-align:center;color:var(--text-dim);font-size:13px;">No chats yet</div>`;
    return html;
}

/** Render a single chat list item with pin/delete actions on hover. */
function chatListItem(c) {
    const active = c.id === currentChatId ? 'active' : '';
    const pinIcon = c.pinned ? '<span class="pin-icon">📌</span>' : '';
    return `<div class="list-item ${active}" onclick="selectChat('${c.id}')">
        <div class="item-title">${escapeHtml(c.title)}</div>
        <div class="item-meta"><span>${formatDate(c.updated)}</span></div>
        ${pinIcon}
        <div class="chat-actions" onclick="event.stopPropagation()">
            <button onclick="togglePinChat('${c.id}')" title="Pin/unpin">${c.pinned ? '📌' : '📍'}</button>
            <button onclick="if(confirm('Delete?'))deleteChat('${c.id}')" title="Delete">✕</button>
        </div>
    </div>`;
}

/** Render the Projects tab: new project button + list of projects with edit/delete. */
function renderProjectsTab() {
    let html = `<button class="new-btn" onclick="openNewProjectModal()">+ New Project</button>`;
    if (!projects.length) return html + `<div style="padding:16px;text-align:center;color:var(--text-dim);font-size:13px;">No projects yet</div>`;
    html += projects.map(p => `
        <div class="list-item" onclick="showProject('${p.id}')">
            <div class="item-title" style="display:flex;align-items:center;gap:8px;">
                <span style="width:10px;height:10px;background:${p.color};border-radius:3px;flex-shrink:0;"></span>
                ${escapeHtml(p.name)}
            </div>
            <div class="item-meta">
                <span class="badge">${p.chat_count} chats</span>
                <span class="badge">${p.file_count} files</span>
                ${p.agent_name ? `<span class="badge" style="color:var(--accent);">🤖 ${escapeHtml(p.agent_name)}</span>` : ''}
            </div>
            <div class="chat-actions" onclick="event.stopPropagation()">
                <button onclick="editProject('${p.id}')" title="Edit">✎</button>
                <button onclick="if(confirm('Delete project?'))deleteProject('${p.id}')" title="Delete">✕</button>
            </div>
        </div>`).join('');
    return html;
}

/** Render the Search tab with search results. */
function renderSearchTab() {
    if (!searchResults.length) return `<div style="padding:16px;text-align:center;color:var(--text-dim);font-size:13px;">Type to search all your messages</div>`;
    return `<div class="search-results">${searchResults.map(r => `
        <div class="search-result-item" onclick="selectChat('${r.chat_id}')">
            <div class="sr-title">${escapeHtml(r.chat_title)}</div>
            <div class="sr-snippet">${escapeHtml(r.snippet)}</div>
            <div class="sr-meta">${r.role} · ${formatDate(r.created)}</div>
        </div>`).join('')}</div>`;
}


// ---------------------------------------------------------------------------
// Rendering — Messages
// ---------------------------------------------------------------------------

/**
 * Render all messages in the chat area.
 * Adds copy buttons to code blocks after rendering.
 */
function renderMessages(messages) {
    const container = document.getElementById('messages');
    if (!messages || !messages.length) { showWelcome(); return; }
    container.innerHTML = '';
    messages.forEach(msg => container.appendChild(createMessageElement(msg.role, msg.content, msg.id, msg.created)));
    container.scrollTop = container.scrollHeight;
    addCopyButtonsToCodeBlocks(container);
}

/**
 * Create a single message DOM element.
 * Includes avatar, content (markdown-parsed for assistant, plain text for user),
 * action buttons (edit, regenerate, copy), and timestamp on hover.
 */
function createMessageElement(role, content, msgId, created) {
    const div = document.createElement('div');
    div.className = `message ${role}`;
    div.dataset.msgId = msgId || '';
    // Avatar: user's initial or ◆ for assistant
    const avatar = document.createElement('div');
    avatar.className = 'avatar';
    avatar.textContent = role === 'user' ? username.charAt(0).toUpperCase() : '◆';
    // Content: markdown for assistant, plain text for user
    const contentDiv = document.createElement('div');
    contentDiv.className = 'content';
    if (role === 'assistant') contentDiv.innerHTML = marked.parse(content || '');
    else contentDiv.textContent = content;
    // Action buttons (shown on hover)
    const actions = document.createElement('div');
    actions.className = 'msg-actions';
    if (role === 'user') {
        actions.innerHTML = `<button onclick="editMessage(this)" title="Edit">✎</button>`;
    } else if (role === 'assistant') {
        actions.innerHTML = `<button onclick="regenerateResponse()" title="Regenerate">↻</button>`;
    }
    actions.innerHTML += `<button onclick="copyMessage(this)" title="Copy">📋</button>`;
    // Timestamp (shown on hover via CSS)
    if (created) {
        const timeDiv = document.createElement('div');
        timeDiv.className = 'msg-time';
        timeDiv.textContent = new Date(created * 1000).toLocaleString();
        contentDiv.appendChild(timeDiv);
    }
    div.appendChild(avatar);
    div.appendChild(contentDiv);
    div.appendChild(actions);
    return div;
}

/**
 * Add "Copy" buttons to all <pre> code blocks in a container.
 * Copies the code text to clipboard and shows a checkmark briefly.
 */
function addCopyButtonsToCodeBlocks(container) {
    container.querySelectorAll('pre').forEach(pre => {
        if (pre.querySelector('.code-copy-btn')) return; // Skip if already has one
        const btn = document.createElement('button');
        btn.className = 'code-copy-btn';
        btn.textContent = 'Copy';
        btn.onclick = () => {
            const code = pre.querySelector('code');
            navigator.clipboard.writeText(code ? code.textContent : pre.textContent);
            btn.textContent = '✓'; setTimeout(() => btn.textContent = 'Copy', 1500);
        };
        pre.appendChild(btn);
    });
}

/** Copy an entire message's text to clipboard. */
function copyMessage(btn) {
    const content = btn.closest('.message').querySelector('.content');
    const text = content.innerText;
    navigator.clipboard.writeText(text);
    btn.textContent = '✓'; setTimeout(() => btn.textContent = '📋', 1500);
}

/**
 * Inline edit of a user message.
 * Replaces the message content with a textarea.
 * On "Save & Resend": updates the message in the DB and reloads the chat
 * so a new AI response is generated from the edited message.
 */
function editMessage(btn) {
    const msgDiv = btn.closest('.message');
    const contentDiv = msgDiv.querySelector('.content');
    const msgId = msgDiv.dataset.msgId;
    // Extract the original text, filtering out the timestamp line
    const oldText = contentDiv.innerText.split('\n')
        .filter(l => !l.match(/^\d{1,2}:\d{2}.*\d{4}/) && !l.match(/^[A-Za-z]{3} \d/))
        .join('\n').trim();
    // Replace content with editable textarea
    const textarea = document.createElement('textarea');
    textarea.value = oldText;
    textarea.style.cssText = 'width:100%;min-height:80px;padding:8px;background:var(--bg-input);color:var(--text);border:1px solid var(--accent);border-radius:8px;font-size:14px;font-family:inherit;resize:vertical;';
    contentDiv.innerHTML = '';
    contentDiv.appendChild(textarea);
    textarea.focus();
    // Save button: update message and reload chat
    const saveBtn = document.createElement('button');
    saveBtn.textContent = 'Save & Resend';
    saveBtn.style.cssText = 'margin-top:8px;padding:6px 14px;background:var(--accent);color:white;border:none;border-radius:6px;cursor:pointer;font-size:13px;';
    saveBtn.onclick = async () => {
        const newText = textarea.value.trim();
        if (!newText || !msgId) return;
        await api(`/api/chats/${currentChatId}/messages/${msgId}`, { method: 'PUT', body: JSON.stringify({ content: newText }) });
        // Reload chat — this will trigger a new AI response
        await selectChat(currentChatId);
    };
    // Cancel button: reload chat without changes
    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.style.cssText = 'margin-top:8px;margin-left:8px;padding:6px 14px;background:var(--bg-input);color:var(--text);border:1px solid var(--border);border-radius:6px;cursor:pointer;font-size:13px;';
    cancelBtn.onclick = () => { selectChat(currentChatId); };
    contentDiv.appendChild(saveBtn);
    contentDiv.appendChild(cancelBtn);
}

/**
 * Regenerate the last AI response.
 * Deletes the last assistant message and streams a new one.
 */
async function regenerateResponse() {
    if (isStreaming || !currentChatId) return;
    // Fetch current messages
    const resp = await api(`/api/chats/${currentChatId}`);
    const data = await resp.json();
    const msgs = data.messages || [];
    if (msgs.length < 2) return;
    const lastAssistant = msgs[msgs.length - 1];
    if (lastAssistant.role !== 'assistant') return;
    // Delete the last assistant message
    await api(`/api/chats/${currentChatId}/messages/${lastAssistant.id}`, { method: 'DELETE' });
    // Render remaining messages and stream a new response
    const remaining = msgs.slice(0, -1).map(m => ({ role: m.role, content: m.content }));
    renderMessages(remaining);
    await streamResponse(remaining);
}


// ---------------------------------------------------------------------------
// Welcome Screen
// ---------------------------------------------------------------------------

/** Show the welcome screen with suggestion cards when no chat is open. */
function showWelcome() {
    document.getElementById('messages').innerHTML = `
        <div class="welcome">
            <h2>Hi ${escapeHtml(username)}!</h2>
            <p>Start a conversation with Ollama, or organize chats into projects</p>
            <div class="suggestions">
                <div class="suggestion" onclick="sendSuggestion('Explain quantum computing in simple terms')">
                    <div class="label">Explain a concept</div><div class="desc">Explain quantum computing in simple terms</div></div>
                <div class="suggestion" onclick="sendSuggestion('Write a Python function to sort a list of dictionaries by a given key')">
                    <div class="label">Write code</div><div class="desc">Python function to sort a list of dicts</div></div>
                <div class="suggestion" onclick="sendSuggestion('Give me 5 creative ideas for a weekend project')">
                    <div class="label">Brainstorm ideas</div><div class="desc">5 creative weekend project ideas</div></div>
                <div class="suggestion" onclick="sendSuggestion('What are the key differences between Rust and Go?')">
                    <div class="label">Compare things</div><div class="desc">Key differences between Rust and Go</div></div>
            </div>
        </div>`;
    document.getElementById('chatTitle').textContent = 'New Chat';
    document.getElementById('exportBtn').style.display = 'none';
    updateProjectBadge();
}


// ---------------------------------------------------------------------------
// Project View
// ---------------------------------------------------------------------------

/**
 * Render the project view: agent profile, files grid, and chats grid.
 * Fetches both chats and files for the project in parallel.
 */
async function showProject(pid) {
    const p = projects.find(x => x.id === pid); if (!p) return;
    // Load chats and files in parallel
    const [chatsResp, filesResp] = await Promise.all([
        api(`/api/chats?project_id=${pid}`).then(r => r.json()),
        api(`/api/files/${pid}`).then(r => r.json())
    ]);
    const pChats = chatsResp.chats || [];
    const files = filesResp.files || [];
    const container = document.getElementById('messages');
    document.getElementById('chatTitle').textContent = p.name;
    currentChatId = null; currentProjectId = pid;
    updateProjectBadge(p);
    // Build agent profile section if the project has one
    let agentHtml = '';
    if (p.agent_name || p.agent_prompt) {
        agentHtml = `<div class="project-section">
            <h3>🤖 Agent Profile</h3>
            <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius);padding:16px;">
                ${p.agent_name ? `<div style="font-weight:600;margin-bottom:8px;">${escapeHtml(p.agent_name)}</div>` : ''}
                ${p.agent_prompt ? `<div style="font-size:13px;color:var(--text-muted);margin-bottom:8px;">${escapeHtml(p.agent_prompt)}</div>` : ''}
                ${p.agent_model ? `<div class="agent-badge">Model: ${escapeHtml(p.agent_model)}</div>` : ''}
                <button class="modal-btn secondary" style="margin-top:8px;" onclick="editProject('${p.id}')">Edit Agent</button>
            </div>
        </div>`;
    }
    // Render the full project view
    container.innerHTML = `
        <div class="project-view">
            <div class="project-header">
                <div class="project-color-dot" style="background:${p.color}"></div>
                <h2>${escapeHtml(p.name)}</h2>
                ${p.description ? `<span class="desc">${escapeHtml(p.description)}</span>` : ''}
            </div>
            ${agentHtml}
            <div class="project-section">
                <h3>Files (${files.length})</h3>
                <div class="file-grid">
                    ${files.map(f => `
                        <div class="file-card" style="cursor:pointer;" onclick="viewFile('${f.id}')">
                            <div class="file-icon">📄</div>
                            <div class="file-info">
                                <div class="file-name">${escapeHtml(f.filename)}</div>
                                <div class="file-size">${formatSize(f.filesize)}</div>
                            </div>
                            <span class="file-delete" onclick="event.stopPropagation();deleteFile('${f.id}','${pid}')">✕</span>
                        </div>`).join('')}
                    <div class="file-card" style="cursor:pointer;border-style:dashed;" onclick="uploadFile('${pid}')">
                        <div class="file-icon">+</div><div class="file-info"><div class="file-name">Upload file</div></div>
                    </div>
                </div>
            </div>
            <div class="project-section">
                <h3>Chats (${pChats.length})</h3>
                <div class="chat-grid">
                    <div class="chat-card" style="border-style:dashed;" onclick="newChatInProject('${pid}')">
                        <div class="cc-title">+ New chat in this project</div></div>
                    ${pChats.map(c => `
                        <div class="chat-card" onclick="selectChat('${c.id}')">
                            <div class="cc-title">${escapeHtml(c.title)}
                                <span class="cc-delete" onclick="event.stopPropagation();deleteChat('${c.id}')">✕</span></div>
                            <div class="cc-meta">${formatDate(c.updated)}</div>
                        </div>`).join('')}
                </div>
            </div>
        </div>`;
    closeSidebarIfMobile();
}


// ---------------------------------------------------------------------------
// Compare Mode (side-by-side model comparison)
// ---------------------------------------------------------------------------

/**
 * Toggle compare mode on/off.
 * When on, shows two model dropdowns side by side.
 * A message sent in compare mode goes to both models simultaneously.
 */
function toggleCompare() {
    compareMode = !compareMode;
    document.getElementById('compareBtn').style.color = compareMode ? 'var(--accent)' : '';
    document.getElementById('compareBtn').style.borderColor = compareMode ? 'var(--accent)' : '';
    if (compareMode) {
        // Show two-panel compare layout
        document.getElementById('messages').innerHTML = `
            <div class="compare-wrapper">
                <div class="compare-panel">
                    <div class="panel-header">Model A: <select id="compareModelA"></select></div>
                    <div class="content" id="compareResultA"><div style="color:var(--text-dim);font-size:13px;">Send a message to compare...</div></div>
                </div>
                <div class="compare-panel">
                    <div class="panel-header">Model B: <select id="compareModelB"></select></div>
                    <div class="content" id="compareResultB"><div style="color:var(--text-dim);font-size:13px;">Send a message to compare...</div></div>
                </div>
            </div>`;
        // Populate both model dropdowns
        const selA = document.getElementById('compareModelA');
        const selB = document.getElementById('compareModelB');
        allModelsList.forEach(m => {
            const name = typeof m === 'string' ? m : m.name;
            selA.appendChild(new Option(name, name));
            selB.appendChild(new Option(name, name));
        });
        if (currentModel) { selA.value = currentModel; selB.value = currentModel; }
        // Auto-select a different model for B if possible
        const opts = allModelsList.length > 1 ? [allModelsList[1]] : [];
        if (opts.length) selB.value = typeof opts[0] === 'string' ? opts[0] : opts[0].name;
    } else {
        // Exit compare mode: restore normal chat view
        if (currentChatId) selectChat(currentChatId); else showWelcome();
    }
}


// ---------------------------------------------------------------------------
// Chat Actions
// ---------------------------------------------------------------------------

/** Start a new chat (not in any project). */
async function newChat() { const id = await createChat(null); await selectChat(id); renderSidebar(); document.getElementById('input').focus(); closeSidebarIfMobile(); }

/** Start a new chat inside a specific project. */
async function newChatInProject(pid) { const id = await createChat(pid); await selectChat(id); renderSidebar(); document.getElementById('input').focus(); closeSidebarIfMobile(); }

/** Fill the input with a suggestion text and send it. */
function sendSuggestion(text) { document.getElementById('input').value = text; sendMessage(); }

/** Handle Enter key (send) vs Shift+Enter (newline) in the input textarea. */
function handleKeyDown(e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }

/** Auto-resize the input textarea as the user types (up to 200px max). */
function autoResize(t) { t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight, 200) + 'px'; }

/**
 * Send a message: save to DB, render in chat, and stream the AI response.
 * In compare mode, sends to two models simultaneously instead.
 * Auto-creates a chat if none is open. Auto-titles the chat from the first message.
 */
async function sendMessage() {
    if (isStreaming || !userId) return;
    const input = document.getElementById('input');
    const text = input.value.trim();
    if (!text) return;

    // Handle compare mode separately
    if (compareMode) {
        await sendCompareMessage(text);
        input.value = ''; input.style.height = 'auto';
        return;
    }

    // Auto-create a chat if none is open
    if (!currentChatId) { const id = await createChat(null, text.substring(0, 40)); currentChatId = id; await loadChats(); }
    const chatId = currentChatId;
    // Save the user message to the DB
    await api(`/api/chats/${chatId}/messages`, { method: 'POST', body: JSON.stringify({ role: 'user', content: text }) });
    // Auto-title the chat from the first message
    const chat = chats.find(c => c.id === chatId);
    if (chat && chat.title === 'New Chat') {
        const title = text.substring(0, 40) + (text.length > 40 ? '...' : '');
        await api(`/api/chats/${chatId}`, { method: 'PUT', body: JSON.stringify({ title }) });
        document.getElementById('chatTitle').textContent = title;
        await loadChats();
    }
    input.value = ''; input.style.height = 'auto';
    // Reload messages and stream a response
    const chatResp = await api(`/api/chats/${chatId}`);
    const chatData = await chatResp.json();
    const messages = chatData.messages.map(m => ({ role: m.role, content: m.content }));
    renderMessages(messages);
    await streamResponse(messages, chatId);
}

/**
 * Stream an AI response into the chat area.
 * Handles SSE (Server-Sent Events) parsing including:
 * - Regular text chunks (accumulated and rendered as markdown)
 * - tool_call events (shows "Searching..." indicator)
 * - tool_result events (shows search results preview)
 * - error events
 * After streaming completes, saves the response to the DB.
 */
async function streamResponse(messages, chatId) {
    const container = document.getElementById('messages');
    // Create assistant message element with typing indicator
    const assistantDiv = createMessageElement('assistant', '');
    const contentDiv = assistantDiv.querySelector('.content');
    contentDiv.innerHTML = '<div class="typing-indicator"><span></span><span></span><span></span></div>';
    container.appendChild(assistantDiv);
    container.scrollTop = container.scrollHeight;
    isStreaming = true;
    document.getElementById('sendBtn').disabled = true;
    let fullResponse = '';
    try {
        // Open SSE connection to the backend
        const resp = await fetch('/api/chat', { method: 'POST', headers: {'Content-Type':'application/json','X-User-Id':userId},
            body: JSON.stringify({ model: currentModel, messages, project_id: currentProjectId }) });
        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        // Read the stream chunk by chunk
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            // Split on newlines — each SSE event is a line starting with "data: "
            const lines = buffer.split('\n'); buffer = lines.pop();
            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const jsonStr = line.slice(6).trim(); if (!jsonStr) continue;
                    try {
                        const chunk = JSON.parse(jsonStr);
                        if (chunk.error) { fullResponse = `Error: ${chunk.error}`; break; }
                        // Handle web search tool call events
                        if (chunk.type === 'tool_call') {
                            let toolDiv = contentDiv.querySelector('.tool-indicator');
                            if (!toolDiv) { toolDiv = document.createElement('div'); toolDiv.className = 'tool-indicator'; contentDiv.appendChild(toolDiv); }
                            toolDiv.innerHTML = `<div class="tool-active">🔍 Searching: "${chunk.args.query || JSON.stringify(chunk.args)}"</div>`;
                            container.scrollTop = container.scrollHeight;
                        } else if (chunk.type === 'tool_result') {
                            let toolDiv = contentDiv.querySelector('.tool-indicator');
                            if (!toolDiv) { toolDiv = document.createElement('div'); toolDiv.className = 'tool-indicator'; contentDiv.appendChild(toolDiv); }
                            toolDiv.innerHTML = `<div class="tool-done">✅ Web search complete</div><div class="tool-preview">${escapeHtml(chunk.result.substring(0, 200))}</div>`;
                            container.scrollTop = container.scrollHeight;
                        } else if (chunk.message && chunk.message.content) {
                            // Accumulate text chunks and render as markdown
                            fullResponse += chunk.message.content;
                            contentDiv.innerHTML = marked.parse(fullResponse);
                            container.scrollTop = container.scrollHeight;
                        }
                    } catch (e) {}
                }
            }
        }
        // Add copy buttons to code blocks in the response
        addCopyButtonsToCodeBlocks(container);
        // Save the complete response to the DB
        if (chatId && fullResponse) {
            await api(`/api/chats/${chatId}/messages`, { method: 'POST', body: JSON.stringify({ role: 'assistant', content: fullResponse }) });
            await loadChats(); renderSidebar();
        }
    } catch (e) { contentDiv.textContent = `Error: ${e.message}`; }
    finally { isStreaming = false; document.getElementById('sendBtn').disabled = false; document.getElementById('input').focus(); }
}

/**
 * Send a message to two models simultaneously for comparison.
 * Both responses are streamed in parallel into side-by-side panels.
 */
async function sendCompareMessage(text) {
    const messages = [{ role: 'user', content: text }];
    const modelA = document.getElementById('compareModelA').value;
    const modelB = document.getElementById('compareModelB').value;
    const resultA = document.getElementById('compareResultA');
    const resultB = document.getElementById('compareResultB');
    // Show typing indicators in both panels
    resultA.innerHTML = '<div class="typing-indicator"><span></span><span></span><span></span></div>';
    resultB.innerHTML = '<div class="typing-indicator"><span></span><span></span><span></span></div>';
    isStreaming = true; document.getElementById('sendBtn').disabled = true;
    /**
     * Stream a single model's response into a target element.
     * Same SSE parsing as streamResponse() but simpler (no tool calls in compare mode).
     */
    const streamOne = async (model, resultEl) => {
        let full = '';
        try {
            const resp = await fetch('/api/chat', { method: 'POST', headers: {'Content-Type':'application/json','X-User-Id':userId},
                body: JSON.stringify({ model, messages, project_id: currentProjectId }) });
            const reader = resp.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n'); buffer = lines.pop();
                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const jsonStr = line.slice(6).trim(); if (!jsonStr) continue;
                        try {
                            const chunk = JSON.parse(jsonStr);
                            if (chunk.error) { full = `Error: ${chunk.error}`; break; }
                            if (chunk.message && chunk.message.content) {
                                full += chunk.message.content;
                                resultEl.innerHTML = marked.parse(full);
                            }
                        } catch (e) {}
                    }
                }
            }
            addCopyButtonsToCodeBlocks(resultEl);
        } catch (e) { resultEl.textContent = `Error: ${e.message}`; }
    };
    // Stream both models in parallel
    await Promise.all([streamOne(modelA, resultA), streamOne(modelB, resultB)]);
    isStreaming = false; document.getElementById('sendBtn').disabled = false;
}


// ---------------------------------------------------------------------------
// UI Helpers
// ---------------------------------------------------------------------------

/** Toggle the sidebar between visible and collapsed.
 *  On desktop this collapses the sidebar into the left margin.
 *  On mobile (<=768px) it slides the sidebar in/out as an overlay drawer
 *  with a semi-transparent backdrop. */
function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebarOverlay');
    const isMobile = window.matchMedia('(max-width: 768px)').matches;
    sidebar.classList.toggle('collapsed');
    if (isMobile) {
        const isOpen = !sidebar.classList.contains('collapsed');
        overlay.classList.toggle('visible', isOpen);
    } else {
        overlay.classList.remove('visible');
    }
}

/** Close the sidebar if we're on mobile (used after selecting a chat/project). */
function closeSidebarIfMobile() {
    if (window.matchMedia('(max-width: 768px)').matches) {
        document.getElementById('sidebar').classList.add('collapsed');
        document.getElementById('sidebarOverlay').classList.remove('visible');
    }
}

/**
 * Update the project badge in the header.
 * Shows the project name if a project is active, hides it otherwise.
 */
function updateProjectBadge(p) {
    const badge = document.getElementById('projectBadge');
    if (p || currentProjectId) {
        const proj = p || projects.find(x => x.id === currentProjectId);
        if (proj) { badge.textContent = proj.name; badge.style.display = 'inline-block'; return; }
    }
    badge.style.display = 'none';
}


// ---------------------------------------------------------------------------
// Project Modal
// ---------------------------------------------------------------------------

/** Render the color picker dots for project color selection. */
function renderColorPicker() {
    document.getElementById('colorPicker').innerHTML = colors.map(c =>
        `<div class="color-dot ${c === selectedColor ? 'selected' : ''}" style="background:${c}" onclick="selectColor('${c}')"></div>`).join('');
}

/** Select a color for the new/edit project. */
function selectColor(c) { selectedColor = c; renderColorPicker(); }

/**
 * Open the project modal in "new project" mode.
 * Resets all fields to defaults including agent profile fields.
 */
function openNewProjectModal() {
    editingProjectId = null;
    selectedColor = '#7c4dff';
    document.getElementById('modalTitle').textContent = 'New Project';
    document.getElementById('projectName').value = '';
    document.getElementById('projectDesc').value = '';
    document.getElementById('agentName').value = '';
    document.getElementById('agentPrompt').value = '';
    document.getElementById('agentModel').value = '';
    document.getElementById('saveProjectBtn').textContent = 'Create';
    renderColorPicker();
    document.getElementById('projectModal').style.display = 'flex';
}

/** Close the project modal. */
function closeModal() { document.getElementById('projectModal').style.display = 'none'; }

/**
 * Save the project (create new or update existing).
 * Reads all fields including agent profile and calls the appropriate API.
 */
async function saveProject() {
    const name = document.getElementById('projectName').value.trim(); if (!name) return;
    const desc = document.getElementById('projectDesc').value.trim();
    const agentName = document.getElementById('agentName').value.trim();
    const agentPrompt = document.getElementById('agentPrompt').value.trim();
    const agentModel = document.getElementById('agentModel').value;
    const agent = { name: agentName, prompt: agentPrompt, model: agentModel };
    if (editingProjectId) {
        // Update existing project
        await updateProject(editingProjectId, { name, description: desc, color: selectedColor, agent_name: agentName, agent_prompt: agentPrompt, agent_model: agentModel });
    } else {
        // Create new project
        await createProject(name, desc, selectedColor, agent);
    }
    closeModal();
    await loadProjects(); renderSidebar();
}


// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

/**
 * Open the settings modal.
 * Loads current settings from the backend (Ollama URL, SearXNG URL, default model).
 */
async function showSettings() {
    try {
        const resp = await api('/api/settings');
        const data = await resp.json();
        document.getElementById('settingsOllamaUrl').value = data.ollama_url || '';
        document.getElementById('settingsSearxngUrl').value = data.searxng_url || '';
        // Populate default model dropdown
        const sel = document.getElementById('settingsDefaultModel');
        sel.innerHTML = '<option value="">Use server default</option>';
        allModelsList.forEach(m => {
            const name = typeof m === 'string' ? m : m.name;
            sel.appendChild(new Option(name, name));
        });
        sel.value = data.default_model || '';
        // Clear test results
        document.getElementById('ollamaTestResult').innerHTML = '';
        document.getElementById('searxngTestResult').innerHTML = '';
        // Show/hide admin section based on role
        const usersSection = document.getElementById('manageUsersSection');
        if (usersSection) usersSection.style.display = userRole === 'admin' ? 'block' : 'none';
        document.getElementById('settingsModal').style.display = 'flex';
        loadTotpStatus();
    } catch (e) { alert('Failed to load settings'); }
}

/** Close the settings modal. */
function closeSettings() { document.getElementById('settingsModal').style.display = 'none'; }

/**
 * Save all settings (Ollama URL, SearXNG URL, default model).
 * Reloads models after saving to reflect any connection changes.
 */
async function saveSettings() {
    const ollamaUrl = document.getElementById('settingsOllamaUrl').value.trim();
    const searxngUrl = document.getElementById('settingsSearxngUrl').value.trim();
    const defaultModel = document.getElementById('settingsDefaultModel').value;
    await api('/api/settings', { method: 'PUT', body: JSON.stringify({
        ollama_url: ollamaUrl, searxng_url: searxngUrl, default_model: defaultModel
    }) });
    closeSettings();
    await loadModels();
    updateStatusText();
}

/**
 * Change the current user's password.
 * Validates old password first, then sends new password to the backend.
 */
async function changePassword() {
    const oldPw = document.getElementById('oldPassword').value;
    const newPw = document.getElementById('newPassword').value;
    const confirmPw = document.getElementById('confirmPassword').value;
    const el = document.getElementById('changePasswordResult');
    el.textContent = '';
    if (!oldPw || !newPw) { el.textContent = 'Fill in all fields'; return; }
    if (newPw !== confirmPw) { el.textContent = 'Passwords do not match'; return; }
    if (newPw.length < 4) { el.textContent = 'Password must be at least 4 characters'; return; }
    try {
        const resp = await api('/api/change-password', {
            method: 'POST',
            body: JSON.stringify({ old_password: oldPw, new_password: newPw })
        });
        const data = await resp.json();
        if (data.error) { el.textContent = data.error; return; }
        el.style.color = 'var(--green)';
        el.textContent = '✓ Password changed';
        document.getElementById('oldPassword').value = '';
        document.getElementById('newPassword').value = '';
        document.getElementById('confirmPassword').value = '';
    } catch (e) { el.textContent = 'Error: ' + e.message; }
}

// -----------------------------------------------------------------------
// TOTP (Two-Factor Authentication) management
// -----------------------------------------------------------------------

let totpSecret = '';

async function loadTotpStatus() {
    try {
        const resp = await api('/api/me');
        const data = await resp.json();
        const statusEl = document.getElementById('totpStatus');
        const enrollBtn = document.getElementById('totpEnrollBtn');
        const disableBtn = document.getElementById('totpDisableBtn');
        if (data.totp_enabled) {
            statusEl.innerHTML = '<span style="color:var(--green);">✓ Two-factor authentication is enabled</span>';
            enrollBtn.style.display = 'none';
            disableBtn.style.display = '';
        } else {
            statusEl.innerHTML = '<span style="color:var(--text-muted);">Two-factor authentication is not enabled</span>';
            enrollBtn.style.display = '';
            disableBtn.style.display = 'none';
        }
        document.getElementById('totpSetup').style.display = 'none';
        document.getElementById('totpDisableForm').style.display = 'none';
    } catch (e) {}
}

async function enrollTotp() {
    try {
        const resp = await api('/api/totp/enroll', { method: 'POST' });
        const data = await resp.json();
        if (data.error) { alert(data.error); return; }
        totpSecret = data.secret;
        // Generate QR code using a simple API (no server-side dependency)
        const otpauthUri = data.otpauth_uri;
        const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(otpauthUri)}`;
        document.getElementById('totpQrContainer').innerHTML = `<img src="${qrUrl}" alt="TOTP QR Code" style="border-radius:8px;" />`;
        document.getElementById('totpSecretDisplay').textContent = data.secret;
        document.getElementById('totpSetup').style.display = '';
        document.getElementById('totpVerifyResult').textContent = '';
        document.getElementById('totpVerifyCode').value = '';
        document.getElementById('totpEnrollBtn').style.display = 'none';
    } catch (e) { alert('Error: ' + e.message); }
}

async function verifyTotp() {
    const code = document.getElementById('totpVerifyCode').value.trim();
    const el = document.getElementById('totpVerifyResult');
    if (!code || code.length !== 6) { el.textContent = 'Enter the 6-digit code'; return; }
    try {
        const resp = await api('/api/totp/verify', {
            method: 'POST',
            body: JSON.stringify({ code })
        });
        const data = await resp.json();
        if (data.error) { el.textContent = data.error; return; }
        el.style.color = 'var(--green)';
        el.textContent = '✓ Two-factor authentication enabled!';
        document.getElementById('totpSetup').style.display = 'none';
        await loadTotpStatus();
    } catch (e) { el.textContent = 'Error: ' + e.message; }
}

function cancelTotpSetup() {
    document.getElementById('totpSetup').style.display = 'none';
    document.getElementById('totpEnrollBtn').style.display = '';
}

function showDisableTotp() {
    document.getElementById('totpDisableForm').style.display = '';
    document.getElementById('totpDisableResult').textContent = '';
    document.getElementById('totpDisablePassword').value = '';
    document.getElementById('totpDisableCode').value = '';
}

async function disableTotp() {
    const password = document.getElementById('totpDisablePassword').value;
    const code = document.getElementById('totpDisableCode').value.trim();
    const el = document.getElementById('totpDisableResult');
    if (!password && !code) { el.textContent = 'Enter your password or current code'; return; }
    try {
        const body = {};
        if (password) body.password = password;
        if (code) body.code = code;
        const resp = await api('/api/totp/disable', {
            method: 'POST',
            body: JSON.stringify(body)
        });
        const data = await resp.json();
        if (data.error) { el.textContent = data.error; return; }
        el.style.color = 'var(--green)';
        el.textContent = '✓ Two-factor authentication disabled';
        document.getElementById('totpDisableForm').style.display = 'none';
        await loadTotpStatus();
    } catch (e) { el.textContent = 'Error: ' + e.message; }
}


/**
 * Admin panel — list users, change roles, create users, reset passwords, delete users.
 */
async function showAdminPanel() {
    if (userRole !== 'admin') { alert('Admin access required'); return; }
    document.getElementById('settingsModal').style.display = 'none';
    const modal = document.getElementById('adminModal');
    const list = document.getElementById('adminUserList');
    list.innerHTML = '<div style="color:var(--text-muted)">Loading...</div>';
    modal.style.display = 'flex';
    try {
        const resp = await api('/api/admin/users');
        const users = await resp.json();
        list.innerHTML = '';
        users.forEach(u => {
            const row = document.createElement('div');
            row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--border);flex-wrap:wrap;';
            const roleBadge = u.role === 'admin'
                ? '<span style="background:var(--accent);color:white;padding:2px 8px;border-radius:4px;font-size:11px;">admin</span>'
                : '<span style="background:var(--bg-input);color:var(--text-muted);padding:2px 8px;border-radius:4px;font-size:11px;">user</span>';
            const totpBadge = u.totp_enabled
                ? '<span style="background:#2e7d32;color:white;padding:2px 8px;border-radius:4px;font-size:11px;">🔐 2FA</span>'
                : '';
            row.innerHTML = `
                <span style="flex:1;font-size:14px;color:var(--text);min-width:80px;">${u.username}</span>
                ${roleBadge} ${totpBadge}
                <select onchange="setUserRole('${u.id}', this.value)" style="font-size:12px;padding:4px;background:var(--bg-input);color:var(--text);border:1px solid var(--border);border-radius:4px;${u.id===userId?'opacity:0.5;pointer-events:none;':''}">
                    <option value="user" ${u.role!=='admin'?'selected':''}>user</option>
                    <option value="admin" ${u.role==='admin'?'selected':''}>admin</option>
                </select>
                <button onclick="resetPassword('${u.id}', '${u.username}')" style="font-size:12px;padding:4px 8px;background:var(--bg-input);color:var(--text);border:1px solid var(--border);border-radius:4px;cursor:pointer;" ${u.id===userId?'disabled':''}>Reset PW</button>
                <button onclick="deleteUser('${u.id}', '${u.username}')" style="font-size:12px;padding:4px 8px;background:#c62828;color:white;border:none;border-radius:4px;cursor:pointer;" ${u.id===userId?'disabled title="Cannot delete yourself"':''}>Delete</button>
            `;
            list.appendChild(row);
        });
    } catch (e) { list.innerHTML = '<div style="color:var(--red)">Failed to load users</div>'; }
    loadInvites();
}

function closeAdminPanel() { document.getElementById('adminModal').style.display = 'none'; }

async function generateInvite() {
    const el = document.getElementById('inviteResult');
    try {
        const resp = await api('/api/admin/invites', { method: 'POST' });
        const data = await resp.json();
        if (data.error) { el.style.color = 'var(--red)'; el.textContent = data.error; return; }
        el.style.color = 'var(--green)';
        el.textContent = '✓ Token created — copy it:';
        // Build the full invite URL
        const baseUrl = window.location.origin;
        const inviteUrl = `${baseUrl}/#invite=${data.token}`;
        // Show token with copy button
        const tokenEl = document.createElement('div');
        tokenEl.style.cssText = 'margin-top:8px;padding:8px;background:var(--bg-input);border:1px solid var(--border);border-radius:6px;font-family:monospace;word-break:break-all;font-size:13px;color:var(--text);display:flex;align-items:center;gap:8px;';
        tokenEl.innerHTML = `<span style="flex:1;">${data.token}</span><button onclick="navigator.clipboard.writeText(this.parentElement.querySelector('span').textContent);this.textContent='Copied!';setTimeout(()=>this.textContent='Copy',1500)" style="padding:4px 8px;background:var(--accent);color:white;border:none;border-radius:4px;cursor:pointer;font-size:12px;">Copy</button>`;
        const linkEl = document.createElement('div');
        linkEl.style.cssText = 'margin-top:4px;font-size:12px;color:var(--text-muted);';
        linkEl.innerHTML = `Share link: <a href="${inviteUrl}" style="color:var(--accent);">${inviteUrl}</a>`;
        el.appendChild(tokenEl);
        el.appendChild(linkEl);
        loadInvites();
    } catch (e) { el.style.color = 'var(--red)'; el.textContent = 'Error: ' + e.message; }
}

async function loadInvites() {
    const el = document.getElementById('inviteList');
    try {
        const resp = await api('/api/admin/invites');
        const invites = await resp.json();
        if (!invites.length) { el.innerHTML = '<div style="color:var(--text-muted);font-size:13px;">No tokens yet</div>'; return; }
        el.innerHTML = invites.map(inv => {
            const status = inv.used ? `<span style="color:var(--text-muted);">Used by ${inv.used_by_name || 'unknown'}</span>` : `<span style="color:var(--green);">✓ Available</span>`;
            return `<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border);font-size:13px;">
                <code style="flex:1;font-size:11px;word-break:break-all;color:var(--text-muted);">${inv.token.slice(0,12)}...</code>
                ${status}
                ${!inv.used ? `<button onclick="deleteInvite('${inv.id}')" style="font-size:11px;padding:2px 6px;background:#c62828;color:white;border:none;border-radius:3px;cursor:pointer;">Delete</button>` : ''}
            </div>`;
        }).join('');
    } catch (e) { el.innerHTML = '<div style="color:var(--red);font-size:13px;">Failed to load invites</div>'; }
}

async function deleteInvite(iid) {
    try {
        await api(`/api/admin/invites/${iid}`, { method: 'DELETE' });
        loadInvites();
    } catch (e) { alert('Failed to delete invite'); }
}

async function setUserRole(uid, role) {
    try {
        await api('/api/admin/set-role', { method: 'POST', body: JSON.stringify({ user_id: uid, role }) });
        showAdminPanel();
    } catch (e) { alert('Failed to update role: ' + e.message); }
}

async function resetPassword(uid, uname) {
    const newPw = prompt(`Enter new password for "${uname}":`);
    if (!newPw) return;
    if (newPw.length < 4) { alert('Password must be at least 4 characters'); return; }
    try {
        await api('/api/admin/reset-password', { method: 'POST', body: JSON.stringify({ user_id: uid, new_password: newPw }) });
        alert('Password updated for ' + uname);
    } catch (e) { alert('Failed to reset password: ' + e.message); }
}

async function adminCreateUser() {
    const username = document.getElementById('newUsername').value.trim();
    const password = document.getElementById('newUserPw').value;
    const role = document.getElementById('newUserRole').value;
    const el = document.getElementById('createUserResult');
    el.textContent = '';
    if (!username || !password) { el.style.color = 'var(--red)'; el.textContent = 'Username and password required'; return; }
    if (password.length < 4) { el.style.color = 'var(--red)'; el.textContent = 'Password must be at least 4 characters'; return; }
    try {
        const resp = await api('/api/admin/create-user', { method: 'POST', body: JSON.stringify({ username, password, role }) });
        const data = await resp.json();
        if (data.error) { el.style.color = 'var(--red)'; el.textContent = data.error; return; }
        el.style.color = 'var(--green)'; el.textContent = '✓ Created ' + username;
        document.getElementById('newUsername').value = '';
        document.getElementById('newUserPw').value = '';
        showAdminPanel(); // Refresh list
    } catch (e) { el.style.color = 'var(--red)'; el.textContent = e.message; }
}

async function deleteUser(uid, uname) {
    if (!confirm(`Delete user "${uname}" and all their data? This cannot be undone.`)) return;
    try {
        await api(`/api/admin/users/${uid}`, { method: 'DELETE' });
        showAdminPanel();
    } catch (e) { alert('Failed to delete user: ' + e.message); }
}

/**
 * Test the Ollama connection.
 * Saves the current URL value first, then calls the test endpoint.
 * Shows success (model count) or failure message.
 */
async function testOllamaConnection() {
    const el = document.getElementById('ollamaTestResult');
    el.innerHTML = '<span style="color:var(--text-muted)">Testing...</span>';
    try {
        // Save the URL first so the test uses the updated value
        const ollamaUrl = document.getElementById('settingsOllamaUrl').value.trim();
        await api('/api/settings', { method: 'PUT', body: JSON.stringify({ ollama_url: ollamaUrl }) });
        const resp = await api('/api/settings/test-ollama');
        const data = await resp.json();
        if (data.status === 'ok') {
            el.innerHTML = `<span style="color:var(--green)">✓ Connected — ${data.model_count} models found</span>`;
        } else {
            el.innerHTML = `<span style="color:var(--red)">✗ ${data.error || 'Failed'}</span>`;
        }
    } catch (e) { el.innerHTML = `<span style="color:var(--red)">✗ ${e.message}</span>`; }
}

/**
 * Test the SearXNG connection.
 * Saves the current URL first, then calls the test endpoint.
 * Shows success (result count) or failure message.
 */
async function testSearxngConnection() {
    const el = document.getElementById('searxngTestResult');
    el.innerHTML = '<span style="color:var(--text-muted)">Testing...</span>';
    try {
        const searxngUrl = document.getElementById('settingsSearxngUrl').value.trim();
        await api('/api/settings', { method: 'PUT', body: JSON.stringify({ searxng_url: searxngUrl }) });
        const resp = await api('/api/settings/test-searxng');
        const data = await resp.json();
        if (data.status === 'ok') {
            el.innerHTML = `<span style="color:var(--green)">✓ Connected — search returned ${data.result_count} results</span>`;
        } else {
            el.innerHTML = `<span style="color:var(--red)">✗ ${data.error || 'Failed'}</span>`;
        }
    } catch (e) { el.innerHTML = `<span style="color:var(--red)">✗ ${e.message}</span>`; }
}


// ---------------------------------------------------------------------------
// Utility Functions
// ---------------------------------------------------------------------------

/**
 * Escape HTML special characters to prevent XSS in dynamically generated HTML.
 * Creates a temporary div and uses textContent/innerHTML to escape.
 */
function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
}

/**
 * Format a Unix timestamp for display.
 * Shows time for today, date for older messages.
 * @param {number} ts - Unix timestamp in seconds
 */
function formatDate(ts) {
    const d = new Date(ts * 1000);
    const now = new Date();
    if (d.toDateString() === now.toDateString())
        return d.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
    return d.toLocaleDateString([], {month:'short', day:'numeric'});
}

/**
 * Format a byte count as a human-readable file size.
 * @param {number} b - Size in bytes
 */
function formatSize(b) {
    if (b < 1024) return b + ' B';
    if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
    return (b / 1048576).toFixed(1) + ' MB';
}