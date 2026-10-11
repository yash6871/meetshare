// ================= Config =================
// If participants on different networks (office Wi-Fi, mobile data) cannot connect, add a TURN server here.
const ICE = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    // { urls: "turn:YOUR_TURN_HOST:3478", username: "user", credential: "pass" },
  ],
};
const REACTIONS = ["👍", "👏", "❤️", "😂", "😮", "🎉"];
const $ = (id) => document.getElementById(id);

// ================= Icons =================
const IC = {
  mic: '<path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z"/><path d="M19 11a7 7 0 0 1-14 0M12 18v3"/>',
  micoff: '<path d="M15 9.3V6a3 3 0 0 0-5.9-.8M9 9v3a3 3 0 0 0 4.6 2.5"/><path d="M19 11a7 7 0 0 1-1 3.6M5 11a7 7 0 0 0 11 5.7M12 18v3"/><path d="M3 3l18 18"/>',
  video: '<rect x="3" y="6" width="13" height="12" rx="3"/><path d="M16 10.5l5-3v9l-5-3z"/>',
  videooff: '<path d="M16 11v-1l5-3v10M13 6H6a3 3 0 0 0-3 3v6a3 3 0 0 0 3 3h7a3 3 0 0 0 3-3v-1"/><path d="M3 3l18 18"/>',
  screen: '<rect x="3" y="4" width="18" height="12" rx="2.5"/><path d="M8 20h8M12 16v4"/>',
  cc: '<rect x="3" y="5" width="18" height="14" rx="3.5"/><path d="M10.5 10a2.2 2.2 0 1 0 0 4M17 10a2.2 2.2 0 1 0 0 4"/>',
  record: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3.2" fill="currentColor"/>',
  hand: '<path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V11M11 11V4a1.5 1.5 0 0 1 3 0v7M14 11V5.5a1.5 1.5 0 0 1 3 0V14c0 4-2.5 7-6 7-3 0-4.4-2-5.8-4.4L3.4 13.3a1.5 1.5 0 0 1 2.6-1.4L8 14.5"/>',
  smile: '<circle cx="12" cy="12" r="9"/><path d="M8 14s1.4 2.5 4 2.5 4-2.5 4-2.5M9 9.5h.01M15 9.5h.01"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.6a3.5 3.5 0 0 1 0 6.8M18.5 14.6A6.5 6.5 0 0 1 21.5 20"/>',
  chat: '<path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v10a1.5 1.5 0 0 1-1.5 1.5H10l-4.5 3.5V17h0A1.5 1.5 0 0 1 4 15.5z"/>',
  sparkles: '<path d="M11 3l1.9 5.6L18.5 10.5 12.9 12.4 11 18l-1.9-5.6L3.5 10.5l5.6-1.9z"/><path d="M19 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z"/>',
  leave: '<path d="M3 14.5c5-5 13-5 18 0l-2 3.2-3.4-1.6v-2.6a9 9 0 0 0-7.2 0v2.6L5 17.7z"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V6.5A2.5 2.5 0 0 0 13.5 4h-7A2.5 2.5 0 0 0 4 6.5v7A2.5 2.5 0 0 0 6.5 16H8"/>',
  send: '<path d="M4 12l16-8-6 16-2.5-6.5z"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
};
const icon = (n) => `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${IC[n] || ""}</svg>`;
document.querySelectorAll("[data-ic]").forEach((el) => (el.innerHTML = icon(el.dataset.ic)));
const setIcon = (id, name) => { $(id).querySelector(".ic").innerHTML = icon(name); };

// ================= State =================
let ws, myId, hostId, myName, roomName, user = null;
let locked = false, leaving = false, joinedAt = 0;
let micTrack = null, micStream = null, camTrack = null;
let muted = true, camOn = false, hand = false;
let screenStream = null, recorder = null;
let pinned = null, unread = 0, panelTab = null;
let capOn = false, recog = null;
const peers = new Map();      // id -> { id, name, sharing, muted, cam, hand, rec }
const mediaConns = new Map(); // peerId -> pc (mic + camera, both directions)
const screenOut = new Map();  // peerId -> pc (my screen -> that peer)
const screenIn = new Map();   // peerId -> pc (their screen -> me)
const tiles = new Map();      // id -> { el, video, av, nm }
const analysers = new Map();  // id -> { an, data }
const transcript = [];        // { t, name, text, kind } -> AI context

const wsSend = (o) => ws && ws.readyState === 1 && ws.send(JSON.stringify(o));
const sig = (to, kind, data) => wsSend({ type: "signal", to, kind, data });
const sendState = (o) => wsSend({ type: "state", ...o });
const chain = (pc, fn) => { pc._q = (pc._q || Promise.resolve()).then(fn).catch((e) => console.error(e)); };
const base = (n) => (n || "").replace(" (You)", "").trim();
const initials = (n) => (base(n).split(/\s+/).map((w) => w[0]).join("").slice(0, 2) || "?").toUpperCase();
const hue = (s) => { let h = 0; for (const c of base(s)) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
const grad = (s) => { const h = hue(s); return `linear-gradient(135deg, hsl(${h} 85% 58%), hsl(${(h + 55) % 360} 85% 42%))`; };
const fmtTime = (t) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const scrollDown = (el) => { el.scrollTop = el.scrollHeight; };

function toast(text) {
  const el = $("toast");
  el.textContent = text;
  el.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove("show"), 3200);
}

// ================= Local media (mic + camera) =================
const VIDEO = { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 24 } };

async function initMedia() {
  try {
    const s = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: VIDEO,
    });
    micTrack = s.getAudioTracks()[0];
    camTrack = s.getVideoTracks()[0];
    camOn = true;
  } catch {
    try { // camera unavailable or denied -> try microphone only
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      micTrack = s.getAudioTracks()[0];
    } catch { /* no devices available; joining without mic/camera is still allowed */ }
  }
  if (micTrack) { micTrack.enabled = false; micStream = new MediaStream([micTrack]); } // start muted
  muted = true;
  updateLobby();
}

async function setCam(on) {
  if (on) {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: VIDEO });
      camTrack = s.getVideoTracks()[0];
      camOn = true;
    } catch { toast("Camera not found or permission was denied"); return; }
  } else {
    camTrack?.stop(); camTrack = null; camOn = false; // also turns off the camera indicator light
  }
  pushCam();
  updateLobby();
  if (tiles.has(myId)) { updateSelfVideo(); updateTile(myId); }
  updateControls();
  sendState({ cam: camOn });
}

function toggleMic() {
  if (!micTrack) return toast("No microphone available");
  muted = !muted;
  micTrack.enabled = !muted;
  updateLobby();
  if (tiles.has(myId)) updateTile(myId);
  updateControls();
  sendState({ muted });
}

function pushCam() { // swap the camera track on all connections without renegotiating
  mediaConns.forEach((pc) => {
    const t = pc.getTransceivers().find((x) => x.receiver.track.kind === "video");
    if (t) t.sender.replaceTrack(camTrack).catch(console.error);
  });
}

// ================= Lobby =================
function updateLobby() {
  const nm = user ? user.name : "";
  $("pvVideo").srcObject = camTrack ? new MediaStream([camTrack]) : null;
  $("pvAvatar").hidden = !!camTrack;
  $("pvAvatar").style.background = grad(nm);
  $("pvAvatar").firstElementChild.textContent = initials(nm);
  setIcon("pvMic", muted || !micTrack ? "micoff" : "mic");
  setIcon("pvCam", camOn ? "video" : "videooff");
  $("pvMic").classList.toggle("off", muted || !micTrack);
  $("pvCam").classList.toggle("off", !camOn);
  $("pvMic").disabled = !micTrack;
}
$("pvMic").onclick = toggleMic;
$("pvCam").onclick = () => setCam(!camOn);
$("roomInput").value = new URLSearchParams(location.search).get("room") || ""; // invite link pre-fills the code; the user still chooses to join
const flash = sessionStorage.getItem("msg");
if (flash) { $("joinError").textContent = flash; sessionStorage.removeItem("msg"); }

// Accepts either a plain code or a full invite link.
function extractCode(v) {
  v = (v || "").trim();
  try { const r = new URL(v).searchParams.get("room"); if (r) return r.trim().toLowerCase(); } catch { /* not a URL */ }
  const m = v.match(/[?&]room=([^&#\s]+)/i);
  return (m ? decodeURIComponent(m[1]) : v).toLowerCase();
}
const joinError = (t) => ($("joinError").textContent = t);

function enterMeeting(code) {
  if (!user) return showAuth();
  myName = user.name;
  roomName = code;
  joinError("");
  const proto = location.protocol === "https:" ? "wss" : "ws";
  let joined = false;
  ws = new WebSocket(`${proto}://${location.host}`);
  ws.onopen = () => wsSend({ type: "join", room: roomName });
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.type === "joined") joined = true;
    onMessage(m);
  };
  ws.onclose = () => {
    if (leaving) return;
    if (!$("meeting").hidden) return leave("Connection lost");
    if (!joined && !$("joinError").textContent) {
      joinError("Unable to connect. Your session may have expired; please sign in again.");
      api("/api/auth/me").then((r) => { if (!r.user) { user = null; showAuth(); } }).catch(() => {});
    }
  };
}

// ---- join an existing meeting ----
$("joinForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const code = extractCode($("roomInput").value);
  if (!/^[a-z0-9-]{3,40}$/.test(code)) return joinError("Please enter a valid meeting code or invite link.");
  $("roomInput").value = code;
  enterMeeting(code);
});

// ---- create a new meeting, then share it before starting ----
let newCode = null;
$("createBtn").onclick = async () => {
  joinError("");
  $("createBtn").disabled = true;
  try {
    newCode = (await api("/api/meetings", {})).code;
    buildInvite($("inviteReady"), newCode);
    $("lobbyHome").hidden = true;
    $("lobbyReady").hidden = false;
  } catch (ex) {
    joinError(ex.message);
  } finally {
    $("createBtn").disabled = false;
  }
};
$("startBtn").onclick = () => enterMeeting(newCode);
$("readyBack").onclick = () => { $("lobbyReady").hidden = true; $("lobbyHome").hidden = false; joinError(""); };

// ---- invite block: copy link, copy code, share ----
async function copyText(text, input) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch { // clipboard API unavailable (e.g. plain http on another device): fall back to selection
    input.select();
    try { return document.execCommand("copy"); } catch { return false; }
  }
}
function buildInvite(el, code) {
  const link = `${location.origin}/?room=${encodeURIComponent(code)}`;
  const msg = `Join my MeetShare meeting: ${link} (meeting code: ${code})`;
  el.textContent = "";
  const row = (label, value) => {
    const wrap = document.createElement("div");
    wrap.className = "invrow";
    const l = document.createElement("span");
    l.textContent = label;
    const line = document.createElement("span");
    line.className = "row";
    const inp = document.createElement("input");
    inp.readOnly = true; inp.value = value;
    inp.setAttribute("aria-label", label);
    inp.onfocus = () => inp.select();
    const b = document.createElement("button");
    b.type = "button"; b.className = "ghost"; b.textContent = "Copy";
    b.onclick = async () => {
      b.textContent = (await copyText(value, inp)) ? "Copied" : "Press Ctrl+C";
      setTimeout(() => (b.textContent = "Copy"), 1800);
    };
    line.append(inp, b);
    wrap.append(l, line);
    return wrap;
  };
  const actions = document.createElement("div");
  actions.className = "invactions";
  if (navigator.share) {
    const s = document.createElement("button");
    s.type = "button"; s.textContent = "Share…";
    s.onclick = () => navigator.share({ title: "MeetShare meeting", text: msg, url: link }).catch(() => {});
    actions.appendChild(s);
  }
  const mk = (label, href) => { const a = document.createElement("a"); a.textContent = label; a.href = href; a.target = "_blank"; a.rel = "noopener noreferrer"; return a; };
  actions.append(
    mk("WhatsApp", `https://wa.me/?text=${encodeURIComponent(msg)}`),
    mk("Email", `mailto:?subject=${encodeURIComponent("Join my MeetShare meeting")}&body=${encodeURIComponent(msg)}`),
  );
  el.append(row("Invite link", link), row("Meeting code", code), actions);
}

// ================= Authentication =================
async function api(url, body) {
  const res = await fetch(url, body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `Request failed (${res.status})`), { status: res.status });
  return data;
}

let authMode = "signin";
function setAuthMode(mode) {
  authMode = mode;
  const up = mode === "signup";
  $("tabSignIn").classList.toggle("active", !up);
  $("tabSignUp").classList.toggle("active", up);
  $("nameField").hidden = !up;
  $("confirmField").hidden = !up;
  $("passHint").hidden = !up;
  $("authSubmit").textContent = up ? "Create account" : "Sign in";
  $("authPass").autocomplete = up ? "new-password" : "current-password";
  $("authError").textContent = "";
}
$("tabSignIn").onclick = () => setAuthMode("signin");
$("tabSignUp").onclick = () => setAuthMode("signup");
$("passToggle").onclick = () => {
  const show = $("authPass").type === "password";
  $("authPass").type = $("authPass2").type = show ? "text" : "password";
  $("passToggle").textContent = show ? "Hide" : "Show";
};

$("authForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = $("authEmail").value.trim();
  const password = $("authPass").value;
  const err = $("authError");
  err.textContent = "";
  if (!email || !password) return (err.textContent = "Please enter your email and password.");
  if (authMode === "signup") {
    if ($("authName").value.trim().length < 2) return (err.textContent = "Please enter your full name.");
    if (password !== $("authPass2").value) return (err.textContent = "Passwords do not match.");
  }
  $("authSubmit").disabled = true;
  try {
    const r = authMode === "signup"
      ? await api("/api/auth/signup", { name: $("authName").value.trim(), email, password })
      : await api("/api/auth/login", { email, password });
    $("authPass").value = $("authPass2").value = "";
    showLobby(r.user);
  } catch (ex) {
    err.textContent = ex.message;
  } finally {
    $("authSubmit").disabled = false;
  }
});

$("signOutBtn").onclick = async () => {
  try { await api("/api/auth/logout", {}); } catch { /* ignore */ }
  camTrack?.stop(); micTrack?.stop(); camTrack = micTrack = null; camOn = false; muted = true;
  mediaStarted = false;
  user = null;
  showAuth();
};

function showAuth() {
  $("lobby").hidden = true;
  $("auth").hidden = false;
  setAuthMode("signin");
}

let mediaStarted = false;
function showLobby(u) {
  user = u;
  $("auth").hidden = true;
  $("lobby").hidden = false;
  $("acctName").textContent = u.name;
  $("acctEmail").textContent = u.email;
  $("acctAvatar").textContent = initials(u.name);
  $("acctAvatar").style.background = grad(u.name);
  if (!mediaStarted) { mediaStarted = true; initMedia(); } // ask for camera/microphone only after sign-in
  updateLobby();
}

// On load: resume an existing session, otherwise show the sign-in screen.
api("/api/auth/me").then((r) => (r.user ? showLobby(r.user) : showAuth())).catch(() => showAuth());

// ================= Server messages =================
function onMessage(m) {
  switch (m.type) {
    case "full": $("joinError").textContent = `This meeting is full (maximum ${m.max} participants).`; ws.close(); break;
    case "not-found": joinError("Meeting not found. Check the code or invite link, or ask the host for a new one."); ws.close(); break;
    case "locked-room": $("joinError").textContent = "The host has locked this meeting."; ws.close(); break;
    case "joined": onJoined(m); break;
    case "peer-joined":
      peers.set(m.id, m);
      ensureTile(m.id); updateTile(m.id); renderPeers();
      toast(`${m.name} joined`);
      pushTranscript("•", `${m.name} joined`, "event");
      if (screenStream) openScreenOut(m.id);
      break;
    case "peer-left": {
      const p = peers.get(m.id);
      if (p) { toast(`${p.name} left`); pushTranscript("•", `${p.name} left`, "event"); }
      peers.delete(m.id);
      hostId = m.host;
      cleanupPeer(m.id);
      renderPeers(); updateRecBadge();
      break;
    }
    case "state": onPeerState(m); break;
    case "signal":
      if (m.kind === "media") onMedia(m.from, m.data);
      else if (m.kind === "screen-out") onScreenOut(m.from, m.data);
      else if (m.kind === "screen-in") onScreenIn(m.from, m.data);
      break;
    case "chat": addChat(m); break;
    case "caption": pushTranscript(m.name, m.text, "speech"); if (capOn) showCaption(m.name, m.text); break;
    case "reaction": floatReaction(m.emoji, m.from === myId ? "You" : m.name); break;
    case "locked": locked = m.on; $("lockBadge").hidden = !locked; updateControls(); toast(locked ? "Meeting locked" : "Meeting unlocked"); break;
    case "mute-request": if (!muted) toggleMic(); toast("The host muted everyone"); break;
    case "stop-share": stopShare(); toast("The host stopped your screen share"); break;
    case "kicked": leave("You were removed from the meeting by the host"); break;
    case "ended": leave("The host ended the meeting"); break;
  }
}

function onJoined(m) {
  myName = m.name || myName;
  myId = m.id; hostId = m.host; locked = m.locked;
  $("lobby").hidden = true;
  document.querySelector(".aurora").style.opacity = ".55";
  $("meeting").hidden = false;
  $("roomTitle").textContent = roomName;
  $("lockBadge").hidden = !locked;
  if (!navigator.mediaDevices.getDisplayMedia) $("shareBtn").hidden = true; // not available on mobile browsers
  joinedAt = Date.now();
  setInterval(tick, 1000); tick();

  ensureTile(myId, true);
  updateSelfVideo();
  m.peers.forEach((p) => { peers.set(p.id, p); ensureTile(p.id); updateTile(p.id); startMedia(p.id); });
  sendState({ muted, cam: camOn });
  if (micStream) watchAudio(myId, micStream);
  updateTile(myId); renderPeers(); updateControls(); updateRecBadge();
}

function onPeerState(m) {
  const old = peers.get(m.id);
  if (!old) return;
  if (m.sharing && !old.sharing) toast(`${old.name} is sharing their screen`);
  if (m.hand && !old.hand) toast(`✋ ${old.name} raised a hand`);
  if (m.rec && !old.rec) toast(`${old.name} started recording`);
  Object.assign(old, { sharing: m.sharing, muted: m.muted, cam: m.cam, hand: m.hand, rec: m.rec });
  updateTile(m.id); renderPeers(); updateRecBadge();
}

// ================= Mic + camera connections =================
function makeMediaPc(peerId, offerer) {
  const pc = new RTCPeerConnection(ICE);
  mediaConns.set(peerId, pc);
  pc.onicecandidate = (e) => e.candidate && sig(peerId, "media", { candidate: e.candidate });
  pc.ontrack = (e) => {
    if (!pc._remote) pc._remote = new MediaStream();
    pc._remote.addTrack(e.track);
    const t = ensureTile(peerId);
    t.video.srcObject = pc._remote;
    watchAudio(peerId, pc._remote);
  };
  if (offerer) { // create audio + video transceivers up front so toggling the camera never needs renegotiation
    pc.addTransceiver(micTrack || "audio", { direction: "sendrecv" });
    pc.addTransceiver(camTrack || "video", { direction: "sendrecv" });
  }
  return pc;
}

function startMedia(peerId) { // the newcomer sends the offer
  const pc = makeMediaPc(peerId, true);
  chain(pc, async () => {
    await pc.setLocalDescription(await pc.createOffer());
    sig(peerId, "media", { sdp: pc.localDescription });
  });
}

function onMedia(from, data) {
  const pc = mediaConns.get(from) || makeMediaPc(from, false);
  chain(pc, async () => {
    if (data.sdp) {
      await pc.setRemoteDescription(data.sdp);
      if (data.sdp.type === "offer") {
        for (const t of pc.getTransceivers()) {
          t.direction = "sendrecv";
          const track = t.receiver.track.kind === "audio" ? micTrack : camTrack;
          if (track) await t.sender.replaceTrack(track);
        }
        await pc.setLocalDescription(await pc.createAnswer());
        sig(from, "media", { sdp: pc.localDescription });
      }
    } else if (data.candidate) {
      await pc.addIceCandidate(data.candidate);
    }
  });
}

// ================= Screen share (one connection per share => several people can share at once) =================
async function startShare() {
  if (screenStream) return;
  let s;
  try {
    s = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: { ideal: 15, max: 30 } },
      audio: { suppressLocalAudioPlayback: true }, // do not play shared audio back locally (prevents echo)
      selfBrowserSurface: "exclude",               // hide this meeting tab from the picker (prevents the infinite-mirror effect)
      surfaceSwitching: "include",
    });
  } catch { return; } // user cancelled the picker
  screenStream = s;
  const vt = s.getVideoTracks()[0];
  vt.contentHint = "detail"; // keeps text and code sharp
  vt.onended = stopShare;    // browser's own "Stop sharing" button
  // No local preview tile: showing your own screen inside the page you are sharing creates a recursive "hall of mirrors".
  sendState({ sharing: true });
  peers.forEach((_, id) => openScreenOut(id));
  updateTile(myId); updateControls();
}

function stopShare() {
  if (!screenStream) return;
  screenStream.getTracks().forEach((t) => t.stop());
  screenStream = null;
  screenOut.forEach((pc, id) => { sig(id, "screen-out", { close: true }); pc.close(); });
  screenOut.clear();
  sendState({ sharing: false });
  if (tiles.has(myId)) updateTile(myId);
  updateControls();
}

function openScreenOut(peerId) {
  if (!screenStream || screenOut.has(peerId)) return; // never open two connections to the same peer
  const pc = new RTCPeerConnection(ICE);
  screenOut.set(peerId, pc);
  pc.onicecandidate = (e) => e.candidate && sig(peerId, "screen-out", { candidate: e.candidate });
  screenStream.getTracks().forEach((t) => pc.addTrack(t, screenStream)); // video (+ system audio if provided)
  chain(pc, async () => {
    await pc.setLocalDescription(await pc.createOffer());
    sig(peerId, "screen-out", { sdp: pc.localDescription });
    capBitrate(pc);
  });
}

function capBitrate(pc) { // every viewer gets a separate stream, so cap bitrate to protect the sharer's upload
  pc.getSenders().filter((x) => x.track?.kind === "video").forEach((x) => {
    try {
      const p = x.getParameters();
      if (!p.encodings || !p.encodings.length) p.encodings = [{}];
      p.encodings[0].maxBitrate = 2_000_000;
      x.setParameters(p).catch(() => {});
    } catch { /* not supported */ }
  });
}

function onScreenIn(from, data) { // answer from the peer I am sending my screen to
  const pc = screenOut.get(from);
  if (!pc) return;
  chain(pc, async () => {
    if (data.sdp) await pc.setRemoteDescription(data.sdp);
    else if (data.candidate) await pc.addIceCandidate(data.candidate);
  });
}

function onScreenOut(from, data) { // another participant's screen is arriving
  if (data.close) return closeScreenIn(from);
  let pc = screenIn.get(from);
  if (!pc) {
    pc = new RTCPeerConnection(ICE);
    screenIn.set(from, pc);
    pc.onicecandidate = (e) => e.candidate && sig(from, "screen-in", { candidate: e.candidate });
    pc.ontrack = (e) => {
      const stream = e.streams[0] || new MediaStream([e.track]);
      showScreen(from, stream, `${peers.get(from)?.name || "Participant"}'s screen`, false);
    };
    pc.onconnectionstatechange = () => { if (["failed", "closed"].includes(pc.connectionState)) removeScreen(from); };
  }
  chain(pc, async () => {
    if (data.sdp) {
      await pc.setRemoteDescription(data.sdp);
      await pc.setLocalDescription(await pc.createAnswer());
      sig(from, "screen-in", { sdp: pc.localDescription });
    } else if (data.candidate) {
      await pc.addIceCandidate(data.candidate);
    }
  });
}

function closeScreenIn(from) {
  const pc = screenIn.get(from);
  if (pc) { pc.close(); screenIn.delete(from); }
  removeScreen(from);
}

function cleanupPeer(id) {
  mediaConns.get(id)?.close(); mediaConns.delete(id);
  screenOut.get(id)?.close(); screenOut.delete(id);
  closeScreenIn(id);
  tiles.get(id)?.el.remove(); tiles.delete(id);
  analysers.delete(id);
}

// ================= Screen tiles =================
function showScreen(key, stream, label, local) {
  const old = document.getElementById("scr-" + key);
  if (old) { if (old.querySelector("video").srcObject === stream) return; old.remove(); }
  const fig = document.createElement("figure");
  fig.className = "screen"; fig.id = "scr-" + key; fig.title = "Click to enlarge or shrink";
  const v = document.createElement("video");
  v.autoplay = true; v.playsInline = true; v.muted = local; v.srcObject = stream;
  const cap = document.createElement("figcaption");
  cap.textContent = label;
  fig.append(v, cap);
  fig.onclick = () => { pinned = pinned === key ? null : key; layout(); };
  $("screens").appendChild(fig);
  layout();
}
function removeScreen(key) {
  document.getElementById("scr-" + key)?.remove();
  if (pinned === key) pinned = null;
  layout();
}
function layout() {
  const kids = [...$("screens").children];
  $("main").classList.toggle("has-screens", kids.length > 0);
  $("main").classList.toggle("has-pin", kids.length > 0 && !!pinned);
  kids.forEach((el) => el.classList.toggle("pinned", el.id === "scr-" + pinned));
}

// ================= Participant tiles =================
function ensureTile(id, isSelf) {
  if (tiles.has(id)) return tiles.get(id);
  const el = document.createElement("div");
  el.className = "tile" + (isSelf ? " self" : "");
  const video = document.createElement("video");
  video.autoplay = true; video.playsInline = true; video.muted = !!isSelf;
  const av = document.createElement("div"); av.className = "avatar";
  const label = document.createElement("div"); label.className = "label";
  const mi = document.createElement("span"); mi.className = "mi"; mi.innerHTML = icon("micoff");
  const nm = document.createElement("span"); nm.className = "nm";
  const eq = document.createElement("span"); eq.className = "eq"; eq.innerHTML = "<i></i><i></i><i></i>";
  label.append(mi, nm, eq);
  el.append(video, av, label);
  $("gallery").appendChild(el);
  const t = { el, video, av, nm };
  tiles.set(id, t);
  return t;
}
function updateSelfVideo() {
  const t = tiles.get(myId);
  if (t) t.video.srcObject = camTrack ? new MediaStream([camTrack]) : null;
}
function updateTile(id) {
  const t = tiles.get(id);
  const p = id === myId ? { name: myName + " (You)", muted, cam: camOn, hand, sharing: !!screenStream } : peers.get(id);
  if (!t || !p) return;
  t.av.textContent = initials(p.name);
  t.av.style.background = grad(p.name);
  t.el.classList.toggle("cam-off", !p.cam);
  t.el.classList.toggle("is-muted", !!p.muted);
  t.nm.textContent = `${p.hand ? "✋ " : ""}${p.name}${p.sharing ? " · sharing" : ""}`;
}

// ================= Active speaker =================
let audioCtx;
function watchAudio(id, stream) {
  if (analysers.has(id) || !stream.getAudioTracks().length) return;
  audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
  audioCtx.resume();
  const an = audioCtx.createAnalyser();
  an.fftSize = 512;
  audioCtx.createMediaStreamSource(stream).connect(an);
  analysers.set(id, { an, data: new Uint8Array(an.frequencyBinCount) });
}
setInterval(() => {
  analysers.forEach((a, id) => {
    a.an.getByteFrequencyData(a.data);
    let sum = 0; for (const v of a.data) sum += v;
    let level = sum / a.data.length;
    if (id === myId && muted) level = 0;
    tiles.get(id)?.el.classList.toggle("speaking", level > 12);
  });
}, 200);

// ================= Controls =================
function setDock(id, ic, tip, off, active) {
  const b = $(id);
  setIcon(id, ic);
  b.querySelector(".tip").textContent = tip;
  b.setAttribute("aria-label", tip);
  b.classList.toggle("off", !!off);
  b.classList.toggle("active", !!active);
}
function updateControls() {
  setDock("micBtn", muted ? "micoff" : "mic", muted ? "Unmute (M)" : "Mute (M)", muted || !micTrack);
  setDock("camBtn", camOn ? "video" : "videooff", camOn ? "Stop video (V)" : "Start video (V)", !camOn);
  setDock("shareBtn", "screen", screenStream ? "Stop sharing (S)" : "Share screen (S)", false, !!screenStream);
  $("shareBanner").hidden = !screenStream;
  setDock("ccBtn", "cc", capOn ? "Captions off" : "Live captions", false, capOn);
  setDock("recBtn", "record", recorder ? "Stop recording" : "Record", false, !!recorder);
  setDock("handBtn", "hand", hand ? "Lower hand (H)" : "Raise hand (H)", false, hand);
  $("lockBtn").textContent = locked ? "Unlock meeting" : "Lock meeting";
}
$("micBtn").onclick = toggleMic;
$("camBtn").onclick = () => setCam(!camOn);
$("shareBtn").onclick = () => (screenStream ? stopShare() : startShare());
$("ccBtn").onclick = toggleCaptions;
$("recBtn").onclick = toggleRecord;
$("handBtn").onclick = () => { hand = !hand; updateTile(myId); renderPeers(); sendState({ hand }); };
$("leaveBtn").onclick = () => leave();
$("shareStop").onclick = stopShare;
$("copyBtn").onclick = () => { buildInvite($("inviteInfo"), roomName); $("infoModal").hidden = false; };
$("infoClose").onclick = () => ($("infoModal").hidden = true);
$("infoModal").addEventListener("click", (e) => { if (e.target === $("infoModal")) $("infoModal").hidden = true; });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") $("infoModal").hidden = true; });

REACTIONS.forEach((emoji) => {
  const b = document.createElement("button");
  b.textContent = emoji;
  b.onclick = () => { wsSend({ type: "reaction", emoji }); $("reactionMenu").hidden = true; };
  $("reactionMenu").appendChild(b);
});
$("reactBtn").onclick = () => ($("reactionMenu").hidden = !$("reactionMenu").hidden);
function floatReaction(emoji, name) {
  const d = document.createElement("div");
  d.className = "float";
  d.style.left = 8 + Math.random() * 70 + "%";
  d.textContent = emoji;
  const s = document.createElement("small");
  s.textContent = name;
  d.appendChild(s);
  $("floaters").appendChild(d);
  setTimeout(() => d.remove(), 3300);
}

// keyboard shortcuts: m = microphone, v = video, s = share, h = raise hand
document.addEventListener("keydown", (e) => {
  if ($("meeting").hidden || e.ctrlKey || e.metaKey || e.altKey) return;
  if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
  const k = e.key.toLowerCase();
  if (k === "m") toggleMic();
  else if (k === "v") setCam(!camOn);
  else if (k === "s") $("shareBtn").click();
  else if (k === "h") $("handBtn").click();
});

// ================= Live captions (Web Speech API, Chrome/Edge) =================
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
function toggleCaptions() {
  if (!SR) return toast("Live captions require Chrome or Edge");
  capOn = !capOn;
  updateControls();
  if (capOn) {
    startRecog();
    toast("Captions on: your speech is added to the transcript while you are unmuted");
  } else {
    recog?.stop(); recog = null;
    $("caption").hidden = true;
  }
}
function startRecog() {
  recog = new SR();
  recog.continuous = true;
  recog.interimResults = false;
  recog.lang = $("capLang").value;
  recog.onresult = (e) => {
    for (let i = e.resultIndex; i < e.results.length; i++) {
      if (!e.results[i].isFinal || muted) continue;
      const text = e.results[i][0].transcript.trim();
      if (!text) continue;
      wsSend({ type: "caption", text });
      pushTranscript(myName, text, "speech");
      showCaption("You", text);
    }
  };
  recog.onend = () => { if (capOn) setTimeout(startRecog, 150); }; // browsers stop recognition after silence
  recog.onerror = (e) => {
    if (e.error === "not-allowed" || e.error === "service-not-allowed") {
      capOn = false; updateControls();
      toast("Microphone permission is required for captions");
    }
  };
  try { recog.start(); } catch { /* already started */ }
}
$("capLang").onchange = () => { if (capOn && recog) recog.stop(); }; // onend restarts recognition with the new language
function showCaption(name, text) {
  const el = $("caption");
  el.textContent = "";
  const b = document.createElement("b");
  b.textContent = name;
  el.append(b, text);
  el.hidden = false;
  clearTimeout(showCaption._t);
  showCaption._t = setTimeout(() => (el.hidden = true), 5500);
}

// ================= Recording (local: current tab + everyone audio + your microphone) =================
async function toggleRecord() {
  if (recorder) return recorder.stop();
  let disp;
  try {
    disp = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true, preferCurrentTab: true, selfBrowserSurface: "include" });
  } catch { return; }
  const ctx = new AudioContext();
  const dest = ctx.createMediaStreamDestination();
  if (disp.getAudioTracks().length) ctx.createMediaStreamSource(new MediaStream([disp.getAudioTracks()[0]])).connect(dest);
  if (micTrack) ctx.createMediaStreamSource(new MediaStream([micTrack])).connect(dest);
  const out = new MediaStream([...disp.getVideoTracks(), ...dest.stream.getAudioTracks()]);
  const mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus") ? "video/webm;codecs=vp9,opus" : "video/webm";
  const chunks = [];
  const rec = new MediaRecorder(out, { mimeType: mime });
  recorder = rec;
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  rec.onstop = () => {
    disp.getTracks().forEach((t) => t.stop());
    ctx.close();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(chunks, { type: "video/webm" }));
    a.download = `meetshare-${roomName}-${Date.now()}.webm`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    recorder = null;
    sendState({ rec: false });
    updateControls(); updateRecBadge();
  };
  disp.getVideoTracks()[0].onended = () => rec.state !== "inactive" && rec.stop();
  rec.start(1000);
  sendState({ rec: true }); // everyone else sees the REC badge
  updateControls(); updateRecBadge();
  toast("Recording started. Make sure you selected this meeting tab.");
}
function updateRecBadge() {
  $("recBadge").hidden = !(recorder || [...peers.values()].some((p) => p.rec));
}

// ================= Side panel: People / Chat / AI =================
function showPanel(tab) {
  panelTab = tab;
  $("meeting").classList.toggle("panel-open", !!tab);
  $("panel").hidden = !tab;
  $("peoplePane").hidden = tab !== "people";
  $("chatPane").hidden = tab !== "chat";
  $("aiPane").hidden = tab !== "ai";
  ["People", "Chat", "Ai"].forEach((n) => $("tab" + n).classList.toggle("active", tab === n.toLowerCase()));
  $("peopleBtn").classList.toggle("active", tab === "people");
  $("chatBtn").classList.toggle("active", tab === "chat");
  $("aiBtn").classList.toggle("active", tab === "ai");
  if (tab === "chat") { unread = 0; $("chatBadge").hidden = true; scrollDown($("chatLog")); }
  if (tab === "ai") scrollDown($("aiLog"));
}
const togglePanel = (t) => showPanel(panelTab === t ? null : t);
$("peopleBtn").onclick = () => togglePanel("people");
$("chatBtn").onclick = () => togglePanel("chat");
$("aiBtn").onclick = () => togglePanel("ai");
$("tabPeople").onclick = () => showPanel("people");
$("tabChat").onclick = () => showPanel("chat");
$("tabAi").onclick = () => showPanel("ai");
$("panelClose").onclick = () => showPanel(null);

const mkTag = (t, cls = "") => { const s = document.createElement("span"); s.className = "tag " + cls; s.textContent = t; return s; };
const mkBtn = (label, cls, fn) => { const b = document.createElement("button"); b.className = "small " + cls; b.textContent = label; b.onclick = fn; return b; };

function renderPeers() {
  const iAmHost = myId === hostId;
  $("hostTools").hidden = !iAmHost;
  const list = $("people");
  list.innerHTML = "";
  const all = [{ id: myId, name: myName + " (You)", muted, cam: camOn, hand, sharing: !!screenStream, rec: !!recorder }, ...peers.values()];
  all.forEach((p) => {
    const li = document.createElement("li");
    const av = document.createElement("span");
    av.className = "pav"; av.textContent = initials(p.name); av.style.background = grad(p.name);
    const nm = document.createElement("span");
    nm.className = "grow"; nm.textContent = p.name;
    li.append(av, nm);
    if (p.id === hostId) li.appendChild(mkTag("host", "host"));
    if (p.hand) li.appendChild(mkTag("✋"));
    if (p.sharing) li.appendChild(mkTag("sharing"));
    if (p.rec) li.appendChild(mkTag("rec"));
    if (p.muted) li.appendChild(mkTag("muted"));
    if (iAmHost && p.id !== myId) {
      if (p.sharing) li.appendChild(mkBtn("Stop share", "ghost", () => wsSend({ type: "stop-share", target: p.id })));
      li.appendChild(mkBtn("Remove", "danger", () => wsSend({ type: "kick", target: p.id })));
    }
    list.appendChild(li);
  });
  updateControls();
}
$("muteAllBtn").onclick = () => { wsSend({ type: "mute-all" }); toast("Mute request sent to all participants"); };
$("lockBtn").onclick = () => wsSend({ type: "lock", on: !locked });
$("endBtn").onclick = () => { if (confirm("End the meeting for everyone?")) wsSend({ type: "end" }); };

// ---------- chat ----------
$("chatForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const text = $("chatInput").value.trim();
  if (!text) return;
  wsSend({ type: "chat", text });
  $("chatInput").value = "";
});
function addChat(m) {
  const mine = m.from === myId;
  const d = document.createElement("div");
  d.className = "msg" + (mine ? " me" : "");
  const who = document.createElement("div");
  who.className = "who";
  who.textContent = mine ? "You" : m.name;
  const t = document.createElement("time");
  t.textContent = fmtTime(m.ts);
  who.appendChild(t);
  const body = document.createElement("div");
  body.textContent = m.text; // textContent => XSS safe
  d.append(who, body);
  $("chatLog").appendChild(d);
  scrollDown($("chatLog"));
  pushTranscript(m.name, m.text, "chat");
  if (panelTab !== "chat" && !mine) { unread++; $("chatBadge").hidden = false; }
}

// ================= AI Copilot (Groq via /api/ai) =================
function pushTranscript(name, text, kind) {
  transcript.push({ t: Date.now(), name, text, kind });
  if (transcript.length > 800) transcript.shift();
}
function buildContext() {
  const lines = transcript.map((x) => x.kind === "event" ? `[${fmtTime(x.t)}] * ${x.text}` : `[${fmtTime(x.t)}] ${x.name}${x.kind === "chat" ? " (chat)" : ""}: ${x.text}`);
  const who = [myName, ...[...peers.values()].map((p) => p.name)].join(", ");
  return `Meeting: ${roomName}\nParticipants now: ${who}\nElapsed: ${$("timer").textContent}\n\nTranscript:\n${lines.join("\n") || "(nothing recorded yet)"}`;
}

const AI_CHIPS = [
  ["Summarize", "Give a concise summary of this meeting in 5-6 bullet points."],
  ["Action items", "List all action items. Include the owner's name where it is known."],
  ["Catch me up", "I joined late. Summarize what has been discussed so far in 3 lines."],
  ["Follow-up email", "Draft a short, professional follow-up email to send after this meeting."],
];
const aiHistory = [];
let aiBusy = false, aiAbort = null, aiReady = true;

function initAi() {
  AI_CHIPS.forEach(([label, prompt]) => {
    const b = document.createElement("button");
    b.type = "button"; b.textContent = label;
    b.onclick = () => askAI(prompt);
    $("aiChips").appendChild(b);
  });
  const e = document.createElement("div");
  e.className = "aiEmpty"; e.id = "aiEmpty";
  e.textContent = "I answer using the meeting transcript (live captions and chat). To include your voice, turn on captions (CC) in the toolbar. Each participant needs to enable their own captions.";
  $("aiLog").appendChild(e);
  fetch("/api/health").then((r) => r.json()).then((h) => {
    aiReady = h.ai;
    $("aiStatus").textContent = h.ai ? `Powered by Groq · ${h.model}` : `AI unavailable: ${h.detail || h.status}`;
    $("aiStatus").title = h.detail || "";
    $("aiStatus").classList.toggle("bad", !h.ai);
  }).catch(() => {});
}
initAi();

function addAiMsg(role, text) {
  $("aiEmpty")?.remove();
  const d = document.createElement("div");
  d.className = "aimsg " + role;
  const md = document.createElement("div");
  md.className = "md";
  if (text) md.textContent = text;
  d.appendChild(md);
  $("aiLog").appendChild(d);
  scrollDown($("aiLog"));
  return d;
}

async function askAI(text) {
  text = (text || "").trim();
  if (!text || aiBusy) return;
  showPanel("ai");
  aiBusy = true;
  $("aiSend").disabled = true;
  aiHistory.push({ role: "user", content: text });
  addAiMsg("user", text);
  const bubble = addAiMsg("assistant", "");
  const md = bubble.querySelector(".md");
  bubble.classList.add("typing");
  aiAbort = new AbortController();
  let full = "";
  try {
    const res = await fetch("/api/ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: aiHistory.slice(-10), context: buildContext() }),
      signal: aiAbort.signal,
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      if (res.status === 401) throw new Error("Your session has expired. Please sign out and sign in again.");
      throw new Error(j.error || `Error ${res.status}`);
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop();
      for (const ln of lines) {
        if (!ln.startsWith("data:")) continue;
        const d = ln.slice(5).trim();
        if (!d || d === "[DONE]") continue;
        try {
          const delta = JSON.parse(d).choices?.[0]?.delta?.content;
          if (delta) { full += delta; renderMd(md, full); scrollDown($("aiLog")); }
        } catch { /* incomplete chunk */ }
      }
    }
    if (full) aiHistory.push({ role: "assistant", content: full });
    else { aiHistory.pop(); md.textContent = "No response was received. Please try again."; }
  } catch (e) {
    aiHistory.pop(); // keep failed requests out of the history
    if (e.name !== "AbortError") {
      bubble.classList.add("err");
      md.textContent = e.message || "Something went wrong. Please try again.";
    }
  } finally {
    bubble.classList.remove("typing");
    aiBusy = false;
    aiAbort = null;
    $("aiSend").disabled = false;
  }
}
$("aiForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const v = $("aiInput").value;
  $("aiInput").value = "";
  askAI(v);
});

// small safe markdown renderer (bold, code, bullets, headings); never uses innerHTML
function renderMd(el, text) {
  el.textContent = "";
  let list = null;
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    const li = line.match(/^\s*(?:[-*•]|\d+\.)\s+(.*)/);
    if (li) {
      if (!list) { list = document.createElement("ul"); el.appendChild(list); }
      const item = document.createElement("li");
      inline(item, li[1]);
      list.appendChild(item);
      continue;
    }
    list = null;
    if (!line.trim()) continue;
    const h = line.match(/^#{1,4}\s+(.*)/);
    const node = document.createElement(h ? "h4" : "p");
    inline(node, h ? h[1] : line);
    el.appendChild(node);
  }
}
function inline(parent, text) {
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0, m;
  while ((m = re.exec(text))) {
    if (m.index > last) parent.append(text.slice(last, m.index));
    const bold = m[0].startsWith("**");
    const node = document.createElement(bold ? "strong" : "code");
    node.textContent = m[0].slice(bold ? 2 : 1, bold ? -2 : -1);
    parent.append(node);
    last = m.index + m[0].length;
  }
  if (last < text.length) parent.append(text.slice(last));
}

// ================= Timer + Leave =================
function tick() {
  const s = Math.floor((Date.now() - joinedAt) / 1000);
  const h = Math.floor(s / 3600), mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0"), ss = String(s % 60).padStart(2, "0");
  $("timer").textContent = h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function leave(msg) {
  leaving = true;
  capOn = false; recog?.stop();
  aiAbort?.abort();
  stopShare();
  if (recorder && recorder.state !== "inactive") recorder.stop();
  mediaConns.forEach((pc) => pc.close());
  screenIn.forEach((pc) => pc.close());
  micTrack?.stop(); camTrack?.stop();
  if (ws) ws.close();
  if (msg) sessionStorage.setItem("msg", msg);
  setTimeout(() => location.reload(), 150); // brief delay so a recording can finish saving
}
