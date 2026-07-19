import { Project, SyntaxKind } from "ts-morph";

const project = new Project();
const testFile = project.addSourceFileAtPath("tests/services/video-verifier.test.ts");

const beforeEachBlocks = testFile.getDescendantsOfKind(SyntaxKind.CallExpression)
    .filter(c => c.getExpression().getText() === "beforeEach");

for (const be of beforeEachBlocks) {
    const fn = be.getArguments()[0];
    if (fn) {
        const assigns = fn.getDescendantsOfKind(SyntaxKind.BinaryExpression);
        for (const assign of assigns) {
            if (assign.getLeft().getText() === "extractKeyFrames") {
                assign.getRight().replaceWithText("extractionMod.extractKeyFrames");
            }
        }
        
        // Add dynamic import
        const block = fn.getDescendantsOfKind(SyntaxKind.Block)[0];
        if (block) {
            block.insertStatements(4, `const extractionMod = await import("../../src/services/video-extraction.js");`);
        }
    }
}
testFile.saveSync();
