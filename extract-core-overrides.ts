import { Project } from "ts-morph";

const project = new Project();
const stealthFile = project.addSourceFileAtPath("src/stealth/stealth-scripts.ts");
const coreFile = project.createSourceFile("src/stealth/scripts/core-overrides.ts", "", { overwrite: true });

const fnsToExtract = [
  "getWebdriverOverrideScript",
  "getAutofillSimulationScript"
];

const variablesToExtract = [
  "WEBDRIVER_OVERRIDE_SCRIPT",
  "AUTOFILL_SIMULATION_SCRIPT"
];

for (const varName of variablesToExtract) {
  const variable = stealthFile.getVariableStatement(varName);
  if (variable) {
    coreFile.addVariableStatement({
      ...variable.getStructure(),
      isExported: true
    });
    variable.remove();
  }
}

for (const fnName of fnsToExtract) {
  const fn = stealthFile.getFunction(fnName);
  if (fn) {
    coreFile.addFunction({
      ...fn.getStructure(),
      isExported: true
    });
    fn.remove();
  }
}

stealthFile.addExportDeclaration({
  namedExports: [...fnsToExtract, ...variablesToExtract],
  moduleSpecifier: "./scripts/core-overrides.js"
});

project.saveSync();
