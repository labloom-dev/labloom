import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import ts from "typescript";
import { type IpcMainInvokeEvent, type WebContents } from "electron";
import zhCN from "../locales/zh-CN.json";
import en from "../locales/en.json";
import { createI18n, type Translate } from "../shared/i18n";
import { connectAPI, failureText, LabloomError, toFailureInfo, type FailureInfo, type IPCReply } from "../shared/failure";
import { defaultAppearance } from "../shared/types/appearance";
import { type StartupState } from "../shared/types/startup";
import { type Language } from "../shared/locale";
import { AppStorage } from "../main/storage/app";
import { createWorkspace, openWorkspace } from "../main/storage/workspace";
import { Startup } from "../main/startup/startup";
import { handle } from "../main/ipc";
import { confirmationText } from "../shared/content/confirmation";

function leaves(value: object, prefix = ""): Record<string, string> {
    return Object.fromEntries(Object.entries(value).flatMap(([key, item]) => {
        const path = prefix ? prefix + "." + key : key;
        return typeof item === "string" ? [[path, item]] : Object.entries(leaves(item, path));
    }));
}
function translator(language: Language): Translate {
    const instance = createI18n(language);
    return (key, options) => instance.t(key, options);
}
function failure(state: StartupState): FailureInfo {
    assert.equal(state.status, "needs-workspace");
    if (state.status !== "needs-workspace" || !state.error) throw new Error("Expected a startup failure");
    return state.error;
}

test("Chinese and English catalogs have identical keys and interpolation arguments, and all failure kinds translate synchronously", () => {
    const chinese = leaves(zhCN), english = leaves(en);
    assert.deepEqual(Object.keys(chinese).sort(), Object.keys(english).sort());
    for (const [key, text] of Object.entries(chinese)) {
        const parameters = (value: string): string[] => [...value.matchAll(/\{\{([^}]+)}}/g)].map(match => match[1]).sort();
        assert.deepEqual(parameters(text), parameters(english[key]), key);
    }
    for (const language of ["zh-CN", "en"] as const) {
        const t = translator(language);
        for (const kind of Object.keys(zhCN.failure)) {
            const key = `failure.${kind}` as Parameters<Translate>[0];
            assert.notEqual(t(key), key);
        }
        const text = failureText(t, { kind: "attribute-invalid-value", attrId: "custom:A", name: "A", type: "number" });
        assert.ok(text.includes("A") && text.includes("number"));
        assert.ok(!text.includes("custom:A"));
        assert.ok(!failureText(t, { kind: "unexpected", diagnostic: "native secret diagnostic" }).includes("native secret diagnostic"));
    }
    const instance = createI18n("zh-CN"), translate: Translate = (key, options) => instance.t(key, options);
    const saved: FailureInfo = { kind: "workspace-not-workspace", path: "A" };
    assert.equal(failureText(translate, saved), "这个文件夹不是 Labloom 工作区。");
    void instance.changeLanguage("en");
    assert.equal(failureText(translate, saved), "This folder is not a Labloom workspace.");
});

test("application failures contain kinds and data, while filesystem, SQLite and PDF exceptions are classified without leaking diagnostics", () => {
    const expected = new LabloomError({ kind: "attribute-invalid-value", attrId: "A", name: "A", type: "boolean" });
    assert.equal(expected.message, "attribute-invalid-value");
    assert.deepEqual(toFailureInfo(expected), expected.failure);
    for (const [code, kind] of [["EACCES", "file-access-denied"], ["EPERM", "file-access-denied"], ["SQLITE_READONLY", "database-readonly"], ["ENOSPC", "disk-full"], ["SQLITE_CORRUPT", "workspace-corrupt"]]) {
        const external = Object.assign(new Error("unaltered native message"), { code });
        assert.deepEqual(toFailureInfo(external), { kind, diagnostic: "unaltered native message" });
    }
    const password = Object.assign(new Error("Incorrect Password"), { name: "PasswordException", code: 2 });
    assert.deepEqual(toFailureInfo(password), { kind: "pdf-password-incorrect", diagnostic: "Incorrect Password" });
    assert.deepEqual(toFailureInfo(new Error("unaltered external message")), { kind: "unexpected", diagnostic: "unaltered external message" });
    assert.deepEqual(toFailureInfo({ kind: "unregistered-error" }), { kind: "unexpected", diagnostic: "[object Object]" });
});

test("IPC transports plain failures and renderer unwrapping preserves kinds, data, successful values and event disposers", async () => {
    const handlers = new Map<string, (event: IpcMainInvokeEvent) => Promise<IPCReply<unknown>>>();
    const contents = { mainFrame: {}, ipc: { handle: (channel: string, listener: unknown): void => {
        handlers.set(channel, listener as (event: IpcMainInvokeEvent) => Promise<IPCReply<unknown>>);
    } } };
    handle(contents as unknown as WebContents, "expected", () => {
        throw new LabloomError({ kind: "attribute-invalid-value", attrId: "A", name: "A", type: "file" });
    });
    handle(contents as unknown as WebContents, "success", () => 42);
    const event = { senderFrame: contents.mainFrame } as IpcMainInvokeEvent;
    const reply = structuredClone(await handlers.get("expected")!(event));
    assert.equal(reply.ok, false);
    if (reply.ok) throw new Error("Expected a failure reply");
    assert.equal(Object.getPrototypeOf(reply.failure), Object.prototype);
    assert.equal(reply.failure.kind, "attribute-invalid-value");
    const stop = (): void => {};
    const api = connectAPI<{ expected(): Promise<void>; success(): Promise<number>; onChanged(): () => void }>({
        expected: async () => reply,
        success: async () => ({ ok: true, value: 42 }),
        onChanged: () => stop
    });
    await assert.rejects(api.expected(), error => error instanceof LabloomError && error.failure.kind === "attribute-invalid-value" && error.failure.attrId === "A");
    assert.equal(await api.success(), 42);
    assert.equal(api.onChanged(), stop);
    const forbidden = await handlers.get("success")!({ senderFrame: {} } as IpcMainInvokeEvent);
    assert.deepEqual(forbidden, { ok: false, failure: { kind: "ipc-not-main-frame" } });
});

test("startup distinguishes a non-workspace folder, a missing folder and an incompatible workspace in both languages without modifying them", t => {
    const root = mkdtempSync(join(process.env.LABLOOM_TEST_ROOT!, "startup-failures-"));
    const empty = mkdtempSync(join(root, "empty-")), missing = join(root, "missing");
    const old = createWorkspace(mkdtempSync(join(root, "old-")));
    old.database.exec("ALTER TABLE attachments ADD COLUMN old_format TEXT");
    old.database.close();
    const bytes = readFileSync(join(old.info.path, "workspace.sqlite"));
    for (const language of ["zh-CN", "en"] as const) {
        const storage = new AppStorage(join(root, language));
        storage.load(); storage.saveAppearance({ ...defaultAppearance, language });
        const startup = new Startup(storage); startup.restore(); t.after(() => startup.close());
        const states = [startup.choose(empty, "open"), startup.choose(missing, "open"), startup.choose(old.info.path, "open")];
        const [a, b, c] = states.map(failure);
        assert.deepEqual(states.map(state => state.status === "needs-workspace" ? state.attemptedPath : null), [empty, missing, old.info.path]);
        assert.equal(a.kind, "workspace-not-workspace"); assert.equal(b.kind, "workspace-folder-missing"); assert.equal(c.kind, "workspace-incompatible");
        const translate = translator(language), messages = [a, b, c].map(info => failureText(translate, info));
        assert.equal(new Set(messages).size, 3);
        if (language === "zh-CN") {
            assert.equal(messages[0], "这个文件夹不是 Labloom 工作区。");
            assert.ok(messages[1].startsWith("找不到工作区文件夹"));
            assert.ok(messages[2].includes("旧版本"));
        }
        else {
            assert.equal(messages[0], "This folder is not a Labloom workspace.");
            assert.ok(messages[1].startsWith("The workspace folder could not be found"));
            assert.ok(messages[2].includes("incompatible"));
            assert.ok(messages.every(text => !/[\u4e00-\u9fff]/.test(text)));
        }
        assert.deepEqual(readdirSync(empty), []);
        assert.deepEqual(readFileSync(join(old.info.path, "workspace.sqlite")), bytes);
    }
    assert.throws(() => openWorkspace(missing), error => error instanceof LabloomError && error.failure.kind === "workspace-folder-missing");
});

test("English startup language survives an app restart with an incompatible last workspace", t => {
    const root = mkdtempSync(join(process.env.LABLOOM_TEST_ROOT!, "startup-language-")), workspace = createWorkspace(mkdtempSync(join(root, "workspace-")));
    workspace.database.exec("ALTER TABLE attachments ADD COLUMN old_format TEXT"); workspace.database.close();
    const storage = new AppStorage(join(root, "profile")); storage.load(); storage.saveAppearance({ ...defaultAppearance, language: "en" }); storage.remember(workspace.info);
    const reopened = new AppStorage(storage.root), startup = new Startup(reopened); t.after(() => startup.close());
    assert.equal(failure(startup.restore()).kind, "workspace-incompatible");
    assert.equal(reopened.getAppearance().language, "en");
});

test("confirmation descriptions use the selected language and include the actual impact counts", () => {
    const preview = { token: "A", causes: [], direct: [], recycled: [{ id: "A", title: "A" }],
        deletedBlocks: [{ id: "B", excerpt: "B", pages: 2, positions: 3, links: 4 }] };
    const chinese = confirmationText(preview, translator("zh-CN")), english = confirmationText(preview, translator("en"));
    assert.ok(chinese.includes("3个位置") && chinese.includes("4个链接"));
    assert.ok(english.includes("3 positions across 2 pages") && english.includes("4 link references") && english.includes("recycle bin: A"));
    assert.ok(!/[\u4e00-\u9fff]/.test(english));
});

test("user-facing main and shared errors cannot introduce display strings outside the catalogs", () => {
    const violations: string[] = [];
    for (const directory of ["main", "shared"]) {
        const walk = (path: string): void => {
            for (const entry of readdirSync(path, { withFileTypes: true })) {
                const file = join(path, entry.name);
                if (entry.isDirectory()) walk(file);
                else if (file.endsWith(".ts")) {
                    const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
                    const visit = (node: ts.Node): void => {
                        if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && ["Error", "TypeError", "RangeError", "FeedError"].includes(node.expression.text)) {
                            const internal = source.text.slice(0, node.getStart(source)).split("\n").slice(-3).join("\n").includes("Internal assertion:");
                            const typedFeed = node.expression.text === "FeedError" && node.arguments?.[0] && ts.isObjectLiteralExpression(node.arguments[0]);
                            if (!internal && !typedFeed) violations.push(file + ":" + (source.getLineAndCharacterOfPosition(node.getStart()).line + 1));
                        }
                        if (ts.isThrowStatement(node) && node.expression && (ts.isStringLiteralLike(node.expression) || ts.isTemplateExpression(node.expression))) violations.push(file);
                        ts.forEachChild(node, visit);
                    };
                    visit(source);
                }
            }
        };
        walk(directory);
    }
    assert.deepEqual(violations, []);
});