import { Project } from "ts-morph";

const project = new Project();
const engineFile = project.addSourceFileAtPath("src/core/engine.ts");

const threatFile = project.createSourceFile("src/core/threat-monitor.ts", "", { overwrite: true });
const idleFile = project.createSourceFile("src/core/idle-watchdog.ts", "", { overwrite: true });

// Copy essential imports for ThreatMonitor and IdleWatchdog
const imports = [
  { defaultImport: "EventEmitter", moduleSpecifier: "node:events" },
  { namedImports: ["Page"], moduleSpecifier: "playwright-core" }
];
threatFile.addImportDeclarations(imports);
idleFile.addImportDeclarations(imports);

const threatClass = engineFile.getClass("ThreatMonitor");
if (threatClass) {
  threatFile.addClass({
    ...threatClass.getStructure(),
    isExported: true
  });
  threatClass.remove();
}

const idleClass = engineFile.getClass("IdleWatchdog");
if (idleClass) {
  idleFile.addClass({
    ...idleClass.getStructure(),
    isExported: true
  });
  idleClass.remove();
}

engineFile.addImportDeclaration({
  namedImports: ["ThreatMonitor"],
  moduleSpecifier: "./threat-monitor.js"
});

engineFile.addImportDeclaration({
  namedImports: ["IdleWatchdog"],
  moduleSpecifier: "./idle-watchdog.js"
});

project.saveSync();
