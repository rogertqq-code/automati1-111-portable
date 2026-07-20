import { createStealthSession } from "./backends/stealth.js";
async function run() {
    const s = await createStealthSession({ headless: false });
    await s.page.goto('about:blank');
    await s.page.evaluate(() => {
        window.moveTo(100, 100);
        window.resizeTo(800, 600);
    });
    const bounds = await s.page.evaluate(() => ({
        x: window.screenX,
        y: window.screenY,
        w: window.outerWidth,
        h: window.outerHeight
    }));
    console.log("BOUNDS:", bounds);
    await new Promise(r => setTimeout(r, 2000));
    await s.browser.close();
}
run();
