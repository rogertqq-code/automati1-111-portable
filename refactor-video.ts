import { Project, SyntaxKind } from "ts-morph";

const project = new Project();
const verifierFile = project.addSourceFileAtPath("src/services/video-verifier.ts");
const extractionFile = project.createSourceFile("src/services/video-extraction.ts", "", { overwrite: true });

// Copy imports needed for extraction
extractionFile.addImportDeclarations([
  { defaultImport: "fs", moduleSpecifier: "node:fs" },
  { defaultImport: "path", moduleSpecifier: "node:path" },
  { namedImports: ["createLogger"], moduleSpecifier: "../core/logger.js" }
]);

// Extract functions
const funcsToExtract = ["extractKeyFrames", "getVideoDuration", "getFfmpegPath"];

for (const fnName of funcsToExtract) {
  const fn = verifierFile.getFunction(fnName);
  if (fn) {
    // Check for variables needed by these functions in the file scope
    // like MAX_FRAMES, FRAME_POSITIONS, etc.
    extractionFile.addFunction({
      name: fn.getName(),
      isExported: true,
      isAsync: fn.isAsync(),
      parameters: fn.getParameters().map(p => p.getStructure()),
      returnType: fn.getReturnTypeNode()?.getText(),
      statements: fn.getBodyText()
    });
    fn.remove();
  }
}

// Ensure the variables used are defined in extractionFile
extractionFile.insertStatements(3, `
const log = createLogger("video-extraction");
const FRAME_POSITIONS = [0.1, 0.3, 0.5, 0.7, 0.9];
const MAX_FRAMES = 8;
const FFMPEG_FRAME_TIMEOUT_MS = 15000;
`);

// Now in verifier file, add import to the new file, and remove local declarations of those consts if they are there
verifierFile.addImportDeclaration({
  namedImports: funcsToExtract,
  moduleSpecifier: "./video-extraction.js"
});

project.saveSync();
