import { cacheAvatar } from "./assets.js";
import {
    markDirty,
    removeOther,
    setMe,
    setOthersFromSnapshot,
    upsertOther
} from "./render.js";

const SERVER_URL = "wss://codepath-mmorg.onrender.com";

let ws = null;
let joined = false;
let myId = null;

export function connect(username) {
    ws = new WebSocket(SERVER_URL);

    ws.addEventListener("open", () => {
        ws.send(JSON.stringify({ action: "join_game", username }));
    });

    ws.addEventListener("message", async (event) => {
        const msg = JSON.parse(event.data);

        // On join: cache avatars, set me + snapshot of others
        if (msg.action === "join_game" && msg.success) {
            for (const [name, data] of Object.entries(msg.avatars || {})) {
                await cacheAvatar(name, data);
            }

            myId = msg.playerId;
            const me = msg.players[myId];

            setMe({
                id: me.id,
                username: me.username || username || "Me",
                x: me.x,
                y: me.y,
                facing: me.facing || "south",
                isMoving: !!me.isMoving,
                animationFrame: me.animationFrame || 0,
                avatar: me.avatar
            });

            setOthersFromSnapshot(msg.players, myId);

            joined = true;
            markDirty();
            return;
        }

        // Movement ticks – update me + others (others get interpolation)
        if (msg.action === "players_moved" && joined) {
            const movedPlayers = msg.players || {};
            for (const [id, p] of Object.entries(movedPlayers)) {
                if (String(id) === String(myId)) {
                    setMe((prev) => ({
                        ...prev,
                        x: p.x,
                        y: p.y,
                        // keep local facing for me; server animationFrame optional
                        facing: prev.facing,
                        isMoving: !!p.isMoving,
                        animationFrame: (p.animationFrame ?? prev.animationFrame),
                        avatar: p.avatar ?? prev.avatar
                    }));
                } else {
                    upsertOther(p); // render.js handles interpolation window
                }
            }
            markDirty();
            return;
        }

        // Player joined
        if ((msg.action === "player_joined" || msg.action === "player-joined") && joined) {
            for (const [name, data] of Object.entries(msg.avatars || {})) {
                await cacheAvatar(name, data);
            }
            const p = msg.player || msg.data || null;
            if (p && String(p.id) !== String(myId)) {
                upsertOther(p); // will set up initial window (t0==t1)
                markDirty();
            }
            return;
        }

        // Player left
        if ((msg.action === "player_left" || msg.action === "player-left" || msg.action === "player_left_game") && joined) {
            const id = msg.playerId || msg.id || msg.data?.id;
            if (id != null && String(id) !== String(myId)) {
                removeOther(id);
                markDirty();
            }
            return;
        }

        // Avatar packs update
        if (msg.action === "avatars" && msg.avatars) {
            for (const [name, data] of Object.entries(msg.avatars)) {
                await cacheAvatar(name, data);
            }
            markDirty();
        }
    });

    ws.addEventListener("close", () => { joined = false; myId = null; });
}

export function sendMove(direction) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ action: "move", direction }));
    }
}

export function sendStop(direction) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ action: "stop", direction }));
    }
}
