import { createStealthSession } from "./backends/stealth.js";
import fs from 'fs';
import path from 'path';

async function run() {
    const wrapperScript = path.join(process.cwd(), 'cf-wrapper.sh');
    fs.writeFileSync(wrapperScript, `#!/bin/bash
PROFILE_DIR=""
for ((i=1; i<=$#; i++)); do
  if [ "\${!i}" = "-profile" ]; then
    next=$((i+1))
    PROFILE_DIR="\${!next}"
    break
  fi
done
if [ -n "$PROFILE_DIR" ]; then
  echo '{"chrome://browser/content/browser.xhtml":{"main-window":{"screenX":"0","screenY":"31","width":"960","height":"540","sizemode":"normal"}}}' > "$PROFILE_DIR/xulstore.json"
fi
exec /Users/user298993/Library/Caches/camoufox/Camoufox.app/Contents/MacOS/camoufox "$@"
`, { mode: 0o755 });

    const s = await createStealthSession({ headless: false, wrapperPath: wrapperScript });
    const bounds = await s.page.evaluate(() => ({
        x: window.screenX,
        y: window.screenY,
        w: window.outerWidth,
        h: window.outerHeight
    }));
    console.log("BOUNDS WITH WRAPPER:", bounds);
    await new Promise(r => setTimeout(r, 2000));
    try { await s.session.close(); } catch {}
}
run();
