import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createWorkspace, openWorkspace } from "../main/storage/workspace";
import { KnowledgeService } from "../main/knowledge/service";
import { plainDocument } from "../main/knowledge/document";
import { PaperService, emptyPaper, parseBibTeX, bibTeX, doiMetadata } from "../main/knowledge/papers";
import { createBackup, restoreBackup, verifyBackup } from "../main/knowledge/backup";
import { FeedService } from "../main/feed/service";
import { AssistantService } from "../main/assistant/service";
import { exportPages } from "../main/knowledge/export";
import { defaultSchedule, isOverdue, fromZonedInput, zonedInput } from "../shared/utils/schedule";

function workspace() {
    const directory = mkdtempSync(join(tmpdir(), "labloom-knowledge-"));
    const folder = join(directory, "workspace");
    mkdirSync(folder);
    const opened = createWorkspace(folder);
    return { directory, folder, opened, service: new KnowledgeService(opened.database), close() { if (opened.database.open) opened.database.close(); rmSync(directory, { recursive: true, force: true }); } };
}

test("pages persist with stable blocks, optimistic revisions, tags and properties", () => {
    const fixture = workspace();
    try {
        const { service } = fixture;
        let page = service.create({ title: "我的笔记", document: plainDocument("第一段\n第二段") });
        const block = page.document.content[0].attrs!.uid;
        service.saveProperty({ id: "custom:score", name: "评分", type: "number" });
        page = service.save({ ...page, tags: ["研究", "研究"], properties: { "custom:score": 3 }, document: { ...page.document, content: [{ ...page.document.content[0], content: [{ type: "text", text: "已自动保存" }] }] } });
        assert.equal(page.document.content[0].attrs!.uid, block);
        assert.deepEqual(page.tags, ["研究"]);
        assert.equal(service.list({ keyword: "自动保存", tags: ["研究"] }).total, 1);
        assert.throws(() => service.save({ ...page, revision: page.revision - 1 }), /其他编辑/);
        fixture.opened.database.close();
        const reopened = openWorkspace(fixture.folder);
        try {
            const restored = new KnowledgeService(reopened.database).get(page.id);
            assert.equal(restored.document.content[0].content![0].text, "已自动保存");
            assert.equal(restored.properties["custom:score"], 3);
        }
        finally { reopened.database.close(); }
    }
    finally { fixture.close(); }
});

test("links retain non-independent pages, deletion cascades to orphans, restoration keeps content", () => {
    const fixture = workspace();
    try {
        const { service } = fixture;
        let source = service.create({ title: "项目" });
        let target = service.create({ title: "相关笔记" });
        source = service.save({ ...source, document: { type: "doc", content: [{ type: "pageReference", attrs: { targetId: target.id, mode: "reference", writable: false } }] } });
        target = service.save({ ...target, independent: false });
        assert.equal(target.deleted, false);
        assert.equal(service.backlinks(target.id)[0].sourceId, source.id);
        service.trash([source.id]);
        assert.equal(service.get(target.id).deleted, true);
        assert.equal(service.list({}).total, 0);
        assert.equal(service.list({ deleted: true }).total, 2);
        service.restore([target.id]);
        assert.equal(service.get(target.id).independent, true);
        assert.equal(service.get(target.id).title, "相关笔记");
    }
    finally { fixture.close(); }
});

test("renaming and removing shared tags never deletes pages and invalidates stale editors", () => {
    const fixture = workspace();
    try {
        let page = fixture.service.create();
        page = fixture.service.save({ ...page, tags: ["旧标签"] });
        fixture.service.renameTag("旧标签", "新标签");
        assert.deepEqual(fixture.service.get(page.id).tags, ["新标签"]);
        assert.throws(() => fixture.service.save(page), /其他编辑/);
        fixture.service.removeTag("新标签");
        assert.equal(fixture.service.list({}).total, 1);
        assert.deepEqual(fixture.service.get(page.id).tags, []);
        assert.throws(() => fixture.service.removeProperty("deleted"), /内置/);
    }
    finally { fixture.close(); }
});

test("PDFs, annotations, reading positions and version attachments survive reopening", () => {
    const fixture = workspace();
    try {
        const papers = new PaperService(fixture.service, fixture.folder);
        const file = join(fixture.directory, "paper.pdf");
        writeFileSync(file, "%PDF-1.4\nfixture");
        const paper = papers.importPDF(file);
        assert.equal(papers.importPDF(file).id, paper.id);
        const attachment = papers.attachments(paper.id)[0];
        const position = { pageNumber: 3, scale: "page-width" as const, rotation: 90 as const, top: 100, left: 20 };
        papers.setPosition(attachment.id, position);
        const annotation = papers.annotate({ attachmentId: attachment.id, pageNumber: 3, quote: "原文", color: "yellow", rects: [{ x: 10, y: 10, width: 20, height: 5 }] });
        assert.equal(fixture.service.get(annotation.pageId).kind, "annotation");
        writeFileSync(file, "%PDF-1.4\nsecond version");
        papers.importPDF(file, paper.id);
        assert.equal(papers.attachments(paper.id).length, 2);
        assert.equal(papers.annotations(attachment.id)[0].quote, "原文");
        assert.deepEqual(papers.getPosition(attachment.id), position);
        assert.throws(() => papers.readAttachment("../../outside"), /标识/);
    }
    finally { fixture.close(); }
});

test("backups validate checksums and restore into a new workspace without touching the original", () => {
    const fixture = workspace();
    try {
        const page = fixture.service.create({ title: "备份的内容" });
        const parent = join(fixture.directory, "backups");
        mkdirSync(parent);
        const backup = createBackup(fixture.opened.database, fixture.folder, parent);
        assert.equal(verifyBackup(backup).files[0].path, "workspace.sqlite");
        fixture.service.save({ ...page, title: "备份后的修改" });
        const destination = join(fixture.directory, "restored");
        mkdirSync(destination);
        restoreBackup(backup, destination);
        const restored = openWorkspace(destination);
        try { assert.equal(new KnowledgeService(restored.database).get(page.id).title, "备份的内容"); }
        finally { restored.database.close(); }
        assert.equal(fixture.service.get(page.id).title, "备份后的修改");
        writeFileSync(join(backup, "workspace.sqlite"), "broken");
        assert.throws(() => verifyBackup(backup), /校验失败/);
    }
    finally { fixture.close(); }
});

test("tasks validate dates and retain due reminders across runs", () => {
    const fixture = workspace();
    try {
        const schedule = { ...defaultSchedule(), timezone: "Asia/Shanghai", end: "2026-11-05", reminder: "2026-11-04T00:00:00Z" };
        const page = fixture.service.create({ title: "读论文", kind: "task", schedule });
        assert.equal(isOverdue(schedule, Date.parse("2026-11-05T16:00:00Z")), true);
        assert.equal(isOverdue(schedule, Date.parse("2026-11-05T15:00:00Z")), false);
        const reminders = fixture.service.reminders(new Date("2026-11-06"));
        assert.equal(reminders.length, 1);
        assert.equal(fixture.service.reminders(new Date("2026-11-06")).length, 1);
        fixture.service.save({ ...page, schedule: { ...schedule, status: "done" } });
        assert.equal(fixture.service.reminders(new Date("2026-11-06")).length, 0);
        assert.throws(() => fixture.service.create({ kind: "event", schedule: { ...schedule, start: "2026-11-07" } }), /早于/);
    }
    finally { fixture.close(); }
});

test("BibTeX nested braces and DOI metadata map to real paper fields", async () => {
    const entries = parseBibTeX('@article{test, title = {A {Nested} Title}, author = {Alice and Bob}, year = {2026}, doi = {10.1234/test}}');
    assert.equal(entries[0].title, "A Nested Title");
    assert.equal(entries[0].paper.authors, "Alice; Bob");
    const metadata = await doiMetadata("10.1234/test", async () => new Response(JSON.stringify({ title: "DOI title", author: [{ given: "Alice", family: "Smith" }], issued: { "date-parts": [[2026]] } })));
    assert.equal(metadata.paper.authors, "Alice Smith");
    assert.equal(metadata.paper.year, "2026");
    const fixture = workspace();
    try {
        const page = fixture.service.create({ title: entries[0].title, kind: "paper", paper: entries[0].paper });
        assert.match(bibTeX([page]), /doi = \{10.1234\/test\}/);
    }
    finally { fixture.close(); }
});

test("copying blocks assigns independent identities and preserves reference targets", () => {
    const fixture = workspace();
    try {
        const source = fixture.service.create({ title: "原始页面", document: plainDocument("原始内容") });
        let copy = fixture.service.create({ title: "内容副本", document: source.document });
        assert.notEqual(copy.document.content[0].attrs!.uid, source.document.content[0].attrs!.uid);
        copy = fixture.service.save({ ...copy, document: plainDocument("只修改副本") });
        assert.equal(fixture.service.get(source.id).document.content[0].content![0].text, "原始内容");
        assert.equal(copy.document.content[0].content![0].text, "只修改副本");
        fixture.service.saveProperty({ id: "custom:field", name: "方向", type: "string" });
        const page = fixture.service.save({ ...source, properties: { "custom:field": "独特检索词" } });
        assert.equal(fixture.service.list({ keyword: "独特检索词" }).total, 1);
        fixture.service.removeProperty("custom:field");
        assert.equal(fixture.service.list({ keyword: "独特检索词" }).total, 0);
        assert.throws(() => fixture.service.save(page), /其他编辑/);
    }
    finally { fixture.close(); }
});

test("feed preferences, grouping, scheduling and bulk reads preserve saved entries", async () => {
    const fixture = workspace();
    try {
        let calls = 0;
        const feed = new FeedService(fixture.opened.database, async () => { calls++; return [{ externalId: "one", title: "Knowledge graph", authors: "", summary: "Notes", url: "https://example.org/1", publishedAt: "2026-01-01T00:00:00Z" }, { externalId: "two", title: "Other topic", authors: "", summary: "Unrelated", url: "https://example.org/2", publishedAt: "2026-02-01T00:00:00Z" }]; });
        const id = await feed.saveSource({ name: "研究", url: "https://example.org/feed", group: "论文", interval: 15, keywords: "knowledge,知识" });
        assert.equal(feed.getState({ group: "论文", preferredOnly: true }).total, 1);
        assert.equal(feed.getState({ group: "其他" }).total, 0);
        assert.equal(feed.getState({ sort: "oldest" }).items[0].externalId, "one");
        feed.setReadAll({ preferredOnly: true });
        assert.equal(feed.getState({ unreadOnly: true }).total, 1);
        await feed.refreshDue(Date.now()); assert.equal(calls, 1);
        await feed.refreshDue(Date.now() + 16 * 60000); assert.equal(calls, 2);
        await feed.saveSource({ id, name: "暂停来源", url: "https://example.org/feed", group: "论文", paused: true, interval: 15 });
        await feed.refreshDue(Date.now() + 20 * 60000); assert.equal(calls, 2);
        await feed.refresh(); assert.equal(calls, 2);
        await feed.refresh(id); assert.equal(calls, 3);
        assert.equal(feed.getState({}).total, 2);
    }
    finally { fixture.close(); }
});

test("Markdown export includes linked snapshots, local images, stable anchors and PDFs", () => {
    const fixture = workspace();
    try {
        const papers = new PaperService(fixture.service, fixture.folder);
        const pdf = join(fixture.directory, "original.pdf"); writeFileSync(pdf, "%PDF-1.4\nexport fixture");
        const paper = papers.importPDF(pdf);
        const page = fixture.service.create({ title: "导出页", document: { type: "doc", content: [
            { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "内容标题" }] },
            { type: "image", attrs: { src: "data:image/png;base64,aGVsbG8=", alt: "本地图片" } },
            { type: "pageReference", attrs: { targetId: paper.id, mode: "sync", writable: false } }
        ] } });
        const output = exportPages(fixture.service, papers, fixture.folder, fixture.directory, [page.id]);
        const content = readFileSync(join(output, `${page.id}.md`), "utf8");
        assert.match(content, /## 内容标题/); assert.match(content, /assets\/.+\.png/); assert.match(content, /<a id=/);
        assert.match(readFileSync(join(output, `${paper.id}.md`), "utf8"), /PDF 原文/);
        assert.equal(readFileSync(join(output, "assets", `${papers.attachments(paper.id)[0].id}.pdf`), "utf8"), "%PDF-1.4\nexport fixture");
        assert.match(readFileSync(join(output, "README.md"), "utf8"), /同步链接指向/);
    }
    finally { fixture.close(); }
});

test("assistant sends only selected context, protects tokens and retains source identities", async () => {
    const fixture = workspace();
    try {
        const selected = fixture.service.create({ title: "可提供资料", document: plainDocument("选中的正文") });
        fixture.service.create({ title: "未选资料", document: plainDocument("不可自动发送的正文") });
        let request: RequestInit | undefined;
        const assistant = new AssistantService(fixture.service, { encrypt: value => `cipher:${value}`, decrypt: value => value.slice(7) }, async (_url, init) => { request = init; return new Response(JSON.stringify({ message: { content: "来自资料的回答 [1]" } })); });
        const config = assistant.configure({ endpoint: "https://models.example.org", model: "test", key: "secret-value" });
        assert.equal(config.hasKey, true); assert.equal("key" in config, false);
        const reply = await assistant.ask({ id: "request-1", question: "总结资料", pageIds: [selected.id], history: [] });
        assert.equal(reply.sources[0].id, selected.id);
        const body = String(request?.body);
        assert.match(body, /选中的正文/); assert.doesNotMatch(body, /不可自动发送的正文/);
        assert.equal((request!.headers as Record<string, string>).Authorization, "Bearer secret-value");
        assert.equal(request!.redirect, "error");
        assert.equal(assistant.configure({ endpoint: "https://different.example.org", model: "test" }).hasKey, false);
        assert.throws(() => assistant.configure({ endpoint: "http://remote.example.org", model: "test" }), /HTTPS/);
        fixture.service.trash([selected.id]);
        await assert.rejects(assistant.ask({ id: "request-2", question: "总结", pageIds: [selected.id], history: [] }), /已删除/);
    }
    finally { fixture.close(); }
});

test("assistant cancellation aborts the request and permits a retry", async () => {
    const fixture = workspace();
    try {
        const assistant = new AssistantService(fixture.service, { encrypt: value => value, decrypt: value => value }, async (_url, init) => new Promise((_resolve, reject) => { init!.signal!.addEventListener("abort", () => reject(new Error("aborted"))); }));
        assistant.configure({ endpoint: "http://localhost:11434", model: "test" });
        const request = assistant.ask({ id: "cancel-test", question: "问题", pageIds: [], history: [] });
        assistant.cancel("cancel-test"); await assert.rejects(request, /已取消/);
    }
    finally { fixture.close(); }
});

test("schedule input honors its timezone and rejects a missing DST hour", () => {
    assert.equal(fromZonedInput("2026-11-06T10:00", "Asia/Shanghai"), "2026-11-06T02:00:00.000Z");
    assert.equal(zonedInput("2026-11-06T02:00:00.000Z", "Asia/Shanghai"), "2026-11-06T10:00");
    assert.throws(() => fromZonedInput("2026-03-08T02:30", "America/New_York"), /夏令时/);
});
test("batch edits and combined property filters are transactional", () => {
    const fixture = workspace();
    try {
        const first = fixture.service.create({ title: "first" }), second = fixture.service.create({ title: "second" });
        fixture.service.saveProperty({ id: "custom:number", name: "分数", type: "number" });
        fixture.service.saveProperty({ id: "custom:flag", name: "标记", type: "boolean" });
        fixture.service.updateMany([first.id, second.id], { addTags: ["共同标签"], properties: { "custom:number": 42, "custom:flag": true }, pinned: true });
        assert.equal(fixture.service.list({ tags: ["共同标签"], properties: { "custom:number": 42, "custom:flag": true }, pinned: true }).total, 2);
        assert.throws(() => fixture.service.updateMany([first.id, "missing"], { addTags: ["不应提交"] }), /不存在/);
        assert.equal(fixture.service.get(first.id).tags.includes("不应提交"), false);
        fixture.service.updateMany([first.id], { removeTags: ["共同标签"], properties: { "custom:flag": false } });
        assert.equal(fixture.service.list({ properties: { "custom:flag": false } }).total, 1);
        fixture.service.saveProperty({ id: "custom:date", name: "日期", type: "date" });
        assert.throws(() => fixture.service.updateMany([first.id], { properties: { "custom:date": "2026-02-30" } }), /有效的日期/);
        assert.equal(fixture.service.list({ properties: { "custom:date": null } }).total, 2);
    }
    finally { fixture.close(); }
});

test("backup validation catches omitted PDF files even when remaining hashes are valid", () => {
    const fixture = workspace();
    try {
        const papers = new PaperService(fixture.service, fixture.folder);
        const pdf = join(fixture.directory, "paper.pdf"); writeFileSync(pdf, "%PDF-1.4\nbackup fixture"); papers.importPDF(pdf);
        const output = createBackup(fixture.opened.database, fixture.folder, fixture.directory);
        const manifest = JSON.parse(readFileSync(join(output, "manifest.json"), "utf8"));
        manifest.files = manifest.files.filter((file: { path: string }) => file.path === "workspace.sqlite");
        writeFileSync(join(output, "manifest.json"), JSON.stringify(manifest));
        assert.throws(() => verifyBackup(output), /文献附件/);
    }
    finally { fixture.close(); }
});