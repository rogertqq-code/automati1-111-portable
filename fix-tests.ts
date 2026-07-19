import { Project } from "ts-morph";

const project = new Project();
const testFile = project.addSourceFileAtPath("tests/services/video-verifier.test.ts");

const importDecl = testFile.getImportDeclaration(d => d.getModuleSpecifierValue() === "../../src/services/video-verifier.js");
if (importDecl) {
    // Remove extractKeyFrames from here
    const named = importDecl.getNamedImports().find(n => n.getName() === "extractKeyFrames");
    if (named) named.remove();
}

testFile.addImportDeclaration({
    namedImports: ["extractKeyFrames"],
    moduleSpecifier: "../../src/services/video-extraction.js"
});

testFile.saveSync();
