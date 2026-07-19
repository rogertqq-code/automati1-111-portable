import { Project, SyntaxKind } from "ts-morph";

const project = new Project();
const sourceFile = project.addSourceFileAtPath("src/services/video-verifier.ts");

const unusedVars = ["MAX_FRAMES", "FRAME_POSITIONS", "FFMPEG_FRAME_TIMEOUT_MS"];
for (const v of unusedVars) {
    const decl = sourceFile.getVariableDeclaration(v);
    if (decl) {
        decl.getVariableStatement()?.remove();
    }
}

const fsImport = sourceFile.getImportDeclaration(d => d.getModuleSpecifierValue() === "node:fs");
if (fsImport) fsImport.remove();

const extImport = sourceFile.getImportDeclaration(d => d.getModuleSpecifierValue() === "./video-extraction.js");
if (extImport) {
    const named = extImport.getNamedImports();
    for (const n of named) {
        if (n.getName() === "getVideoDuration" || n.getName() === "getFfmpegPath") {
            n.remove();
        }
    }
}

sourceFile.saveSync();
