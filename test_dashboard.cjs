const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', err => console.log('PAGE ERROR:', err.message));
  
  await page.goto('http://localhost:3011');
  
  // Wait for the Dashboard nav tab to be visible
  await page.waitForSelector('.nav-tab:has-text("Dashboard")');
  
  // Click the Dashboard tab
  console.log("Clicking Dashboard tab...");
  await page.click('.nav-tab:has-text("Dashboard")');
  
  // Wait a moment and check if #tab-dashboard has class 'active'
  await page.waitForTimeout(1000);
  
  const isDashboardActive = await page.evaluate(() => {
    return document.getElementById('tab-dashboard').classList.contains('active');
  });
  console.log("Is Dashboard active?", isDashboardActive);
  
  // Also check what is currently active
  const activeTabs = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('.view.active')).map(v => v.id);
  });
  console.log("Currently active views:", activeTabs);
  
  await browser.close();
})();
