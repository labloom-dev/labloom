import { mount, unmount } from "svelte";
import { type NodeViewRenderer } from "@tiptap/core";
import type { MediaFile } from "../../../shared/content/media";
import type { BlockMedia } from "../../../shared/types/content";
import { perform } from "../Knowledge/feedback.svelte";
import MediaBlock from "./MediaBlock.svelte";

export function mediaViews(options: {
    file: (id: string) => MediaFile | undefined; writable: () => boolean; checkpoint: () => void;
    open: (pos: number, anchor: HTMLElement) => void;
}): NodeViewRenderer {
    const visibleCallbacks = new WeakMap<Element, () => void>();
    let observer: IntersectionObserver | undefined;
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- Only the observer and its timer read this queue.
    const waiting = new Set<Element>();
    let timer: ReturnType<typeof setTimeout>, firstFrame = true;
    function reveal(): void {
        for (const element of waiting) {
            observer!.unobserve(element);
            visibleCallbacks.get(element)?.();
            visibleCallbacks.delete(element);
        }
        waiting.clear();
    }
    return ({ node: initial, view, getPos }) => {
        let node = initial, media = $state.raw<BlockMedia>(node.attrs.media), visible = $state(false);
        const dom = document.createElement("div"), contentDOM = document.createElement("div"), shell = document.createElement("div");
        const kind = node.attrs.kind;
        dom.dataset.kind = kind;
        dom.dataset.blockId = node.attrs.blockId;
        shell.className = "media-resource";
        shell.contentEditable = "false";
        contentDOM.className = "media-caption";
        contentDOM.toggleAttribute("data-empty", !node.firstChild!.content.size);
        dom.append(shell, contentDOM);
        const component = mount(MediaBlock, { target: shell, props: {
            kind, get media() {
                return media;
            },
            get visible() {
                return visible;
            },
            get file() {
                return media.fileId ? options.file(media.fileId) : undefined;
            },
            writable: options.writable,
            resize(width) {
                const pos = getPos();
                if (pos === undefined || !view.editable || view.composing || !options.writable() || width === media.width) return;
                const next = { ...media };
                if (width === undefined) delete next.width; else next.width = width;
                options.checkpoint();
                view.dispatch(view.state.tr.setNodeAttribute(pos, "media", next));
                options.checkpoint();
            },
            open(anchor) {
                const pos = getPos();
                if (pos !== undefined) options.open(pos, anchor);
            },
            save() {
                if (media.fileId) void perform(() => window.api.attachments.saveAs(media.fileId!));
            }
        } });
        observer ??= new IntersectionObserver(entries => {
            for (const entry of entries) {
                if (entry.isIntersecting) waiting.add(entry.target);
                else waiting.delete(entry.target);
            }
            clearTimeout(timer);
            if (!waiting.size) return;
            if (firstFrame) {
                firstFrame = false;
                reveal();
            }
            // While a fast scroll keeps replacing the viewport, avoid decoding passing images.
            else timer = setTimeout(reveal, 120);
        });
        visibleCallbacks.set(dom, () => {
            visible = true;
        });
        observer.observe(dom);
        return {
            dom, contentDOM,
            stopEvent: event => event.target instanceof globalThis.Node && shell.contains(event.target),
            ignoreMutation: mutation => mutation.type !== "selection"
                && (mutation.target === dom || mutation.target === contentDOM && mutation.type === "attributes" || shell.contains(mutation.target)),
            update(next) {
                if (next.type !== node.type || next.attrs.blockId !== node.attrs.blockId || next.attrs.kind !== kind || next.attrs.media.fileId !== media.fileId) return false;
                node = next;
                media = next.attrs.media;
                contentDOM.toggleAttribute("data-empty", !node.firstChild!.content.size);
                return true;
            },
            destroy() {
                observer!.unobserve(dom);
                waiting.delete(dom);
                if (!waiting.size) clearTimeout(timer);
                visibleCallbacks.delete(dom);
                void unmount(component);
            }
        };
    };
}