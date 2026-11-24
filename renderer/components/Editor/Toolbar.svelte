<Toolbar.Root>
    {#snippet child({ props })}
        <div {...props} class="toolbar ui-popup" aria-label={t("editor.toolbar")} aria-keyshortcuts="Alt+F10" popover="manual" bind:this={element} onmousedown={keepSelection}>
            {#each toolbarState.formats as format (format.name)}
                <Toolbar.Button disabled={format.disabled}>
                    {#snippet child({ props: button })}<IconButton {...button} label={t(`editor.${format.name}`)} shortcut={format.shortcut} icon={format.icon}
                        pressed={format.active} onclick={() => editor.chain().focus().toggleMark(format.name).run()} />{/snippet}
                </Toolbar.Button>
            {/each}
            <span class="separator"></span>
            <Color {editor} anchor={element} bind:element={colorElement} bind:open={colorOpen} />
            <Toolbar.Button disabled={!toolbarState.canClear}>
                {#snippet child({ props: button })}<IconButton {...button} icon="clear-formatting" label={t("editor.clearFormat")} onclick={clearFormat} />{/snippet}
            </Toolbar.Button>
            <span class="separator"></span>
            {#each ["undo", "redo"] as const as id (id)}
                <Toolbar.Button disabled={!toolbarState.ready || (id === "undo" ? !(dirty || history.canUndo) : !history.canRedo || dirty)}>
                    {#snippet child({ props: button })}<IconButton {...button} icon={id} label={commandLabel(id)} shortcut={commands[id].shortcut}
                        onclick={() => editor.chain().focus()[id]().run()} />{/snippet}
                </Toolbar.Button>
            {/each}
        </div>
    {/snippet}
</Toolbar.Root>

<style>
    .toolbar { position: fixed; inset: auto; margin: 0; max-width: calc(100vw - var(--ui-space-5)); height: var(--ui-toolbar-height); padding: var(--ui-space-1); overflow: visible; }
    .toolbar:popover-open { display: flex; align-items: center; gap: var(--ui-space-1); }
    .toolbar:not(:popover-open) { display: none; }
    .toolbar :global(.ui-icon-button) { flex: 1 1 var(--ui-button-height); min-width: 0; }
    .separator { width: var(--ui-stroke); height: var(--ui-icon-normal); margin-inline: var(--ui-space-1); background: var(--ui-divider); }
</style>

<script lang="ts">
    import { commandLabel, t } from "../../i18n.svelte";
    import { isComposingKey, commands } from "../../../shared/content/commands";
    import IconButton from "../base/IconButton.svelte";
    import type { Editor } from "@tiptap/core";
    import { located } from "./transactions";
    import { TextSelection } from "@tiptap/pm/state";
    import { Toolbar } from "bits-ui";
    import { showLayer } from "../base/top-layer";
    import Color from "./Color.svelte";

    import type { HistoryState } from "../../../shared/types/knowledge";
    let { editor, history, dirty }: { editor: Editor; history: HistoryState; dirty: boolean } = $props();
    let element = $state<HTMLDivElement>();
    let colorElement = $state<HTMLDivElement | null>(null);
    let colorOpen = $state(false);

    const formats = [
        { name: "bold", shortcut: "Ctrl+B", icon: "bold" },
        { name: "italic", shortcut: "Ctrl+I", icon: "italic" },
        { name: "underline", shortcut: "Ctrl+U", icon: "underline" },
        { name: "strike", shortcut: "Ctrl+S", icon: "strikethrough" },
        { name: "code", shortcut: "Ctrl+E", icon: "code" }
    ] as const;
    let toolbarState = $state(readState(null));

    function clearFormat(): void {
        if (!editor || editor.isDestroyed || !editor.isEditable) return;
        const cleared = editor.chain().focus().unsetAllMarks().command(({ tr }) => {
            // unsetAllMarks only clears a range; a caret also needs its pending marks cleared.
            if (tr.selection.empty) tr.setStoredMarks([]);
            return true;
        }).run();
        if (cleared) colorOpen = false;
    }

    function readState(instance: Editor | null): {
        formats: (typeof formats[number] & { active: boolean; disabled: boolean })[];
        canClear: boolean;
        ready: boolean;
    } {
        const ready = instance !== null && !instance.isDestroyed && instance.isEditable;
        return {
            formats: formats.map(format => ({
                ...format,
                active: ready && instance.isActive(format.name),
                disabled: !ready || !instance.can().toggleMark(format.name)
            })),
            canClear: ready && instance.can().unsetAllMarks(),
            ready
        };
    }

    $effect(() => {
        const instance = editor;
        if (instance.isDestroyed || !element) return;

        const dom = instance.view.dom;
        const menu = element;
        let disposed = false;
        let queued = false;
        // The first pointerdown in this block can precede the toolbar's listeners.
        let selecting = false;
        let pointerSelection = selecting;
        let dismissed = false;
        let frame = 0;
        let hideLayer: (() => void) | undefined;

        function hide(): void {
            hideLayer?.();
            hideLayer = undefined;
        }

        function dismiss(): void {
            if (instance?.view.composing) return;
            dismissed = true;
            if (menu.contains(document.activeElement)) instance?.view.focus();
            hide();
        }

        function position(): void {
            frame = 0;
            if (disposed) return;
            if (colorOpen && colorElement?.contains(document.activeElement)) return;
            if (instance?.isDestroyed || !instance?.isEditable) {
                colorOpen = false;
                hide();
                return;
            }
            if (located(instance.state)?.node.type.name === "codeBlock" || !(instance.state.selection instanceof TextSelection) || instance.state.selection.empty || dismissed) {
                hide();
                return;
            }

            // Switching windows preserves both popovers and their last position.
            if (!document.hasFocus()) return;
            // A pointer click can collapse the DOM selection before the editor receives selectionchange.
            if (
                selecting || instance.view.composing
                || (pointerSelection && window.getSelection()?.isCollapsed)
                || (!instance.view.hasFocus() && !menu.contains(document.activeElement) && !colorElement?.contains(document.activeElement))
            ) {
                colorOpen = false;
                hide();
                return;
            }

            // The DOM selection may briefly disappear while window focus changes.
            const { from, to } = instance.state.selection;
            const start = instance.view.domAtPos(from);
            const end = instance.view.domAtPos(to);
            const range = document.createRange();
            range.setStart(start.node, start.offset);
            range.setEnd(end.node, end.offset);
            const rect = range.getBoundingClientRect();
            const viewport = dom.closest(".content")?.getBoundingClientRect() ?? dom.getBoundingClientRect();
            if (
                rect.bottom <= Math.max(0, viewport.top) || rect.top >= Math.min(window.innerHeight, viewport.bottom)
                || rect.right <= Math.max(0, viewport.left) || rect.left >= Math.min(window.innerWidth, viewport.right)
            ) {
                colorOpen = false;
                hide();
                return;
            }

            hideLayer ??= showLayer(menu, dismiss);
            const bounds = (dom.closest(".annotation-popover") ?? dom.closest(".main-content") ?? dom.closest(".group-content") ?? dom).getBoundingClientRect();
            menu.style.maxWidth = Math.max(40, Math.min(bounds.width, viewport.width)) + "px";
            const { width, height } = menu.getBoundingClientRect();
            const left = Math.max(bounds.left, viewport.left, Math.min(rect.left, bounds.right - width, viewport.right - width));
            menu.style.left = left + "px";
            const ceiling = Math.max(bounds.top, dom.closest(".group-content")?.getBoundingClientRect().top ?? 0);
            const top = rect.top - height - 4 >= ceiling ? rect.top - height - 4 : rect.bottom + 4;
            menu.style.top = Math.max(ceiling, Math.min(top, window.innerHeight - height - 4)) + "px";
        }

        function update(): void {
            if (queued) return;
            queued = true;
            // Blur can dispatch a transaction during Svelte rendering.
            queueMicrotask(() => {
                queued = false;
                if (disposed) return;
                if (instance.isDestroyed || !instance.isEditable || instance.state.selection.empty || dismissed || selecting) {
                    if (instance.isDestroyed || !instance.isEditable) colorOpen = false;
                    hide();
                    return;
                }
                toolbarState = readState(instance);
                // Measure after Svelte has updated the button labels.
                if (!frame) frame = requestAnimationFrame(position);
            });
        }

        function pointerDown(event: PointerEvent): void {
            const popup = event.target instanceof Element && event.target.closest(".menubar,[data-menubar-content],.ui-menu,.ui-popover,.target-picker,.handle,.group-header");
            if (menu.contains(event.target as Node) || colorElement?.contains(event.target as Node) || popup && !popup.contains(dom)) return;
            const inside = dom.contains(event.target as Node);
            selecting = event.button === 0 && inside;
            pointerSelection = selecting;
            dismissed = !selecting;
            colorOpen = false;
            hide();

            if (!inside && instance && !instance.isDestroyed) {
                const { selection } = instance.state;
                if (!selection.empty && selection.$head.parent.inlineContent) instance.commands.setTextSelection(selection.head);
                // Scrollbars and drag handles may keep focus and the browser selection in the editor.
                dom.blur();
                const nativeSelection = window.getSelection();
                if (nativeSelection && (dom.contains(nativeSelection.anchorNode) || dom.contains(nativeSelection.focusNode))) {
                    nativeSelection.removeAllRanges();
                }
            }
        }

        function finishSelection(): void {
            selecting = false;
            update();
        }

        function shortcut(event: KeyboardEvent): void {
            if (event.defaultPrevented || isComposingKey(event) || instance?.view.composing || instance && located(instance.state)?.node.type.name === "codeBlock") return;
            const target = event.target as Node;
            if (!dom.contains(target) && !menu.contains(target) && !colorElement?.contains(target)) return;
            if (event.altKey && !event.ctrlKey && event.key === "F10" && dom.contains(target) && menu.matches(":popover-open")) {
                event.preventDefault(); event.stopPropagation();
                menu.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus({ preventScroll: true });
                return;
            }
        }

        function keyDown(event: KeyboardEvent): void {
            // Unhandled shortcuts can leave the selection intact; position follows the editor state.
            if (!event.defaultPrevented && !isComposingKey(event) && !["Escape", "Tab", "Alt", "AltGraph", "Control", "Meta", "Shift"].includes(event.key) && dom.contains(event.target as Node)) {
                pointerSelection = false;
                dismissed = false;
                update();
            }
        }

        function windowBlur(): void {
            selecting = false;
            pointerSelection = false;
        }

        const resizeObserver = new ResizeObserver(update);
        resizeObserver.observe(menu);
        instance.on("transaction", update);
        // setEditable emits update without a transaction.
        instance.on("update", update);
        instance.on("destroy", update);
        document.addEventListener("pointerdown", pointerDown, true);
        document.addEventListener("selectionchange", update);
        document.addEventListener("focusin", update);
        document.addEventListener("keydown", shortcut, true);
        document.addEventListener("keydown", keyDown);
        document.addEventListener("keyup", finishSelection);
        document.addEventListener("scroll", update, true);
        window.addEventListener("pointerup", finishSelection);
        window.addEventListener("pointercancel", finishSelection);
        window.addEventListener("resize", update);
        window.addEventListener("blur", windowBlur);
        window.addEventListener("focus", update);
        update();

        return () => {
            disposed = true;
            resizeObserver.disconnect();
            cancelAnimationFrame(frame);
            hide();
            colorOpen = false;
            instance.off("transaction", update);
            instance.off("update", update);
            instance.off("destroy", update);
            document.removeEventListener("pointerdown", pointerDown, true);
            document.removeEventListener("selectionchange", update);
            document.removeEventListener("focusin", update);
            document.removeEventListener("keydown", shortcut, true);
            document.removeEventListener("keydown", keyDown);
            document.removeEventListener("keyup", finishSelection);
            document.removeEventListener("scroll", update, true);
            window.removeEventListener("pointerup", finishSelection);
            window.removeEventListener("pointercancel", finishSelection);
            window.removeEventListener("resize", update);
            window.removeEventListener("blur", windowBlur);
            window.removeEventListener("focus", update);
        };
    });

    function keepSelection(event: MouseEvent): void {
        if (event.button === 0) event.preventDefault();
    }
</script>