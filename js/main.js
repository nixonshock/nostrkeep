/**
 * main.js — Nostr Keep UI and app logic
 * Encrypted notes, lists, pins, colors, archive — Google Keep on Nostr
 */
import * as Nostr from './nostr.js';

// --- Color definitions ---
const COLORS = {
  default: { bg: 'var(--color-default)', border: 'var(--color-default-border)', label: 'Default' },
  red:     { bg: 'var(--color-red)',     border: 'var(--color-red-border)',     label: 'Red' },
  orange:  { bg: 'var(--color-orange)',  border: 'var(--color-orange-border)',  label: 'Orange' },
  yellow:  { bg: 'var(--color-yellow)',  border: 'var(--color-yellow-border)',  label: 'Yellow' },
  green:   { bg: 'var(--color-green)',   border: 'var(--color-green-border)',   label: 'Green' },
  teal:    { bg: 'var(--color-teal)',    border: 'var(--color-teal-border)',    label: 'Teal' },
  blue:    { bg: 'var(--color-blue)',    border: 'var(--color-blue-border)',    label: 'Blue' },
  purple:  { bg: 'var(--color-purple)',  border: 'var(--color-purple-border)',  label: 'Purple' },
  pink:    { bg: 'var(--color-pink)',    border: 'var(--color-pink-border)',    label: 'Pink' },
  gray:    { bg: 'var(--color-gray)',    border: 'var(--color-gray-border)',    label: 'Gray' },
};

// --- State ---
let notes = [];
let editingId = null;
let showArchived = false;
let activeLabel = 'all';
let searchQuery = '';
let listEditData = []; // list items in edit modal

// Check cached login
const cachedNsec = sessionStorage.getItem('nostrkeep_nsec');

// --- DOM refs ---
const $ = (sel) => document.querySelector(sel);
const loginScreen = $('#login-screen');
const appScreen = $('#app-screen');
const nsecInput = $('#nsec-input');
const nsecLoginBtn = $('#nsec-login-btn');
const extLoginBtn = $('#ext-login-btn');
const createBtn = $('#create-btn');
const loginError = $('#login-error');
const logoutBtn = $('#logout-btn');
const archiveBtn = $('#archive-btn');
const themeBtn = $('#theme-btn');
const pubkeyDisplay = $('#pubkey-display');
const connStatus = $('#conn-status');
const noteCount = $('#note-count');
const notesGrid = $('#notes-grid');
const pinnedGrid = $('#pinned-grid');
const pinnedSection = $('#pinned-section');
const sectionHeaderLabel = $('#section-header-label');
const emptyState = $('#empty-state');
const emptyMsg = $('#empty-msg');
const labelBar = $('#label-bar');
const addBtn = $('#add-btn');
const searchInput = $('#search-input');
const searchClear = $('#search-clear');
const modalOverlay = $('#modal-overlay');
const noteForm = $('#note-form');
const noteId = $('#note-id');
const noteTitle = $('#note-title');
const noteContent = $('#note-content');
const typeNoteBtn = $('#type-note');
const typeListBtn = $('#type-list');
const contentGroup = $('#content-group');
const listGroup = $('#list-group');
const listItems = $('#list-items');
const addItemBtn = $('#add-item-btn');
const colorPicker = $('#color-picker');
const noteLabels = $('#note-labels');
const noteReminder = $('#note-reminder');
const reminderClear = $('#reminder-clear');
const notePinned = $('#note-pinned');
const modalCancel = $('#modal-cancel');
const confirmOverlay = $('#confirm-overlay');
const confirmMsg = $('#confirm-msg');
const confirmYes = $('#confirm-yes');
const confirmNo = $('#confirm-no');

// --- Toast ---
function showToast(msg, duration = 2500) {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), duration);
}

// --- Escape HTML ---
function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// --- Theme ---
function applyTheme(isLight) {
  document.body.classList.toggle('light-mode', isLight);
  themeBtn.textContent = isLight ? '☀️' : '🌙';
  localStorage.setItem('nostrkeep_theme', isLight ? 'light' : 'dark');
}

themeBtn.addEventListener('click', () => {
  applyTheme(!document.body.classList.contains('light-mode'));
});

const savedTheme = localStorage.getItem('nostrkeep_theme');
if (savedTheme === 'light') applyTheme(true);

// --- Filter & search ---
function getFilteredNotes() {
  let filtered = notes.filter(n => {
    if (n.archived !== showArchived) return false;
    if (activeLabel !== 'all' && !(n.labels || []).includes(activeLabel)) return false;
    return true;
  });
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    filtered = filtered.filter(n => {
      const searchable = [
        n.title, n.content,
        ...(n.listItems || []).map(i => i.text),
        ...(n.labels || []),
      ].filter(Boolean).join(' ').toLowerCase();
      return searchable.includes(q);
    });
  }
  return filtered;
}

function getUniqueLabels() {
  const set = new Set();
  for (const n of notes) {
    for (const l of (n.labels || [])) {
      if (l.trim()) set.add(l.trim().toLowerCase());
    }
  }
  return [...set].sort();
}

// --- Label bar ---
function renderLabels() {
  labelBar.innerHTML = '';
  const labels = getUniqueLabels();
  const chips = [{ id: 'all', label: 'All' }];
  if (showArchived) {
    chips.push({ id: '_archived', label: '📦 Archived' });
  }
  labels.forEach(l => chips.push({ id: l, label: l }));

  chips.forEach(({ id, label }) => {
    const btn = document.createElement('button');
    btn.className = 'label-chip' + (id === activeLabel ? ' active' : '');
    btn.innerHTML = label;
    btn.dataset.label = id;
    btn.addEventListener('click', () => {
      activeLabel = id;
      renderLabels();
      renderNotes();
    });
    labelBar.appendChild(btn);
  });
}

// --- Render notes ---
function renderNotes() {
  const filtered = getFilteredNotes();
  const total = notes.filter(n => !n.archived).length;

  // Update count badge
  noteCount.textContent = showArchived
    ? `📦 ${filtered.length}`
    : `${total}`;

  // Separate pinned & unpinned
  const pinned = filtered.filter(n => n.pinned);
  const unpinned = filtered.filter(n => !n.pinned);

  // Pinned section
  if (!showArchived && pinned.length > 0) {
    pinnedSection.classList.remove('hidden');
    pinnedGrid.innerHTML = '';
    pinned.forEach(n => pinnedGrid.appendChild(createNoteCard(n)));
  } else {
    pinnedSection.classList.add('hidden');
  }

  // Notes section
  sectionHeaderLabel.textContent = showArchived
    ? '📦 Archive'
    : (pinned.length > 0 ? 'Other notes' : 'Notes');

  if (unpinned.length === 0 && (showArchived || pinned.length === 0)) {
    // Show empty state only if no notes at all
    const totalFiltered = showArchived ? filtered.length : notes.filter(n => !n.archived).length;
    if (totalFiltered === 0) {
      emptyState.style.display = 'block';
      if (searchQuery) {
        emptyMsg.textContent = `No results for "${searchQuery}"`;
      } else if (showArchived) {
        emptyMsg.textContent = 'No archived notes';
      } else {
        emptyMsg.textContent = 'No notes yet';
      }
      notesGrid.innerHTML = '';
      return;
    }
  }

  emptyState.style.display = 'none';
  notesGrid.innerHTML = '';
  unpinned.forEach(n => notesGrid.appendChild(createNoteCard(n)));

  // Attach inline listeners
  document.querySelectorAll('.pin-btn').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      togglePin(el.dataset.id);
    });
  });
  document.querySelectorAll('.archive-btn').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleArchive(el.dataset.id);
    });
  });
  document.querySelectorAll('.del-note-btn').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      confirmDeleteNote(el.dataset.id);
    });
  });
  document.querySelectorAll('.list-item-toggle').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleListItem(el.dataset.id, parseInt(el.dataset.idx));
    });
  });
  document.querySelectorAll('.note-card').forEach(el => {
    el.addEventListener('click', (e) => {
      // Only open edit if not clicking a button/toggle
      if (e.target.closest('button, .list-item-toggle, .card-actions')) return;
      openEdit(el.dataset.id);
    });
  });
}

// --- Create note card ---
function createNoteCard(note) {
  const card = document.createElement('div');
  card.className = 'note-card' + (note.pinned && !showArchived ? ' pinned' : '');
  card.dataset.id = note.id;

  const color = COLORS[note.color] || COLORS.default;
  card.style.setProperty('--card-bg', color.bg);
  card.style.setProperty('--card-border', color.border);

  let bodyHtml = '';
  if (note.type === 'list' && note.listItems && note.listItems.length > 0) {
    const items = note.listItems.map((item, idx) => `
      <div class="list-item${item.checked ? ' checked' : ''}">
        <span class="list-item-toggle" data-id="${escapeHtml(note.id)}" data-idx="${idx}">
          ${item.checked ? '☑' : '☐'}
        </span>
        <span class="list-item-text">${escapeHtml(item.text)}</span>
      </div>
    `).join('');
    bodyHtml += `<div class="card-list">${items}</div>`;
  } else if (note.content) {
    bodyHtml += `<div class="card-content">${escapeHtml(note.content)}</div>`;
  }

  const labelsHtml = (note.labels || []).map(l =>
    `<span class="card-label">${escapeHtml(l)}</span>`
  ).join('');

  const reminderHtml = note.reminder
    ? `<span class="card-reminder">🔔 ${formatReminder(note.reminder)}</span>`
    : '';

  card.innerHTML = `
    <div class="card-header">
      <div class="card-title">${escapeHtml(note.title || 'Untitled')}</div>
    </div>
    ${bodyHtml}
    ${labelsHtml ? `<div class="card-labels">${labelsHtml}</div>` : ''}
    ${reminderHtml}
    <div class="card-actions">
      <button class="pin-btn" data-id="${escapeHtml(note.id)}" title="${note.pinned ? 'Unpin' : 'Pin'}">
        ${note.pinned ? '📌' : '📍'}
      </button>
      <button class="archive-btn" data-id="${escapeHtml(note.id)}" title="${note.archived ? 'Restore' : 'Archive'}">
        ${note.archived ? '📤' : '📦'}
      </button>
      <button class="del-note-btn" data-id="${escapeHtml(note.id)}" title="Delete">🗑</button>
    </div>
  `;

  return card;
}

function formatReminder(ts) {
  const d = new Date(ts * 1000);
  const now = new Date();
  const diff = d - now;
  if (diff < 0) return 'Overdue!';
  if (diff < 60000) return 'Now';
  if (diff < 3600000) return `${Math.round(diff / 60000)}m`;
  if (diff < 86400000) return `${Math.round(diff / 3600000)}h`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// --- CRUD helpers ---
async function refreshNotes() {
  if (searchQuery) {
    searchInput.value = '';
    searchQuery = '';
    searchClear.classList.remove('visible');
  }
  connStatus.innerHTML = '<span class="dot dot-yellow"></span> Loading...';
  notes = await Nostr.fetchNotes();
  renderNotes();
  renderLabels();
  connStatus.innerHTML = `<span class="dot dot-green"></span> Connected · ${notes.length} notes`;
}

async function togglePin(id) {
  const note = notes.find(n => n.id === id);
  if (!note) return;
  note.pinned = !note.pinned;
  renderNotes();
  try {
    await Nostr.saveNote(note);
  } catch (e) {
    note.pinned = !note.pinned; // revert
    renderNotes();
    showToast('Failed to update: ' + e.message, 3000);
  }
}

async function toggleArchive(id) {
  const note = notes.find(n => n.id === id);
  if (!note) return;
  note.archived = !note.archived;
  renderNotes();
  renderLabels();
  try {
    await Nostr.saveNote(note);
    showToast(note.archived ? 'Archived' : 'Restored', 1500);
  } catch (e) {
    note.archived = !note.archived;
    renderNotes();
    renderLabels();
    showToast('Failed: ' + e.message, 3000);
  }
}

async function toggleListItem(noteId, idx) {
  const note = notes.find(n => n.id === noteId);
  if (!note || !note.listItems || !note.listItems[idx]) return;
  note.listItems[idx].checked = !note.listItems[idx].checked;
  renderNotes();
  try {
    await Nostr.saveNote(note);
  } catch (e) {
    note.listItems[idx].checked = !note.listItems[idx].checked;
    renderNotes();
    showToast('Failed to update: ' + e.message, 3000);
  }
}

let pendingDeleteId = null;

function confirmDeleteNote(id) {
  pendingDeleteId = id;
  const note = notes.find(n => n.id === id);
  confirmMsg.textContent = `Delete "${note ? note.title : 'this note'}"?`;
  confirmOverlay.classList.remove('hidden');
}

confirmYes.addEventListener('click', async () => {
  if (!pendingDeleteId) return;
  const id = pendingDeleteId;
  pendingDeleteId = null;
  confirmOverlay.classList.add('hidden');
  notes = notes.filter(n => n.id !== id);
  renderNotes();
  renderLabels();
  try {
    await Nostr.deleteNote(id);
    showToast('Deleted', 1500);
  } catch (e) {
    showToast('Failed to delete: ' + e.message, 3000);
    await refreshNotes();
  }
});

confirmNo.addEventListener('click', () => {
  pendingDeleteId = null;
  confirmOverlay.classList.add('hidden');
});

// --- Modal management ---
function closeModal() {
  modalOverlay.classList.add('hidden');
  editingId = null;
  listEditData = [];
  noteForm.reset();
  noteId.value = '';
  noteReminder.value = '';
  reminderClear.classList.add('hidden');
  // Reset type to note
  setNoteType('note');
}

function setNoteType(type) {
  const isNote = type === 'note';
  typeNoteBtn.classList.toggle('active', isNote);
  typeListBtn.classList.toggle('active', !isNote);
  contentGroup.classList.toggle('hidden', !isNote);
  listGroup.classList.toggle('hidden', isNote);
}

typeNoteBtn.addEventListener('click', () => setNoteType('note'));
typeListBtn.addEventListener('click', () => setNoteType('list'));

function renderColorPicker(selectedColor) {
  colorPicker.innerHTML = '';
  Object.entries(COLORS).forEach(([key, cfg]) => {
    const dot = document.createElement('button');
    dot.type = 'button';
    dot.className = 'color-dot' + (key === selectedColor ? ' active' : '');
    dot.dataset.color = key;
    dot.style.background = cfg.bg;
    dot.style.borderColor = cfg.border;
    dot.addEventListener('click', () => {
      colorPicker.querySelectorAll('.color-dot').forEach(d => d.classList.remove('active'));
      dot.classList.add('active');
    });
    colorPicker.appendChild(dot);
  });
}

function renderListEditor(items) {
  listEditData = (items || []).map(item => ({ ...item }));
  renderListItems();
}

function renderListItems() {
  listItems.innerHTML = '';
  listEditData.forEach((item, idx) => {
    const row = document.createElement('div');
    row.className = 'list-edit-row';
    row.innerHTML = `
      <span class="list-edit-check">${item.checked ? '☑' : '☐'}</span>
      <input type="text" class="list-edit-input" value="${escapeHtml(item.text)}" placeholder="List item..." data-idx="${idx}" />
      <button type="button" class="list-edit-del" data-idx="${idx}">✕</button>
    `;
    // Toggle check
    row.querySelector('.list-edit-check').addEventListener('click', () => {
      listEditData[idx].checked = !listEditData[idx].checked;
      renderListItems();
    });
    // Input change
    row.querySelector('.list-edit-input').addEventListener('input', (e) => {
      listEditData[idx].text = e.target.value;
    });
    // Input enter → new item
    row.querySelector('.list-edit-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        listEditData.splice(idx + 1, 0, { text: '', checked: false });
        renderListItems();
        // Focus the new input
        const inputs = listItems.querySelectorAll('.list-edit-input');
        if (inputs[idx + 1]) inputs[idx + 1].focus();
      }
    });
    // Delete
    row.querySelector('.list-edit-del').addEventListener('click', () => {
      listEditData.splice(idx, 1);
      renderListItems();
    });
    listItems.appendChild(row);
  });
}

addItemBtn.addEventListener('click', () => {
  listEditData.push({ text: '', checked: false });
  renderListItems();
  const inputs = listItems.querySelectorAll('.list-edit-input');
  if (inputs.length) inputs[inputs.length - 1].focus();
});

// --- Open modal for add/edit ---
function openAdd() {
  editingId = null;
  noteForm.reset();
  noteId.value = '';
  noteContent.value = '';
  noteReminder.value = '';
  reminderClear.classList.add('hidden');
  notePinned.checked = false;
  setNoteType('note');
  renderColorPicker('default');
  renderListEditor([]);
  modalOverlay.classList.remove('hidden');
  noteTitle.focus();
}

function openEdit(id) {
  const note = notes.find(n => n.id === id);
  if (!note) return;
  editingId = id;
  noteId.value = id;
  noteTitle.value = note.title || '';
  setNoteType(note.type || 'note');
  if ((note.type || 'note') === 'list') {
    renderListEditor(note.listItems || []);
    noteContent.value = '';
  } else {
    noteContent.value = note.content || '';
    renderListEditor([]);
  }
  renderColorPicker(note.color || 'default');
  noteLabels.value = (note.labels || []).join(', ');
  notePinned.checked = !!note.pinned;
  if (note.reminder) {
    const d = new Date(note.reminder * 1000);
    const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    noteReminder.value = local;
    reminderClear.classList.remove('hidden');
  } else {
    noteReminder.value = '';
    reminderClear.classList.add('hidden');
  }
  modalOverlay.classList.remove('hidden');
  noteTitle.focus();
}

reminderClear.addEventListener('click', () => {
  noteReminder.value = '';
  reminderClear.classList.add('hidden');
});

// --- Submit handler ---
noteForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const id = noteId.value || undefined;
  const type = typeNoteBtn.classList.contains('active') ? 'note' : 'list';
  const title = noteTitle.value.trim() || 'Untitled';
  const content = type === 'note' ? noteContent.value.trim() : '';
  const colorEl = colorPicker.querySelector('.color-dot.active');
  const color = colorEl ? colorEl.dataset.color : 'default';
  const labels = noteLabels.value.trim()
    ? noteLabels.value.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
    : [];
  const pinned = notePinned.checked;
  const reminderStr = noteReminder.value;

  let reminder = null;
  if (reminderStr) {
    const d = new Date(reminderStr);
    reminder = Math.floor(d.getTime() / 1000);
  }

  const listItems = type === 'list'
    ? listEditData.filter(item => item.text.trim()).map(item => ({
        text: item.text.trim(),
        checked: !!item.checked,
      }))
    : [];

  const existing = id ? notes.find(n => n.id === id) : null;

  const noteData = {
    id,
    type,
    title,
    content,
    listItems,
    color,
    pinned,
    archived: existing ? existing.archived : false,
    reminder,
    labels,
    created_at: existing ? existing.created_at : undefined,
  };

  try {
    const saved = await Nostr.saveNote(noteData);
    closeModal();
    await refreshNotes();
    showToast(id ? 'Updated' : 'Created', 1500);
  } catch (err) {
    showToast('Failed to save: ' + err.message, 3000);
  }
});

modalCancel.addEventListener('click', closeModal);
modalOverlay.addEventListener('click', (e) => {
  if (e.target === modalOverlay) closeModal();
});

// --- Archive toggle ---
archiveBtn.addEventListener('click', () => {
  showArchived = !showArchived;
  activeLabel = 'all';
  searchInput.value = '';
  searchQuery = '';
  searchClear.classList.remove('visible');
  archiveBtn.textContent = showArchived ? '📝' : '📦';
  renderLabels();
  renderNotes();
});

// --- Search ---
searchInput.addEventListener('input', () => {
  searchQuery = searchInput.value.trim();
  searchClear.classList.toggle('visible', searchQuery.length > 0);
  renderNotes();
});

searchClear.addEventListener('click', () => {
  searchInput.value = '';
  searchQuery = '';
  searchClear.classList.remove('visible');
  renderNotes();
});

// --- Login ---
async function handleLogin(nsec) {
  nsecLoginBtn.disabled = true;
  extLoginBtn.disabled = true;
  createBtn.disabled = true;
  loginError.classList.add('hidden');

  try {
    const { npub } = Nostr.login(nsec);
    pubkeyDisplay.textContent = npub.slice(0, 12) + '…';

    const connected = await Nostr.connect();
    if (!connected) {
      loginError.textContent = 'Could not connect to relay. Is it running?';
      loginError.classList.remove('hidden');
      return;
    }

    sessionStorage.setItem('nostrkeep_nsec', nsec);
    loginScreen.classList.add('hidden');
    appScreen.classList.remove('hidden');

    renderLabels();
    await refreshNotes();
  } catch (e) {
    loginError.textContent = e.message || 'Login failed';
    loginError.classList.remove('hidden');
  }
  nsecLoginBtn.disabled = false;
  extLoginBtn.disabled = false;
  createBtn.disabled = false;
}

nsecInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') nsecLoginBtn.click();
});

nsecLoginBtn.addEventListener('click', () => {
  const nsec = nsecInput.value.trim();
  if (!nsec) {
    loginError.textContent = 'Please enter your nsec';
    loginError.classList.remove('hidden');
    return;
  }
  handleLogin(nsec);
});

// --- Extension login ---
extLoginBtn.addEventListener('click', async () => {
  nsecLoginBtn.disabled = true;
  extLoginBtn.disabled = true;
  createBtn.disabled = true;
  loginError.classList.add('hidden');

  try {
    const { npub } = await Nostr.loginWithExtension();
    pubkeyDisplay.textContent = npub.slice(0, 12) + '…';

    const connected = await Nostr.connect();
    if (!connected) {
      loginError.textContent = 'Could not connect to relay. Is it running?';
      loginError.classList.remove('hidden');
      nsecLoginBtn.disabled = false;
      extLoginBtn.disabled = false;
      createBtn.disabled = false;
      return;
    }

    loginScreen.classList.add('hidden');
    appScreen.classList.remove('hidden');

    renderLabels();
    await refreshNotes();
  } catch (e) {
    loginError.textContent = e.message || 'Extension login failed';
    loginError.classList.remove('hidden');
  }
  nsecLoginBtn.disabled = false;
  extLoginBtn.disabled = false;
  createBtn.disabled = false;
});

// --- Create new account ---
const keyModalOverlay = $('#key-modal-overlay');
const keyModalNpub = $('#key-modal-npub');
const keyModalNsec = $('#key-modal-nsec');
const keyModalCopy = $('#key-modal-copy');
const keyModalCloseBtn = $('#key-modal-close-btn');

createBtn.addEventListener('click', async () => {
  nsecLoginBtn.disabled = true;
  extLoginBtn.disabled = true;
  createBtn.disabled = true;
  loginError.classList.add('hidden');

  try {
    const { npub, nsec } = Nostr.createAccount();
    keyModalNpub.textContent = npub;
    keyModalNsec.textContent = nsec;
    keyModalOverlay.classList.remove('hidden');
  } catch (e) {
    loginError.textContent = e.message || 'Failed to create account';
    loginError.classList.remove('hidden');
  }
  nsecLoginBtn.disabled = false;
  extLoginBtn.disabled = false;
  createBtn.disabled = false;
});

keyModalCopy.addEventListener('click', async () => {
  const nsec = keyModalNsec.textContent;
  if (!nsec) return;
  try {
    await navigator.clipboard.writeText(nsec);
    keyModalCopy.textContent = '✓ Copied!';
    setTimeout(() => { keyModalCopy.textContent = '📋 Copy nsec'; }, 2000);
  } catch {
    showToast('Could not copy to clipboard', 2000);
  }
});

keyModalCloseBtn.addEventListener('click', async () => {
  keyModalOverlay.classList.add('hidden');
  pubkeyDisplay.textContent = (Nostr.getNpub() || '').slice(0, 12) + '…';

  const connected = await Nostr.connect();
  if (!connected) {
    loginError.textContent = 'Could not connect to relay. Is it running?';
    loginError.classList.remove('hidden');
    return;
  }

  loginScreen.classList.add('hidden');
  appScreen.classList.remove('hidden');
  renderLabels();
  await refreshNotes();
});

// --- Logout ---
logoutBtn.addEventListener('click', () => {
  sessionStorage.removeItem('nostrkeep_nsec');
  Nostr.logout();
  notes = [];
  appScreen.classList.add('hidden');
  loginScreen.classList.remove('hidden');
  nsecInput.value = '';
  loginError.classList.add('hidden');
  showToast('Logged out', 1500);
});

// --- Auto-login ---
if (cachedNsec) {
  handleLogin(cachedNsec);
}

// --- FAB ---
addBtn.addEventListener('click', openAdd);

// --- Keyboard shortcuts ---
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (!modalOverlay.classList.contains('hidden')) closeModal();
    if (!confirmOverlay.classList.contains('hidden')) {
      pendingDeleteId = null;
      confirmOverlay.classList.add('hidden');
    }
  }
});
