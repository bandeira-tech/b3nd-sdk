/**
 * B3nd Arena — browser game client.
 *
 * Top-down 2D shooter that drives the b3nd arena protocol. Everything
 * the player sees comes from the b3nd network:
 *   player://   joins & leaves (rendered in the scoreboard)
 *   tick://     20 Hz position/rotation updates (hot path)
 *   shot://     fire-and-forget projectile events
 *   chat://     chat messages
 *   score://    scoreboard
 *   kill://     kill feed
 *
 * The game is client-authoritative (each client resolves hits on itself).
 * That's fine for a private LAN demo; the schema stays the same when a
 * real deployment wants to layer server-side rewrite prevention or
 * signature verification on top of these paths.
 */

import { localPubkey, observe, read, receive, shortId } from "./b3nd.js";

// ── Config ───────────────────────────────────────────────────────────

const ROOM_ID = new URLSearchParams(location.search).get("room") ?? "alpha";
const TICK_HZ = 20;                         // position broadcast rate
const RENDER_HZ = 60;                       // local render rate
const MOVE_SPEED = 220;                     // units/sec
const PLAYER_RADIUS = 14;
const SHOT_RANGE = 1200;
const SHOT_SPEED = 900;                     // units/sec (for rendering)
const SHOT_DMG = 28;
const RESPAWN_MS = 2000;
const ARENA_W = 1600;
const ARENA_H = 1000;
const COLORS = ["#ff6464", "#7fd1ff", "#82f2a0", "#f2c066", "#c8a0ff", "#ff95cf", "#6bffe3", "#ffd46b"];

// ── DOM refs ─────────────────────────────────────────────────────────

const canvas = document.getElementById("cv");
const ctx = canvas.getContext("2d");
const scoresEl = document.getElementById("scores");
const feedEl = document.getElementById("feed");
const chatLogEl = document.getElementById("chat-log");
const chatFormEl = document.getElementById("chat-form");
const chatInputEl = document.getElementById("chat-input");
const roomBadge = document.getElementById("room-badge");
const peersBadge = document.getElementById("peers-badge");
const linkBadge = document.getElementById("link-badge");
const meNameEl = document.getElementById("me-name");

roomBadge.textContent = `room: ${ROOM_ID}`;

// ── Local state ──────────────────────────────────────────────────────

const myPubkey = localPubkey();
const myColor = COLORS[parseInt(myPubkey.slice(0, 2), 16) % COLORS.length];
const myName = prompt("Your callsign?")?.slice(0, 24) || `p-${myPubkey.slice(0, 4)}`;
meNameEl.textContent = myName;

let me = {
  p: [ARENA_W / 2 + (Math.random() - 0.5) * 400, ARENA_H / 2 + (Math.random() - 0.5) * 400, 0],
  r: [0, 0],
  hp: 100,
  tickSeq: 0,
  lastBroadcast: 0,
  deadUntil: 0,
};

// Remote state. Each player has a `prev` and `next` frame we interpolate between.
/** @type {Map<string, {pubkey, name, color, p, prevP, t, prevT, hp, alive}>} */
const players = new Map();

/** @type {Array<{id, origin, dir, tFire, weapon, owner, remaining, hit}>} */
const shots = [];

/** @type {Map<string, {kills, deaths, points}>} */
const scores = new Map();

// ── Input ────────────────────────────────────────────────────────────

const keys = new Set();
let cursor = [canvas.width / 2, canvas.height / 2];
let chatOpen = false;

addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    if (chatOpen) return;
    chatOpen = true;
    chatInputEl.focus();
    e.preventDefault();
    return;
  }
  if (chatOpen) return;
  keys.add(e.key.toLowerCase());
});
addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));
addEventListener("blur", () => keys.clear());

canvas.addEventListener("mousemove", (e) => {
  const rect = canvas.getBoundingClientRect();
  cursor = [
    (e.clientX - rect.left) * (canvas.width / rect.width),
    (e.clientY - rect.top) * (canvas.height / rect.height),
  ];
});

canvas.addEventListener("mousedown", (e) => {
  if (e.button !== 0 || chatOpen) return;
  if (performance.now() < me.deadUntil) return;
  fireShot();
});

chatInputEl.addEventListener("blur", () => { chatOpen = false; });
chatFormEl.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = chatInputEl.value.trim();
  chatInputEl.value = "";
  chatInputEl.blur();
  if (text) sendChat(text);
});

// ── Protocol helpers ─────────────────────────────────────────────────

function roomTick() {
  return {
    t: performance.now(),
    p: [me.p[0], me.p[1], 0],
    r: [me.r[0], 0],
    hp: me.hp,
  };
}

async function join() {
  await receive(`player://arena/${ROOM_ID}/${myPubkey}`, {
    name: myName,
    color: myColor,
    status: "alive",
    joinedAt: Date.now(),
  });
  await receive(`score://arena/${ROOM_ID}/${myPubkey}`, {
    kills: 0, deaths: 0, points: 0,
  });
  scores.set(myPubkey, { kills: 0, deaths: 0, points: 0 });
  broadcastTick(true);
}

async function broadcastTick(force = false) {
  const now = performance.now();
  if (!force && now - me.lastBroadcast < 1000 / TICK_HZ) return;
  me.lastBroadcast = now;
  me.tickSeq += 1;
  const uri = `tick://arena/${ROOM_ID}/${myPubkey}/${me.tickSeq}`;
  receive(uri, roomTick()); // fire-and-forget
}

async function fireShot() {
  const aim = aimDirection();
  const shotId = shortId("s");
  const uri = `shot://arena/${ROOM_ID}/${myPubkey}/${shotId}`;
  await receive(uri, {
    t: performance.now(),
    o: [me.p[0], me.p[1], 0],
    d: [aim[0], aim[1], 0],
    w: "pistol",
    dmg: SHOT_DMG,
  });
}

async function sendChat(text) {
  const id = shortId("m");
  await receive(`chat://arena/${ROOM_ID}/${id}`, {
    t: Date.now(), from: myPubkey, text,
  });
}

async function recordKill(killer, victim, weapon) {
  const id = shortId("k");
  await receive(`kill://arena/${ROOM_ID}/${id}`, {
    t: Date.now(), killer, victim, weapon,
  });
  // The killer's local client bumps their own score; victims bump their death.
  // Either side writing is fine — last writer wins, but both produce the same record
  // for the common case of 1v1 kills.
  if (killer === myPubkey) {
    const s = scores.get(myPubkey) ?? { kills: 0, deaths: 0, points: 0 };
    s.kills += 1; s.points += 100;
    await receive(`score://arena/${ROOM_ID}/${myPubkey}`, s);
  }
  if (victim === myPubkey) {
    const s = scores.get(myPubkey) ?? { kills: 0, deaths: 0, points: 0 };
    s.deaths += 1;
    await receive(`score://arena/${ROOM_ID}/${myPubkey}`, s);
  }
}

// ── Movement & aim ───────────────────────────────────────────────────

function aimDirection() {
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  const dx = cursor[0] - cx;
  const dy = cursor[1] - cy;
  const mag = Math.hypot(dx, dy) || 1;
  return [dx / mag, dy / mag];
}

function stepPlayer(dt) {
  if (performance.now() < me.deadUntil) return;
  let vx = 0, vy = 0;
  if (keys.has("w") || keys.has("arrowup")) vy -= 1;
  if (keys.has("s") || keys.has("arrowdown")) vy += 1;
  if (keys.has("a") || keys.has("arrowleft")) vx -= 1;
  if (keys.has("d") || keys.has("arrowright")) vx += 1;
  const mag = Math.hypot(vx, vy);
  if (mag > 0) { vx /= mag; vy /= mag; }
  me.p[0] = Math.max(PLAYER_RADIUS, Math.min(ARENA_W - PLAYER_RADIUS, me.p[0] + vx * MOVE_SPEED * dt));
  me.p[1] = Math.max(PLAYER_RADIUS, Math.min(ARENA_H - PLAYER_RADIUS, me.p[1] + vy * MOVE_SPEED * dt));
  const aim = aimDirection();
  me.r[0] = Math.atan2(aim[1], aim[0]);
}

function respawn() {
  me.p = [Math.random() * ARENA_W, Math.random() * ARENA_H, 0];
  me.hp = 100;
  me.deadUntil = 0;
  broadcastTick(true);
}

// ── Hit detection (client-authoritative, local only) ─────────────────

function processIncomingShot(shot) {
  // Render it regardless. Only resolve damage against ourselves.
  shots.push({
    id: shortId("sr"),
    origin: [shot.o[0], shot.o[1]],
    dir: [shot.d[0], shot.d[1]],
    tFire: performance.now(),
    weapon: shot.w,
    owner: shot.owner,
    remaining: SHOT_RANGE,
    hit: false,
  });

  if (shot.owner === myPubkey) return;         // our own bullets don't hit us
  if (performance.now() < me.deadUntil) return; // dead players can't be hit
  if (me.hp <= 0) return;

  // Segment-circle intersection: bullet from o along d*SHOT_RANGE vs our circle.
  const ox = shot.o[0], oy = shot.o[1];
  const dx = shot.d[0], dy = shot.d[1];
  const mx = me.p[0] - ox, my = me.p[1] - oy;
  const t = Math.max(0, Math.min(SHOT_RANGE, mx * dx + my * dy));
  const cx = ox + dx * t, cy = oy + dy * t;
  const dist = Math.hypot(cx - me.p[0], cy - me.p[1]);
  if (dist <= PLAYER_RADIUS) {
    me.hp -= shot.dmg;
    if (me.hp <= 0) {
      me.hp = 0;
      me.deadUntil = performance.now() + RESPAWN_MS;
      recordKill(shot.owner, myPubkey, shot.w);
      setTimeout(respawn, RESPAWN_MS);
    }
    broadcastTick(true);
  }
}

// ── Interpolation for remote players ─────────────────────────────────

function interpolated(player) {
  if (!player.prevP) return player.p;
  const span = Math.max(1, player.t - player.prevT);
  const a = Math.min(1, (performance.now() - player.t) / span + 0.5);
  return [
    player.prevP[0] + (player.p[0] - player.prevP[0]) * a,
    player.prevP[1] + (player.p[1] - player.prevP[1]) * a,
  ];
}

// ── Render ───────────────────────────────────────────────────────────

function render() {
  const w = canvas.width, h = canvas.height;
  ctx.fillStyle = "#0f1320";
  ctx.fillRect(0, 0, w, h);

  // Camera follows me
  const cx = me.p[0], cy = me.p[1];
  ctx.save();
  ctx.translate(w / 2 - cx, h / 2 - cy);

  // Arena border
  ctx.strokeStyle = "#1e2432";
  ctx.lineWidth = 2;
  ctx.strokeRect(0, 0, ARENA_W, ARENA_H);

  // Grid
  ctx.strokeStyle = "#141a28";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x <= ARENA_W; x += 80) { ctx.moveTo(x, 0); ctx.lineTo(x, ARENA_H); }
  for (let y = 0; y <= ARENA_H; y += 80) { ctx.moveTo(0, y); ctx.lineTo(ARENA_W, y); }
  ctx.stroke();

  // Shots (fade out as they travel)
  const now = performance.now();
  for (let i = shots.length - 1; i >= 0; i--) {
    const s = shots[i];
    const age = (now - s.tFire) / 1000;
    const travelled = Math.min(SHOT_RANGE, SHOT_SPEED * age);
    if (travelled >= SHOT_RANGE) { shots.splice(i, 1); continue; }
    const fx = s.origin[0] + s.dir[0] * travelled;
    const fy = s.origin[1] + s.dir[1] * travelled;
    const tx = s.origin[0] + s.dir[0] * Math.max(0, travelled - 60);
    const ty = s.origin[1] + s.dir[1] * Math.max(0, travelled - 60);
    const alpha = 1 - travelled / SHOT_RANGE;
    ctx.strokeStyle = `rgba(255, 230, 120, ${alpha})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(tx, ty); ctx.lineTo(fx, fy);
    ctx.stroke();
  }

  // Remote players
  for (const player of players.values()) {
    if (player.pubkey === myPubkey) continue;
    if (!player.alive) continue;
    const [px, py] = interpolated(player);
    drawPlayer(px, py, player.color, player.name, player.hp, 0);
  }

  // Me
  if (performance.now() >= me.deadUntil) {
    drawPlayer(me.p[0], me.p[1], myColor, myName, me.hp, me.r[0], true);
  } else {
    // Respawn timer
    ctx.fillStyle = "rgba(255,100,100,0.8)";
    ctx.font = "14px monospace";
    ctx.textAlign = "center";
    const s = Math.ceil((me.deadUntil - performance.now()) / 1000);
    ctx.fillText(`respawning… ${s}`, me.p[0], me.p[1]);
  }

  ctx.restore();

  // HUD — HP bar
  ctx.fillStyle = "#1e2432";
  ctx.fillRect(12, h - 28, 200, 14);
  ctx.fillStyle = me.hp > 30 ? "#82f2a0" : "#ff6464";
  ctx.fillRect(12, h - 28, 200 * Math.max(0, me.hp) / 100, 14);
  ctx.fillStyle = "#fff";
  ctx.font = "11px monospace";
  ctx.textAlign = "left";
  ctx.fillText(`HP ${Math.max(0, me.hp)}`, 16, h - 18);
}

function drawPlayer(x, y, color, name, hp, angle, isMe = false) {
  // Aim line
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.35;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + Math.cos(angle) * 28, y + Math.sin(angle) * 28);
  ctx.stroke();
  ctx.globalAlpha = 1;

  // Body
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, PLAYER_RADIUS, 0, Math.PI * 2);
  ctx.fill();

  if (isMe) {
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, PLAYER_RADIUS + 3, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Name
  ctx.fillStyle = "#fff";
  ctx.font = "11px monospace";
  ctx.textAlign = "center";
  ctx.fillText(name, x, y - PLAYER_RADIUS - 6);

  // HP bar over head
  ctx.fillStyle = "#1e2432";
  ctx.fillRect(x - 20, y - PLAYER_RADIUS - 20, 40, 4);
  ctx.fillStyle = hp > 30 ? "#82f2a0" : "#ff6464";
  ctx.fillRect(x - 20, y - PLAYER_RADIUS - 20, 40 * Math.max(0, hp) / 100, 4);
}

// ── UI updates ───────────────────────────────────────────────────────

function renderScoreboard() {
  const items = [...players.values()]
    .map((p) => ({ p, s: scores.get(p.pubkey) ?? { kills: 0, deaths: 0, points: 0 } }))
    .sort((a, b) => b.s.points - a.s.points);
  scoresEl.innerHTML = "";
  for (const { p, s } of items) {
    const li = document.createElement("li");
    if (p.pubkey === myPubkey) li.className = "me";
    li.innerHTML = `
      <span class="swatch" style="background:${p.color}"></span>
      <span class="nm">${escapeHtml(p.name)}</span>
      <span class="k">${s.kills}</span>
      <span class="d">/ ${s.deaths}</span>
    `;
    scoresEl.appendChild(li);
  }
  peersBadge.textContent = `peers: ${players.size}`;
}

function appendFeed(killer, victim, weapon) {
  const li = document.createElement("li");
  const kn = players.get(killer)?.name ?? killer.slice(0, 6);
  const vn = players.get(victim)?.name ?? victim.slice(0, 6);
  li.innerHTML = `<b>${escapeHtml(kn)}</b> → <b>${escapeHtml(vn)}</b> <span style="color:#8b93a7">· ${escapeHtml(weapon)}</span>`;
  feedEl.prepend(li);
  while (feedEl.childNodes.length > 20) feedEl.removeChild(feedEl.lastChild);
}

function appendChat(from, text) {
  const li = document.createElement("li");
  const fromName = players.get(from)?.name ?? from.slice(0, 6);
  li.innerHTML = `<b>${escapeHtml(fromName)}:</b> ${escapeHtml(text)}`;
  chatLogEl.appendChild(li);
  while (chatLogEl.childNodes.length > 60) chatLogEl.removeChild(chatLogEl.firstChild);
  chatLogEl.scrollTop = chatLogEl.scrollHeight;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ── Network wiring ───────────────────────────────────────────────────

function onTick(uri, data) {
  // uri = tick://arena/{room}/{pubkey}/{seq}
  const parts = uri.replace("://", "/").split("/");
  const pubkey = parts[3];
  if (!pubkey || pubkey === myPubkey) return;
  const existing = players.get(pubkey);
  const t = performance.now();
  const pxy = [data.p[0], data.p[1]];
  if (existing) {
    existing.prevP = existing.p;
    existing.prevT = existing.t;
    existing.p = pxy;
    existing.t = t;
    existing.hp = data.hp;
    existing.alive = data.hp > 0;
  } else {
    // Tick from a player we don't know yet — placeholder until their player:// record arrives.
    players.set(pubkey, {
      pubkey,
      name: pubkey.slice(0, 6),
      color: COLORS[parseInt(pubkey.slice(0, 2), 16) % COLORS.length],
      p: pxy, prevP: pxy, t, prevT: t, hp: data.hp,
      alive: data.hp > 0,
    });
    renderScoreboard();
  }
}

function onPlayer(uri, data) {
  const parts = uri.replace("://", "/").split("/");
  const pubkey = parts[3];
  if (!pubkey) return;
  const existing = players.get(pubkey);
  if (existing) {
    existing.name = data.name;
    existing.color = data.color;
    existing.alive = data.status === "alive";
  } else {
    players.set(pubkey, {
      pubkey,
      name: data.name,
      color: data.color,
      p: [ARENA_W / 2, ARENA_H / 2],
      prevP: null,
      t: performance.now(), prevT: performance.now(),
      hp: 100,
      alive: data.status === "alive",
    });
  }
  if (!scores.has(pubkey)) scores.set(pubkey, { kills: 0, deaths: 0, points: 0 });
  renderScoreboard();
}

function onShot(uri, data) {
  const parts = uri.replace("://", "/").split("/");
  processIncomingShot({ ...data, owner: parts[3] });
}

function onChat(_uri, data) {
  appendChat(data.from, data.text);
}

function onScore(uri, data) {
  const parts = uri.replace("://", "/").split("/");
  const pubkey = parts[3];
  if (!pubkey) return;
  scores.set(pubkey, data);
  renderScoreboard();
}

function onKill(_uri, data) {
  appendFeed(data.killer, data.victim, data.weapon);
}

// ── Bootstrap ────────────────────────────────────────────────────────

async function loadInitialState() {
  // Grab all existing players + scores so late joiners aren't blind.
  const playerList = await read(`player://arena/${ROOM_ID}/`);
  if (playerList.success && playerList.items) {
    for (const it of playerList.items) {
      if (it.uri && it.data) onPlayer(it.uri, it.data);
    }
  }
  const scoreList = await read(`score://arena/${ROOM_ID}/`);
  if (scoreList.success && scoreList.items) {
    for (const it of scoreList.items) {
      if (it.uri && it.data) onScore(it.uri, it.data);
    }
  }
}

async function main() {
  await loadInitialState();
  await join();

  observe(`player://arena/${ROOM_ID}`, onPlayer);
  observe(`tick://arena/${ROOM_ID}`, onTick);
  observe(`shot://arena/${ROOM_ID}`, onShot);
  observe(`chat://arena/${ROOM_ID}`, onChat);
  observe(`score://arena/${ROOM_ID}`, onScore);
  observe(`kill://arena/${ROOM_ID}`, onKill);

  linkBadge.textContent = "online";
  linkBadge.classList.add("live");

  // Leave tombstone on unload. Fire-and-forget; navigator.sendBeacon
  // would be nicer but we want it gated by our single POST endpoint.
  addEventListener("beforeunload", () => {
    const body = JSON.stringify([
      `player://arena/${ROOM_ID}/${myPubkey}`,
      {},
      { name: myName, color: myColor, status: "spectator", joinedAt: Date.now() },
    ]);
    navigator.sendBeacon?.("/api/v1/receive", body);
  });

  // Loops
  let last = performance.now();
  function tick() {
    const now = performance.now();
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    stepPlayer(dt);
    broadcastTick();
    render();
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

main().catch((err) => {
  console.error(err);
  linkBadge.textContent = "error";
});
