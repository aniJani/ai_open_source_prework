import { world } from "./render.js";

export function computeCamera(me, viewW, viewH) {
    let camX = Math.round(me.x - viewW / 2);
    let camY = Math.round(me.y - viewH / 2);

    const maxX = Math.max(0, world.w - viewW);
    const maxY = Math.max(0, world.h - viewH);

    camX = Math.min(Math.max(camX, 0), maxX);
    camY = Math.min(Math.max(camY, 0), maxY);

    return { x: camX, y: camY };
}
