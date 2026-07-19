const def = 42;
const raw = "-0";
const trimmed = raw.trim();
const n = parseInt(trimmed, 10);
const stripped = trimmed.startsWith('+') ? trimmed.slice(1) : trimmed;
console.log(!Number.isFinite(n) || `${n}` !== stripped);
