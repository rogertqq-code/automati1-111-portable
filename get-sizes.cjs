const fs = require('fs');
const path = require('path');

function getFiles(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach(file => {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat && stat.isDirectory()) {
      results = results.concat(getFiles(fullPath));
    } else if (fullPath.endsWith('.ts')) {
      results.push({ path: fullPath, size: stat.size });
    }
  });
  return results;
}

const files = getFiles(path.join(process.cwd(), 'src'));
files.sort((a, b) => a.size - b.size);

// Just print the top 10 smallest, 10 medium, 10 largest to avoid blowing up the console
console.log("TOTAL FILES: ", files.length);
console.log("\nSMALLEST 5:");
files.slice(0, 5).forEach(f => console.log(`${f.size} bytes - ${f.path}`));
console.log("\nLARGEST 5:");
files.slice(-5).forEach(f => console.log(`${f.size} bytes - ${f.path}`));
