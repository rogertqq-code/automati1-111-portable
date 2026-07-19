import { Project, SyntaxKind } from "ts-morph";

const project = new Project();
const sourceFile = project.addSourceFileAtPath("src/stealth/stealth-scripts.ts");

// Add import for mutator
sourceFile.addImportDeclaration({
    namedImports: ["mutatePayload"],
    moduleSpecifier: "./scripts/ast-mutator.js"
});

const fn = sourceFile.getFunction("buildStealthScripts");
if (fn) {
    const returnStmts = fn.getDescendantsOfKind(SyntaxKind.ReturnStatement);
    for (const ret of returnStmts) {
        const expr = ret.getExpression();
        if (expr && expr.getText() === "scripts") {
            ret.replaceWithText("return scripts.map(s => mutatePayload(s, seed));");
        }
    }
}
sourceFile.saveSync();
