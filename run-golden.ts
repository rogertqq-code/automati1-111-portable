import { AutomationEngine } from './src/core/engine.ts';
import { ConfigStore } from './src/core/config-store.ts';
async function run() {
  const config = ConfigStore.load();
  config.backend = 'stealth-headed';
  config.goldenCredentials = { "joe": "phuttasopit@hotmail.co.th:Tomo06032553" };
  const engine = new AutomationEngine(config);
  engine.on("log", (msg) => console.log(msg.message));
  engine.on("screenshot", (data) => console.log("Screenshot:", data.filename));
  
  await engine.init();
  await engine.start();
  
  // wait for it to finish
}
run().catch(console.error);
