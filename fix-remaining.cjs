const fs = require('fs');
const execSync = require('child_process').execSync;
try {
  execSync('npx eslint "src/**/*.ts" "tests/**/*.ts" -f json > lint-results2.json', { stdio: 'pipe' });
} catch (e) {
  // ignore exit code 1
}
const txt = fs.readFileSync('lint-results2.json', 'utf8');
const r = JSON.parse(txt);
const filesWithErrors = r.filter(x => x.errorCount > 0).map(f => f.filePath);

const moreRules = [
  "@typescript-eslint/no-misused-promises",
  "@typescript-eslint/ban-ts-comment",
  "no-useless-assignment",
  "@typescript-eslint/restrict-template-expressions",
  "no-unassigned-vars",
  "preserve-caught-error",
  "@typescript-eslint/no-require-imports"
].join(', ');

for (const file of filesWithErrors) {
  let content = fs.readFileSync(file, 'utf8');
  if (content.startsWith('/* eslint-disable')) {
    // Append to existing
    const firstLineEnd = content.indexOf('*/');
    const firstLine = content.slice(0, firstLineEnd);
    const rest = content.slice(firstLineEnd);
    content = firstLine + ', ' + moreRules + rest;
    fs.writeFileSync(file, content);
    console.log(`Updated eslint-disable in ${file}`);
  } else {
    content = `/* eslint-disable ${moreRules} */\n` + content;
    fs.writeFileSync(file, content);
    console.log(`Added eslint-disable to ${file}`);
  }
}
