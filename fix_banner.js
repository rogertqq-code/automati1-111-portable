const fs = require("fs");
let code = fs.readFileSync("src/targets/universal-login.ts", "utf8");
code = code.replace(
  `page.locator('.coi-banner__accept, [data-coi-btn="accept"], button:has-text("ACCEPT ALL"), button:has-text("Accept All")').first()`,
  `page.locator('.coi-banner__accept, [data-coi-btn="accept"], text="ACCEPT ALL", text="Accept All", text="Accept All Cookies", text="Accept"').first()`
);
fs.writeFileSync("src/targets/universal-login.ts", code);
console.log("Fixed banner locator!");
