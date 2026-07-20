import { createStealthSession } from "./backends/stealth.js";
import { ConfigStore } from "./src/core/config-store.js";

async function main() {
    const session = await createStealthSession({ headless: false, liveTest: false });
    await session.page.goto("https://example.com");
    console.log("Initial bounds:", await session.page.evaluate(() => ({ x: window.screenX, y: window.screenY, w: window.outerWidth, h: window.outerHeight })));
    await session.page.evaluate(() => { window.moveTo(0, 0); window.resizeTo(800, 600); });
    await new Promise(r => setTimeout(r, 1000));
    console.log("After bounds:", await session.page.evaluate(() => ({ x: window.screenX, y: window.screenY, w: window.outerWidth, h: window.outerHeight })));
    await session.browser.close();
}
main().catch(console.error);
