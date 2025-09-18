import { initInput } from "./input.js";
import { connect } from "./net.js";
import { resizeCanvas, startLoop } from "./render.js";

window.addEventListener("resize", resizeCanvas);

window.addEventListener("DOMContentLoaded", () => {
    resizeCanvas();
    connect("Janit");
    initInput();
    startLoop();
});
