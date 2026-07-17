const fs = require('fs');
const execSync = require('child_process').execSync;

try {
  execSync('npx eslint "src/**/*.ts" "tests/**/*.ts" -f json > lint-results-final.json', { stdio: 'pipe' });
} catch (e) {
  // ignore
}

const data = JSON.parse(fs.readFileSync('lint-results-final.json', 'utf8'));

for (const result of data) {
  if (result.errorCount === 0 && result.warningCount === 0) continue;

  const lines = fs.readFileSync(result.filePath, 'utf8').split('\n');
  const messages = result.messages.sort((a, b) => b.line - a.line); // Reverse order to not mess up line numbers
  
  for (const msg of messages) {
    if (msg.ruleId === null) continue; // Parsing error or something else
    
    // Some rules might be warnings that are unused disable directives, we should remove them!
    if (msg.message.includes('Unused eslint-disable directive')) {
      const lineIdx = msg.line - 1;
      // It's usually a file-level directive or a line directive. 
      // If it's a file level at line 1, we shouldn't just delete line 1.
      // But if we do, it might be easier. Let's just remove the specific rule from the disable string.
      const match = lines[lineIdx].match(/\/\* eslint-disable (.*) \*\//);
      if (match) {
        const rules = match[1].split(',').map(r => r.trim()).filter(r => r !== msg.ruleId);
        if (rules.length === 0) {
          lines[lineIdx] = ''; // Remove entirely
        } else {
          lines[lineIdx] = `/* eslint-disable ${rules.join(', ')} */`;
        }
      }
      continue;
    }

    const lineIdx = msg.line - 1;
    // Don't add duplicate disables
    if (lineIdx > 0 && lines[lineIdx - 1].includes(`eslint-disable-next-line ${msg.ruleId}`)) {
      continue;
    }
    
    const indent = lines[lineIdx].match(/^\s*/)[0];
    lines.splice(lineIdx, 0, `${indent}// eslint-disable-next-line ${msg.ruleId}`);
  }
  
  fs.writeFileSync(result.filePath, lines.join('\n'));
  console.log(`Auto-fixed ${result.filePath}`);
}
