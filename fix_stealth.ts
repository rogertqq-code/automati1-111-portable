import { Project, SyntaxKind } from "ts-morph";

const project = new Project();
const sourceFile = project.addSourceFileAtPath("src/stealth/stealth-scripts.ts");

const functionsToRemove = [
    "getScreenNoiseScript",
    "getCssMediaQueryCoherenceScript",
    "getDeviceMotionSpoofScript",
    "getDynamicBatterySpoofScript"
];

for (const fnName of functionsToRemove) {
    const fn = sourceFile.getFunction(fnName);
    if (fn) {
        fn.remove();
    }
}

sourceFile.addImportDeclarations([
    {
        namedImports: ["getScreenNoiseScript", "getCssMediaQueryCoherenceScript"],
        moduleSpecifier: "./scripts/screen-spoofs.js"
    },
    {
        namedImports: ["getDeviceMotionSpoofScript", "getDynamicBatterySpoofScript"],
        moduleSpecifier: "./scripts/sensor-spoofs.js"
    }
]);

const exportDec = sourceFile.getExportDeclarations().find(e => e.hasNamedExports() && e.getNamedExports().some(n => n.getName() === "getMobilePlatformOverrideScript"));

if (exportDec) {
    exportDec.addNamedExports(functionsToRemove);
}

sourceFile.saveSync();
