import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { getSchema, type Editor } from "@tiptap/core";
import { Slice, Fragment } from "@tiptap/pm/model";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import { Mapping } from "@tiptap/pm/transform";
import { blockData, blankTable, documentEdit, documentExtensions, indexDoc, pageDocument, removesReference } from "../renderer/components/Editor/document";
import { clipboardRows, copyBlocks, identityPlugin, indent, split, syncInsert } from "../renderer/components/Editor/transactions";
import { BlockSelection } from "../renderer/components/Editor/block-selection";
import { moveBlocks } from "../renderer/components/Editor/block-move";
import { fold, reveal } from "../renderer/components/Editor/folding";
import { inputAction, convertPrefix, restoreLiteral } from "../renderer/components/Editor/input-conversion";
import { inverse, patchDocument, replay } from "../renderer/components/Editor/reconcile";
import { PageWrites, restoreOccurrences, reviewEdit } from "../renderer/components/Knowledge/page-writes";
import { PendingInput } from "../renderer/components/Editor/pending-input";
import { changedUses, payload, validateBlock } from "../shared/content/blocks";
import { type ChangePreview, type ContentBlock, type ContentBlockKind, type EditCommit, type PageRecord } from "../shared/types/content";

const schema = getSchema(documentExtensions);
function block(text: string, type: ContentBlockKind = "paragraph"): ContentBlock {
    return { id: randomUUID(), type, payload: payload(type, text), children: [] };
}
function page(rows: ContentBlock[], children = rows.map(b => b.id)): PageRecord {
    const title = block("Test", "title");
    return { id: randomUUID(), titleBlockId: title.id, kind: "editable", title: "Test", excerpt: "", attributes: {}, children, blocks: Object.fromEntries([title, ...rows].map(b => [b.id, b])) };
}
function state(p: PageRecord): EditorState {
    return EditorState.create({ schema, doc: schema.nodeFromJSON(pageDocument(p)), plugins: [identityPlugin()] });
}
function select(s: EditorState, id: string, offset = 0): EditorState {
    return s.apply(s.tr.setSelection(TextSelection.create(s.doc, indexDoc(s.doc).get(id)![0].pos + 2 + offset)));
}

test("a tab replays text and editing keys in order against its reread document, excluding shortcuts and composition", () => {
    const row = block("A"), p = page([row]);
    let doc = select(state(p), row.id, 1);
    const input = new PendingInput();
    const editor = {
        get state() {
            return doc;
        },
        view: { dispatch: (tr: typeof doc.tr) => {
            doc = doc.apply(tr);
        } }
    } as unknown as Editor;
    input.attach(editor);
    const key = (key: string, options = {}): void => input.key({ key, keyCode: 0, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false,
        isComposing: false, getModifierState: () => false, ...options });
    key("a"); key("b"); key("c"); key("Backspace"); key("z", { ctrlKey: true }); key("Process", { isComposing: true, keyCode: 229 });
    key("Enter"); input.text("好"); input.text("👩‍🔬"); key("Backspace");
    assert.equal(doc.doc.lastChild!.textContent, "A");
    p.blocks[row.id] = { ...row, payload: payload("paragraph", "AB") };
    doc = doc.apply(patchDocument(doc, p, [row.id], false)!);
    input.replay();
    assert.deepEqual(doc.doc.content.content.slice(1).map(n => n.textContent), ["ABab", "好"]);
    assert.equal(input.waiting, false);
});

test("page conversion preserves nesting, title, atoms, marks and table cells; deltas include only changed records", () => {
    assert.deepEqual([...changedUses(["A", "B", "A"], ["B", "A", "C"])], [["A", -1], ["C", 1]]);
    assert.deepEqual([...changedUses(["A", "B"], ["B", "A"])], []);
    const parent = block("first"), kid = block("child", "unordered_list"), line = block("", "hr"), table = block("", "table"), ref = block("", "blocked_reference");
    parent.children = [kid.id];
    parent.payload.collapsed = true;
    parent.payload.inline = [{ type: "text", text: "bold", marks: [{ type: "bold" }] }, { type: "hardBreak" }, { type: "inlineReference", attrs: { target: { kind: "block", id: kid.id }, label: "x" } }];
    table.payload.table = blankTable();
    ref.payload.target = { kind: "block", id: kid.id };
    const p = page([parent, kid, line, table, ref], [parent.id, line.id, table.id, ref.id]);
    const s = state(p);
    s.doc.check();
    for (const [id, places] of indexDoc(s.doc)) {
        const data = blockData(places[0].node);
        validateBlock(data);
        assert.deepEqual(structuredClone(data), p.blocks[id]);
    }
    const firstCell = indexDoc(s.doc).get(table.id)![0].node.firstChild!.firstChild!.firstChild!;
    assert.equal(firstCell.attrs.colspan, 1);
    assert.equal(firstCell.attrs.rowspan, 1);
    const current = select(s, kid.id).tr.insertText("new");
    assert.deepEqual(documentEdit(s.doc, current.doc).blocks.map(b => b.id), [kid.id]);
    assert.equal(documentEdit(s.doc, current.doc).pageChildren, undefined);
});
test("native split and paste create IDs; inserting a synchronous occurrence retains its ID and mirrors typing and split", () => {
    const a = block("abcd"), p = page([a]);
    let s = state(p);
    const original = s.doc.lastChild!;
    s = s.apply(s.tr.insert(s.doc.content.size, original).setMeta(syncInsert, true));
    assert.equal(indexDoc(s.doc).get(a.id)?.length, 2);
    s = select(s, a.id, 2);
    s = s.apply(s.tr.insertText("X"));
    assert.deepEqual(indexDoc(s.doc).get(a.id)?.map(o => o.node.textContent), ["abXcd", "abXcd"]);
    assert.ok(split(s, tr => {
        s = s.apply(tr);
    }));
    const nodes = s.doc.content.content.slice(1), ids = nodes.map(n => n.attrs.blockId);
    assert.deepEqual(nodes.map(n => n.textContent), ["abX", "cd", "abX", "cd"]);
    assert.deepEqual(ids, [a.id, ids[1], a.id, ids[1]]);
    assert.match(ids[1], /^[0-9a-f-]{36}$/u);
    assert.notEqual(a.id, ids[1]);
    const oldNode = s.doc.child(1);
    const pasted = copyBlocks(new Slice(Fragment.from(oldNode), 0, 0));
    s = s.apply(s.tr.replace(s.doc.content.size, s.doc.content.size, pasted).setMeta("workspace.paste", true));
    assert.notEqual(s.doc.lastChild!.attrs.blockId, a.id);
    assert.ok(s.doc.lastChild!.attrs.blockId);
    // An unmarked insertion of a copied ProseMirror node must not silently create a sync location.
    const native = oldNode;
    s = s.apply(s.tr.insert(s.doc.content.size, native));
    assert.notEqual(s.doc.lastChild!.attrs.blockId, a.id);
});
test("cross-page block paste copies every child, multiline paste allocates each item, indentation retains identity", () => {
    const a = block(""), b = block("k", "unordered_list");
    a.children = [b.id];
    const p = page([a, b], [a.id]), s = state(p);
    const copy = copyBlocks(new Slice(Fragment.from(s.doc.lastChild!), 0, 0));
    const next = s.apply(s.tr.replace(s.doc.content.size, s.doc.content.size, copy).setMeta("workspace.paste", true));
    assert.notEqual(next.doc.lastChild!.attrs.blockId, a.id);
    assert.notEqual(next.doc.lastChild!.lastChild!.attrs.blockId, b.id);
    assert.equal(next.doc.lastChild!.lastChild!.textContent, b.payload.inline[0].type === "text" ? b.payload.inline[0].text : "");
    let current = select(state(page([b])), b.id);
    current = current.apply(clipboardRows(current, [{ text: "one", kind: "unordered_list" }, { text: "two", kind: "unordered_list" }]));
    const first = current.doc.child(1), last = current.doc.lastChild!;
    assert.notEqual(first.attrs.blockId, last.attrs.blockId);
    assert.equal(last.attrs.kind, "unordered_list");
    assert.ok(indent(false)(current, tr => {
        current = current.apply(tr);
    }));
    assert.equal(current.doc.lastChild!.lastChild!.attrs.blockId, last.attrs.blockId);
    assert.ok(indent(true)(current, tr => {
        current = current.apply(tr);
    }));
    assert.equal(current.doc.lastChild!.attrs.blockId, last.attrs.blockId);
});
test("targeted reread preserves an untouched node and caret; subtree removal detects retention references", () => {
    const a = block("abc"), b = block("past"), c = block("", "blocked_reference");
    c.payload.target = { kind: "page", id: randomUUID() };
    b.children = [c.id];
    const p = page([a, b, c], [a.id, b.id]), s = select(state(p), a.id, 1);
    const changed = { ...p, blocks: { ...p.blocks, [b.id]: { ...b, payload: payload("paragraph", "new") } } };
    const next = s.apply(patchDocument(s, changed, [b.id], false)!);
    assert.equal(next.doc.child(1), s.doc.child(1));
    assert.equal(next.selection.head, s.selection.head);
    assert.equal(next.doc.lastChild!.firstChild!.textContent, "new");
    assert.equal(removesReference({ blocks: [], pageChildren: [a.id] }, p), true);
    assert.equal(removesReference({ blocks: [], pageChildren: [b.id] }, p), false);
});
test("saving accepts further edits and retries the original failed batch before later revisions", async () => {
    const a = block("A"), calls: EditCommit[] = [];
    let release!: () => void, fail = false;
    const writes = new PageWrites(randomUUID(), async input => {
        calls.push(input);
        if (calls.length === 1) await new Promise<void>(r => {
            release = r;
        });
        if (fail) {
            fail = false;
            throw Error("offline");
        }
    });
    writes.stage({ blocks: [a] });
    const pending = writes.flush(false);
    writes.stage({ blocks: [{ ...a, payload: payload("paragraph", "B") }] });
    release();
    await pending;
    assert.equal(writes.unsaved, true);
    fail = true;
    await assert.rejects(writes.flush());
    writes.stage({ blocks: [{ ...a, payload: payload("paragraph", "C") }] });
    await writes.flush();
    assert.deepEqual(calls.map(c => c.batch), [1, 2, 2, 3]);
    assert.strictEqual(calls[1], calls[2]);
    assert.equal(writes.unsaved, false);
});
test("last-reference cancellation rolls back just the deletion; confirmation commits its token once", async () => {
    const a = block("X"), target = { kind: "page" as const, id: randomUUID() };
    a.payload.inline.push({ type: "inlineReference", attrs: { target, label: "B" } });
    const p = page([a]), s = select(state(p), a.id, 1);
    const remove = s.tr.delete(s.selection.from, s.selection.from + 1);
    const input = { ...documentEdit(s.doc, remove.doc), pageId: p.id, batch: 1 };
    const preview: ChangePreview = { token: "test", recycled: [{ id: target.id, title: "B" }], direct: [], deletedBlocks: [], causes: [a.id] };
    for (const consent of [false, true]) {
        let current = s.apply(remove), asks = 0, commits = 0;
        const typing = current.tr.insertText("Z", indexDoc(current.doc).get(a.id)![0].pos + 2);
        current = current.apply(typing);
        let redo: ReturnType<typeof inverse> = [];
        await reviewEdit(input, async () => preview, async () => {
            asks++;
            return consent;
        }, async (data, token) => {
            assert.deepEqual(data, input);
            assert.equal(token, "test");
            commits++;
            return { status: "saved", batch: 1, changed: { pages: [], blocks: [] } };
        }, () => {
            const undo = replay(current, inverse([remove]), typing.mapping);
            redo = inverse([undo]);
            current = current.apply(undo);
            assert.equal(current.doc.lastChild!.firstChild!.lastChild!.type.name, "inlineReference");
        },
            () => {
                current = current.apply(replay(current, redo, new Mapping()));
            });
        assert.equal(asks, 1);
        assert.equal(commits, Number(consent));
        const edit = documentEdit(consent ? remove.doc : s.doc, current.doc);
        assert.equal(removesReference(edit, consent ? { ...p, blocks: { ...p.blocks, [a.id]: blockData(remove.doc.lastChild!) } } : p), false);
        assert.match(current.doc.textContent, /ZX/u);
    }
});

test("canceling a fallback confirmation restores only lost positions and preserves newer fields", async () => {
    const a = block("A"), b = block("B"), p = page([a, b]);
    const c = block("C");
    const restored = restoreOccurrences([a.id, b.id, a.id], [c.id, b.id, a.id], new Set([a.id]));
    assert.deepEqual(restored, [c.id, a.id, b.id, a.id]);
    const calls: EditCommit[] = [];
    const queue = new PageWrites(p.id, async input => {
        calls.push(input);
        if (calls.length === 1) {
            queue.stage({ blocks: [{ ...b, payload: payload("paragraph", "typed during confirmation") }] });
            queue.retain({ blocks: [b, c], pageChildren: restored });
        }
    });
    queue.stage({ blocks: [a, b, c], pageChildren: [c.id, b.id, a.id] });
    await queue.flush();
    assert.deepEqual(calls[1].pageChildren, restored);
    assert.equal(calls[1].blocks.find(row => row.id === b.id)?.payload.inline[0].type, "text");
    assert.deepEqual(calls[1].blocks.find(row => row.id === b.id)?.payload.inline, payload("paragraph", "typed during confirmation").inline);
});
test("typed prefixes keep the literal for undo and respect child, table and code boundaries", () => {
    for (const [prefix, kind] of [["# ", "heading_1"], ["## ", "heading_2"], ["### ", "heading_3"], ["- ", "unordered_list"], ["* ", "unordered_list"], ["+ ", "unordered_list"], ["19. ", "ordered_list"], ["> ", "blockquote"], ["```", "code"], ["---", "hr"]] as const) {
        const a = block("tail"), before = select(state(page([a])), a.id);
        const literal = before.apply(before.tr.insertText(prefix));
        assert.equal(inputAction(literal, literal.selection.from, literal.selection.to, ""), kind);
        const converted = literal.apply(convertPrefix(literal, kind));
        assert.equal(blockData(converted.doc.child(1)).type, kind);
        assert.equal(converted.doc.textContent.endsWith("tail"), true);
        const restored = converted.apply(restoreLiteral(converted, literal));
        assert.ok(restored.doc.eq(literal.doc));
        assert.equal(restored.selection.head, literal.selection.head);
    }
    const a = block("# "), b = block("nested");
    a.children = [b.id];
    const nested = select(state(page([a, b], [a.id])), a.id, 2);
    assert.equal(inputAction(nested, nested.selection.head, nested.selection.head, ""), undefined);
    for (const kind of ["code", "heading_1", "ordered_list", "blockquote"] as const) {
        const row = block("# ", kind), s = select(state(page([row])), row.id, 2);
        assert.equal(inputAction(s, s.selection.head, s.selection.head, ""), undefined);
    }
});
test("block ranges include descendants, move a subtree atomically and reject paths through synced descendants", () => {
    const a = block("A"), b = block("B"), c = block("C"), d = block("D");
    a.children = [b.id];
    const s = state(page([a, b, c, d], [a.id, c.id, b.id, d.id])), positions = indexDoc(s.doc);
    const A = positions.get(a.id)![0], B = positions.get(b.id)!, C = positions.get(c.id)![0];
    const range = new BlockSelection(s.doc, A.pos, C.pos);
    assert.deepEqual(range.places().map(p => p.node.attrs.blockId), [a.id, c.id]);
    assert.equal(range.content().content.firstChild!.lastChild!.attrs.blockId, b.id);
    assert.equal(moveBlocks(s, [A], B[1].pos + B[1].node.nodeSize - 1), null);
    const moved = moveBlocks(s, range.places(), s.doc.content.size)!;
    assert.deepEqual(s.apply(moved.tr).doc.content.content.slice(1).map(n => n.attrs.blockId), [b.id, d.id, a.id, c.id]);
    const folded = s.apply(fold(s.tr, A)), revealed = reveal(folded.tr, B[0].pos);
    assert.ok(folded.doc.child(1).attrs.collapsed && revealed.docChanged);
    assert.equal(revealed.doc.child(1).attrs.collapsed, false);
});
test("dragging between two visible occurrences of the same synced parent reorders the shared child array once", () => {
    const a = block("parent"), b = block("first"), c = block("second");
    a.children = [b.id, c.id];
    const s = state(page([a, b, c], [a.id, a.id])), entries = indexDoc(s.doc);
    const moved = moveBlocks(s, [entries.get(b.id)![0]], entries.get(a.id)![1].pos + s.doc.child(1).nodeSize - 1)!;
    assert.deepEqual(s.apply(moved.tr).doc.content.content.slice(1).map(n => blockData(n).children), [[c.id, b.id], [c.id, b.id]]);
});

test("code languages round-trip through blocks", () => {
    const a = block("const a = 1;\nconst b = 2;", "code");
    a.payload.language = "typescript";
    validateBlock(a);
    assert.deepEqual(blockData(state(page([a])).doc.child(1)), a);
});

test("invalid code language reports a language failure for both unknown languages and other block kinds", () => {
    const a = block("code", "code");
    const invalid = { failure: { kind: "block-invalid-language" } };
    assert.throws(() => validateBlock({ ...a, payload: { ...a.payload, language: "unknown" } }), invalid);
    const b = block("note");
    assert.throws(() => validateBlock({ ...b, payload: { ...b.payload, language: "typescript" } }), invalid);
});
test("an in-flight page write preserves both sides of a queued conversion boundary", async () => {
    const a = block("A"), commits: string[] = [];
    let release!: () => void;
    const first = new Promise<void>(resolve => {
        release = resolve;
    });
    const writes = new PageWrites(randomUUID(), async edit => {
        commits.push(edit.blocks[0].type + "/" + edit.blocks[0].payload.inline.map(n => n.type === "text" ? n.text : "").join(""));
        if (commits.length === 1) await first;
    });
    writes.stage({ blocks: [a] });
    const pending = writes.flush();
    writes.stage({ blocks: [{ ...a, payload: payload("paragraph", "# ") }] }); writes.checkpoint();
    writes.stage({ blocks: [{ ...a, type: "heading_1", payload: payload("heading_1") }] }); writes.checkpoint();
    release(); await pending;
    assert.deepEqual(commits, ["paragraph/A", "paragraph/# ", "heading_1/"]);
});