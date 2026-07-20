import { createStealthSession } from "./backends/stealth.js";
import fs from 'fs';
import path from 'path';
import os from 'os';

async function run() {
    // Generate the dynamic extension
    const extDir = path.join(process.cwd(), 'data', 'temp_profiles', `dynamic_ext_${Date.now()}`);
    if (!fs.existsSync(extDir)) fs.mkdirSync(extDir, { recursive: true });
    
    fs.writeFileSync(path.join(extDir, 'manifest.json'), JSON.stringify({
        "manifest_version": 2,
        "name": "Dynamic Resizer",
        "version": "1.0",
        "background": { "scripts": ["background.js"] },
        "content_scripts": [{
            "matches": ["<all_urls>"],
            "js": ["content.js"]
        }],
        "permissions": ["windows", "<all_urls>"]
    }));
    
    fs.writeFileSync(path.join(extDir, 'background.js'), `
        browser.runtime.onMessage.addListener((msg, sender) => {
            if (msg.type === "RESIZE_ME") {
                browser.windows.update(sender.tab.windowId, { left: msg.x, top: msg.y, width: msg.w, height: msg.h });
            }
        });
    `);
    
    fs.writeFileSync(path.join(extDir, 'content.js'), `
        window.addEventListener("message", (event) => {
            if (event.data && event.data.type === "RESIZE_ME") {
                browser.runtime.sendMessage(event.data);
            }
        });
    `);

    // We can't inject this directly into stealth.ts here without modifying it, 
    // but we can just modify stealth.ts directly for the test since we want to commit to this!
}
run();
