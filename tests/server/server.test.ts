/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Pre-mock everything server.ts imports that might cause side-effects
vi.mock("express", () => {
  const app = {
    use: vi.fn(),
    get: vi.fn(),
    post: vi.fn(),
    listen: vi.fn(),
  };
  const expressFn = vi.fn(() => app);
  (expressFn as any).json = vi.fn();
  (expressFn as any).static = vi.fn();
  return { default: expressFn };
});

vi.mock("ws", () => ({
  WebSocketServer: class {
    on = vi.fn();
    clients = new Set();
  },
  WebSocket: { OPEN: 1 }
}));

vi.mock("node:http", () => {
  const serverMock = { listen: vi.fn(), on: vi.fn() };
  return {
    default: { createServer: vi.fn().mockReturnValue(serverMock) },
    createServer: vi.fn().mockReturnValue(serverMock)
  };
});

vi.mock("node:https", () => {
  const serverMock = { listen: vi.fn(), on: vi.fn() };
  return {
    default: { createServer: vi.fn().mockReturnValue(serverMock) },
    createServer: vi.fn().mockReturnValue(serverMock)
  };
});

// Avoid executing global intervals during tests
vi.useFakeTimers();
vi.spyOn(global, 'setInterval').mockImplementation(() => { return {} as any; });
vi.spyOn(global, 'setTimeout').mockImplementation((cb) => { return {} as any; });

vi.mock("node:child_process", () => ({
  exec: vi.fn(),
  spawn: vi.fn().mockReturnValue({
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
    on: vi.fn(),
    send: vi.fn(),
    kill: vi.fn(),
    connected: true,
    killed: false,
  }),
  execSync: vi.fn(),
}));

vi.mock("../../src/core/engine.js", () => ({
  AutomationEngine: class {
    on = vi.fn();
    start = vi.fn();
    stop = vi.fn();
    loadCredentials = vi.fn().mockReturnValue([]);
    screenshotSvc = {
      setGcsUploader: vi.fn(),
      on: vi.fn(),
      startAutoPrune: vi.fn()
    };
  },
  DEFAULT_TARGETS: [{ name: "joe", url: "http://x", selectors: { username: "u", password: "p", submit: "s" } }],
  BACKEND_OPTIMAL_SETTINGS: {}
}));

vi.mock("../../src/core/database.js", () => ({
  initDB: vi.fn(),
  startCredentialsWatcher: vi.fn(),
  getUntestedCredentials: vi.fn().mockReturnValue([]),
  getAllCredentialsWithLatestStatus: vi.fn().mockReturnValue([]),
  getResultSummary: vi.fn().mockReturnValue({}),
  countCredentials: vi.fn().mockReturnValue(0),
  importCsv: vi.fn(),
  db: {
    pragma: vi.fn(),
    exec: vi.fn(),
    prepare: vi.fn().mockReturnValue({ get: vi.fn().mockReturnValue(undefined) })
  }
}));

vi.mock("../../src/services/process-cleaner.js", () => ({
  cleanPreviousZombies: vi.fn(),
  killOurOrphans: vi.fn(),
  startPeriodicZombieReaper: vi.fn()
}));

vi.mock("../../src/services/browser-warmer.js", () => ({
  browserWarmer: {
    start: vi.fn(),
    stop: vi.fn()
  }
}));

vi.mock("../../src/backends/index.js", () => ({
  proxyScoreTracker: {}
}));

let server: any;
let db: any;

describe.skip("server.ts exports", () => {
  beforeEach(async () => {
    vi.clearAllMocks();

    server = await import("../../src/server/server.js");
    db = (await import("../../src/core/database.js")).db;
  });

  it("checkpointWAL calls db.pragma", () => {
    server.checkpointWAL();
    expect(db.pragma).toHaveBeenCalledWith("wal_checkpoint(TRUNCATE)");
  });

  it("exports schemas", () => {
    expect(server.WsMessageSchema).toBeDefined();
    expect(server.SetConcurrencySchema).toBeDefined();
    expect(server.SetBackendSchema).toBeDefined();
  });

  it("SetConcurrencySchema validates correctly", () => {
    expect(server.SetConcurrencySchema.safeParse({ value: 5 }).success).toBe(true);
    expect(server.SetConcurrencySchema.safeParse({ value: -1 }).success).toBe(false);
    expect(server.SetConcurrencySchema.safeParse({ value: 1000 }).success).toBe(false);
  });

  it("SetBackendSchema validates correctly", () => {
    expect(server.SetBackendSchema.safeParse({ value: "stealth" }).success).toBe(true);
    expect(server.SetBackendSchema.safeParse({ value: 123 }).success).toBe(false);
  });
});

