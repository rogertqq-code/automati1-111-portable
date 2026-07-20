import { default as Camoufox } from 'camoufox-js';
async function run() {
    const cf = await Camoufox({ headless: false });
    console.log(cf.executablePath());
    await cf.close();
}
run();
