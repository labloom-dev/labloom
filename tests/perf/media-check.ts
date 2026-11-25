import type { Editor } from "@tiptap/core";
import type { PageRecord } from "../../shared/types/content";
import type { MediaFile } from "../../shared/content/media";

type ImageMetrics = { open: number; viewer: number; shift: number; offscreen: number; opening: number[]; viewing: number[] };
export async function browserChecks(ids: { photos: string; note: string; short: string; editing: string; ordinary: string; correction: string },
    foreignSource: { workspaceId: string; file: MediaFile }): Promise<ImageMetrics> {
    const wait = (ms = 10): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));
    const frame = (): Promise<number> => new Promise(resolve => requestAnimationFrame(resolve));
    const paint = (): Promise<void> => new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
    const until = async <T>(read: () => T | undefined | null | false | Promise<T | undefined | null | false>, label: string): Promise<T> => {
        const deadline = performance.now() + 30000;
        for (;;) {
            const value = await read();
            if (value) return value;
            if (performance.now() >= deadline) throw Error("Timed out: " + label + " · " + document.body.innerText.slice(-400));
            await wait();
        }
    };
    const p95 = (values: number[]): number => +(values.toSorted((a, b) => a - b)[Math.ceil(values.length * .95) - 1] ?? 0).toFixed(2);
    const visible = (selector: string): HTMLElement | null => document.querySelector("[data-tabs-content]:not([hidden]) " + selector);
    const editor = (): Editor | undefined => (visible(".tiptap") as (HTMLElement & { editor?: Editor }) | null)?.editor;
    const pinned = (id: string): HTMLElement | null => document.querySelector(`[data-panel-node=page][data-panel-key$="${id}"]`);
    async function open(page: keyof Omit<typeof ids, "ordinary">): Promise<Editor> {
        await until(() => pinned(ids[page]), "pinned page " + page).then(link => link.click());
        return until(() => {
            const current = editor(), title = current?.state.doc.firstChild?.textContent;
            const labels = { photos: "300 images", note: "Media editing", short: "Small video", editing: "Concurrent editing", correction: "Media transfer and links" };
            return title === labels[page] && current?.view.editable && current;
        }, page + " editor ready");
    }
    function end(instance: Editor): void {
        instance.commands.focus("end", { scrollIntoView: false });
    }
    function press(target: Element, key: string, extra: KeyboardEventInit = {}): void {
        target.dispatchEvent(new KeyboardEvent("keydown", { key, ...extra, bubbles: true, cancelable: true }));
    }
    function paste(instance: Editor, data: DataTransfer): void {
        instance.view.dom.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
    }
    function textData(text: string, html?: string): DataTransfer {
        const data = new DataTransfer();
        data.setData("text/plain", text);
        if (html) data.setData("text/html", html);
        return data;
    }
    const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aM9kAAAAASUVORK5CYII=";
    function addBitmap(data: DataTransfer): DataTransfer {
        const bytes = Uint8Array.from(atob(png.split(",")[1]), char => char.charCodeAt(0));
        data.items.add(new File([bytes], "Screenshot.png", { type: "image/png" }));
        return data;
    }
    const note = (): Promise<PageRecord> => window.api.pages.get(ids.note);
    const kinds = (page: PageRecord): string => page.children.map(id => page.blocks[id].type).join(",");
    const count = (page: PageRecord, kind: string): number => page.children.filter(id => page.blocks[id].type === kind).length;
    await until(() => pinned(ids.photos), "startup");
    const opening: number[] = [], viewing: number[] = [];
    let shift = 0, offscreen = 0;
    const rounds = 21;
    for (let i = 0; i < rounds; i++) {
        const started = performance.now(), instance = await open("photos"), dom = instance.view.dom;
        const images = [...dom.querySelectorAll<HTMLElement>("[data-kind=image]")], viewport = visible(".page-view")!.getBoundingClientRect();
        const onScreen = images.filter(image => {
            const b = image.getBoundingClientRect();
            return b.top < Math.min(viewport.bottom, innerHeight) && b.bottom > Math.max(viewport.top, 0);
        });
        if (images.length !== 300 || !onScreen.length) throw Error("Fixture did not mount 300 images");
        const y = onScreen[0].getBoundingClientRect().top;
        const decoded = await until(() => {
            const elements = onScreen.map(el => el.querySelector("img"));
            return elements.every(image => image?.complete && image.naturalWidth > 0) && elements as HTMLImageElement[];
        }, "first-screen images loaded");
        await Promise.all(decoded.map(image => image.decode()));
        await paint();
        const read = performance.getEntriesByName("labloom:page-read").at(-1);
        if (!read || read.startTime < started) throw Error("Missing page open mark");
        opening.push(performance.now() - started);
        shift = Math.max(shift, Math.abs(onScreen[0].getBoundingClientRect().top - y));
        offscreen = Math.max(offscreen, dom.querySelectorAll("img").length);
        const button = onScreen[0].querySelector<HTMLButtonElement>(".media-image")!;
        const openStarted = performance.now();
        button.click();
        const popup = await until(() => document.querySelector<HTMLDialogElement>(".image-viewer:modal"), "image viewer");
        const image = await until(() => {
            const image = popup.querySelector("img");
            return image?.complete && image.naturalWidth > 0 && image;
        }, "viewer image");
        await image.decode(); await paint();
        viewing.push(performance.now() - openStarted);
        if (!i) {
            const first = image.src;
            const small = image.getBoundingClientRect(), stage = image.parentElement!.getBoundingClientRect();
            if (small.width !== 64 || small.height !== 48 || Math.abs(small.left + small.width / 2 - stage.left - stage.width / 2) > 1
                || Math.abs(small.top + small.height / 2 - stage.top - stage.height / 2) > 1) throw Error("Small viewer image was resized or off center");
            const doubleClick = (target: Element): boolean => target.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
            doubleClick(image);
            await paint();
            if (image.getBoundingClientRect().width !== 64) throw Error("Double clicking enlarged a small image");
            press(popup, "ArrowRight", { isComposing: true });
            if (popup.querySelector("img")?.src !== first) throw Error("Composing key changed image");
            press(popup, "ArrowRight");
            await until(() => popup.querySelector("img")?.src !== first && popup.textContent?.includes("2 / 300"), "next image and caption");
            press(popup, "ArrowRight");
            await until(() => popup.textContent?.includes("3 / 300"), "third image");
            press(popup, "ArrowRight");
            const large = await until(() => {
                const current = popup.querySelector("img");
                return current?.complete && current.naturalWidth === 6000 && current;
            }, "6000px viewer image");
            await paint();
            const viewport = large.parentElement!.getBoundingClientRect(), fitted = large.getBoundingClientRect();
            if (Math.abs(fitted.width - Math.min(viewport.width, viewport.height * 1.5)) > 1 || fitted.width >= 6000
                || fitted.left < viewport.left - 1 || fitted.top < viewport.top - 1 || fitted.right > viewport.right + 1
                || fitted.bottom > viewport.bottom + 1) throw Error("Large image did not fit in the viewer");
            doubleClick(large);
            await until(() => large.getBoundingClientRect().width === 6000, "original viewer size");
            doubleClick(large);
            await until(() => Math.abs(large.getBoundingClientRect().width - fitted.width) <= 1, "restore fitted size");
            for (let index = 0; index < 3; index++) {
                press(popup, "ArrowLeft");
                await paint();
            }
            await until(() => popup.querySelector("img")?.src === first && popup.querySelector("img")?.getBoundingClientRect().width === 64, "previous image and native size");
            console.info("MEDIA viewer native and fitted sizes " + JSON.stringify({ small: [small.width, small.height], fitted: [fitted.width, fitted.height], viewport: [viewport.width, viewport.height] }));
        }
        press(popup, "Escape");
        await until(() => !document.querySelector(".image-viewer:modal"), "viewer closed with Escape");
        await until(() => document.activeElement === button, "viewer focus restored");
        if (i + 1 < rounds) {
            const close = document.querySelector<HTMLButtonElement>(".tab.active .close-tab");
            if (!close) throw Error("Could not close benchmark tab");
            close.click();
            await until(() => !editor(), "benchmark tab closed");
        }
    }
    const photosResult = { open: p95(opening), viewer: p95(viewing), shift, offscreen, opening, viewing };
    console.info("MEDIA stills " + JSON.stringify(photosResult));
    if (offscreen < 1 || offscreen > 12) throw Error("Offscreen images were loaded on open");
    async function checkClipboard(): Promise<void> {
        const instance = await open("note"), field = instance.view.dom;
        end(instance);
        instance.view.dispatch(instance.state.tr.insertText(" "));
        instance.view.dispatch(instance.state.tr.insertText("/"));
        await until(() => document.querySelector(".suggestion-menu:popover-open"), "slash menu");
        instance.view.dispatch(instance.state.tr.insertText("image"));
        await until(() => [...document.querySelectorAll<HTMLButtonElement>(".suggestion-menu:popover-open button")].find(button => /^(图片|Image)$/u.test(button.textContent?.trim() ?? "")), "image choice").then(button => button.click());
        const bulk = await until(async () => {
            const page = await note();
            return count(page, "image") === 2 && page;
        }, "bulk insert via native picker").catch(async error => {
            const page = await note();
            throw Error(error.message + " " + JSON.stringify({ blocks: Object.values(page.blocks).map(block => block.type),
                root: kinds(page), status: document.querySelector(".toast.error")?.textContent, dom: field.textContent?.slice(0, 300) }));
        });
        const fileIds = bulk.children.map(id => bulk.blocks[id].payload.media?.fileId).filter(Boolean);
        if (new Set(fileIds).size !== 2) throw Error("Two new local copies must get different IDs");
        const first = bulk.children.find(id => bulk.blocks[id].type === "image")!;
        await until(() => instance.view.editable && field.querySelector(`[data-block-id="${first}"]`), "bulk import rendered");
        const firstPosition = (): number => {
            let pos = 0;
            instance.state.doc.forEach((node, offset) => {
                if (node.attrs.blockId === first) pos = offset;
            });
            return pos;
        };
        instance.commands.setTextSelection(firstPosition() + 2);
        instance.view.focus();
        press(field, "/", { ctrlKey: true });
        const caption = await until(() => [...document.querySelectorAll<HTMLElement>("[role=menuitem]")].find(item => /添加说明|Add caption/.test(item.textContent ?? "")), "caption action");
        caption.click();
        await until(() => instance.state.selection.from === firstPosition() + 2, "caption caret");
        instance.view.dispatch(instance.state.tr.insertText("image caption"));
        await until(async () => (await note()).blocks[first]?.payload.inline.some(node => node.type === "text" && node.text.includes("image caption")), "caption saved");
        const resize = field.querySelector<HTMLButtonElement>(`[data-block-id="${first}"] .resize:not(.left)`)!;
        const pointerCapture = resize.setPointerCapture;
        resize.setPointerCapture = () => {};
        try {
            const x = resize.getBoundingClientRect().left;
            for (const [type, clientX] of [["pointerdown", x], ["pointermove", x - 80], ["pointerup", x - 80]] as const)
                resize.dispatchEvent(new PointerEvent(type, { clientX, pointerId: 9, button: 0, bubbles: true, cancelable: true }));
        }
        finally {
            resize.setPointerCapture = pointerCapture;
        }
        await until(async () => {
            const width = (await note()).blocks[first].payload.media?.width;
            return width !== undefined && width > 0 && width < 1;
        }, "relative media width");
        resize.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
        await until(async () => (await note()).blocks[first].payload.media?.width === undefined, "default media width");
        instance.commands.setTextSelection(firstPosition() + 2);
        press(field, "Escape");
        const data = new DataTransfer();
        field.dispatchEvent(new ClipboardEvent("copy", { clipboardData: data, cancelable: true, bubbles: true }));
        const custom = data.getData("application/x-labloom-blocks");
        if (!custom || !Object.values(JSON.parse(custom).files ?? {}).some(file => typeof (file as { path?: string }).path === "string")) throw Error("Clipboard file path missing");
        end(instance);
        paste(instance, data);
        const pasteButton = await until(() => [...document.querySelectorAll<HTMLElement>("[role=menuitem]")].find(item => /^(粘贴|Paste)(Ctrl\+V)?$/u.test((item.textContent ?? "").trim())), "paste choice");
        pasteButton.click();
        await until(async () => instance.view.editable && count(await note(), "image") === 3
            && field.querySelectorAll("[data-kind=image]").length === 3, "ordinary local-media paste");
        const copy = await note();
        if (copy.children.filter(id => copy.blocks[id].payload.media?.fileId === fileIds[0]).length !== 2) throw Error("Same-workspace paste copied bytes");
        const foreign = JSON.parse(custom);
        foreign.workspaceId = foreignSource.workspaceId;
        foreign.files = { [foreignSource.file.id]: foreignSource.file };
        foreign.slice.content[0].attrs.media.fileId = foreignSource.file.id;
        const outside = new DataTransfer();
        outside.setData("application/x-labloom-blocks", JSON.stringify(foreign));
        end(instance); paste(instance, outside);
        await until(async () => instance.view.editable && count(await note(), "image") === 4
            && field.querySelectorAll("[data-kind=image]").length === 4, "cross-workspace folder import");
        const foreignResult = await note();
        if (new Set(foreignResult.children.map(id => foreignResult.blocks[id].payload.media?.fileId).filter(Boolean)).size !== 3) throw Error("Foreign file was not copied");
        foreign.files[Object.keys(foreign.files)[0]].path += "-missing";
        outside.setData("application/x-labloom-blocks", JSON.stringify(foreign));
        end(instance); paste(instance, outside);
        await until(async () => instance.view.editable && Object.values((await note()).blocks).some(block => block.payload.media?.fileId === null)
            && field.querySelectorAll("[data-kind=image]").length === 5, "foreign missing file label");
        console.info("MEDIA local picker, caption, same-workspace and foreign clipboard");
        const imagesReady = async (expected: number): Promise<boolean> => instance.view.editable &&
            field.querySelectorAll("[data-kind=image]").length === expected && count(await note(), "image") === expected;
        const bitmap = addBitmap(new DataTransfer());
        end(instance); paste(instance, bitmap);
        await until(() => imagesReady(6), "clipboard bitmap");
        end(instance); paste(instance, textData("https://example.test/image.png"));
        await until(() => imagesReady(7), "plain network image URL");
        end(instance); paste(instance, textData("https://example.test/extensionless"));
        await until(() => [...document.querySelectorAll<HTMLElement>("[role=menuitem]")].find(item => /嵌入为图片|Embed as image/.test(item.textContent ?? "")), "embed choice").then(button => button.click());
        await until(() => imagesReady(8), "extensionless embed");
        end(instance); paste(instance, addBitmap(textData("A B C", `<p>A <b>bold</b></p><img src="${png}"><p>B</p><img src="https://example.test/bad.png"><p>C</p>`)));
        await until(async () => await imagesReady(9) && !!field.querySelector(".web-link[href='https://example.test/bad.png']"), "mixed HTML and failed image link");
        console.info("MEDIA bitmap, URL choices and mixed HTML clipboard");
        end(instance);
        paste(instance, textData("https://example.test/slow.png"));
        await until(() => visible(".media-transfer"), "slow image progress");
        const firstBody = instance.state.doc.firstChild!.nodeSize;
        instance.view.dispatch(instance.state.tr.insertText("Moved anchor: ", firstBody + 2, firstBody + 2));
        await until(() => imagesReady(10), "image inserted after concurrent typing");
        const changed = await note();
        const firstText = changed.blocks[changed.children[0]].payload.inline[0];
        if (firstText?.type !== "text" || !firstText.text.startsWith("Moved anchor:")
            || changed.blocks[changed.children.at(-1)!].type !== "image") throw Error("The insertion did not track the edited page");
        end(instance);
        paste(instance, textData("https://example.test/slow.png"));
        await until(() => visible(".media-transfer button"), "cancel action").then(button => button.click());
        await until(() => !visible(".media-transfer"), "transfer canceled");
        if (!await imagesReady(10)) throw Error("Canceled transfer modified the page");
        end(instance);
        paste(instance, textData("https://example.test/slow.png"));
        await until(() => visible(".media-transfer"), "transfer before tab close");
        document.querySelector<HTMLButtonElement>(".tab.active .close-tab")!.click();
        await until(() => !field.isConnected, "editor closed during transfer");
        await wait(500);
        if (count(await note(), "image") !== 10) throw Error("Closing the editor did not cancel the transfer");
        console.info("MEDIA resize and reset, mapped insertion, canceled and closed transfers");
    }

    async function checkCorrections(): Promise<void> {
        const instance = await open("correction"), { view } = instance, dom = view.dom;
        const source = { kind: "page", id: ids.correction } as const;
        const saved = (): Promise<PageRecord> => window.api.pages.get(ids.correction);
        const text = (page: PageRecord, id: string): string => page.blocks[id].payload.inline.map(part => part.type === "text" ? part.text : "").join("");
        const first = instance.state.doc.firstChild!.nodeSize + 2, second = first + instance.state.doc.child(1).nodeSize;
        function drag(target: Element, event: string, dataTransfer: DataTransfer, clientX: number, clientY: number): void {
            target.dispatchEvent(new DragEvent(event, { bubbles: true, cancelable: true, clientX, clientY, dataTransfer }));
        }
        const noLine = async (): Promise<void> => {
            await paint();
            if (visible(".drop-line")) throw Error("Text or unconfirmed HTML drag drew a block drop line");
        };
        const dragStart = view.coordsAtPos(first + 6), dragEnd = view.coordsAtPos(second + 5);
        instance.commands.setTextSelection({ from: first + 5, to: first + 10 });
        view.focus();
        const internal = new DataTransfer(), paragraphs = dom.querySelectorAll("[data-kind=paragraph] [data-body]");
        drag(paragraphs[0], "dragstart", internal, dragStart.left, (dragStart.top + dragStart.bottom) / 2);
        if (!internal.types.includes("text/html")) throw Error("ProseMirror did not start a native text drag");
        drag(paragraphs[1], "dragover", internal, dragEnd.left, (dragEnd.top + dragEnd.bottom) / 2);
        await noLine();
        drag(paragraphs[1], "drop", internal, dragEnd.left, (dragEnd.top + dragEnd.bottom) / 2);
        await until(async () => {
            const value = await saved();
            return value.children.map(id => text(value, id)).join("|") === "Keep rest|Drop move here";
        }, "native text move");
        const plain = textData(" Web text", " <a href=\"https://example.test/drag-link\"> Web text</a>");
        const plainTarget = view.coordsAtPos(instance.state.doc.content.size - 2);
        drag(paragraphs[1], "dragover", plain, plainTarget.left, (plainTarget.top + plainTarget.bottom) / 2);
        await noLine();
        drag(paragraphs[1], "drop", plain, plainTarget.left, (plainTarget.top + plainTarget.bottom) / 2);
        const before = await until(async () => {
            const value = await saved(), last = text(value, value.children[1]);
            return last.startsWith("Drop move here") && last.endsWith("Web text") && value;
        }, "native external text drop");
        const row = paragraphs[1].getBoundingClientRect();
        const mixed = textData("Web before Web middle Web after", `<p>Web <a href="https://example.test/drag-link">before</a></p><img src="${png}"><p>Web middle</p><img src="https://example.test/dropped.png"><p>Web after</p>`);
        drag(paragraphs[1], "dragover", mixed, row.left + 2, row.top + 1);
        await noLine();
        drag(paragraphs[1], "drop", mixed, row.left + 2, row.top + 1);
        const after = await until(async () => {
            const value = await saved();
            return view.editable && value.children.length === before.children.length + 5 && value;
        }, "mixed HTML drop");
        const actual = after.children.map(id => after.blocks[id].type === "image" ? "image" : text(after, id));
        if (actual.join("|") !== "Keep rest|Web before|image|Web middle|image|Web after|" + text(before, before.children[1]) || dom.querySelector(".web-link"))
            throw Error("Dropped content changed order, position or links: " + actual.join("|"));
        await window.api.history.apply(source, "undo");
        await until(async () => {
            const value = await saved();
            return instance.state.doc.childCount === before.children.length + 1 && value.children.join("|") === before.children.join("|");
        }, "one undo for mixed drop");

        end(instance);
        const excel = "<style>.mso {color: black}</style><table><tr><td>Quarter</td><td>Revenue</td></tr><tr><td>Q1</td><td>42</td></tr></table>";
        paste(instance, addBitmap(textData("Quarter\tRevenue\r\nQ1\t42", excel)));
        await until(() => dom.textContent?.includes("Quarter") && dom.textContent.includes("42"), "Excel text with PNG");
        end(instance); paste(instance, addBitmap(textData("Office slide", "<p>Office slide</p>")));
        await until(() => dom.textContent?.includes("Office slide"), "PowerPoint text with PNG");
        end(instance); paste(instance, addBitmap(textData("Local image and text", "<p>Local image and text</p><img src=\"file:///missing.png\">")));
        await until(() => dom.textContent?.includes("Local image and text"), "unreadable HTML image with text and PNG");
        const oldDoc = instance.state.doc;
        paste(instance, textData("", "<img src=\"file:///missing.png\">"));
        await paint();
        if (dom.querySelector("[data-kind=image]") || !instance.state.doc.eq(oldDoc)) throw Error("Text and unreadable image cases created media");
        end(instance);
        paste(instance, addBitmap(textData("https://example.test/clipboard-only.png", "<div> <img src=\"https://example.test/clipboard-only.png\" alt=\"This is an image\"> &nbsp; </div>")));
        await until(async () => view.editable && count(await saved(), "image") === 1 && dom.querySelector("[data-kind=image]"), "browser image from clipboard data");

        const url = "https://example.test/open-link";
        end(instance); paste(instance, textData(`Read ${url}`, `<p>Read <a href="${url}">${url}</a></p>`));
        await until(() => dom.textContent?.includes(`Read ${url}`), "ordinary pasted web anchor text");
        if (dom.querySelector(".web-link")) throw Error("Pasted web anchor retained a link");
        end(instance); paste(instance, textData(url));
        await until(() => [...document.querySelectorAll<HTMLElement>("[role=menuitem]")].find(item => /粘贴链接|Paste link/i.test(item.textContent ?? "")), "explicit paste link choice").then(button => button.click());
        const link = await until(() => dom.querySelector<HTMLAnchorElement>(`a.web-link[href="${url}"]`), "explicit web link");
        const click = (init: MouseEventInit = {}): boolean => link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ...init }));
        click();
        click(/Mac/.test(navigator.platform) ? { metaKey: true } : { ctrlKey: true });
        await until(async () => JSON.stringify((await saved()).blocks).includes(`"href":"${url}"`), "saved link");
        console.info("MEDIA native drag, ordered mixed drop and undo, Office and browser image clipboard, explicit web link");
    }

    async function checkReadOnlyLink(): Promise<void> {
        const instance = await open("correction"), source = { kind: "page", id: ids.correction } as const;
        const preview = await window.api.pages.trash([ids.correction], source);
        if (preview.status !== "confirmation" || (await window.api.pages.trash([ids.correction], source, preview.preview.token)).status !== "saved")
            throw Error("Could not recycle the link fixture");
        const link = await until(() => !instance.view.editable && instance.view.dom.querySelector<HTMLAnchorElement>("a.web-link"), "saved link in recycled page");
        link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    }

    let copyProgress: { started: boolean; done: boolean; unsubscribe: () => void } | undefined;
    let scroll: { stop: () => { p95: number; frames: number; wheels: number; distance: number } } | undefined;
    function video(): HTMLVideoElement {
        return visible(".tiptap video") as HTMLVideoElement;
    }
    const api = {
        open: async (page: Parameters<typeof open>[0]) => {
            await open(page);
        },
        checkClipboard,
        checkCorrections,
        checkReadOnlyLink,
        closeViewer() {
            document.querySelector<HTMLDialogElement>(".image-viewer:modal")?.close();
        },
        async startScroll() {
            const ed = await open("photos"), dom = ed.view.dom;
            let viewport: HTMLElement | null = dom.parentElement;
            while (viewport && !["auto", "scroll"].includes(getComputedStyle(viewport).overflowY)) viewport = viewport.parentElement;
            if (!viewport) throw Error("Photo scroll container missing");
            viewport.scrollTop = 0;
            await paint();
            const scroller = viewport, frames: number[] = [], rect = scroller.getBoundingClientRect();
            let latest = await frame(), rAF = 0, wheels = 0, moved = false;
            const track = (event: WheelEvent): void => {
                if (event.isTrusted) wheels++;
            };
            const measure = (now: number): void => {
                if (moved) frames.push(now - latest);
                latest = now;
                moved ||= scroller.scrollTop > 0;
                rAF = requestAnimationFrame(measure);
            };
            scroller.addEventListener("wheel", track);
            rAF = requestAnimationFrame(measure);
            scroll = { stop: () => {
                cancelAnimationFrame(rAF);
                scroller.removeEventListener("wheel", track);
                const distance = scroller.scrollTop;
                scroller.scrollTop = 0;
                return { p95: p95(frames), frames: frames.length, wheels, distance };
            } };
            return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
        },
        stopScroll() {
            return scroll!.stop();
        },
        dropInput() {
            const input = document.querySelector<HTMLInputElement>("#media-drop-input") ?? document.createElement("input");
            input.id = "media-drop-input"; input.type = "file"; input.multiple = true; input.hidden = true; document.body.append(input);
            return true;
        },
        async dropFiles() {
            const ed = editor()!, dom = ed.view.dom, input = document.querySelector<HTMLInputElement>("#media-drop-input")!;
            dom.scrollIntoView({ block: "start" });
            await paint();
            const rect = dom.children[1].getBoundingClientRect(), transfer = new DataTransfer();
            for (const file of input.files!) {
                if (!window.getPathForFile(file)) throw Error("CDP did not supply a local path");
                transfer.items.add(file);
            }
            const opts = { bubbles: true, cancelable: true, clientX: rect.left + 4, clientY: rect.top + 1, dataTransfer: transfer };
            dom.dispatchEvent(new DragEvent("dragover", opts));
            await until(() => visible(".drop-line"), "external drop line");
            dom.dispatchEvent(new DragEvent("drop", opts));
        },
        async checkDrop() {
            const page = await until(async () => {
                const value = await note();
                return kinds(value).startsWith("image,blocked_reference,file") && value;
            }, "ordered mixed drop");
            const preview = page.blocks[page.children[1]].payload.target!.id;
            const paper = await window.api.pages.get(preview);
            await until(() => visible(".media-file"), "file save action").then(button => button.click());
            await wait(150);
            const source = { kind: "page", id: ids.note } as const;
            await window.api.history.apply(source, "undo");
            const undid = (await window.api.pages.get(preview)).attributes.deleted;
            await window.api.history.apply(source, "redo");
            return { independent: paper.attributes.independent, kind: paper.kind, undo: undid && !(await window.api.pages.get(preview)).attributes.deleted };
        },
        armCopy() {
            copyProgress = { started: false, done: false, unsubscribe: window.api.attachments.onTransferProgress(data => {
                if ((data.total ?? 0) < 1_000_000_000) return;
                copyProgress!.started = true;
                copyProgress!.done = data.bytes >= data.total!;
            }) };
        },
        async editDuringCopy() {
            await until(() => copyProgress?.started, "1GB copy started");
            const ed = await open("editing"), source = { kind: "page", id: ids.editing } as const;
            const page = await window.api.pages.get(ids.editing), block = page.blocks[ids.ordinary];
            let copied = 0;
            for (let i = 0; i < 50 && !copyProgress!.done; i++) {
                const changed = { ...block, payload: { ...block.payload, inline: [{ type: "text" as const, text: "Concurrent " + i }] } };
                const result = await window.api.pages.commitEdit({ pageId: page.id, batch: i, blocks: [changed] }, source);
                if (result.status !== "saved" || ed.isDestroyed) throw Error("Concurrent edit did not finish");
                if (!copyProgress!.done) copied++;
                await wait(2);
            }
            copyProgress!.unsubscribe();
            return copied;
        },
        video,
        async readyVideo() {
            const block = await until(() => visible(".tiptap [data-kind=video]"), "video block");
            block.scrollIntoView({ block: "center" });
            await until(() => video()?.readyState >= 1, "video metadata");
        },
        async seek() {
            await api.readyVideo();
            const player = video();
            player.muted = true;
            const middle = player.duration / 2, start = performance.now();
            const drawn = new Promise<number>(resolve => {
                const confirm = (_now: number, metadata: VideoFrameCallbackMetadata): void => {
                    if (Math.abs(metadata.mediaTime - middle) < 1) resolve(performance.now() - start);
                    else player.requestVideoFrameCallback(confirm);
                };
                player.requestVideoFrameCallback(confirm);
            });
            player.currentTime = middle;
            await player.play();
            const result = await Promise.race([drawn, wait(5000).then(() => {
                throw Error("No decoded midpoint video frame");
            })]);
            player.pause();
            return +result.toFixed(2);
        }
    };
    Object.assign(window, { mediaQA: api });
    await open("photos");
    const button = await until(() => visible(".media-image:not(:disabled)"), "gallery screenshot");
    button.click();
    await until(() => document.querySelector(".image-viewer:modal img"), "gallery screenshot image");
    return photosResult;
}