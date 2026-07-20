import { createStealthSession } from "./backends/stealth.js";
async function run() {
    const s = await createStealthSession({ headless: false });
    await new Promise(r => setTimeout(r, 10000));
    await s.browser.close();
}
run();
