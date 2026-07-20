import { createStealthSession } from "./backends/stealth.js";
import fs from 'fs';
import path from 'path';

async function run() {
    const wrapperScript = path.join(process.cwd(), 'cf-wrapper2.sh');
    fs.writeFileSync(wrapperScript, `#!/bin/bash
echo "ARGS: $@" > wrapper_args.log
exec /Users/user298993/Library/Caches/camoufox/Camoufox.app/Contents/MacOS/camoufox "$@"
`, { mode: 0o755 });

    const s = await createStealthSession({ headless: false, wrapperPath: wrapperScript });
    await new Promise(r => setTimeout(r, 2000));
    try { await s.session.close(); } catch {}
}
run();
