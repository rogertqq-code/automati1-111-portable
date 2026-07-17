const fs = require('fs');
const execSync = require('child_process').execSync;
try {
  execSync('npx eslint "src/**/*.ts" "tests/**/*.ts" -f json > lint-results.json', { stdio: 'pipe' });
} catch (e) {
  // ignore exit code 1
}
const txt = fs.readFileSync('lint-results.json', 'utf8');
const r = JSON.parse(txt);
const c = r.map(f => ({
  file: f.filePath.replace(process.cwd(), ''),
  errors: f.errorCount,
  warnings: f.warningCount
})).filter(x => x.errors > 0).sort((a, b) => b.errors - a.errors).slice(0, 15);
console.table(c);
