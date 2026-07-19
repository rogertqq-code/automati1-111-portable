import { Project } from "ts-morph";

const project = new Project();
const stealthFile = project.addSourceFileAtPath("src/stealth/stealth-scripts.ts");

const webglFile = project.createSourceFile("src/stealth/scripts/webgl-spoofs.ts", "", { overwrite: true });
const canvasFile = project.createSourceFile("src/stealth/scripts/canvas-spoofs.ts", "", { overwrite: true });

// Move WebGL functions
const webglSpoof = stealthFile.getFunction("getWebGLSpoofScript");
if (webglSpoof) {
  webglFile.addFunction({
    ...webglSpoof.getStructure(),
    isExported: true
  });
  webglSpoof.remove();
}

const mobileWebgl = stealthFile.getFunction("getMobileWebGLRendererScript");
if (mobileWebgl) {
  webglFile.addFunction({
    ...mobileWebgl.getStructure(),
    isExported: true
  });
  mobileWebgl.remove();
}

// Move Canvas functions
const canvasSpoof = stealthFile.getFunction("getCanvasSpoofScript");
if (canvasSpoof) {
  canvasFile.addFunction({
    ...canvasSpoof.getStructure(),
    isExported: true
  });
  canvasSpoof.remove();
}

stealthFile.addImportDeclaration({
  namedImports: ["getWebGLSpoofScript", "getMobileWebGLRendererScript"],
  moduleSpecifier: "./scripts/webgl-spoofs.js"
});

stealthFile.addImportDeclaration({
  namedImports: ["getCanvasSpoofScript"],
  moduleSpecifier: "./scripts/canvas-spoofs.js"
});

project.saveSync();
