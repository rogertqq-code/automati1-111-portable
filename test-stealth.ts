import { createStealthSession } from "./backends/stealth.js";
import { ConfigStore } from "./src/core/config-store.js";
import { gridBounds } from "./src/services/browser-tiler.js";

async function main() {
    console.log("Setting config to concurrency 4...");
    const config = ConfigStore.load();
    config.concurrency = 4;
    ConfigStore.save(config);

    console.log("Launching stealth-headed...");
    const session = await createStealthSession({
        headless: false,
        liveTest: false
    });

    console.log("Stealth session created.");
    await new Promise(r => setTimeout(r, 10000));

    console.log("Closing...");
    await session.browser.close();
    process.exit(0);
}

main().catch(console.error);
