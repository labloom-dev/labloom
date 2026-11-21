import { StringStream, type StreamParser } from "@codemirror/streamparser";
import type { CodeLanguage } from "../../../shared/content/code-languages";
import type { HighlightRequest, HighlightResult, Token } from "./code-highlight";

const grammars: Record<Exclude<CodeLanguage, "markdown">, () => Promise<StreamParser<unknown>>> = {
    javascript: async () => (await import("@codemirror/legacy-modes/mode/javascript")).javascript,
    typescript: async () => (await import("@codemirror/legacy-modes/mode/javascript")).typescript,
    python: async () => (await import("@codemirror/legacy-modes/mode/python")).python,
    r: async () => (await import("@codemirror/legacy-modes/mode/r")).r,
    c: async () => (await import("@codemirror/legacy-modes/mode/clike")).c,
    cpp: async () => (await import("@codemirror/legacy-modes/mode/clike")).cpp,
    csharp: async () => (await import("@codemirror/legacy-modes/mode/clike")).csharp,
    java: async () => (await import("@codemirror/legacy-modes/mode/clike")).java,
    kotlin: async () => (await import("@codemirror/legacy-modes/mode/clike")).kotlin,
    scala: async () => (await import("@codemirror/legacy-modes/mode/clike")).scala,
    rust: async () => (await import("@codemirror/legacy-modes/mode/rust")).rust,
    go: async () => (await import("@codemirror/legacy-modes/mode/go")).go,
    swift: async () => (await import("@codemirror/legacy-modes/mode/swift")).swift,
    shell: async () => (await import("@codemirror/legacy-modes/mode/shell")).shell,
    powershell: async () => (await import("@codemirror/legacy-modes/mode/powershell")).powerShell,
    sql: async () => (await import("@codemirror/legacy-modes/mode/sql")).standardSQL,
    json: async () => (await import("@codemirror/legacy-modes/mode/javascript")).json,
    yaml: async () => (await import("@codemirror/legacy-modes/mode/yaml")).yaml,
    toml: async () => (await import("@codemirror/legacy-modes/mode/toml")).toml,
    html: async () => (await import("@codemirror/legacy-modes/mode/xml")).html,
    xml: async () => (await import("@codemirror/legacy-modes/mode/xml")).xml,
    css: async () => (await import("@codemirror/legacy-modes/mode/css")).css,
    latex: async () => (await import("@codemirror/legacy-modes/mode/stex")).stex,
    matlab: async () => (await import("@codemirror/legacy-modes/mode/octave")).octave,
    ruby: async () => (await import("@codemirror/legacy-modes/mode/ruby")).ruby,
    lua: async () => (await import("@codemirror/legacy-modes/mode/lua")).lua,
    perl: async () => (await import("@codemirror/legacy-modes/mode/perl")).perl
};
const classes: Record<string, string> = {
    keyword: "keyword", controlKeyword: "control", operatorKeyword: "keyword", modifier: "keyword", atom: "keyword", bool: "keyword",
    string: "string", string2: "string", regexp: "string", comment: "comment", lineComment: "comment", blockComment: "comment",
    number: "number", integer: "number", float: "number", variableName: "variable", propertyName: "variable", attributeName: "variable",
    typeName: "type", className: "type", tagName: "keyword", meta: "control", definitionKeyword: "keyword", function: "function",
    heading: "keyword", link: "string", processingInstruction: "control", special: "type"
};
function style(tag: string): string | undefined {
    for (const name of tag.split(" ")) {
        if (name.includes("function")) return "function";
        const value = classes[name.split(".")[0]];
        if (value) return value;
    }
    return undefined;
}
type Cache = { language: CodeLanguage; lines: string[]; states: unknown[] };
const cache = new Map<number, Cache>();
function copy(parser: StreamParser<unknown>, state: unknown): unknown {
    if (parser.copyState) return parser.copyState(state);
    if (!state || typeof state !== "object") return state;
    return Object.fromEntries(Object.entries(state).map(([k, v]) => [k, Array.isArray(v) ? v.slice() : v]));
}
async function tokens(request: HighlightRequest): Promise<Token[]> {
    const { language, text, first, last, id } = request;
    const lines = text.split("\n"), result: Token[] = [];
    if (language === "markdown") {
        const [{ parser }, { highlightTree, classHighlighter }] = await Promise.all([import("@lezer/markdown"), import("@lezer/highlight")]);
        const start = lines.slice(0, first).reduce((sum, l) => sum + l.length + 1, 0);
        const end = Math.min(text.length, start + lines.slice(first, last).reduce((sum, l) => sum + l.length + 1, 0));
        const starts: number[] = [];
        let offset = 0;
        for (const line of lines) {
            starts.push(offset);
            offset += line.length + 1;
        }
        const modelPos = (position: number): number => {
            let low = 0, high = starts.length;
            while (low + 1 < high) {
                const mid = (low + high) >>> 1;
                if (starts[mid] <= position) low = mid; else high = mid;
            }
            return position + low;
        };
        highlightTree(parser.parse(text), classHighlighter, (from, to, tag) => {
            result.push([modelPos(from), modelPos(to), style(tag.replaceAll("tok-", "")) ?? "type"]);
        }, start, end);
        return result;
    }
    const parser = await grammars[language]();
    let known = cache.get(id);
    if (!known || known.language !== language) {
        known = { language, lines: [], states: [parser.startState?.(4) ?? {}] };
        cache.set(id, known);
    }
    let shared = 0, offset = 0;
    while (shared < known.states.length - 1 && shared < lines.length && lines[shared] === known.lines[shared]) shared++;
    known.states.length = shared + 1;
    known.lines = lines;
    const begin = Math.min(shared, first);
    for (let i = 0; i < begin; i++) offset += lines[i].length + 1;
    const state = copy(parser, known.states[begin]);
    for (let i = begin; i < Math.min(last, lines.length); i++) {
        const stream = new StringStream(lines[i], 4, 4);
        if (stream.eol()) parser.blankLine?.(state, 4);
        let stalled = 0;
        while (!stream.eol()) {
            stream.start = stream.pos;
            const tag = parser.token(stream, state);
            if (stream.pos === stream.start) {
                if (++stalled > 8) stream.next();
                continue;
            }
            stalled = 0;
            const token = tag && style(tag);
            if (i >= first && token) result.push([offset + i + stream.start, offset + i + stream.pos, token]);
        }
        known.states[i + 1] = copy(parser, state);
        offset += lines[i].length + 1;
    }
    return result;
}
self.onmessage = async (event: MessageEvent<HighlightRequest | { id: number; close: true }>) => {
    const data = event.data;
    if ("close" in data) {
        cache.delete(data.id); return;
    }
    const result: HighlightResult = { id: data.id, version: data.version, tokens: await tokens(data) };
    self.postMessage(result);
};