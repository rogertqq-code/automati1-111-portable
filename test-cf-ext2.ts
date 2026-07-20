import { createStealthSession } from "./backends/stealth.js";
async function run() {
    const s = await createStealthSession({ headless: false });
    const bounds = await s.page.evaluate(() => ({
        x: window.screenX,
        y: window.screenY,
        w: window.outerWidth,
        h: window.outerHeight
    }));
    console.log("BOUNDS WITH EXTENSION:", bounds);
    await new Promise(r => setTimeout(r, 2000));
    try { await s.session.close(); } catch {}
}
run();
