const fs = require('fs');
const file = 'src/stealth/stealth-scripts.ts';
let code = fs.readFileSync(file, 'utf8');

// Insert imports at the top
const imports = `
import { getScreenNoiseScript, getCssMediaQueryCoherenceScript } from './scripts/screen-spoofs.js';
import { getDeviceMotionSpoofScript, getDynamicBatterySpoofScript } from './scripts/sensor-spoofs.js';
`;
code = code.replace(/(import \{[\s\S]*?\} from "\.\/scripts\/hardware-rotation\.js";)/, `$1\n${imports}`);

// We want to completely remove the functions from stealth-scripts.ts
// We can use a regex that matches the function up to the closing brace that is at the start of a line
code = code.replace(/\/\*\*[\s\S]*?export function getDeviceMotionSpoofScript\([\s\S]*?^}$/gm, '');
code = code.replace(/\/\*\*[\s\S]*?export function getDynamicBatterySpoofScript\([\s\S]*?^}$/gm, '');
code = code.replace(/export function getScreenNoiseScript\([\s\S]*?^}$/gm, '');
code = code.replace(/export function getCssMediaQueryCoherenceScript\([\s\S]*?^}$/gm, '');

// Re-export
code = code.replace(/export \{/, `export {\n  getScreenNoiseScript,\n  getCssMediaQueryCoherenceScript,\n  getDeviceMotionSpoofScript,\n  getDynamicBatterySpoofScript,`);

fs.writeFileSync(file, code);
