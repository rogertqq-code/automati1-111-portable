const fs = require('fs');
let code = fs.readFileSync('src/core/engine.ts', 'utf8');

const t1 = `    const mutationRetryCounts = new Map<number, number>();
    for (let attemptIdx = 0; attemptIdx < passwords.length; attemptIdx++) {`;
const r1 = `    const mutationRetryCounts = new Map<number, number>();
    const attemptOutcomes: string[] = [];
    for (let attemptIdx = 0; attemptIdx < passwords.length; attemptIdx++) {`;
code = code.replace(t1, r1);

const validation = `
          let validNoAccount = true;
          for (let i = 0; i < 4; i++) {
            const r = i === 3 ? response : attemptOutcomes[i];
            if (r === "incorrect") continue;
            if (r === "timeout") {
              if (i === 0) validNoAccount = false;
            } else {
              validNoAccount = false;
            }
          }
          if (validNoAccount) {
            this.log("WARN", \`  \${site.name}: Strict 4-attempt sequence validated — confirmed no_account\`);
            $1
            return { outcome: "noaccount", attempts: attemptNum };
          } else {
            this.log("WARN", \`  \${site.name}: 4 attempts reached but strict no_account criteria failed. Returning "other"\`);
            $1
            return { outcome: "other", attempts: attemptNum };
          }
`;

const t2 = `          this.log("WARN", \`  \${site.name}: \${response} on attempt 4 — confirmed no_account\`);
          await this.smartAttemptPause(page);
          return { outcome: "noaccount", attempts: attemptNum };`;
code = code.replace(t2, validation.replace(/\$1/g, 'await this.smartAttemptPause(page);'));

const t3 = `        // If bypassed, we need to manually continue the loop for incorrect passwords
        lastResponse = response;
        if (attemptNum < 4) {
          await this.smartAttemptPause(page);
          continue;
        }
        return { outcome: "noaccount", attempts: attemptNum };`;
const r3 = `        // If bypassed, we need to manually continue the loop for incorrect passwords
        lastResponse = response;
        if (attemptNum < 4) {
          await this.smartAttemptPause(page);
          continue;
        }
` + validation.replace(/\$1/g, '');
code = code.replace(t3, r3);

const t4 = `      lastResponse = response;
      if (attemptNum < 4) {
        this.log("WARN", \`  \${site.name}: \${response} on attempt \${attemptNum} — trying next password\`);
        await page.waitForLoadState('networkidle', { timeout: 2000 }).catch(() => { });
        // Removed massive multi-second interDelay to ensure millisecond optimization
      } else {
        this.log("WARN", \`  \${site.name}: \${response} on attempt 4 — confirmed no_account\`);
        await page.waitForLoadState('networkidle', { timeout: 2000 }).catch(() => { });
        return { outcome: "noaccount", attempts: attemptNum };
      }`;
const r4 = `      lastResponse = response;
      attemptOutcomes.push(response || "unknown");
      if (attemptNum < 4) {
        this.log("WARN", \`  \${site.name}: \${response} on attempt \${attemptNum} — trying next password\`);
        await page.waitForLoadState('networkidle', { timeout: 2000 }).catch(() => { });
        // Removed massive multi-second interDelay to ensure millisecond optimization
      } else {
` + validation.replace(/\$1/g, "await page.waitForLoadState('networkidle', { timeout: 2000 }).catch(() => { });") + `      }`;
code = code.replace(t4, r4);

fs.writeFileSync('src/core/engine.ts', code);
console.log("Successfully replaced file content!");
