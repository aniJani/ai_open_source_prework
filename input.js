import { sendMove, sendStop } from "./net.js";
import { setInputState } from "./render.js";

const pressed = new Set(); // "north" | "south" | "east" | "west"

function keyToDir(e) {
    switch (e.key) {
        case "ArrowUp": return "north";
        case "ArrowDown": return "south";
        case "ArrowLeft": return "west";
        case "ArrowRight": return "east";
        default: return null;
    }
}

export function initInput() {
    window.addEventListener("keydown", (e) => {
        const dir = keyToDir(e);
        if (!dir) return;
        e.preventDefault();

        // send one move per keydown (including auto-repeat)
        sendMove(dir);

        pressed.add(dir);
        setInputState(new Set(pressed));
    }, { passive: false });

    window.addEventListener("keyup", (e) => {
        const dir = keyToDir(e);
        if (!dir) return;
        e.preventDefault();

        pressed.delete(dir);
        setInputState(new Set(pressed));
        sendStop(dir);
    }, { passive: false });

    window.addEventListener("blur", () => {
        pressed.clear();
        setInputState(new Set());
    });
}
