const fs = require('fs');
const file = 'src/stealth/stealth-scripts.ts';
let code = fs.readFileSync(file, 'utf8');

// Replace implementations with re-exports or just remove them if not needed to be exported
code = code.replace(/\/\*\*[\s\S]*?export function getScreenNoiseScript\([\s\S]*?\n\}/m, '');
code = code.replace(/export function getCssMediaQueryCoherenceScript\([\s\S]*?\n\}/m, '');
code = code.replace(/\/\*\*[\s\S]*?export function getDeviceMotionSpoofScript\([\s\S]*?\n\}/m, '');
code = code.replace(/\/\*\*[\s\S]*?export function getDynamicBatterySpoofScript\([\s\S]*?\n\}/m, '');

const imports = `
import { getScreenNoiseScript, getCssMediaQueryCoherenceScript } from './scripts/screen-spoofs.js';
import { getDeviceMotionSpoofScript, getDynamicBatterySpoofScript } from './scripts/sensor-spoofs.js';
`;

// Insert after existing imports (around line 59)
code = code.replace(/(import \{[\s\S]*?\} from "\.\/scripts\/hardware-rotation\.js";)/, `$1\n${imports}`);

// Add to the bottom export {}
code = code.replace(/export \{/, `export {\n  getScreenNoiseScript,\n  getCssMediaQueryCoherenceScript,\n  getDeviceMotionSpoofScript,\n  getDynamicBatterySpoofScript,`);

fs.writeFileSync(file, code);
