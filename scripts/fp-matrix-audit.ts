/**
 * FP Strategy × Backend Matrix Audit
 * 
 * Tests EVERY backend against EVERY fingerprint strategy using
 * FingerprintJS + ThumbmarkJS dual-SDK coherence checks.
 * 
 * Runs DIRECT (no proxy) since this is a local coherence test.
 * Outputs a formatted score table after each backend and a final matrix.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import { createSession, type SessionOpts } from '../backends/index.js';
import { createLogger } from '../src/core/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const log = createLogger('fp-matrix-audit');

// Force no proxy for local audit — override env
process.env.EXTERNAL_PROXY_POOL = 'none';
process.env.PRIMARY_PROXY_URL = '';

// CLI flags
const MOBILE_MODE = process.argv.includes('--mobile');

// ── All individual backends — Chromium first (fast/parallel), stealth last (slow/sequential) ──
const BACKENDS: Array<{ name: string; opts: Partial<SessionOpts> }> = [
  { name: 'cloak-headless',       opts: { backend: 'cloak-headless',       headless: true } },
  { name: 'cloak-headed',         opts: { backend: 'cloak-headed',         headless: false } },
  { name: 'cloak-headless-nocloak', opts: { backend: 'cloak-headless-nocloak', headless: true } },
  { name: 'cloak-headed-nocloak', opts: { backend: 'cloak-headed-nocloak', headless: false } },
  { name: 'zendriver',            opts: { backend: 'zendriver',            headless: true } },
  { name: 'zendriver-headed',     opts: { backend: 'zendriver-headed',     headless: false } },
  { name: 'stealth',              opts: { backend: 'stealth',              headless: true } },
  { name: 'stealth-headed',       opts: { backend: 'stealth-headed',       headless: false } },
];

// ── Only the 3 canonical strategies (legacy aliases normalize to 'optimal' at runtime) ──
const FP_STRATEGIES = [
  { name: 'optimal',         label: 'Optimal (auto per backend)' },
  { name: 'native-only',     label: 'Native Only (zero JS)' },
  { name: 'full-stealth',    label: 'Full Stealth (max JS)' },
];

interface CellResult {
  backend: string;
  fpStrategy: string;
  fpjsHash: string | null;
  thumbmarkHash: string | null;
  coherent: boolean;
  issues: string[];
  suspectScore: number;
  fpComScore?: number | null; // Live score from demo.fingerprint.com
  durationMs: number;
  error?: string;
  mobileMode: boolean;
  scrapflyVectors?: Record<string, any>; // Coverage data for each Scrapfly detection point
  keySignals: {
    webdriver: boolean;
    platform: string;
    timezone: string;
    webglRenderer: string;
    pluginCount: number;
    screenWidth: number;
    screenHeight: number;
    devicePixelRatio: number;
    automationTraces: string[];
  };
}

// ── Audit Server ──
let auditServer: http.Server | null = null;

async function startAuditServer(): Promise<string> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.url === '/' || req.url === '/index.html') {
        const html = fs.readFileSync(path.join(__dirname, '../tests/dual-sdk-audit.html'), 'utf-8');
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(html);
      } else if (req.url === '/fp.js') {
        // Serve FingerprintJS from node_modules (eliminates CDN dependency)
        try {
          const js = fs.readFileSync(path.join(__dirname, '../node_modules/@fingerprintjs/fingerprintjs/dist/fp.min.js'), 'utf-8');
          res.writeHead(200, { 'Content-Type': 'application/javascript' });
          res.end(js);
        } catch {
          res.writeHead(404); res.end('FingerprintJS not found');
        }
      } else if (req.url === '/thumbmark.js' || req.url === '/thumbmark.mjs') {
        // Serve ThumbmarkJS from node_modules (eliminates CDN dependency)
        try {
          const js = fs.readFileSync(path.join(__dirname, '../node_modules/@thumbmarkjs/thumbmarkjs/dist/thumbmark.umd.js'), 'utf-8');
          res.writeHead(200, { 'Content-Type': 'application/javascript' });
          res.end(js);
        } catch {
          res.writeHead(404); res.end('ThumbmarkJS not found');
        }
      } else {
        res.writeHead(404); res.end();
      }
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as any;
      auditServer = server;
      resolve(`http://127.0.0.1:${addr.port}`);
    });
  });
}

// ── WebSocket to Dashboard ──
let ws: WebSocket | null = null;

function connectDashboard() {
  try {
    ws = new WebSocket('ws://localhost:3011');
    ws.on('open', () => log.info('Connected to dashboard for live updates'));
    ws.on('close', () => { ws = null; });
    ws.on('error', () => { ws = null; });
  } catch { ws = null; }
}

function broadcast(data: any) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'fp-matrix-update', data }));
  }
}

// ── Table formatting helpers ──
const COL_BACKEND = 26;
const COL_STRAT = 10;
const COL_SCORE = 7;
const COL_FP = 14;
const COL_TM = 14;
const COL_COH = 8;
const COL_TIME = 8;

function tableRow(cols: string[]) {
  return '│ ' + cols.join(' │ ') + ' │';
}

function tableSep(cols: number[], char = '─', left = '├', mid = '┼', right = '┤') {
  return left + cols.map(w => char.repeat(w + 2)).join(mid) + right;
}

function printBackendTable(backendName: string, results: CellResult[]) {
  const widths = [COL_STRAT, COL_SCORE, COL_FP, COL_TM, COL_COH, COL_TIME];

  console.log('');
  console.log(`  ┌── ${backendName} ${'─'.repeat(Math.max(0, 70 - backendName.length - 6))}┐`);
  console.log('  ' + tableSep(widths, '─', '┌', '┬', '┐'));
  console.log('  ' + tableRow([
    'Strategy'.padEnd(COL_STRAT),
    'Score'.padEnd(COL_SCORE),
    'FPJS Hash'.padEnd(COL_FP),
    'TM Hash'.padEnd(COL_TM),
    'Coh?'.padEnd(COL_COH),
    'Time'.padEnd(COL_TIME),
  ]));
  console.log('  ' + tableSep(widths, '─', '├', '┼', '┤'));

  for (const r of results) {
    const emoji = r.suspectScore === 0 ? '🟢' : r.suspectScore < 10 ? '🟡' : r.suspectScore < 30 ? '🟠' : '🔴';
    const fp = r.fpjsHash ? r.fpjsHash.substring(0, 12) : '✗ FAIL';
    const tm = r.thumbmarkHash ? r.thumbmarkHash.substring(0, 12) : '✗ FAIL';
    const coh = r.coherent ? '✅ YES' : `❌ ${r.issues.length}`;
    const time = r.durationMs < 1000 ? `${r.durationMs}ms` : `${(r.durationMs / 1000).toFixed(1)}s`;

    console.log('  ' + tableRow([
      r.fpStrategy.padEnd(15),
      (emoji + ' ' + String(r.suspectScore).padStart(3) + ' | ' + String(r.fpComScore ?? 'N/A').padStart(5)).padEnd(16),
      (fp.padEnd(14)),
      tm.padEnd(14),
      coh.padEnd(8),
      time.padEnd(8),
    ]));
  }
  console.log(`  └───────────────┴────────────────┴────────────────┴────────────────┴──────────┴──────────┘`);
  const best = results.reduce((a, b) => a.suspectScore <= b.suspectScore ? a : b);
  console.log(`  ⭐ BEST: ${best.fpStrategy} (local score: ${best.suspectScore}, fp.com: ${best.fpComScore ?? 'N/A'})`);
}

function printFinalMatrix(allResults: CellResult[]) {
  const stratNames = FP_STRATEGIES.map(s => s.name);
  const stratWidths = stratNames.map(s => Math.max(s.length, 6));
  const allWidths = [COL_BACKEND, ...stratWidths, 18];

  console.log('');
  console.log('  ╔' + '═'.repeat(allWidths.reduce((a, b) => a + b + 3, 0) - 1) + '╗');
  console.log('  ║' + '  📊  FINAL SCORE MATRIX — Lower is better (0 = perfect stealth)'.padEnd(allWidths.reduce((a, b) => a + b + 3, 0) - 1) + '║');
  console.log('  ╚' + '═'.repeat(allWidths.reduce((a, b) => a + b + 3, 0) - 1) + '╝');
  console.log('');
  console.log('  ' + tableSep(allWidths, '═', '╔', '╦', '╗'));
  console.log('  ' + tableRow([
    'BACKEND'.padEnd(COL_BACKEND),
    ...stratNames.map((s, i) => s.padEnd(stratWidths[i] ?? 0)),
    'RECOMMENDATION'.padEnd(18),
  ]));
  console.log('  ' + tableSep(allWidths, '═', '╠', '╬', '╣'));

  for (const backend of BACKENDS) {
    const bResults = allResults.filter(r => r.backend === backend.name);
    const scoreMap: Record<string, number> = {};
    for (const r of bResults) scoreMap[r.fpStrategy] = r.suspectScore;

    const best = bResults.length > 0
      ? bResults.reduce((a, b) => a.suspectScore <= b.suspectScore ? a : b)
      : null;

    const cells = stratNames.map((s, i) => {
      const score = scoreMap[s] ?? -1;
      if (score < 0) return '  ?  '.padEnd(stratWidths[i] ?? 0);
      const emoji = score === 0 ? '🟢' : score < 10 ? '🟡' : score < 30 ? '🟠' : '🔴';
      return `${emoji}${String(score).padStart(3)}`.padEnd(stratWidths[i] ?? 0);
    });

    const rec = best ? `⭐ ${best.fpStrategy} (${best.suspectScore})` : '? N/A';

    console.log('  ' + tableRow([
      backend.name.padEnd(COL_BACKEND),
      ...cells,
      rec.padEnd(18),
    ]));
  }
  console.log('  ' + tableSep(allWidths, '═', '╚', '╩', '╝'));
}

// ── Run single audit cell ──
async function runCell(
  backendDef: typeof BACKENDS[0],
  fpStrategy: string,
  auditUrl: string,
  cellIndex: number,
): Promise<CellResult> {
  const startTime = Date.now();
  const email = `matrix_audit_${backendDef.name}_${fpStrategy}_${cellIndex}@example.com`;

  let session: any;
  try {
    session = await createSession({
      ...backendDef.opts,
      email,
      liveTest: false,
      osProfile: MOBILE_MODE ? 'android' : 'windows',
      proxyPool: 'none',
      fpStrategy: fpStrategy as any,
      emulateMobile: MOBILE_MODE,
    } as any);
  } catch (e: unknown) {
    return {
      backend: backendDef.name,
      fpStrategy,
      fpjsHash: null, thumbmarkHash: null,
      coherent: false, issues: ['Launch failed: ' + (e instanceof Error ? e.message : String(e))],
      suspectScore: 99,
      fpComScore: null,
      durationMs: Date.now() - startTime,
      error: `Launch failed: ${e instanceof Error ? e.message : String(e)}`,
      mobileMode: MOBILE_MODE,
      keySignals: { webdriver: true, platform: 'N/A', timezone: 'N/A', webglRenderer: 'N/A', pluginCount: 0, screenWidth: 0, screenHeight: 0, devicePixelRatio: 1, automationTraces: ['launch_failed'] },
    };
  }

  try {
    const page = session.page;
    await page.goto(auditUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Wait for full audit completion (26 vectors + SDKs)
    await page.waitForFunction(
      () => (window as any).__auditResult?.suspectScore !== undefined,
      { timeout: 15000 }
    ).catch(() => {});

    // Wait for FPJS hash
    await page.waitForFunction(
      () => (window as any).__auditResult?.fpjs?.hash || (window as any).__auditResult?.fpjs?.error,
      { timeout: 8000 }
    ).catch(() => {});

    // Wait for ThumbmarkJS hash
    await page.waitForFunction(
      () => (window as any).__auditResult?.thumbmark?.hash || (window as any).__auditResult?.thumbmark?.error,
      { timeout: 5000 }
    ).catch(() => {});

    const result = await page.evaluate(() => (window as any).__auditResult);

    // ── Extract local data IMMEDIATELY ──
    const vectors = result?.vectors || {};
    const coherence = result?.coherence || { coherent: false, issues: ['No data'], score: 99 };

    // Navigate to Fingerprint.com for live Suspect Score BEFORE closing
    // (reuses the same fingerprinted context for accuracy)
    let fpComScore: number | null = null;
    try {
      await page.goto("https://demo.fingerprint.com/playground", { waitUntil: "domcontentloaded", timeout: 20000 });
      await page.waitForFunction(
        () => (document.body.innerText || '').match(/suspect\s*score/i),
        { timeout: 10000 }
      ).catch(() => {});
      const allText: string = await page.evaluate("document.body.innerText || ''");
      const match = allText.match(/Suspect Score[:\s]*(\d+)/i) || allText.match(/suspect_score:\s*(\d+)/i);
      if (match) {
        fpComScore = parseInt(match[1] ?? '0');
      }
    } catch (e) {
      log.warn(`  [${fpStrategy}] Failed to extract live FP.com score: ${String(e)}`);
    }

    // Use the page's self-computed suspect score (from 26 weighted vectors)
    const score = result?.suspectScore ?? 99;
    const totalVectors = result?.totalVectors ?? 0;

    // If SDKs failed, add penalty
    let finalScore = score;
    if (!result?.fpjs?.hash) finalScore += 5;
    if (!result?.thumbmark?.hash) finalScore += 3;

    // ── CLOSE SESSION INSTANTLY after all data captured ──
    await session.close();

    // Extract automation traces from per-vector results
    const automationTraces: string[] = [];
    if (vectors.webdriver && !vectors.webdriver.passed) automationTraces.push('webdriver=true');
    if (vectors['playwright-trace'] && !vectors['playwright-trace'].passed) automationTraces.push('__playwright');
    if (vectors['cdp-trace'] && !vectors['cdp-trace'].passed) automationTraces.push('cdc_');
    if (vectors['wdc-trace'] && !vectors['wdc-trace'].passed) automationTraces.push('$wdc_');

    // Log per-vector breakdown for debugging
    const failedNames = Object.entries(vectors)
      .filter(([_, v]: any) => v && !v.passed)
      .map(([name]: any) => name);
    if (failedNames.length > 0) {
      log.warn(`  [${fpStrategy}] Failed vectors (${failedNames.length}/${totalVectors}): ${failedNames.join(', ')}`);
    } else {
      log.info(`  [${fpStrategy}] All ${totalVectors} vectors passed ✅`);
    }

    return {
      backend: backendDef.name,
      fpStrategy,
      fpjsHash: result?.fpjs?.hash || null,
      thumbmarkHash: result?.thumbmark?.hash || null,
      coherent: coherence.coherent,
      issues: coherence.issues || [],
      suspectScore: finalScore,
      fpComScore,
      durationMs: Date.now() - startTime,
      mobileMode: MOBILE_MODE,
      scrapflyVectors: result?.scrapflyVectors || {},
      keySignals: {
        webdriver: vectors.webdriver ? !vectors.webdriver.passed : true,
        platform: result?.scrapflyVectors?.hardware?.platform || 'N/A',
        timezone: result?.scrapflyVectors?.timezone?.timezone || 'N/A',
        webglRenderer: (result?.scrapflyVectors?.webgl?.renderer || 'N/A').substring(0, 50),
        pluginCount: -1,
        screenWidth: result?.scrapflyVectors?.screen?.width ?? 0,
        screenHeight: result?.scrapflyVectors?.screen?.height ?? 0,
        devicePixelRatio: result?.scrapflyVectors?.screen?.dpr ?? 1,
        automationTraces,
      },
    };
  } catch (e: unknown) {
    await session.close().catch(() => {});
    return {
      backend: backendDef.name,
      fpStrategy,
      fpjsHash: null, thumbmarkHash: null,
      coherent: false, issues: [(e instanceof Error ? e.message : String(e))],
      suspectScore: 99,
      fpComScore: null,
      durationMs: Date.now() - startTime,
      error: (e instanceof Error ? e.message : String(e)),
      mobileMode: MOBILE_MODE,
      keySignals: { webdriver: true, platform: 'N/A', timezone: 'N/A', webglRenderer: 'N/A', pluginCount: 0, screenWidth: 0, screenHeight: 0, devicePixelRatio: 1, automationTraces: ['session_error'] },
    };
  }
}

// ── Main ──
async function runMatrixAudit() {
  const auditUrl = await startAuditServer();
  const totalCells = BACKENDS.length * FP_STRATEGIES.length;

  console.log('');
  console.log('  ╔══════════════════════════════════════════════════════════════════╗');
  console.log('  ║  🔬 FINGERPRINT STRATEGY × BACKEND MATRIX AUDIT               ║');
  console.log('  ╠══════════════════════════════════════════════════════════════════╣');
  console.log(`  ║  Audit server : ${auditUrl.padEnd(48)}║`);
  console.log(`  ║  Backends     : ${String(BACKENDS.length).padEnd(48)}║`);
  console.log(`  ║  Strategies   : ${String(FP_STRATEGIES.length).padEnd(48)}║`);
  console.log(`  ║  Total cells  : ${String(totalCells).padEnd(48)}║`);
  console.log(`  ║  Proxy        : ${'DIRECT (none)'.padEnd(48)}║`);
  console.log(`  ║  Mobile Mode  : ${(MOBILE_MODE ? '✅ ON' : '❌ OFF').padEnd(48)}║`);
  console.log('  ╚══════════════════════════════════════════════════════════════════╝');
  console.log('');

  connectDashboard();

  const allResults: CellResult[] = [];
  let cellsDone = 0;

  for (const backend of BACKENDS) {
    log.info(`\n  🖥️  Testing: ${backend.name} × ${FP_STRATEGIES.length} strategies...`);

    // Camoufox can only run 1 browser at a time on this machine.
    // Run stealth strategies strictly sequentially with instant teardown.
    // Chromium backends (cloak, zendriver) run all strategies in parallel.
    let batchResults: CellResult[];
    if (backend.name.startsWith('stealth')) {
      batchResults = [];
      for (let i = 0; i < FP_STRATEGIES.length; i++) {
        const result = await runCell(backend, FP_STRATEGIES[i]!.name, auditUrl, i);
        batchResults.push(result);
      }
    } else {
      const promises = FP_STRATEGIES.map((fp, i) =>
        runCell(backend, fp.name, auditUrl, i)
      );
      batchResults = await Promise.all(promises);
    }
    allResults.push(...batchResults);
    cellsDone += batchResults.length;

    // Print formatted table for this backend
    printBackendTable(backend.name, batchResults);

    // Broadcast to dashboard
    const best = batchResults.reduce((a, b) => a.suspectScore <= b.suspectScore ? a : b);
    broadcast({
      type: 'progress',
      cellsDone,
      totalCells,
      backendDone: backend.name,
      bestStrategy: best.fpStrategy,
      bestScore: best.suspectScore,
      results: batchResults.map(r => ({
        backend: r.backend, fpStrategy: r.fpStrategy, score: r.suspectScore,
        fpjsHash: r.fpjsHash?.substring(0, 12), thumbmarkHash: r.thumbmarkHash?.substring(0, 12),
        coherent: r.coherent, durationMs: r.durationMs, issues: r.issues.length,
      })),
    });

    // Brief cooldown between backends
    if (backend !== BACKENDS[BACKENDS.length - 1]) {
      log.info('  ⏳ Cooldown 2s...');
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  // ── Print final matrix table ──
  printFinalMatrix(allResults);

  // ── Recommendations ──
  console.log('');
  console.log('  ┌─────────────────────────────────────────────────────────────────┐');
  console.log('  │  🏆 RECOMMENDED STRATEGY PER BACKEND                           │');
  console.log('  └─────────────────────────────────────────────────────────────────┘');
  for (const backend of BACKENDS) {
    const bResults = allResults.filter(r => r.backend === backend.name);
    if (bResults.length === 0) continue;
    const best = bResults.reduce((a, b) => a.suspectScore <= b.suspectScore ? a : b);
    const emoji = best.suspectScore === 0 ? '🟢' : best.suspectScore < 10 ? '🟡' : best.suspectScore < 30 ? '🟠' : '🔴';
    console.log(`  ${emoji} ${backend.name.padEnd(26)} → ${best.fpStrategy.padEnd(18)} (score: ${best.suspectScore})`);
  }

  // ── Issues deep dive ──
  const problematic = allResults.filter(r => r.keySignals.automationTraces.length > 0 && !r.error);
  if (problematic.length > 0) {
    console.log('');
    console.log('  ┌─────────────────────────────────────────────────────────────────┐');
    console.log('  │  ⚠️  AUTOMATION TRACE DETAILS                                   │');
    console.log('  └─────────────────────────────────────────────────────────────────┘');
    for (const r of problematic) {
      console.log(`  ${r.backend} + ${r.fpStrategy}: [${r.keySignals.automationTraces.join(', ')}]`);
    }
  }

  // Save full report
  const recommendations: Record<string, any> = {};
  for (const backend of BACKENDS) {
    const bResults = allResults.filter(r => r.backend === backend.name);
    const scores: Record<string, number> = {};
    const fpComScores: Record<string, number | null> = {};
    for (const r of bResults) {
      scores[r.fpStrategy] = r.suspectScore;
      fpComScores[r.fpStrategy] = r.fpComScore ?? null;
    }
    const best = bResults.length > 0 ? bResults.reduce((a, b) => a.suspectScore <= b.suspectScore ? a : b) : null;
    
    // Calculate score impact: how much does switching strategies affect the score?
    const scoreValues = Object.values(scores);
    const scoreRange = scoreValues.length > 1 ? Math.max(...scoreValues) - Math.min(...scoreValues) : 0;
    
    recommendations[backend.name] = {
      best: best?.fpStrategy,
      score: best?.suspectScore,
      fpComScore: best ? fpComScores[best.fpStrategy] : null,
      allScores: scores,
      allFpComScores: fpComScores,
      scoreRange,
      mobile: MOBILE_MODE,
    };
  }

  // Scrapfly vector coverage summary
  const scrapflyCoverage: Record<string, Record<string, boolean>> = {};
  for (const r of allResults) {
    if (r.scrapflyVectors) {
      const key = `${r.backend}/${r.fpStrategy}`;
      scrapflyCoverage[key] = {};
      for (const [vector, data] of Object.entries(r.scrapflyVectors)) {
        scrapflyCoverage[key][vector] = (data)?.present !== false;
      }
    }
  }

  const report = {
    timestamp: new Date().toISOString(),
    mobileMode: MOBILE_MODE,
    totalCells,
    backends: BACKENDS.map(b => b.name),
    strategies: FP_STRATEGIES.map(s => s.name),
    results: allResults,
    recommendations,
    scrapflyCoverage,
  };

  const reportPath = path.join(process.cwd(), 'fp-matrix-audit-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`\n  📁 Full report saved to: ${reportPath}`);

  // Broadcast final
  broadcast({ type: 'complete', totalCells, recommendations });

  if (auditServer) auditServer.close();
  process.exit(0);
}

runMatrixAudit().catch((e) => {
  log.error(`Fatal: ${e instanceof Error ? e.message : String(e)}`);
  console.error(e.stack);
  if (auditServer) auditServer.close();
  process.exit(1);
});