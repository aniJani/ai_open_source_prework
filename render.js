import { avatars, getLabel } from "./assets.js";
import { computeCamera } from "./camera.js";

export const canvas = document.getElementById("map");
export const ctx = canvas.getContext("2d", { alpha: false });
ctx.imageSmoothingEnabled = false;

// World map
export const worldImg = new Image();
worldImg.src = "world.jpg";
export const world = { w: 2048, h: 2048 };
worldImg.onload = () => {
    world.w = worldImg.naturalWidth || world.w;
    world.h = worldImg.naturalHeight || world.h;
};

// Local state
const state = {
    me: null,
    // Other players: id -> {
    //   id, username, avatar,
    //   // interpolation window:
    //   x0, y0, x1, y1, t0, t1, lastMsgTs, lastDelta,
    //   facing, animationFrame
    // }
    players: new Map(),
    pressed: new Set(),
    lastTs: 0,
    dirty: true,

    meAnimTime: 0
};

// ===== external setters used by net.js =====
export function setMe(meOrUpdater) {
    state.me = (typeof meOrUpdater === "function") ? meOrUpdater(state.me) : meOrUpdater;
    state.dirty = true;
}

export function setOthersFromSnapshot(playersObj, myId) {
    state.players.clear();
    const now = performance.now();
    for (const [id, p] of Object.entries(playersObj || {})) {
        if (String(id) === String(myId)) continue;
        state.players.set(String(id), {
            id: p.id,
            username: p.username || "Player",
            avatar: p.avatar,
            x0: p.x, y0: p.y,
            x1: p.x, y1: p.y,
            t0: now, t1: now,
            lastMsgTs: now, lastDelta: 120,
            facing: p.facing || "south",
            animationFrame: p.animationFrame || 0
        });
    }
    state.dirty = true;
}

export function upsertOther(p) {
    if (!p || p.id == null) return;
    const id = String(p.id);
    const now = performance.now();

    const prev = state.players.get(id);
    if (!prev) {
        // first time we've seen this player
        state.players.set(id, {
            id: p.id,
            username: p.username || "Player",
            avatar: p.avatar,
            x0: p.x, y0: p.y,
            x1: p.x, y1: p.y,
            t0: now, t1: now,
            lastMsgTs: now, lastDelta: 120,
            facing: p.facing || "south",
            animationFrame: p.animationFrame || 0
        });
        state.dirty = true;
        return;
    }

    // compute current interpolated position at 'now'
    const { x: cx, y: cy } = sampleInterpolated(prev, now);

    // choose a new window size based on observed tick rate
    const delta = Math.max(0, now - (prev.lastMsgTs || now));
    const est = isFinite(delta) && delta > 0 ? delta : (prev.lastDelta || 120);
    const MIN = 80, MAX = 250;
    const win = Math.max(MIN, Math.min(MAX, est));

    // movement vector to set facing for others
    const dx = (p.x ?? cx) - cx;
    const dy = (p.y ?? cy) - cy;
    let facing = prev.facing || "south";
    if (dx !== 0 || dy !== 0) {
        if (Math.abs(dx) >= Math.abs(dy)) facing = (dx < 0) ? "west" : "east";
        else facing = (dy < 0) ? "north" : "south";
    }

    state.players.set(id, {
        id: p.id,
        username: p.username ?? prev.username ?? "Player",
        avatar: p.avatar ?? prev.avatar,
        x0: cx, y0: cy,
        x1: p.x ?? prev.x1, y1: p.y ?? prev.y1,
        t0: now, t1: now + win,
        lastMsgTs: now, lastDelta: win,
        facing,
        animationFrame: p.animationFrame ?? prev.animationFrame ?? 0
    });

    state.dirty = true;
}

export function removeOther(id) {
    state.players.delete(String(id));
    state.dirty = true;
}

export function setInputState(pressedSet) {
    state.pressed = pressedSet;
    state.dirty = true;
}

export function markDirty() { state.dirty = true; }

// ===== canvas DPI =====
export function resizeCanvas() {
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const cssW = window.innerWidth;
    const cssH = window.innerHeight;
    canvas.width = Math.floor(cssW * dpr);
    canvas.height = Math.floor(cssH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    state.dirty = true;
}

// ===== movement & local walking animation for "me" =====
const SPEED = 160;      // px/sec
const ANIM_FPS = 8;     // walking cadence for "me"
const ANIM_PERIOD = 1 / ANIM_FPS;

function integrate(dt) {
    if (!state.me) return false;

    let vx = 0, vy = 0;
    if (state.pressed.has("north")) vy -= 1;
    if (state.pressed.has("south")) vy += 1;
    if (state.pressed.has("west")) vx -= 1;
    if (state.pressed.has("east")) vx += 1;

    const moving = (vx !== 0 || vy !== 0);
    if (!moving) {
        state.me.isMoving = false;
        state.meAnimTime = 0;
        state.me.animationFrame = 1; // neutral middle frame
        return false;
    }

    const len = Math.hypot(vx, vy);
    vx /= len; vy /= len;

    state.me.x += vx * SPEED * dt;
    state.me.y += vy * SPEED * dt;

    // clamp to world
    state.me.x = Math.min(Math.max(state.me.x, 0), world.w - 1);
    state.me.y = Math.min(Math.max(state.me.y, 0), world.h - 1);

    // facing from velocity (horizontal wins on diagonals)
    if (Math.abs(vx) >= Math.abs(vy)) state.me.facing = (vx < 0) ? "west" : "east";
    else state.me.facing = (vy < 0) ? "north" : "south";

    // walk animation
    state.me.isMoving = true;
    state.meAnimTime += dt;
    if (state.meAnimTime >= ANIM_PERIOD) {
        state.meAnimTime -= ANIM_PERIOD;
        state.me.animationFrame = ((state.me.animationFrame ?? 0) + 1) % 3; // 0..2
    }

    return true;
}

// ===== interpolation helpers for others =====
function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
function lerp(a, b, t) { return a + (b - a) * t; }
function sampleInterpolated(rec, now) {
    const t = (rec.t1 === rec.t0) ? 1 : clamp01((now - rec.t0) / (rec.t1 - rec.t0));
    return { x: lerp(rec.x0, rec.x1, t), y: lerp(rec.y0, rec.y1, t), t };
}

/* ---------- Draw helpers (west flip with bottom-center anchor) ---------- */

function drawSpriteBottomCenter(frame, sx, sy, flipX = false) {
    const w = frame.width, h = frame.height;

    if (!flipX) {
        ctx.drawImage(frame, Math.round(sx - w / 2), Math.round(sy - h));
        return;
    }
    ctx.save();
    ctx.translate(Math.round(sx), Math.round(sy - h));
    ctx.scale(-1, 1);
    ctx.drawImage(frame, -w / 2, 0);
    ctx.restore();
}

/** Prefer flipping EAST frames when facing WEST. */
function pickFrames(pack, facing) {
    if (facing === "west") {
        if (pack.frames.east && pack.frames.east.length) {
            return { frames: pack.frames.east, flipX: true };   // flip east → west
        }
        if (pack.frames.west && pack.frames.west.length) {
            return { frames: pack.frames.west, flipX: false };
        }
        return { frames: pack.frames.south || [], flipX: false };
    }
    const dirFrames = pack.frames[facing] || [];
    if (dirFrames.length) return { frames: dirFrames, flipX: false };
    return { frames: pack.frames.south || [], flipX: false };
}

function drawOther(rec, cam, viewW, viewH) {
    const pack = avatars.get(rec.avatar);
    if (!pack) return;

    // cull offscreen (with margin)
    const margin = 64;
    const now = performance.now();
    const { x, y } = sampleInterpolated(rec, now);

    if (x < cam.x - margin || x > cam.x + viewW + margin ||
        y < cam.y - margin || y > cam.y + viewH + margin) return;

    const facing = rec.facing || "south";
    const { frames, flipX } = pickFrames(pack, facing);
    const frame = frames.length ? frames[rec.animationFrame % frames.length] : null;
    if (!frame) return;

    const sx = Math.round(x - cam.x);
    const sy = Math.round(y - cam.y);
    drawSpriteBottomCenter(frame, sx, sy, flipX);

    const label = getLabel(rec.id, rec.username || "Player");
    ctx.drawImage(label.canvas, sx - label.w / 2, sy - frame.height - label.h - 4);
}

function drawMe(cam, viewW, viewH) {
    const pack = avatars.get(state.me.avatar);
    if (!pack) return;

    const facing = state.me.facing || "south";
    const { frames, flipX } = pickFrames(pack, facing);
    const frame = frames.length ? frames[state.me.animationFrame % frames.length] : null;
    if (!frame) return;

    const sx = Math.round(state.me.x - cam.x);
    const sy = Math.round(state.me.y - cam.y);
    drawSpriteBottomCenter(frame, sx, sy, flipX);

    const label = getLabel(state.me.id, state.me.username || "Me");
    ctx.drawImage(label.canvas, sx - label.w / 2, sy - frame.height - label.h - 4);
}

function drawFrame() {
    if (!worldImg.complete || !state.me) return;

    const viewW = canvas.clientWidth;
    const viewH = canvas.clientHeight;
    const cam = computeCamera(state.me, viewW, viewH);

    ctx.clearRect(0, 0, viewW, viewH);
    ctx.drawImage(worldImg, cam.x, cam.y, viewW, viewH, 0, 0, viewW, viewH);

    // others first
    for (const rec of state.players.values()) {
        drawOther(rec, cam, viewW, viewH);
    }

    // me on top
    drawMe(cam, viewW, viewH);
}

// Animation loop
export function startLoop() {
    function tick(ts) {
        const dt = state.lastTs ? (ts - state.lastTs) / 1000 : 0;
        state.lastTs = ts;

        const moved = integrate(dt);
        if (moved || state.dirty) {
            drawFrame();
            state.dirty = false;
        }
        requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
}
