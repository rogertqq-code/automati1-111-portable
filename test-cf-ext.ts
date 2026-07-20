import { createStealthSession } from "./backends/stealth.js";
import fs from 'fs';
import path from 'path';

async function run() {
    const s = await createStealthSession({ headless: false });
    await new Promise(r => setTimeout(r, 2000));
    try { await s.session.close(); } catch {}
}
run();
