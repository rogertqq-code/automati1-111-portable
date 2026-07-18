import { test, expect } from '@playwright/test';

test.describe('Visual Regression Baseline - Login Modals', () => {
  test('Joe Fortune Login Modal Baseline', async ({ page }) => {
    await page.goto('https://www.joefortune.zone');
    
    // Attempt to trigger the login modal if it's not present natively
    const loginBtn = page.locator('header').locator('text="Login"').first();
    if (await loginBtn.isVisible()) {
      await loginBtn.click();
    }

    // Wait for the login form to appear
    const loginForm = page.locator('form').filter({ has: page.locator('input[type="password"]') }).first();
    await expect(loginForm).toBeVisible({ timeout: 15000 });

    // Assert visual baseline of the modal layout
    // This catches silent UI changes, injected hidden captchas, or structural shifts
    // that standard CSS selectors miss.
    await expect(loginForm).toHaveScreenshot('joe-fortune-login-modal.png', {
      maxDiffPixelRatio: 0.05 // Allow slight rendering differences across CI runs
    });
  });

  test('Ignition Casino Login Modal Baseline', async ({ page }) => {
    await page.goto('https://www.ignitioncasino.eu');
    
    // Wait for the login form to appear
    const loginForm = page.locator('form').filter({ has: page.locator('input[type="password"]') }).first();
    await expect(loginForm).toBeVisible({ timeout: 15000 });

    // Assert visual baseline
    await expect(loginForm).toHaveScreenshot('ignition-login-modal.png', {
      maxDiffPixelRatio: 0.05
    });
  });
});
