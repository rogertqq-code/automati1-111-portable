/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unused-vars, @typescript-eslint/require-await */
import { type ScreenBounds } from "../profiles/viewport-resolver.js";
import { type Page, type BrowserContext } from "playwright";
import { ConfigStore } from "../core/config-store.js";
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { windowManager } from "node-window-manager";
import { createLogger } from "../core/logger.js";

const log = createLogger("BrowserTiler");

// Improvement 4: Launch Focus Peeking Daemon (Windows-only)
try {
  if (process.platform === "win32") {
    const resizerExe = path.join(process.cwd(), "resizer.exe");
    if (fs.existsSync(resizerExe)) {
        // Spawn detached daemon
        const daemon = spawn(resizerExe, ["--daemon"], {
            detached: true,
            stdio: 'ignore'
        });
        daemon.on('error', (err) => {
          log.debug(`Focus Peeking daemon error: ${err.message}`);
        });
        daemon.unref(); // Don't block Node.js exit
    }
  }
} catch (e) {
  log.debug(`Failed to start Focus Peeking daemon: ${e instanceof Error ? e.message : String(e)}`);
}

/**
 * Universal Browser Tiler
 * 
 * Manages slots and mathematically calculates screen bounds for headed browser windows.
 * Can be imported by any automation backend to ensure consistent window packing.
 */
export class BrowserTiler {
  private totalWindows: number;
  private freeSlots: number[];
  private customGrid: {cols: number, rows: number} | null = null;
  private waiters: Array<(n: number) => void> = [];
  constructor(initialWindows: number = 1) {
    this.totalWindows = initialWindows;
    this.freeSlots = Array.from({ length: this.totalWindows }, (_, i) => i);
  }
  public getTotalWindows(): number {
    return this.totalWindows;
  }
  /**
   * Adjusts the total number of managed windows dynamically.
   * New slots are appended, while out-of-bounds slots are discarded.
   */
  public reconfigure(concurrency: number, customGrid?: {cols: number, rows: number}): void {
    if (customGrid) {
      this.customGrid = customGrid;
      concurrency = customGrid.cols * customGrid.rows;
    } else {
      this.customGrid = null;
    }
    if (concurrency > this.totalWindows) {
      for (let i = this.totalWindows; i < concurrency; i++) {
        this.freeSlots.push(i);
      }
      this.totalWindows = concurrency;
    } else if (concurrency < this.totalWindows) {
      this.totalWindows = concurrency;
      this.freeSlots = this.freeSlots.filter(slot => slot < this.totalWindows);
    }
  }
  /**
   * Acquires the next available slot number. Wait if none are available.
   */
  public async acquireSlot(): Promise<number> {
    if (this.freeSlots.length > 0) {
      return this.freeSlots.shift()!;
    }
    return new Promise<number>((resolve) => this.waiters.push(resolve));
  }
  /**
   * Releases a slot back into the available pool.
   */
  public releaseSlot(slot: number): void {
    if (this.waiters.length > 0) {
      const nextWaiter = this.waiters.shift()!;
      nextWaiter(slot);
    } else {
      this.freeSlots.push(slot);
    }
  }
  /**
   * Calculates dynamic (x, y, width, height) to pack windows evenly based on the current pool size.
   */
  public async getBounds(slot: number): Promise<ScreenBounds & { zOrder?: string, _emulateDpr?: number, _emulateMobile?: boolean } | null> {
    const config = ConfigStore.load();
    if (config.tilingLayout === "os-native") {
      return null;
    }

    const monitors = windowManager.getMonitors();
    if (monitors.length === 0) return null;

    // Distribute slots across multiple monitors
    const windowsPerMonitor = Math.ceil(this.totalWindows / monitors.length);
    const monitorIndex = Math.min(Math.floor(slot / windowsPerMonitor), monitors.length - 1);
    const localSlot = slot % windowsPerMonitor;
    const monitor = monitors[monitorIndex];
    if (!monitor) return null;
    
    // Improvement 3: Dynamic Taskbar Compensation
    // node-window-manager returns the raw resolution. We reserve the bottom 48px to emulate SPI_GETWORKAREA
    const TASKBAR_HEIGHT = 48;
    const rawScreen = monitor.getBounds();
    const screen = {
       x: rawScreen?.x ?? 0,
       y: rawScreen?.y ?? 0,
       width: rawScreen?.width ?? 1920,
       height: Math.max(10, (rawScreen?.height ?? 1080) - TASKBAR_HEIGHT)
    };
    
    if (this.totalWindows <= 1) {
      return { x: screen.x, y: screen.y, width: screen.width, height: screen.height };
    }
    
    const TILE_GAP = 6;
    
    // cols and rows will be calculated based on grid mode below

    // "cascading" or "messy desk" layout mode
    if (config.tilingLayout === "cascading") {
       let baseWidth = Math.floor(screen.width * 0.7);
       let baseHeight = Math.floor(screen.height * 0.7);
       
       // 50/50 Aspect Ratio Spin for Portrait
       if (Math.random() > 0.5) {
           const temp = baseWidth;
           baseWidth = Math.min(screen.width * 0.9, baseHeight);
           baseHeight = Math.min(screen.height * 0.9, temp);
       }
       
       const offsetX = (localSlot * 40) % Math.max(1, screen.width - baseWidth);
       const offsetY = (localSlot * 40) % Math.max(1, screen.height - baseHeight);
       
       const fuzzW = Math.floor(Math.random() * 20);
       const fuzzH = Math.floor(Math.random() * 20);
       
       const x = screen.x + offsetX;
       const y = screen.y + offsetY;
       const width = baseWidth + fuzzW;
       const height = baseHeight + fuzzH;
       
       const zOrder = Math.random() > 0.5 ? "TOP" : "BOTTOM";
       return { x, y, width, height, zOrder };
    }

    // Improvement 2 & 4: Chaos Mode (Top 100 Viewport Snapping)
    if (config.tilingLayout === "chaos") {
        try {
            const topViewportsPath = path.join(process.cwd(), 'data', 'top-viewports.json');
            if (fs.existsSync(topViewportsPath)) {
                const viewports = JSON.parse(fs.readFileSync(topViewportsPath, 'utf8')) as Array<{width: number; height: number; isMobile?: boolean; dpr?: number}>;
                const randomVp = viewports[Math.floor(Math.random() * viewports.length)];
                if (!randomVp) throw new Error("No viewports found in top-viewports.json");
                
                // Allow random flipping of orientation for tablets, but phones usually stay portrait
                let width = randomVp.width;
                let height = randomVp.height;
                if (!randomVp.isMobile && Math.random() > 0.5) {
                    width = randomVp.height;
                    height = randomVp.width;
                }
                
                // Ensure it fits on screen
                width = Math.min(width, screen.width - 20);
                height = Math.min(height, screen.height - 20);
                
                const x = screen.x + Math.floor(Math.random() * Math.max(1, screen.width - width));
                const y = screen.y + Math.floor(Math.random() * Math.max(1, screen.height - height));
                const zOrder = Math.random() > 0.5 ? "TOP" : "BOTTOM";
                
                // We pass dpr and isMobile back for the dynamic CDP swapping
                return { x, y, width, height, zOrder, _emulateDpr: randomVp.dpr, _emulateMobile: randomVp.isMobile };
            }
        } catch(e) {
            log.error(`Failed to load top-viewports.json: ${e instanceof Error ? e.message : String(e)}`);
        }
        
        // Fallback chaos mode
        const MIN_WIDTH = 320;
        const MIN_HEIGHT = 240;
        const maxWidth = Math.max(MIN_WIDTH + 1, Math.floor(screen.width * 0.8));
        const maxHeight = Math.max(MIN_HEIGHT + 1, Math.floor(screen.height * 0.8));
        
        let width = Math.floor(Math.random() * (maxWidth - MIN_WIDTH)) + MIN_WIDTH;
        let height = Math.floor(Math.random() * (maxHeight - MIN_HEIGHT)) + MIN_HEIGHT;
        
        if (Math.random() > 0.5 && width > height) {
           const temp = width;
           width = height;
           height = temp;
        }

        const x = screen.x + Math.floor(Math.random() * Math.max(1, screen.width - width));
        const y = screen.y + Math.floor(Math.random() * Math.max(1, screen.height - height));
        
        const zOrder = Math.random() > 0.5 ? "TOP" : "BOTTOM";
        return { x, y, width, height, zOrder };
    }

    // Improvement 1: Golden Ratio (Fibonacci) Splitting
    if (config.tilingLayout === "fibonacci") {
        let remainingWidth = screen.width;
        let remainingHeight = screen.height;
        let x = screen.x;
        let y = screen.y;
        
        for (let i = 0; i < localSlot; i++) {
            if (i % 2 === 0) {
                const chunk = Math.floor(remainingWidth * 0.618);
                x += chunk;
                remainingWidth -= chunk;
            } else {
                const chunk = Math.floor(remainingHeight * 0.618);
                y += chunk;
                remainingHeight -= chunk;
            }
        }
        
        let width = (localSlot % 2 === 0) ? Math.floor(remainingWidth * 0.618) : remainingWidth;
        let height = (localSlot % 2 === 1) ? Math.floor(remainingHeight * 0.618) : remainingHeight;
        
        if (localSlot === windowsPerMonitor - 1) {
            width = remainingWidth;
            height = remainingHeight;
        }

        // Apply natural human fuzzing to the fibonacci blocks
        width += (Math.random() > 0.5 ? 1 : -1) * (Math.floor(Math.random() * 4) + 1);
        height += (Math.random() > 0.5 ? 1 : -1) * (Math.floor(Math.random() * 4) + 1);
        
        return { x, y, width, height };
    }

    // OS-Native "Snap Layout" Fuzzing
    if (config.tilingLayout === "snap") {
        const snapWidth = Math.floor(screen.width / 2);
        const isLeft = (localSlot % 2) === 0;
        
        // Exact snap math +/- 1px variance
        const fuzzW = (Math.random() > 0.5 ? 1 : -1);
        const fuzzH = (Math.random() > 0.5 ? 1 : -1);
        
        const width = snapWidth + fuzzW;
        const height = screen.height + fuzzH;
        const x = screen.x + (isLeft ? 0 : snapWidth) + (Math.random() > 0.5 ? 1 : -1);
        const y = screen.y + (Math.random() > 0.5 ? 1 : -1);
        return { x, y, width, height };
    }

    let cols: number;
    let rows: number;
    if (this.customGrid) {
      cols = this.customGrid.cols;
      rows = this.customGrid.rows;
    } else if (config.tilingLayout === "portrait-grid" || config.tilingLayout === "horizontal") {
      cols = windowsPerMonitor;
      rows = 1;
    } else if (config.tilingLayout === "vertical") {
      cols = 1;
      rows = windowsPerMonitor;
    } else {
      // "auto" mode: Aspect-Aware Smart Grid
      if (screen.width > screen.height) {
         // Landscape monitor: Favor columns to push viewports into portrait ratio
         rows = Math.max(1, Math.floor(Math.sqrt(windowsPerMonitor)));
         cols = Math.ceil(windowsPerMonitor / rows);
      } else {
         // Portrait monitor: Favor rows
         cols = Math.max(1, Math.floor(Math.sqrt(windowsPerMonitor)));
         rows = Math.ceil(windowsPerMonitor / cols);
      }
    }
    
    const cellW = Math.floor(screen.width / cols);
    const cellH = Math.floor(screen.height / rows);
    
    const col = localSlot % cols;
    const row = Math.floor(localSlot / cols);
    
    const xBase = screen.x + col * cellW + TILE_GAP;
    const yBase = screen.y + row * cellH + TILE_GAP;
    const widthBase = Math.max(320, cellW - TILE_GAP * 2);
    const heightBase = Math.max(240, cellH - TILE_GAP * 2);

    // Humanized Dynamic Viewports: Micro-fuzzing (1 to 4 pixels)
    const fuzzW = Math.floor(Math.random() * 4) + 1;
    const fuzzH = Math.floor(Math.random() * 4) + 1;
    
    const offsetX = Math.floor(Math.random() * 4) + 1;
    const offsetY = Math.floor(Math.random() * 4) + 1;

    let width = widthBase - fuzzW;
    let height = heightBase - fuzzH;
    let x = xBase + offsetX;
    let y = yBase + offsetY;
    
    // Feature 3: Inner Viewport Minimum Constraints
    // Lowered to 320x240 to support true Portrait mode side-by-side!
    const MIN_WIDTH = 320;
    const MIN_HEIGHT = 240;
    
    if (width < MIN_WIDTH) {
       width = MIN_WIDTH;
       // Diagonal Z-Stacking Overlap Logic: Offset by slot index so top-left is always visible
       x = Math.max(screen.x, Math.min(screen.x + screen.width - width, x + (localSlot * 20)));
    }
    if (height < MIN_HEIGHT) {
       height = MIN_HEIGHT;
       y = Math.max(screen.y, Math.min(screen.y + screen.height - height, y + (localSlot * 20)));
    }
    
    return { x, y, width, height };
  }

  // Global lock to prevent concurrent PowerShell resize hooks from deadlocking Camoufox during launch

  /**
   * Enforces the OS window bounds natively.
   * @param backendName - The backend identifier (e.g., "stealth", "cloak-headed").
   *   Used to skip Chromium-only CDP commands and JS fingerprint overrides
   *   that conflict with Camoufox's C++ engine-level management (Rule 39).
   */
  public async enforceWindowBounds(page: Page, bounds: ScreenBounds & { zOrder?: string, _emulateDpr?: number, _emulateMobile?: boolean } | null, _browserPid?: number, backendName?: string): Promise<void> {
    return Promise.race([
      this._enforceWindowBounds(page, bounds, _browserPid, backendName),
      new Promise<void>((_, rej) => setTimeout(() => rej(new Error("BrowserTiler bounds enforcement timed out")), 10000))
    ]).catch(e => {
      log.warn(`[BrowserTiler] Bounds enforcement failed or timed out: ${e instanceof Error ? e.message : String(e)}`);
    });
  }

  private async _enforceWindowBounds(page: Page, bounds: ScreenBounds & { zOrder?: string, _emulateDpr?: number, _emulateMobile?: boolean } | null, _browserPid?: number, backendName?: string): Promise<void> {
    if (!bounds) return; // OS-native mode bypasses bounds entirely

    const isStealth = backendName?.startsWith("stealth") ?? false;

    try {
      // 1. Native OS Manipulation via C# Executable (Flawless Windows API Hook with <10ms overhead)
      // 1. Native OS Manipulation via C# Executable (Flawless Windows API Hook with <10ms overhead)
      try {
        if (!page) throw new Error("Page required for title injection");
        
        const uniqueTitle = "Automati_Tiling_" + Date.now() + "_" + Math.floor(Math.random() * 10000);
        log.info(`Injecting title for ${isStealth ? 'Firefox/Camoufox' : 'Chromium'} hook: ${uniqueTitle}`);
        await page.evaluate((newTitle: string) => {
           
          (window as any).__originalTitle = document.title;
          document.title = newTitle;
        }, uniqueTitle).catch(() => {});
        
        // Wait for OS to register the new title via a page round-trip
        // (deterministic: waits for Playwright evaluate to resolve rather than an arbitrary sleep)
        await page.evaluate(() => document.title).catch(() => {});
        
        const zOrder = bounds.zOrder ?? "TOP";
        const resizerExe = path.join(process.cwd(), "resizer.exe");
        
        let nativeTilingSuccess = false;
        
        if (process.platform === "win32" && fs.existsSync(resizerExe)) {
          const out = execFileSync(resizerExe, [
             uniqueTitle, 
             Math.floor(bounds.x).toString(), 
             Math.floor(bounds.y).toString(), 
             Math.floor(bounds.width).toString(), 
             Math.floor(bounds.height).toString(), 
             zOrder
          ], { encoding: "utf8" });
          
          log.info(`C# Native hook result: ${out.trim()}`);
          nativeTilingSuccess = out.includes("SUCCESS");
        } else if (process.platform === "win32") {
           log.warn(`Native C# resizer.exe not found at ${resizerExe}`);
        }

        // ── macOS AppleScript Tiling (DEPRECATED) ──
        // We no longer use osascript because it requires admin Accessibility rights
        if (!nativeTilingSuccess && process.platform === "darwin") {
           log.info(`macOS detected. Skipping AppleScript. Relying on Native CDP or JS Injection based on config.`);
        }

        // ── node-window-manager fallback (Issue 8 — Firefox/Camoufox tiling fix) ──
        // If resizer.exe failed or doesn't exist, use the already-imported
        // node-window-manager to find the window by its injected title and
        // call setBounds directly. This is the ONLY reliable method for
        // Firefox/Camoufox since:
        //   - CDP Browser.getWindowForTarget is Chromium-only
        //   - window.moveTo/resizeTo is blocked by dom.disable_window_move_resize
        // Works for Chromium too as a universal fallback.
        if (!nativeTilingSuccess && process.platform !== "darwin") {
          try {
            const allWindows = windowManager.getWindows();
            const target = allWindows.find((w: { getTitle: () => string; setBounds: (b: {x: number; y: number; width: number; height: number}) => void }) => {
              try { return w.getTitle().includes(uniqueTitle); } catch { return false; }
            });
            if (target) {
              target.setBounds({
                x: Math.floor(bounds.x),
                y: Math.floor(bounds.y),
                width: Math.floor(bounds.width),
                height: Math.floor(bounds.height),
              });
              log.info(`node-window-manager setBounds SUCCESS for "${uniqueTitle}" → ${bounds.width}x${bounds.height} @ (${bounds.x},${bounds.y})`);
              nativeTilingSuccess = true;
            } else {
              log.warn(`node-window-manager: No window found matching title "${uniqueTitle}" (${allWindows.length} windows scanned)`);
            }
          } catch (nwmErr: unknown) {
            log.warn(`node-window-manager fallback failed: ${nwmErr instanceof Error ? nwmErr.message : String(nwmErr)}`);
          }
        }
        
        // ── CDP Fallback (Chromium Only) ──
        if (!nativeTilingSuccess && !isStealth) {
          try {
             if (page.context) {
                 const context = page.context();
                 const cdp = await context.newCDPSession(page).catch(() => null);
                 if (cdp) {
                     const { windowId } = await cdp.send('Browser.getWindowForTarget').catch(() => ({ windowId: null }));
                     if (windowId) {
                         await cdp.send('Browser.setWindowBounds', {
                             windowId,
                             bounds: {
                                 windowState: 'normal',
                                 left: Math.floor(bounds.x),
                                 top: Math.floor(bounds.y),
                                 width: Math.floor(bounds.width),
                                 height: Math.floor(bounds.height)
                             }
                         });
                         log.info(`CDP Browser.setWindowBounds SUCCESS for "${uniqueTitle}" → ${bounds.width}x${bounds.height} @ (${bounds.x},${bounds.y})`);
                         nativeTilingSuccess = true;
                     }
                 }
             }
          } catch (cdpErr: any) {
             log.warn(`CDP bounds fallback failed: ${cdpErr.message}`);
          }
        }

        // ── Viewport Fallback (Firefox/Camoufox) ──
        if (!nativeTilingSuccess) {
             // Try to move it natively via JS if the profile injection didn't snap it perfectly
             try {
                await page.evaluate(({x, y, w, h}) => {
                   window.moveTo(x, y);
                   window.resizeTo(w, h);
                }, { x: Math.floor(bounds.x), y: Math.floor(bounds.y), w: Math.floor(bounds.width), h: Math.floor(bounds.height) });
                log.info(`JS window.moveTo/resizeTo fallback executed for ${uniqueTitle}`);
             } catch (e: any) {
                log.warn(`JS window.moveTo failed: ${e.message}`);
             }
           
           log.warn(`All native OS window moving methods failed for ${uniqueTitle}. Falling back to internal page.setViewportSize() so screenshots are correct.`);
           await page.setViewportSize({ width: Math.floor(bounds.width), height: Math.floor(bounds.height) }).catch(() => {});
           nativeTilingSuccess = true; // Mark as success so the flow continues smoothly
        }
        
        // Restore title
        await page.evaluate(() => {
          if (typeof (window as any).__originalTitle !== 'undefined') {
            document.title = (window as any).__originalTitle;
          }
        }).catch(() => {});
        
        if (nativeTilingSuccess) {
            // ── Post-tiling viewport enhancements (Chromium-only) ──
            // These CDP + addInitScript overrides are SKIPPED for stealth (Camoufox)
            // because Camoufox manages window.screen, outerWidth, outerHeight at the
            // C++ engine level. Layering JS overrides creates Frankenstein profiles
            // (Rule 39: strict-no-frankenstein-fingerprints).
            if (!isStealth) {
              try {
                if (page.context) {
                   const context = page.context();
                   const cdp = await context.newCDPSession(page).catch(() => null);
                   if (cdp) {
                     // Anti-Breakage CSS, Orientation Change, Scrollbar Randomization & Screen Property Fuzzing
                     await page.addInitScript((injectedBounds: ScreenBounds & { _emulateMobile?: boolean } | null) => {
                       const style = document.createElement('style');
                       const scrollbarWidth = Math.floor(Math.random() * 8) + 8; // 8px to 16px
                       
                       style.innerHTML = `
                           body, html { min-width: 100vw !important; max-width: 100vw !important; overflow-x: hidden !important; }
                           ::-webkit-scrollbar { width: ${scrollbarWidth}px !important; }
                       `;
                       document.addEventListener('DOMContentLoaded', () => document.head.appendChild(style));
                       
                       let lastWidth = window.innerWidth;
                       window.addEventListener('resize', () => {
                          if ((lastWidth < window.innerHeight && window.innerWidth > window.innerHeight) || 
                              (lastWidth > window.innerHeight && window.innerWidth < window.innerHeight)) {
                              window.dispatchEvent(new Event('orientationchange'));
                          }
                          lastWidth = window.innerWidth;
                       });

                       // Screen Property Fuzzing — ONLY for explicit mobile emulation
                       // For regular grid tiling, the real monitor screen dimensions MUST be
                       // preserved. Setting screen.width to a 370px tile cell creates a
                       // Frankenstein profile (desktop Chrome UA + mobile screen.width = bot flag).
                       if (injectedBounds && injectedBounds._emulateMobile) {
                           const fuzzedScreen = {
                               width: injectedBounds.width,
                               height: injectedBounds.height,
                               availWidth: injectedBounds.width,
                               availHeight: injectedBounds.height,
                               colorDepth: 24,
                               pixelDepth: 24,
                               orientation: { type: injectedBounds.width > injectedBounds.height ? "landscape-primary" : "portrait-primary", angle: 0 }
                           };
                           
                           Object.defineProperty(window, 'screen', {
                               get: () => fuzzedScreen
                           });
                           
                           // Mask outer dimensions to match inner when mimicking mobile
                           Object.defineProperty(window, 'outerWidth', { get: () => window.innerWidth });
                           Object.defineProperty(window, 'outerHeight', { get: () => window.innerHeight });
                       }
                     }, bounds).catch(() => {});

                     // Dynamic Mobile / Touch Emulation (Chromium CDP only)
                     // ONLY when explicitly requested by chaos/viewport layout — NEVER auto-detect from width
                     // Auto-detection at width < 600 was corrupting all headed audits (grid cells are ~370px)
                     if (bounds._emulateMobile) {
                         log.info(`Explicit mobile emulation requested for bounds ${bounds.width}px. Enabling Touch & UA.`);
                         await cdp.send('Emulation.setDeviceMetricsOverride', {
                             width: 0, // 0 = inherit from OS window
                             height: 0,
                             deviceScaleFactor: bounds._emulateDpr || 2.5,
                             mobile: true
                         }).catch(() => {});
                         
                         await cdp.send('Emulation.setTouchEmulationEnabled', {
                             enabled: true,
                             maxTouchPoints: 5
                         }).catch(() => {});
                         
                         await cdp.send('Network.setUserAgentOverride', {
                             userAgent: 'Mozilla/5.0 (Linux; Android 13; Pixel 7 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Mobile Safari/537.36',
                             platform: 'Android'
                         }).catch(() => {});
                     }
                   }
                }
              } catch (e) {
                log.debug(`Failed to inject CDP Viewport Emulation: ${String(e)}`);
              }
            } else {
              log.info(`Skipping CDP/screen overrides for stealth backend (Camoufox manages these natively)`);
            }
            return; // Successfully tiled
          }
      } catch (e) {
        log.warn(`Native tiling hook failed, falling back to CDP/JS: ${e instanceof Error ? e.message : String(e)}`);
      }

    // 2. Chromium CDP Fallback (skipped for Firefox/Juggler — not implemented)
    if (!isStealth) {
      try {
        const client = await page.context().newCDPSession(page);
        const { windowId } = await client.send('Browser.getWindowForTarget');
        await client.send('Browser.setWindowBounds', {
          windowId,
          bounds: {
            left: bounds.x,
            top: bounds.y,
            width: bounds.width,
            height: bounds.height,
            windowState: 'normal'
          }
        });
        client.detach().catch(() => {});
        return;
      } catch (e) {
        // Falls through to JS fallback
      }
    }

    // 3. Firefox/JS Fallback — window.moveTo/resizeTo
    // NOTE: For Camoufox, this only works if firefoxUserPrefs has
    // 'dom.disable_window_move_resize': false (set in stealth.ts).
    try {
      await page.evaluate((b: {x: number, y: number, w: number, h: number}) => {
        window.moveTo(b.x, b.y);
        window.resizeTo(b.w, b.h);
      }, {x: bounds.x, y: bounds.y, w: bounds.width, h: bounds.height}).catch(() => {});
    } catch (fallbackErr) {
      log.warn(`Failed to enforce window bounds via all methods: ${fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr)}`);
    }
    } finally {
      // Empty, no longer need Mutex!
    }
  }
}
// Export a universal global instance
export const globalTiler = new BrowserTiler(1);

export function disableBookmarksBar(userDataDir: string): void {
  try {
    const defaultDir = path.join(userDataDir, "Default");
    if (!fs.existsSync(defaultDir)) fs.mkdirSync(defaultDir, { recursive: true });
    const prefsPath = path.join(defaultDir, "Preferences");
    let prefs: { bookmark_bar?: { show_on_all_tabs?: boolean }; [key: string]: unknown } = {};
    if (fs.existsSync(prefsPath)) {
      prefs = JSON.parse(fs.readFileSync(prefsPath, 'utf8')) as { bookmark_bar?: { show_on_all_tabs?: boolean }; [key: string]: unknown };
    }
    prefs.bookmark_bar = { show_on_all_tabs: false };
    fs.writeFileSync(prefsPath, JSON.stringify(prefs));
  } catch (e) {
    log.warn(`Failed to disable bookmarks bar via Preferences: ${e instanceof Error ? e.message : String(e)}`);
  }
}