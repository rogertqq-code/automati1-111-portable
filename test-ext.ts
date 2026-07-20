import { createStealthSession } from "./backends/stealth.js";
import fs from 'fs';
import path from 'path';

async function run() {
    // Create a temporary WebExtension
    const extDir = path.join(process.cwd(), 'temp_resizer_ext');
    if (!fs.existsSync(extDir)) fs.mkdirSync(extDir);
    
    fs.writeFileSync(path.join(extDir, 'manifest.json'), JSON.stringify({
        "manifest_version": 2,
        "name": "Window Resizer",
        "version": "1.0",
        "background": {
            "scripts": ["background.js"]
        },
        "permissions": ["windows"]
    }));
    
    fs.writeFileSync(path.join(extDir, 'background.js'), `
        browser.windows.getCurrent().then(win => {
            browser.windows.update(win.id, { left: 100, top: 100, width: 800, height: 600 });
        });
    `);

    // We can load it via Camoufox options or Playwright? 
    // Camoufox-js has an `addons` array! We just pass the path to the extension!
    console.log("Created extension at", extDir);
    
    const s = await createStealthSession({ headless: false });
    // Let's modify the stealth backend manually to load this addon for a test
    // Actually we can't easily pass it without modifying stealth.ts
}
run();
