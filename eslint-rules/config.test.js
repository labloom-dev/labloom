import config from "../eslint.config.js";
import css from "@eslint/css";
import { ESLint } from "eslint";
import assert from "node:assert/strict";
const lint = new ESLint({ overrideConfigFile: true, overrideConfig: config });
const fix = new ESLint({ overrideConfigFile: true, overrideConfig: config, fix: true });
const cases = [
    ["probe.js", "export const x = 'hello'  \n", ["@stylistic/quotes", "@stylistic/semi", "@stylistic/no-trailing-spaces", "@stylistic/eol-last"]],
    ["probe.ts", "export type Name = 'hello'\n", ["@stylistic/quotes", "@stylistic/semi", "@stylistic/eol-last"]],
    ["probe.js", "if (a) {\nfoo();\n} else {\nbar();\n}\ntry {\nfoo();\n} catch {\nbar();\n}", ["@stylistic/brace-style"]],
    ["probe.css", "a[data-x='value'] { content: 'hello'; background: url('a.png'); --text: 'custom'; color: red }  \n", ["local/css-quotes", "local/css-semi", "@stylistic/no-trailing-spaces", "@stylistic/eol-last"]],
    ["probe.svelte", "<script lang=\"ts\">\nconst x = 'hello'\n</script>\n<p>{x}</p>\n<style>p { content: 'hello' }</style>  \n", ["@stylistic/quotes", "@stylistic/semi", "local/css-quotes", "local/css-semi", "@stylistic/no-trailing-spaces", "@stylistic/eol-last"]],
    ["probe.json", "{\"x\": 1}  \n", ["@stylistic/no-trailing-spaces", "@stylistic/eol-last"]],
    ["probe.yaml", "name: hello  \n", ["@stylistic/no-trailing-spaces", "@stylistic/eol-last"]]
];
for (const [filePath, source, rules] of cases) {
    const [result] = await lint.lintText(source, { filePath });
    const found = result.messages.map(m => m.ruleId);
    for (const rule of rules) assert.ok(found.includes(rule), JSON.stringify({ filePath, missing: rule, messages: result.messages }));
    const [fixed] = await fix.lintText(source, { filePath });
    assert.ok(!fixed.messages.some(m => rules.includes(m.ruleId)), JSON.stringify({ filePath, messages: fixed.messages, output: fixed.output }));
    const output = fixed.output ?? source;
    const crlf = source.replace(/\n/gu, "\r\n");
    const [crlfFixed] = await fix.lintText(crlf, { filePath });
    assert.ok(!crlfFixed.messages.some(m => rules.includes(m.ruleId)), filePath + " CRLF");
    assert.equal((await fix.lintText(output, { filePath }))[0].output, undefined, filePath + " must be stable");

}
for (const filePath of ["probe.json", "probe.jsonc", ".vscode/probe.json"]) {
    const [result] = await lint.lintText("{\"x\": 1,}", { filePath });
    assert.ok(result.fatalErrorCount > 0, filePath + " must reject trailing commas");
}
const cssCases = [
    "a { content: 'it\\'s \"quoted\"' }",
    "a { content: '\\22 hello\\22 '; --text: 'custom' /* comment */ }",
    "/* 'unchanged' */ a { background: url(data:abc); content: \"ok\"; }",
    "a { content: 'continued\\\nline' }",
    "a { color: red /* comment */ ; }",
    "@media screen { a { color: red } }",
    "a { --empty: ; color: red; }",
    "a { --empty: }"
];
const language = css.languages.css;
function values(text) {
    const parsed = language.parse({ path: "probe.css", body: text });
    assert.ok(parsed.ok, JSON.stringify(parsed.errors));
    const values = [];
    parsed.lexer.syntax.walk(parsed.ast, node => {
 if (node.type === "String" || node.type === "Url") values.push(node.value);
});
    return values;
}
for (const source of cssCases) {
    const [result] = await fix.lintText(source, { filePath: "probe.css" });
    assert.equal(result.messages.length, 0, JSON.stringify(result));
    const output = result.output ?? source;
    assert.deepEqual(values(output), values(source), source);
    assert.equal((await fix.lintText(output, {filePath:"probe.css"}))[0].output, undefined);

}
console.log("ESLint configuration checks passed: JS, TS, Svelte, CSS, JSON, YAML and CSS escape preservation.");