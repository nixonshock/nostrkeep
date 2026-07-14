/**
 * nostr.js — Nostr Keep relay ops + NIP-44 encryption
 */
import {
  SimplePool,
  generateSecretKey,
  getPublicKey,
  nip19,
  nip44,
  finalizeEvent,
} from 'nostr-tools';

// --- Config ---
function getRelay() {
  return localStorage.getItem('nostrkeep_relay')
    || import.meta.env.VITE_KEEP_RELAY_URL
    || 'ws://localhost:8080';
}
const NOTE_KIND = 30050;
const D_TAG_PREFIX = 'nostrkeep:note:';

let pool = null;
let secretKey = null;
let pubkey = null;
let extensionMode = false;

// --- NIP-44 helpers ---
function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2)
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  return bytes;
}

function getConvKey(secBytes, pubkeyHex) {
  return nip44.v2.utils.getConversationKey(secBytes, pubkeyHex);
}

function encrypt(data, convKey) {
  return nip44.v2.encrypt(JSON.stringify(data), convKey);
}

function decrypt(ciphertext, convKey) {
  return JSON.parse(nip44.v2.decrypt(ciphertext, convKey));
}

// --- Keep data model ---
const NOTE_COLORS = [
  'default', 'red', 'orange', 'yellow', 'green',
  'teal', 'blue', 'purple', 'pink', 'gray'
];

function makeNote(template) {
  const now = Math.floor(Date.now() / 1000);
  return {
    id: template.id || crypto.randomUUID(),
    type: 'note',
    title: template.title || '',
    content: template.content || '',
    listItems: template.listItems || [],
    color: template.color || 'default',
    pinned: !!template.pinned,
    archived: !!template.archived,
    reminder: template.reminder || null,
    labels: template.labels || [],
    created_at: template.created_at || now,
    updated_at: now,
  };
}

// --- Event creation ---
function createNoteEvent(note, convKey) {
  const encrypted = encrypt(note, convKey);
  const dTag = D_TAG_PREFIX + note.id;
  const tags = [['d', dTag]];
  // Add labels as searchable tags
  if (note.labels && note.labels.length > 0) {
    for (const label of note.labels) {
      tags.push(['t', label.toLowerCase().trim()]);
    }
  }
  const created_at = Math.floor(Date.now() / 1000);
  return { kind: NOTE_KIND, content: encrypted, tags, created_at };
}

// --- Sign & publish ---
function signAndPublish(template) {
  if (extensionMode && window.nostr) {
    return window.nostr.signEvent(template).then((signed) =>
      pool.publish([getRelay()], signed)
    );
  } else if (secretKey) {
    const event = finalizeEvent(template, secretKey);
    return pool.publish([getRelay()], event);
  }
  return Promise.reject(new Error('No signing method available'));
}

// --- Relay ops ---
export async function connect() {
  if (!pool) pool = new SimplePool();
  try {
    await pool.ensureRelay(getRelay());
    return true;
  } catch (e) {
    console.error('Relay connection failed:', e);
    return false;
  }
}

export function login(nsec) {
  let decoded;
  try {
    decoded = nip19.decode(nsec);
  } catch (e) {
    throw new Error('Invalid nsec format');
  }
  if (decoded.type !== 'nsec') throw new Error('Expected an nsec key');
  secretKey = decoded.data;
  pubkey = getPublicKey(secretKey);
  return { pubkey, npub: nip19.npubEncode(pubkey) };
}

export function loginWithExtension() {
  if (!window.nostr) throw new Error('No Nostr extension found');
  return window.nostr.getPublicKey().then((hex) => {
    pubkey = hex;
    extensionMode = true;
    secretKey = generateSecretKey(); // local session key for NIP-44
    return { pubkey, npub: nip19.npubEncode(pubkey) };
  });
}

export function createAccount() {
  const sk = generateSecretKey();
  const pk = getPublicKey(sk);
  const nsec = nip19.nsecEncode(sk);
  const npub = nip19.npubEncode(pk);
  secretKey = sk;
  pubkey = pk;
  return { pubkey, npub, nsec };
}

export function isLoggedIn() { return !!pubkey; }
export function getPubkey() { return pubkey; }
export function getNpub() { return pubkey ? nip19.npubEncode(pubkey) : ''; }

// --- Fetch all notes ---
export async function fetchNotes() {
  if (!pubkey || !pool) return [];

  const convKey = getConvKey(secretKey, pubkey);
  try {
    const events = await pool.querySync(
      [getRelay()],
      { kinds: [NOTE_KIND], authors: [pubkey] }
    );

    const notes = [];
    for (const ev of events) {
      try {
        const data = decrypt(ev.content, convKey);
        notes.push({
          ...data,
          id: data.id,
          type: data.type || 'note',
          title: data.title || '',
          content: data.content || '',
          listItems: data.listItems || [],
          color: NOTE_COLORS.includes(data.color) ? data.color : 'default',
          pinned: !!data.pinned,
          archived: !!data.archived,
          reminder: data.reminder || null,
          labels: data.labels || [],
          created_at: data.created_at || ev.created_at,
          updated_at: data.updated_at || ev.created_at,
          _event: {
            id: ev.id, pubkey: ev.pubkey, kind: ev.kind,
            created_at: ev.created_at, tags: ev.tags,
            content: ev.content, sig: ev.sig,
          },
        });
      } catch (e) {
        console.warn('Failed to decrypt note event:', ev.id);
      }
    }

    notes.sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0));
    return notes;
  } catch (e) {
    console.error('Failed to fetch notes:', e);
    return [];
  }
}

// --- Create / Update ---
export async function saveNote(noteData) {
  if (!pubkey || !pool) throw new Error('Not logged in');
  const note = makeNote(noteData);
  const convKey = getConvKey(secretKey, pubkey);
  const ev = createNoteEvent(note, convKey);
  await signAndPublish(ev);
  return note;
}

// --- Delete ---
export async function deleteNote(noteId) {
  if (!pubkey || !pool) throw new Error('Not logged in');
  const dTag = D_TAG_PREFIX + noteId;
  const ev = {
    kind: 5,
    content: '',
    tags: [['d', dTag], ['k', String(NOTE_KIND)]],
    created_at: Math.floor(Date.now() / 1000),
  };
  const signed = finalizeEvent(ev, secretKey);
  await pool.publish([getRelay()], signed);
}

// --- Real-time subscription ---
export function subscribeNotes(onEvent) {
  if (!pubkey || !pool) return null;
  const convKey = getConvKey(secretKey, pubkey);

  return pool.subscribeMany(
    [getRelay()],
    [{ kinds: [NOTE_KIND], authors: [pubkey] }],
    {
      onevent(ev) {
        try {
          const data = decrypt(ev.content, convKey);
          onEvent({
            ...data,
            id: data.id,
            type: data.type || 'note',
            title: data.title || '',
            content: data.content || '',
            listItems: data.listItems || [],
            color: NOTE_COLORS.includes(data.color) ? data.color : 'default',
            pinned: !!data.pinned,
            archived: !!data.archived,
            reminder: data.reminder || null,
            labels: data.labels || [],
            created_at: data.created_at || ev.created_at,
            updated_at: data.updated_at || ev.created_at,
            _event: {
              id: ev.id, pubkey: ev.pubkey, kind: ev.kind,
              created_at: ev.created_at, tags: ev.tags,
              content: ev.content, sig: ev.sig,
            },
          });
        } catch (e) { /* silent */ }
      },
    }
  );
}

// --- Logout ---
export function logout() {
  secretKey = null;
  pubkey = null;
  extensionMode = false;
  if (pool) {
    pool.close([getRelay()]);
    pool = null;
  }
}
