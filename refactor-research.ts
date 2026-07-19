import { Project, SyntaxKind } from "ts-morph";

const project = new Project();
const orchFile = project.addSourceFileAtPath("src/intelligence/research-orchestrator.ts");

const arcFile = project.createSourceFile("src/intelligence/arc-runner.ts", "", { overwrite: true });
const hermesFile = project.createSourceFile("src/intelligence/hermes-runner.ts", "", { overwrite: true });

// Copy imports to new files
const importsToAdd = [
  { defaultImport: "fs", moduleSpecifier: "node:fs" },
  { namedImports: ["execFile"], moduleSpecifier: "node:child_process" },
  { namedImports: ["promisify"], moduleSpecifier: "node:util" },
  { namedImports: ["ResearchTarget", "ResearchSkill"], moduleSpecifier: "./research-orchestrator.js" }
];

arcFile.addImportDeclarations(importsToAdd);
hermesFile.addImportDeclarations(importsToAdd);

const setupCode = `
const execFileAsync = promisify(execFile);
`;
arcFile.addStatements(setupCode);
hermesFile.addStatements(setupCode);

const clazz = orchFile.getClass("ResearchOrchestrator");
if (clazz) {
  const runArc = clazz.getMethod("runAutoResearchClaw");
  if (runArc) {
    arcFile.addFunction({
      name: "runAutoResearchClaw",
      isExported: true,
      isAsync: true,
      parameters: [
        { name: "target", type: "ResearchTarget" },
        { name: "context", type: "any" } // optional contexts like logger
      ],
      returnType: runArc.getReturnTypeNode()?.getText() || "Promise<{ success: boolean; skills: ResearchSkill[]; error?: string }>",
      statements: runArc.getBodyText()?.replace(/this\.log/g, "context.log")
    });
    
    // Replace original body to call the new function
    runArc.setBodyText(`return runAutoResearchClaw(target, { log: this.log.bind(this) });`);
  }

  const runHermes = clazz.getMethod("runHermes");
  if (runHermes) {
    hermesFile.addFunction({
      name: "runHermes",
      isExported: true,
      isAsync: true,
      parameters: [
        { name: "target", type: "ResearchTarget" },
        { name: "context", type: "any" }
      ],
      returnType: runHermes.getReturnTypeNode()?.getText() || "Promise<{ success: boolean; skills: ResearchSkill[]; error?: string }>",
      statements: runHermes.getBodyText()?.replace(/this\.log/g, "context.log")
    });

    // Replace original body
    runHermes.setBodyText(`return runHermes(target, { log: this.log.bind(this) });`);
  }
}

orchFile.addImportDeclaration({
  namedImports: ["runAutoResearchClaw"],
  moduleSpecifier: "./arc-runner.js"
});

orchFile.addImportDeclaration({
  namedImports: ["runHermes"],
  moduleSpecifier: "./hermes-runner.js"
});

project.saveSync();
