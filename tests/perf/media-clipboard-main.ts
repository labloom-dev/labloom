import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { app, BrowserWindow } from "electron";
import { type Editor } from "@tiptap/core";
import { type Node as DocNode } from "@tiptap/pm/model";
import { registerAttachmentProtocol } from "../../main/attachments/protocol";
import { registerIPCs } from "../../main/register";
import { attach } from "../../main/ui/windowFrame";
import * as workspaceSettings from "../../main/workspace-settings";
import { payload } from "../../shared/content/blocks";
import { type ContentBlock } from "../../shared/types/content";
import { session, startupServices } from "../support/session";
import { fixture } from "./fixture";

const root = process.env.LABLOOM_TEST_ROOT!;
const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aM9kAAAAASUVORK5CYII=";
const link = "https://example.test/stored-link";
app.setPath("userData", join(root, "chromium"));
registerAttachmentProtocol();

async function run(): Promise<void> {
    await app.whenReady();
    const f = fixture(), page = f.makePage(3, "Clipboard links"), [source, destination] = page.children, code = randomUUID();
    const blocks: ContentBlock[] = [
        { id: source, type: "paragraph", children: [], payload: { ...payload("paragraph"), inline: [
            { type: "text", text: "Prefix select " },
            { type: "text", text: "linked words", marks: [{ type: "webLink", attrs: { href: link } }] },
            { type: "text", text: " within the sentence suffix" }
        ] } },
        { id: destination, type: "paragraph", children: [], payload: payload("paragraph", "Destination ") },
        { id: code, type: "code", children: [], payload: payload("code") }
    ];
    assert.equal(f.service.commitEdit({ pageId: page.id, batch: 0, blocks, pageChildren: [source, destination, code] }, false).status, "saved");
    f.attr.run(1, page.id, "pinned");
    const directory = dirname(f.sql.name);
    session.close();
    const requested: string[] = [];
    session.configureNetwork(async input => {
        requested.push(String(input));
        return new Response(new Uint8Array(Buffer.from(png, "base64")), { headers: { "content-type": "image/png" } });
    });
    const startup = startupServices(join(root, "profile"));
    startup.restore();
    assert.equal(startup.choose(directory, "open").status, "ready");
    workspaceSettings.update({ tabs: null });

    const win = new BrowserWindow({ show: false, width: 1280, height: 860, titleBarStyle: "hidden", titleBarOverlay: true,
        webPreferences: { preload: join(root, "preload.cjs"), sandbox: true, offscreen: true, backgroundThrottling: false } });
    registerIPCs(win, attach(win));
    try {
        await win.loadURL(process.env.LABLOOM_BENCH_URL!);
        const contents = win.webContents;
        contents.debugger.attach();
        await contents.debugger.sendCommand("Emulation.setFocusEmulationEnabled", { enabled: true });
        console.log(await contents.executeJavaScript("(" + checks.toString() + ")(" + JSON.stringify({ page: page.id, source, destination, code, link, png }) + ")"));
        assert.deepEqual(requested, [
            "https://example.test/edge.png", "https://example.test/selection.png", "https://example.test/mixed.png"
        ]);
        console.log("Network requests matched the two copied image URLs and the image in mixed HTML.");
    }
    finally {
        win.destroy();
        startup.close();
    }
}

async function checks(input: { page: string; source: string; destination: string; code: string; link: string; png: string }): Promise<string> {
    const wait = (ms = 10): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));
    async function until<T>(test: () => T | Promise<T>, label: string): Promise<NonNullable<T>> {
        const deadline = performance.now() + 15000;
        for (;;) {
            const value = await test();
            if (value) return value;
            if (performance.now() > deadline) throw Error("Timed out: " + label);
            await wait();
        }
    }
    function expect(condition: unknown, label: string): asserts condition {
        if (!condition) throw Error(label);
    }
    const pin = await until(() => document.querySelector<HTMLElement>("[data-panel-node=page][data-panel-key$=\"" + input.page + "\"]"), "pinned fixture");
    pin.click();
    const editor = await until(() => {
        const dom = document.querySelector("[data-tabs-content]:not([hidden]) .tiptap") as (HTMLElement & { editor?: Editor }) | null;
        return dom?.editor?.isEditable && dom.editor.state.doc.firstChild?.textContent === "Clipboard links" ? dom.editor : undefined;
    }, "editable fixture");
    const { view } = editor;
    const dom = view.dom;
    function block(id: string): { start: number; node: DocNode } {
        let start = 0;
        for (const node of editor.state.doc.content.content) {
            if (node.attrs.blockId === id) return { start: start + 2, node };
            start += node.nodeSize;
        }
        throw Error("Block not found: " + id);
    }
    function select(id: string, from?: number, to?: number): void {
        const { start, node } = block(id);
        const offset = from ?? node.firstChild!.content.size;
        editor.commands.setTextSelection({ from: start + offset, to: start + (to ?? offset) });
        view.focus();
    }
    function clip(plain?: string, html?: string, bitmap = false): DataTransfer {
        const data = new DataTransfer();
        if (plain !== undefined) data.setData("text/plain", plain);
        if (html !== undefined) data.setData("text/html", html);
        if (bitmap) data.items.add(new File([Uint8Array.from(atob(input.png), char => char.charCodeAt(0))], "Clipboard.png", { type: "image/png" }));
        return data;
    }
    function send(event: string, data: DataTransfer): void {
        dom.dispatchEvent(new ClipboardEvent(event, { clipboardData: data, bubbles: true, cancelable: true }));
    }
    function paste(data: DataTransfer, id = input.destination): void {
        select(id);
        send("paste", data);
    }
    const links = (id = input.destination): HTMLAnchorElement[] =>
        [...dom.querySelectorAll<HTMLAnchorElement>("[data-block-id=\"" + id + "\"] a.web-link")];
    const choice = (): HTMLElement | undefined => [...document.querySelectorAll<HTMLElement>("[role=menuitem]")]
        .find(item => item.getClientRects().length > 0 && /粘贴链接|Paste link/i.test(item.textContent ?? ""));
    const images = (): number => dom.querySelectorAll("[data-kind=image]").length;
    const anchor = (url: string, text: string): string => "<a href=\"" + url + "\">" + text + "</a>";
    const image = (url: string): string => "<img src=\"" + url + "\">";
    for (const kind of ["edge", "selection"]) {
        const address = "https://example.test/" + kind;
        const html = kind === "edge" ? anchor(address, "Edge page title") : "<p><span>" + address + "</span></p>";
        paste(clip(" \t" + address + "\n ", html));
        (await until(choice, kind + " URL choice")).click();
        await until(() => view.editable && links().some(el => el.getAttribute("href") === address && el.textContent === address), kind + " URL link");

        const imageURL = address + ".png";
        const imageHTML = kind === "edge" ? anchor(imageURL, "Edge image title") : "<p><span>" + imageURL + "</span></p>";
        const expected = images() + 1;
        paste(clip(imageURL, imageHTML));
        await until(() => view.editable && images() === expected, kind + " image URL download");
    }
    for (const address of ["https://example.test/code", "https://example.test/code.png"]) {
        paste(clip(address, anchor(address, "Shortcut label")), input.code);
        expect(block(input.code).node.textContent.includes(address) && images() === 2 && !choice(), "Code paste did not insert literal URL");
    }

    function excerpt(id: string, text: string, event: "copy" | "cut"): DataTransfer {
        const from = block(id).node.textContent.indexOf(text);
        expect(from >= 0, "Selection text was missing");
        select(id, from, from + text.length);
        const data = new DataTransfer();
        send(event, data);
        expect(data.getData("text/plain") === text && data.getData("text/html").includes("class=\"web-link\""), event + " did not serialize the linked excerpt");
        return data;
    }
    const copied = excerpt(input.source, "linked words within", "copy");
    paste(copied);
    expect(links().some(el => el.href === input.link && el.textContent === "linked words"), "Copied excerpt lost its link");
    expect(block(input.destination).node.textContent.includes("linked words within"), "Copied excerpt lost surrounding text");
    const cut = excerpt(input.source, "words within", "cut");
    expect(block(input.source).node.textContent === "Prefix select linked  the sentence suffix", "Cut left text in its original position");
    paste(cut);
    expect(links().some(el => el.href === input.link && el.textContent === "words"), "Cut excerpt lost its link");
    const linkOnly = excerpt(input.destination, "https://example.test/edge", "copy");
    paste(linkOnly, input.source);
    expect(links(input.source).some(el => el.href === "https://example.test/edge") && !choice(), "Copied URL reopened the URL menu");

    const linkCount = links().length;
    paste(clip("Read the article", "<p>Read " + anchor("https://example.test/external", "the article") + "</p>"));
    expect(block(input.destination).node.textContent.includes("Read the article") && links().length === linkCount, "Ordinary external anchor became a mark");
    const external = "<p><a class=\"web-link\" href=\"https://example.test/web\">Web label</a> and <a class=\"web-link\" href=\"mailto:editor@example.test\">Mail label</a></p>";
    paste(clip("Web label and Mail label", external));
    expect(block(input.destination).node.textContent.includes("Web label and Mail label") && links().length === linkCount, "External web-link class became a mark");
    cut.setData("text/html", "<p><a class=\"web-link\" href=\"data:image/png;base64," + input.png + "\">Image label</a></p>");
    cut.setData("text/plain", "Image label");
    paste(cut);
    expect(block(input.destination).node.textContent.includes("Image label") && links().length === linkCount, "A non-HTTP URL was retained as a link");

    paste(clip("Quarter\tRevenue\r\nQ1\t42", "<table><tr><td>Quarter</td><td>Revenue</td></tr><tr><td>Q1</td><td>42</td></tr></table>", true));
    expect(dom.textContent?.includes("Quarter") && dom.textContent.includes("42") && images() === 2, "Excel text became an image");
    paste(clip("Slide text", "<p>Slide text</p>", true));
    expect(dom.textContent?.includes("Slide text") && images() === 2, "PowerPoint text became an image");
    const browserImage = "https://example.test/browser-copy.png";
    paste(clip(browserImage, image(browserImage), true));
    await until(() => view.editable && images() === 3, "browser image with a bitmap");
    paste(clip(undefined, undefined, true));
    await until(() => view.editable && images() === 4, "screenshot only");
    paste(clip("Before mixed image After mixed image", "<p>Before mixed image</p>" + image("https://example.test/mixed.png") + "<p>After mixed image</p>", true));
    await until(() => view.editable && images() === 5, "one downloaded image in mixed HTML");
    const correctlyPlaced = editor.state.doc.content.content.some((node, index, nodes) => node.textContent === "Before mixed image"
        && nodes[index + 1]?.attrs.kind === "image" && nodes[index + 2]?.textContent === "After mixed image");
    expect(correctlyPlaced, "Image did not stay between the pasted paragraphs");
    return "Clipboard URL choices, code literals, linked copy and cut, external links, Office text, bitmap and mixed HTML passed.";
}

void run().then(() => app.exit(0), error => {
    console.error(error);
    app.exit(1);
});