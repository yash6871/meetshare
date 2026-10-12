// MeetShare server: authentication, signaling (rooms, host controls, chat) and the Groq AI proxy.
// Audio, video and screens travel directly between peers over WebRTC; no media passes through this server.
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env"), override: true, quiet: true });
const fs = require("fs");
const express = require("express");
const http = require("http");
const crypto = require("crypto");
const { promisify } = require("util");
const { WebSocketServer } = require("ws");

const scrypt = promisify(crypto.scrypt);

const PORT = process.env.PORT || 3000;
const MAX_PEERS = Number(process.env.MAX_PEERS || 6); // P2P mesh works best with 4-6 participants
const FLAGS = ["sharing", "muted", "cam", "hand", "rec"];
const EMOJIS = ["👍", "👏", "❤️", "😂", "😮", "🎉"];
const SESSION_DAYS = 7;
const COOKIE = "ms_session";
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");

// ================= Storage (users + sessions + meetings) =================
// If DATABASE_URL is set (Neon / Supabase / Render Postgres) data lives in Postgres and survives restarts and redeploys.
// Without it we fall back to local JSON files (fine for localhost, but Render's free disk is wiped on every restart).
const DATABASE_URL = process.env.DATABASE_URL;
let pool = null;
if (DATABASE_URL) {
  const { Pool } = require("pg");
  pool = new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 3 });
  pool.on("error", (e) => console.error("DB pool error:", e.message));
} else {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
const fileFor = (name) => path.join(DATA_DIR, `${name}.json`);

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}
function writeJson(file, data) { // atomic write: never leaves a half-written file behind
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

async function loadStore(name) {
  if (!pool) return readJson(fileFor(name), {});
  const r = await pool.query("SELECT value FROM kv WHERE key = $1", [name]);
  return r.rows[0] ? r.rows[0].value : {};
}
const writeChain = {}; // per-key queue so writes never land out of order
function persist(name, obj) {
  if (!pool) { writeJson(fileFor(name), obj); return Promise.resolve(); }
  const json = JSON.stringify(obj);
  const run = () => pool.query(
    "INSERT INTO kv (key, value) VALUES ($1, $2::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
    [name, json]
  ).catch((e) => console.error(`DB save failed (${name}):`, e.message));
  writeChain[name] = (writeChain[name] || Promise.resolve()).then(run);
  return writeChain[name];
}

const users = new Map(); // email -> user
const sessions = new Map(); // sha256(token) -> { uid(email), exp }
const meetings = new Map(); // code -> { owner, createdAt, lastUsed }
const saveMeetings = () => persist("meetings", Object.fromEntries(meetings));
const MEETING_TTL = 7 * 864e5;
const saveUsers = () => persist("users", Object.fromEntries(users));
const saveSessions = () => persist("sessions", Object.fromEntries(sessions));

async function initStore() {
  if (pool) await pool.query("CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value JSONB NOT NULL)");
  for (const [name, map] of [["users", users], ["sessions", sessions], ["meetings", meetings]]) {
    Object.entries(await loadStore(name)).forEach(([k, v]) => map.set(k, v));
  }
  console.log(`Storage: ${pool ? "Postgres" : "local JSON files"} | users: ${users.size}, sessions: ${sessions.size}`);
}

// ================= Auth helpers =================
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
const DUMMY_SALT = crypto.randomBytes(16);

async function hashPassword(password, salt) {
  return (await scrypt(password, salt, 64)).toString("hex");
}

function parseCookies(header = "") {
  const out = {};
  header.split(";").forEach((p) => {
    const i = p.indexOf("=");
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}

function userFromRequest(req) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (!token) return null;
  const s = sessions.get(sha(token));
  if (!s || s.exp < Date.now()) return null;
  return users.get(s.uid) || null;
}

function createSession(req, res, email) {
  const token = crypto.randomBytes(32).toString("base64url");
  sessions.set(sha(token), { uid: email, exp: Date.now() + SESSION_DAYS * 864e5 });
  saveSessions();
  const secure = req.secure || process.env.COOKIE_SECURE === "true";
  res.setHeader("Set-Cookie", `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 86400}${secure ? "; Secure" : ""}`);
}

const publicUser = (u) => ({ name: u.name, email: u.email });

// Simple in-memory limiter: key -> timestamps
const buckets = new Map();
function hit(key, max, windowMs) {
  const now = Date.now();
  const arr = (buckets.get(key) || []).filter((t) => now - t < windowMs);
  arr.push(now);
  buckets.set(key, arr);
  return arr.length > max;
}
const peek = (key, max, windowMs) => (buckets.get(key) || []).filter((t) => Date.now() - t < windowMs).length >= max;
setInterval(() => {
  buckets.clear();
  const now = Date.now();
  let changed = false;
  sessions.forEach((s, k) => { if (s.exp < now) { sessions.delete(k); changed = true; } });
  if (changed) saveSessions();
  let mchanged = false;
  meetings.forEach((m, k) => { if (now - m.lastUsed > MEETING_TTL) { meetings.delete(k); mchanged = true; } });
  if (mchanged) saveMeetings();
}, 10 * 60 * 1000).unref();

// ================= Meeting codes =================
// Accepts a bare code or a full invite link and returns a clean code ("" if invalid).
function normalizeCode(v) {
  let c = String(v || "").trim();
  const m = c.match(/[?&]room=([^&#\s]+)/i);
  if (m) { try { c = decodeURIComponent(m[1]); } catch { c = m[1]; } }
  c = c.toLowerCase();
  return /^[a-z0-9-]{3,40}$/.test(c) ? c : "";
}
function newMeetingCode() {
  const L = "abcdefghijkmnpqrstuvwxyz";
  const part = (n) => Array.from({ length: n }, () => L[crypto.randomInt(L.length)]).join("");
  for (;;) { const c = `${part(3)}-${part(4)}-${part(3)}`; if (!meetings.has(c)) return c; }
}

// ================= Groq AI =================
const GROQ_BASE = process.env.GROQ_BASE_URL || "https://api.groq.com/openai/v1";
const PREFERRED_MODEL = (process.env.GROQ_MODEL || "openai/gpt-oss-120b").trim();
// llama-3.3-70b-versatile was decommissioned by Groq on 2026-08-16. These are tried in order if the preferred model is unavailable.
const FALLBACK_MODELS = ["openai/gpt-oss-120b", "openai/gpt-oss-20b"];
const groqKey = () => (process.env.GROQ_API_KEY || "").trim().replace(/^["']|["']$/g, "");

let groqState = { checkedAt: 0, status: "unknown", model: PREFERRED_MODEL, detail: "" };

// Verifies the API key and that the model is live. Falls back automatically if the preferred model is gone.
async function checkGroq(force = false) {
  if (!force && Date.now() - groqState.checkedAt < 60000) return groqState;
  const done = (status, model, detail = "") => (groqState = { checkedAt: Date.now(), status, model, detail });
  const key = groqKey();
  if (!key) return done("no_key", PREFERRED_MODEL, "GROQ_API_KEY is not set.");
  try {
    const r = await fetch(`${GROQ_BASE}/models`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(8000) });
    if (r.status === 401) return done("invalid_key", PREFERRED_MODEL, "Groq rejected the API key.");
    if (!r.ok) return done("error", PREFERRED_MODEL, `Groq returned HTTP ${r.status}.`);
    const ids = ((await r.json()).data || []).map((m) => m.id);
    const pick = [PREFERRED_MODEL, ...FALLBACK_MODELS].find((id) => ids.includes(id));
    if (!pick) return done("no_model", PREFERRED_MODEL, `Model "${PREFERRED_MODEL}" is not available on your account.`);
    return done("ok", pick, pick !== PREFERRED_MODEL ? `"${PREFERRED_MODEL}" is unavailable; using "${pick}".` : "");
  } catch (e) {
    return done("unreachable", PREFERRED_MODEL, "Could not reach Groq.");
  }
}

const AI_ERRORS = {
  no_key: "The AI service is not configured. Set GROQ_API_KEY in the .env file and restart the server.",
  invalid_key: "The Groq API key was rejected. Create a new key at console.groq.com/keys and restart the server.",
  no_model: "The configured AI model is not available. Set GROQ_MODEL to a model that is live on Groq.",
  unreachable: "The AI service could not be reached. Please try again shortly.",
  error: "The AI service returned an error. Please try again shortly.",
};

const SYSTEM_PROMPT = `You are "MeetShare Copilot", an AI assistant inside a live video meeting.
You receive the meeting context (participants, speech captions and chat transcript) below.
Rules:
- Reply in the same language the user writes in.
- Be concise and practical. Use short bullets for summaries and action items.
- Base answers on the transcript. If something is not in it, say so clearly. Never invent things people said.
- The transcript only contains people who turned on live captions, plus chat messages, so it can be incomplete.`;

// ================= HTTP app =================
const app = express();
if (process.env.TRUST_PROXY) app.set("trust proxy", Number(process.env.TRUST_PROXY) || 1); // set when deployed behind Render/Railway/Nginx
app.disable("x-powered-by");
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader("Permissions-Policy", "camera=(self), microphone=(self), display-capture=(self)");
  res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: blob:; media-src 'self' blob: mediastream:; connect-src 'self' ws: wss:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  next();
});
app.use(express.json({ limit: "300kb" }));

// CSRF defence for state-changing requests: JSON only, and Origin must match this host when present.
function sameOrigin(req) {
  const o = req.headers.origin;
  if (!o) return true;
  try { return new URL(o).host === req.headers.host; } catch { return false; }
}
app.use("/api", (req, res, next) => {
  if (req.method !== "GET" && (!sameOrigin(req) || !req.is("application/json"))) return res.status(403).json({ error: "Request blocked." });
  next();
});

app.use(express.static(path.join(__dirname, "public")));

// ---------- Auth routes ----------
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;

app.get("/api/auth/me", (req, res) => {
  const u = userFromRequest(req);
  res.json({ user: u ? publicUser(u) : null });
});

app.post("/api/auth/signup", async (req, res) => {
  if (hit(`signup:${req.ip}`, 10, 60 * 60 * 1000)) return res.status(429).json({ error: "Too many sign-up attempts. Please try again later." });
  const b = req.body || {};
  const name = String(b.name || "").trim().replace(/\s+/g, " ");
  const email = String(b.email || "").trim().toLowerCase();
  const password = String(b.password || "");
  if (name.length < 2 || name.length > 30) return res.status(400).json({ error: "Name must be between 2 and 30 characters." });
  if (!EMAIL_RE.test(email) || email.length > 120) return res.status(400).json({ error: "Please enter a valid email address." });
  if (password.length < 8 || password.length > 128) return res.status(400).json({ error: "Password must be between 8 and 128 characters." });
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return res.status(400).json({ error: "Password must include at least one letter and one number." });
  if (password.toLowerCase() === email) return res.status(400).json({ error: "Password must not be the same as your email." });
  if (users.has(email)) return res.status(409).json({ error: "An account with this email already exists. Please sign in." });

  const salt = crypto.randomBytes(16);
  const user = { id: crypto.randomUUID(), email, name, salt: salt.toString("hex"), hash: await hashPassword(password, salt), createdAt: Date.now() };
  if (users.has(email)) return res.status(409).json({ error: "An account with this email already exists. Please sign in." }); // re-check after the async hash
  users.set(email, user);
  await saveUsers(); // make sure the account is really stored before we answer
  createSession(req, res, email);
  res.json({ user: publicUser(user) });
});

app.post("/api/auth/login", async (req, res) => {
  const email = String((req.body || {}).email || "").trim().toLowerCase();
  const password = String((req.body || {}).password || "");
  const key = `login:${req.ip}:${email}`;
  if (peek(key, 5, 15 * 60 * 1000) || peek(`login-ip:${req.ip}`, 30, 15 * 60 * 1000)) {
    return res.status(429).json({ error: "Too many failed attempts. Please wait 15 minutes and try again." });
  }
  const user = users.get(email);
  // Always run the hash so response time does not reveal whether the account exists.
  const hash = await hashPassword(password.slice(0, 128), user ? Buffer.from(user.salt, "hex") : DUMMY_SALT);
  const ok = user && crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(user.hash, "hex"));
  if (!ok) {
    hit(key, 5, 15 * 60 * 1000);
    hit(`login-ip:${req.ip}`, 30, 15 * 60 * 1000);
    return res.status(401).json({ error: "Invalid email or password." });
  }
  buckets.delete(key);
  createSession(req, res, email);
  res.json({ user: publicUser(user) });
});

app.post("/api/auth/logout", (req, res) => {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (token && sessions.delete(sha(token))) saveSessions();
  res.setHeader("Set-Cookie", `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
  res.json({ ok: true });
});

// Everything below /api (except auth) needs a signed-in user.
function requireAuth(req, res, next) {
  const u = userFromRequest(req);
  if (!u) return res.status(401).json({ error: "Please sign in to continue." });
  req.user = u;
  next();
}

app.get("/api/health", requireAuth, async (_req, res) => {
  const s = await checkGroq();
  res.json({ ai: s.status === "ok", status: s.status, model: s.model, detail: s.detail });
});

app.post("/api/meetings", requireAuth, (req, res) => {
  if (hit(`meet:${req.user.email}`, 20, 60 * 60 * 1000)) return res.status(429).json({ error: "You have created too many meetings. Please try again later." });
  const code = newMeetingCode();
  meetings.set(code, { owner: req.user.email, createdAt: Date.now(), lastUsed: Date.now() });
  saveMeetings();
  res.json({ code });
});

app.post("/api/ai", requireAuth, async (req, res) => {
  if (hit(`ai:${req.user.email}`, 20, 60000)) return res.status(429).json({ error: "Too many requests. Please wait a moment (limit: 20 per minute)." });

  const body = req.body || {};
  const messages = (Array.isArray(body.messages) ? body.messages : [])
    .filter((m) => m && ["user", "assistant"].includes(m.role) && typeof m.content === "string")
    .slice(-10)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }));
  if (!messages.length || messages[messages.length - 1].role !== "user") return res.status(400).json({ error: "Bad request." });
  const context = String(body.context || "").slice(-15000);

  const state = await checkGroq();
  if (state.status !== "ok") return res.status(503).json({ error: AI_ERRORS[state.status] || AI_ERRORS.error });

  const ctrl = new AbortController();
  res.on("close", () => ctrl.abort()); // the user pressed stop or closed the tab
  try {
    const payload = {
      model: state.model,
      stream: true,
      temperature: 0.4,
      max_tokens: 1500,
      messages: [{ role: "system", content: `${SYSTEM_PROMPT}\n\n--- MEETING CONTEXT ---\n${context}` }, ...messages],
    };
    if (state.model.startsWith("openai/gpt-oss")) payload.reasoning_effort = "low"; // keeps replies fast
    const r = await fetch(`${GROQ_BASE}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${groqKey()}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    if (!r.ok) {
      const detail = (await r.text()).slice(0, 400);
      console.error("Groq error", r.status, detail);
      groqState.checkedAt = 0; // re-verify key and model on the next request
      const msg = r.status === 401 ? AI_ERRORS.invalid_key
        : (r.status === 404 || (r.status === 400 && /model/i.test(detail))) ? `The AI model "${state.model}" is not available right now. The server will re-check and switch models automatically; please try again.`
        : r.status === 429 ? "Groq rate limit reached. Please try again in a moment."
        : `The AI service returned an error (${r.status}).`;
      return res.status(502).json({ error: msg });
    }
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    for await (const chunk of r.body) res.write(chunk);
    res.end();
  } catch (e) {
    if (e.name === "AbortError") return;
    console.error("AI proxy error", e.message);
    if (!res.headersSent) res.status(502).json({ error: AI_ERRORS.unreachable });
    else res.end();
  }
});

app.use("/api", (_req, res) => res.status(404).json({ error: "Not found." }));

// ================= Signaling (WebSocket) =================
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });

// Only signed-in users from this site's own origin may open a socket.
server.on("upgrade", (req, socket, head) => {
  const reject = (code, text) => { socket.write(`HTTP/1.1 ${code} ${text}\r\nConnection: close\r\n\r\n`); socket.destroy(); };
  if (!sameOrigin(req)) return reject(403, "Forbidden");
  const user = userFromRequest(req);
  if (!user) return reject(401, "Unauthorized");
  wss.handleUpgrade(req, socket, head, (ws) => { ws.user = user; wss.emit("connection", ws, req); });
});

const rooms = new Map(); // roomName -> { host, locked, peers: Map(id -> peer) }

const send = (ws, msg) => ws.readyState === 1 && ws.send(JSON.stringify(msg));
const toOthers = (room, exceptId, msg) => room.peers.forEach((p, id) => id !== exceptId && send(p.ws, msg));
const toAll = (room, msg) => room.peers.forEach((p) => send(p.ws, msg));
const publicPeer = (id, p) => ({ id, name: p.name, sharing: p.sharing, muted: p.muted, cam: p.cam, hand: p.hand, rec: p.rec });
const SIGNAL_KINDS = new Set(["media", "screen-out", "screen-in"]);

wss.on("connection", (ws) => {
  let me = null;
  let flood = [];

  ws.on("message", (raw) => {
    const now = Date.now();
    flood = flood.filter((t) => now - t < 10000);
    if (flood.push(now) > 400) return ws.close(); // connection is flooding the server
    let m;
    try { m = JSON.parse(raw); } catch { return; }

    if (m.type === "join") {
      if (me) return;
      const roomName = normalizeCode(m.room);
      const name = ws.user.name; // the display name always comes from the signed-in account
      if (!roomName || !meetings.has(roomName)) return send(ws, { type: "not-found" }); // meetings must be created first
      meetings.get(roomName).lastUsed = Date.now();
      if (!rooms.has(roomName)) rooms.set(roomName, { host: null, locked: false, peers: new Map() });
      const room = rooms.get(roomName);
      if (room.locked && room.peers.size > 0) return send(ws, { type: "locked-room" });
      if (room.peers.size >= MAX_PEERS) return send(ws, { type: "full", max: MAX_PEERS });

      const id = crypto.randomUUID().slice(0, 8);
      me = { id, roomName };
      if (!room.host) room.host = id;

      const existing = [...room.peers].map(([pid, p]) => publicPeer(pid, p));
      const peer = { ws, name, sharing: false, muted: true, cam: false, hand: false, rec: false };
      room.peers.set(id, peer);
      send(ws, { type: "joined", id, name, host: room.host, locked: room.locked, peers: existing });
      toOthers(room, id, { type: "peer-joined", ...publicPeer(id, peer) });
      return;
    }

    if (!me) return;
    const room = rooms.get(me.roomName);
    if (!room) return;
    const self = room.peers.get(me.id);
    const isHost = me.id === room.host;

    switch (m.type) {
      case "signal": {
        const target = room.peers.get(m.to);
        if (target && SIGNAL_KINDS.has(m.kind)) send(target.ws, { type: "signal", from: me.id, kind: m.kind, data: m.data });
        break;
      }
      case "chat":
        toAll(room, { type: "chat", from: me.id, name: self.name, text: String(m.text || "").slice(0, 500), ts: Date.now() });
        break;
      case "state":
        FLAGS.forEach((f) => { if (typeof m[f] === "boolean") self[f] = m[f]; });
        toOthers(room, me.id, { type: "state", ...publicPeer(me.id, self) });
        break;
      case "caption":
        toOthers(room, me.id, { type: "caption", from: me.id, name: self.name, text: String(m.text || "").slice(0, 300), ts: Date.now() });
        break;
      case "reaction":
        if (EMOJIS.includes(m.emoji)) toAll(room, { type: "reaction", from: me.id, name: self.name, emoji: m.emoji });
        break;
      // ---- host only ----
      case "stop-share":
        if (isHost && room.peers.has(m.target)) send(room.peers.get(m.target).ws, { type: "stop-share" });
        break;
      case "mute-all":
        if (isHost) toOthers(room, me.id, { type: "mute-request" });
        break;
      case "lock":
        if (isHost) { room.locked = !!m.on; toAll(room, { type: "locked", on: room.locked }); }
        break;
      case "kick":
        if (isHost && m.target !== me.id && room.peers.has(m.target)) {
          const t = room.peers.get(m.target);
          send(t.ws, { type: "kicked" });
          t.ws.close();
        }
        break;
      case "end":
        if (isHost) {
          toOthers(room, me.id, { type: "ended" });
          room.peers.forEach((p, id) => id !== me.id && p.ws.close());
        }
        break;
    }
  });

  ws.on("close", () => {
    if (!me) return;
    const room = rooms.get(me.roomName);
    if (!room) return;
    room.peers.delete(me.id);
    if (room.peers.size === 0) return rooms.delete(me.roomName);
    if (room.host === me.id) room.host = room.peers.keys().next().value;
    toAll(room, { type: "peer-left", id: me.id, host: room.host });
  });
});

// Hosts like Render/Heroku drop idle websockets
setInterval(() => wss.clients.forEach((c) => c.readyState === 1 && c.ping()), 30000).unref();

initStore().then(() => {
  server.listen(PORT, async () => {
    console.log(`MeetShare running on http://localhost:${PORT}`);
    const s = await checkGroq(true);
    console.log(s.status === "ok" ? `AI ready: ${s.model}${s.detail ? ` (${s.detail})` : ""}` : `AI NOT ready: ${s.detail}`);
  });
}).catch((e) => { console.error("Storage init failed:", e); process.exit(1); });
