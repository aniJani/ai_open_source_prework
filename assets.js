// Caches avatar frames (as ImageBitmaps when possible) and pre-renders username labels.

export const avatars = new Map(); // name -> { name, frames: {north:[], south:[], east:[], west:[]} }
export const labels = new Map();  // playerId -> { canvas, w, h }

// Load an image URL and return an ImageBitmap when supported, else HTMLImageElement.
async function loadImage(src) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = async () => {
            try {
                if ("createImageBitmap" in window) {
                    const bmp = await createImageBitmap(img);
                    resolve(bmp);
                } else {
                    resolve(img);
                }
            } catch {
                resolve(img);
            }
        };
        img.onerror = reject;
        img.src = src;
    });
}

// Ensure ImageBitmap when possible.
async function toBitmap(node) {
    if ("createImageBitmap" in window) {
        try { return await createImageBitmap(node); } catch { }
    }
    return node;
}

// Flip horizontally; keep bottom-center anchor consistent via draw at (-w,0)
async function flipImage(imgLike) {
    const w = imgLike.width, h = imgLike.height;
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const g = c.getContext("2d");
    g.scale(-1, 1);
    g.drawImage(imgLike, -w, 0);
    return toBitmap(c);
}

export async function cacheAvatar(name, data) {
    if (avatars.has(name)) return avatars.get(name);

    const loadList = async (list = []) => Promise.all(list.map(loadImage));

    const frames = {};
    frames.north = await loadList(data?.frames?.north || []);
    frames.south = await loadList(data?.frames?.south || []);
    frames.east = await loadList(data?.frames?.east || []);

    if (data?.frames?.west?.length) {
        frames.west = await loadList(data.frames.west);
    } else if (frames.east.length) {
        frames.west = await Promise.all(frames.east.map(flipImage));
    } else {
        frames.west = []; // fallback handled at draw-time
    }

    const pack = { name, frames };
    avatars.set(name, pack);
    return pack;
}

export function getLabel(id, username) {
    if (labels.has(id)) return labels.get(id);

    const padX = 6, padY = 3;
    const c = document.createElement("canvas");
    const t = c.getContext("2d");
    t.font = "14px system-ui, -apple-system, Segoe UI, Roboto, Arial";
    const w = Math.ceil(t.measureText(username).width) + padX * 2;
    const h = 18 + padY * 2;
    c.width = w; c.height = h;

    // pill background
    t.fillStyle = "rgba(0,0,0,0.6)";
    t.strokeStyle = "rgba(255,255,255,0.35)";
    const r = 8;
    t.beginPath();
    t.moveTo(r, 0);
    t.arcTo(w, 0, w, h, r);
    t.arcTo(w, h, 0, h, r);
    t.arcTo(0, h, 0, 0, r);
    t.arcTo(0, 0, w, 0, r);
    t.closePath();
    t.fill();
    t.stroke();

    t.font = "14px system-ui, -apple-system, Segoe UI, Roboto, Arial";
    t.fillStyle = "#fff";
    t.textBaseline = "middle";
    t.fillText(username, padX, h / 2);

    const label = { canvas: c, w, h };
    labels.set(id, label);
    return label;
}
