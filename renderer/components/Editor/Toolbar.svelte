<Toolbar.Root>
    {#snippet child({ props })}
        <div
            {...props}
            class="toolbar"
            popover="manual"
            bind:this={element}
            onmousedown={keepSelection}
            style="position: fixed; inset: auto; margin: 0;"
        >
            <div class="actions">
                {#each toolbarState.formats as format (format.name)}
                    <Toolbar.Button
                        class={format.active ? "tool-button active" : "tool-button"}
                        disabled={format.disabled}
                        onclick={() => editor?.chain().focus().toggleMark(format.name).run()}
                    >
                        {#if format.icon}
                            <span class="icon">
                                <!-- eslint-disable-next-line svelte/no-at-html-tags -->
                                {@html format.icon}
                            </span>
                        {:else}
                            {format.label}
                        {/if}
                    </Toolbar.Button>
                {/each}
                <span class="separator"></span>
                <Color {editor} anchor={element} bind:element={colorElement} bind:open={colorOpen} />
                <Toolbar.Button
                    class="tool-button"
                    disabled={!toolbarState.canClear}
                    onclick={clearFormat}
                >
                    <span class="icon">
                        <!-- eslint-disable-next-line svelte/no-at-html-tags -->
                        {@html clearIcon}
                    </span>
                </Toolbar.Button>
                <span class="separator"></span>
                <div class="history-actions">
                    <Toolbar.Button class="tool-button" disabled={!toolbarState.canUndo} onclick={() => editor?.chain().focus().undo().run()}>
                        <span class="icon">
                            <!-- eslint-disable-next-line svelte/no-at-html-tags -->
                            {@html undoIcon}
                        </span>
                    </Toolbar.Button>
                    <Toolbar.Button class="tool-button" disabled={!toolbarState.canRedo} onclick={() => editor?.chain().focus().redo().run()}>
                        <span class="icon">
                            <!-- eslint-disable-next-line svelte/no-at-html-tags -->
                            {@html redoIcon}
                        </span>
                    </Toolbar.Button>
                </div>
            </div>
        </div>
    {/snippet}
</Toolbar.Root>


<style>
    .toolbar {
        max-width: calc(100vw - 16px);
        padding: .25rem;
        overflow: visible;
        border: 1px solid var(--dc-c-popover-border);
        border-radius: .5rem;
        color: var(--dc-c-popover-text);
        background: var(--dc-c-surface);
        box-shadow: 0 .25rem 1rem var(--dc-c-popover-shadow-soft);
        font-size: .8125rem;
    }
    .actions, .history-actions {
        display: flex;
        align-items: center;
        gap: .125rem;
    }
    .actions {
        flex-wrap: wrap;
    }
    .toolbar :global(button) {
        box-sizing: border-box;
        color: inherit;
        font: inherit;
        border-radius: .25rem;
    }
    .toolbar :global(.tool-button) {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 2rem;
        height: 2rem;
        padding: 0 .5rem;
        white-space: nowrap;
    }
    .toolbar :global(button:hover:not(:disabled)) {
        background-color: var(--dc-c-surface-hover);
    }
    .toolbar :global(button:focus-visible) {
        outline: 2px solid var(--dc-c-accent);
        outline-offset: 1px;
    }
    .toolbar :global(button:disabled) {
        opacity: .4;
    }
    .toolbar :global(button.active) {
        background-color: var(--dc-c-surface-focus);
    }
    .icon {
        display: inline-flex;
        flex-shrink: 0;
        width: 1.125rem;
        height: 1.125rem;
    }
    .icon :global(svg) {
        width: 100%;
        height: 100%;
    }
    .separator {
        width: 1px;
        height: 1rem;
        margin: 0 .25rem;
        background: var(--dc-c-popover-border);
    }
</style>


<script lang="ts">
    import type { Editor } from "@tiptap/core";
    import type { ResolvedPos } from "@tiptap/pm/model";
    import { Toolbar } from "bits-ui";
    import Color from "./Color.svelte";
    import boldIcon from "../../assets/carbon--text-bold.svg?raw";
    import italicIcon from "../../assets/carbon--text-italic.svg?raw";
    import underlineIcon from "../../assets/carbon--text-underline.svg?raw";
    import strikeIcon from "../../assets/carbon--text-strikethrough.svg?raw";
    import clearIcon from "../../assets/carbon--text-clear-format.svg?raw";
    import codeIcon from "../../assets/carbon--code.svg?raw";
    import undoIcon from "../../assets/carbon--undo.svg?raw";
    import redoIcon from "../../assets/carbon--redo.svg?raw";

    let { editor }: { editor: Editor | null } = $props();
    let element = $state<HTMLDivElement>();
    let colorElement = $state<HTMLDivElement | null>(null);
    let colorOpen = $state(false);
    const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform);

    const formats = [
        { name: "bold", label: "加粗", icon: boldIcon },
        { name: "italic", label: "斜体", icon: italicIcon },
        { name: "underline", label: "下划线", icon: underlineIcon },
        { name: "strike", label: "删除线", icon: strikeIcon },
        { name: "code", label: "行内代码", icon: codeIcon }
    ];
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
        formats: { name: string; label: string; icon: string | null; active: boolean; disabled: boolean }[];
        canClear: boolean;
        canUndo: boolean;
        canRedo: boolean;
    } {
        const ready = instance !== null && !instance.isDestroyed && instance.isEditable;
        return {
            formats: formats.map(format => ({
                ...format,
                active: ready && instance.isActive(format.name),
                disabled: !ready || !instance.can().toggleMark(format.name)
            })),
            canClear: ready && instance.can().unsetAllMarks(),
            canUndo: ready && instance.can().undo(),
            canRedo: ready && instance.can().redo()
        };
    }

    $effect(() => {
        const instance = editor;
        if (!instance || !element) return;

        const dom = instance.view.dom;
        const menu = element;
        let disposed = false;
        let queued = false;
        let selecting = false;
        let pointerSelection = false;
        let dismissed = false;
        let frame = 0;

        function hide(): void {
            if (menu.matches(":popover-open")) menu.hidePopover();
        }

        function blockRect(position: ResolvedPos): DOMRect | null {
            for (let depth = position.depth; depth > 0; depth--) {
                if (!position.node(depth).isBlock) continue;
                const node = instance?.view.nodeDOM(position.before(depth));
                if (node instanceof HTMLElement) return node.getBoundingClientRect();
            }
            return null;
        }

        function position(): void {
            if (disposed) return;
            if (instance?.isDestroyed || !instance?.isEditable) {
                colorOpen = false;
                hide();
                return;
            }
            if (instance.state.selection.empty || dismissed) {
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
            const { from, to, $from: fromPosition, $to: toPosition } = instance.state.selection;
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

            if (!menu.matches(":popover-open")) menu.showPopover();
            const { width, height } = menu.getBoundingClientRect();
            const left = Math.max(8, Math.min(rect.left + rect.width / 2 - width / 2, window.innerWidth - width - 8));
            const top = (blockRect(fromPosition) ?? rect).top - height - 8;
            const bottom = (blockRect(toPosition) ?? rect).bottom + 8;
            menu.style.left = left + "px";
            menu.style.top = Math.max(8, Math.min(top >= 8 ? top : bottom, window.innerHeight - height - 8)) + "px";
        }

        function update(): void {
            if (queued) return;
            queued = true;
            // Blur can dispatch a transaction during Svelte rendering.
            queueMicrotask(() => {
                queued = false;
                if (disposed) return;
                toolbarState = readState(instance);
                cancelAnimationFrame(frame);
                // Measure after Svelte has updated the button labels.
                frame = requestAnimationFrame(position);
            });
        }

        function pointerDown(event: PointerEvent): void {
            if (menu.contains(event.target as Node) || colorElement?.contains(event.target as Node)) return;
            const inside = dom.contains(event.target as Node);
            selecting = event.button === 0 && inside;
            pointerSelection = selecting;
            dismissed = !selecting;
            colorOpen = false;
            hide();

            if (!inside && instance && !instance.isDestroyed) {
                const { selection } = instance.state;
                if (!selection.empty) instance.commands.setTextSelection(selection.head);
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
            if (event.defaultPrevented || event.isComposing || event.key === "Process") return;
            const target = event.target as Node;
            if (!dom.contains(target) && !menu.contains(target) && !colorElement?.contains(target)) return;
            const modifier = isMac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
            if (modifier && !event.altKey && !event.shiftKey && event.code === "KeyW" && instance?.isEditable && !instance.isDestroyed) {
                event.preventDefault();
                event.stopImmediatePropagation();
                if (!event.repeat) clearFormat();
                return;
            }
            if (event.key !== "Escape" || event.defaultPrevented || event.repeat || colorOpen || !menu.matches(":popover-open")) return;
            if (!dom.contains(event.target as Node) && !menu.contains(event.target as Node)) return;
            event.preventDefault();
            event.stopImmediatePropagation();
            dismissed = true;
            if (menu.contains(document.activeElement)) instance?.view.focus();
            hide();
        }

        function keyDown(event: KeyboardEvent): void {
            // Unhandled shortcuts can leave the selection intact; position follows the editor state.
            if (!event.defaultPrevented && !["Escape", "Tab", "Alt", "AltGraph", "Control", "Meta", "Shift"].includes(event.key) && dom.contains(event.target as Node)) {
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