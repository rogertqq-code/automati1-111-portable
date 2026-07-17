/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Page } from "playwright-core";
import { codegenExporter } from "../services/codegen-exporter.js";


export interface AutomatiWindow extends Window {
  [key: symbol]: any;
  __automatiCookieDismissed?: boolean;
  __automatiSubmitObserverResult?: any;
  __automatiErrorBaseline?: string;
  __hermesMutationTelemetry?: (data: any) => void;
  __automatiCleanupObservers?: () => void;
}

export interface AutomatiPage {
  __canonicalLoginObserverInstalled?: boolean;
  __mousePos?: { x: number; y: number };
  __sessionId?: string;
  evaluate: any;
}

// ── Minimalist/Instant implementation enforcing strict-instant-injection ──

export interface Point { x: number; y: number; }


function setMousePos(page: Page, x: number, y: number): void {
  if (!(page as unknown as AutomatiPage).__mousePos) (page as unknown as AutomatiPage).__mousePos = { x, y };
  else { (page as unknown as AutomatiPage).__mousePos!.x = x; (page as unknown as AutomatiPage).__mousePos!.y = y; }
}

export async function humanMouseMove(
  page: Page,
  toX: number,
  toY: number,
  _speedFactor: number = 1.0,
): Promise<void> {
  // STRICT RULE: ultrafast max 200ms per movement rule.
  // Playwright distributes movement over steps. 5-15 steps introduces ~20-200ms delay.
  const steps = Math.floor(Math.random() * 10) + 5;
  await page.mouse.move(Math.round(toX), Math.round(toY), { steps });
  setMousePos(page, toX, toY);
}

export async function injectMicroTremor(
  _page: Page,
  _baseX: number,
  _baseY: number,
  _durationMs: number,
): Promise<void> {
  // STRICT RULE: Zero wasted milliseconds. Bypassing tremor.
}

export async function humanScroll(
  page: Page,
  targetDelta: number,
): Promise<void> {
  await page.mouse.wheel(0, Math.round(targetDelta));
}

export function resetMousePosition(x: number = 400, y: number = 300, page?: Page): void {
  if (page) {
    setMousePos(page, x, y);
  }
}

export function getSafeRestingPosition(viewportWidth: number, viewportHeight: number): Point {
  return { x: viewportWidth / 2, y: viewportHeight / 2 };
}

export async function humanClick(page: Page): Promise<void> {
  // Ultrafast click
  await page.mouse.down();
  await new Promise(r => setTimeout(r, Math.floor(Math.random() * 30)));
  await page.mouse.up();
}

export async function humanClickAt(
  page: Page,
  x: number,
  y: number,
  options?: { clickCount?: number; skipJitter?: boolean },
): Promise<void> {
  if ((page as unknown as AutomatiPage).__sessionId) {
    codegenExporter.logAction((page as unknown as AutomatiPage).__sessionId!, `await page.mouse.click(${Math.round(x)}, ${Math.round(y)});`);
  }
  const count = options?.clickCount ?? 1;
  const targetX = Math.round(x);
  const targetY = Math.round(y);
  
  for (let c = 0; c < count; c++) {
    await page.mouse.move(targetX, targetY);
    await page.mouse.down();
    await new Promise(r => setTimeout(r, Math.floor(Math.random() * 30)));
    await page.mouse.up();
    if (c < count - 1) await new Promise(r => setTimeout(r, Math.floor(Math.random() * 30) + 10));
  }
  setMousePos(page, targetX, targetY);
}

export async function humanClickSelector(
  page: Page,
  selector: string,
  opts?: { force?: boolean; timeout?: number; clickCount?: number; description?: string },
): Promise<void> {
  if ((page as unknown as AutomatiPage).__sessionId) {
    codegenExporter.logAction((page as unknown as AutomatiPage).__sessionId!, `await page.click('${selector}');`);
  }
  
  // STRICT RULE: native click with ultrafast max 30ms delay
  await page.click(selector, {
    delay: Math.floor(Math.random() * 30),
    force: opts?.force,
    timeout: opts?.timeout,
    clickCount: opts?.clickCount ?? 1,
  });
}
