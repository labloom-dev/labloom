<Popover.Root bind:open={() => open, setOpen}>
    <Popover.Trigger disabled={colorState.every(format => format.disabled)}>
        {#snippet child({ props })}
            <Toolbar.Button {...props} class={open ? "tool-button active" : "tool-button"} style={buttonStyle}>
                <span class="icon">
                    <!-- eslint-disable-next-line svelte/no-at-html-tags -->
                    {@html paletteIcon}
                </span>
            </Toolbar.Button>
        {/snippet}
    </Popover.Trigger>
    <Popover.Portal>
        <Popover.Content
            side="bottom"
            align={attached ? "end" : "start"}
            customAnchor={attached ? anchor : caretAnchor}
            sideOffset={8}
            collisionPadding={8}
            strategy="fixed"
            trapFocus={false}
            onOpenAutoFocus={openColors}
            onCloseAutoFocus={event => event.preventDefault()}
        >
            {#snippet child({ props, wrapperProps })}
                <div {...wrapperProps} class="color-layer" popover="manual" bind:this={element}>
                    <div {...props} class="color-menu">
                        {#each colorState as format (format.name)}
                            {@render palette(format)}
                        {/each}
                    </div>
                </div>
            {/snippet}
        </Popover.Content>
    </Popover.Portal>
</Popover.Root>

{#snippet palette(format: ColorFormatState)}
    <div class="color-section">
        <div class="color-heading">
            <span>{format.label}</span>
            <span class="color-current">{colorLabel(format.active)}</span>
        </div>
        <div class="color-palette">
            {#each colors as color (color.value)}
                <button
                    class="color-choice"
                    class:active={format.active === color.value}
                    type="button"
                    disabled={format.disabled}
                    onclick={() => applyColor(format.name, color.value)}
                >
                    <span
                        class="icon color-icon"
                        class:background={format.name === "bgColor" && color.value !== null}
                        style:color={color.value === null ? undefined : `var(--dc-c-${format.name === "fgColor" ? "fg" : "bg"}-${color.value})`}
                    >
                        <!-- eslint-disable-next-line svelte/no-at-html-tags -->
                        {@html format.icon}
                    </span>
                </button>
            {/each}
        </div>
    </div>
{/snippet}


<style>
    .color-layer {
        inset: auto;
        margin: 0;
        padding: 0;
        overflow: visible;
        border: 0;
        color: var(--dc-c-popover-text);
        background: transparent;
        font-size: .8125rem;
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
    .color-menu {
        --dc-popover-available-height: var(--bits-popover-content-available-height);
        width: 17rem;
        max-width: calc(100vw - 16px);
        max-height: var(--dc-popover-available-height);
        overflow-y: auto;
        padding: .75rem;
        border: 1px solid var(--dc-c-popover-border);
        border-radius: .625rem;
        background: var(--dc-c-surface);
        box-shadow: 0 .5rem 1.5rem var(--dc-c-popover-shadow-soft), 0 .125rem .375rem var(--dc-c-popover-shadow-soft);
    }
    .color-section + .color-section {
        margin-top: .75rem;
        padding-top: .75rem;
        border-top: 1px solid var(--dc-c-divider);
    }
    .color-heading {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: .5rem;
        font-size: .75rem;
    }
    .color-current {
        color: var(--dc-c-secondary-text);
    }
    .color-palette {
        display: grid;
        grid-template-columns: repeat(7, minmax(0, 1fr));
        gap: .25rem;
    }
    .color-choice {
        display: grid;
        place-items: center;
        min-width: 0;
        aspect-ratio: 1;
        padding: .25rem;
        border: 1px solid var(--dc-c-popover-border);
        border-radius: .25rem;
        color: inherit;
        background: var(--dc-c-surface);
        font: inherit;
    }
    .color-choice:hover:not(:disabled) {
        background-color: var(--dc-c-surface-hover);
    }
    .color-choice:focus-visible {
        outline: 2px solid var(--dc-c-accent);
        outline-offset: 1px;
    }
    .color-choice:disabled {
        opacity: .4;
        cursor: default;
    }
    .color-icon {
        width: 1.375rem;
        height: 1.375rem;
    }
    .color-icon.background :global(svg) {
        color: hsl(from currentColor h s calc(l * .6));
    }
    .color-choice.active {
        border-color: var(--dc-c-accent);
        box-shadow: inset 0 0 0 1px var(--dc-c-accent);
    }
</style>


<script lang="ts">
    import { tick } from "svelte";
    import { SvelteSet } from "svelte/reactivity";
    import type { Editor } from "@tiptap/core";
    import { Popover, Toolbar } from "bits-ui";
    import paletteIcon from "../../assets/carbon--color-palette.svg?raw";
    import fgColorIcon from "../../assets/carbon--text-color.svg?raw";
    import bgColorIcon from "../../assets/carbon--text-highlight.svg?raw";

    let { editor, anchor, element = $bindable(null), open = $bindable(false) }: {
        editor: Editor | null;
        anchor: HTMLElement | undefined;
        element?: HTMLDivElement | null;
        open?: boolean;
    } = $props();
    type ColorMark = "fgColor" | "bgColor";
    type ActiveColor = string | null | undefined;
    type ColorFormatState = {
        name: ColorMark;
        label: string;
        icon: string;
        keys: string[];
        active: ActiveColor;
        disabled: boolean;
    };
    let attached = $state(false);
    let returnFocus: HTMLElement | null = null;
    const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform);
    const lastColors: Record<ColorMark, string | null | undefined> = { fgColor: undefined, bgColor: undefined };
    const caretAnchor = {
        getBoundingClientRect(): DOMRect {
            if (!editor || editor.isDestroyed) return new DOMRect();
            const { left, right, top, bottom } = editor.view.coordsAtPos(editor.state.selection.head);
            return new DOMRect(left, top, right - left, bottom - top);
        }
    };

    const colors = [
        { value: null, label: "默认" },
        { value: "gray", label: "灰" },
        { value: "light-gray", label: "淡灰" },
        { value: "red", label: "红" },
        { value: "yellow", label: "黄" },
        { value: "orange", label: "橙" },
        { value: "green", label: "绿" },
        { value: "lime", label: "黄绿" },
        { value: "blue", label: "蓝" },
        { value: "purple", label: "紫" },
        { value: "brown", label: "棕" },
        { value: "cyan", label: "青" },
        { value: "pink", label: "粉" },
        { value: "magenta", label: "品红" }
    ];
    const colorFormats: { name: ColorMark; label: string; icon: string; keys: string[] }[] = [
        { name: "fgColor", label: "前景色", icon: fgColorIcon, keys: [..."1234567QWERTYU"] },
        { name: "bgColor", label: "背景色", icon: bgColorIcon, keys: [..."ASDFGHJZXCVBNM"] }
    ];
    const keyColors = new Map<string, { name: ColorMark; value: string | null }>(colorFormats.flatMap(format => format.keys.map((key, index) => [
        `${/\d/.test(key) ? "Digit" : "Key"}${key}`,
        { name: format.name, value: colors[index].value }
    ] as const)));
    let colorState = $state(readState(null));
    const buttonStyle = $derived(colorState.map(({ name, active }) => typeof active === "string"
        ? `${name === "fgColor" ? "color" : "background-color"}: var(--dc-c-${name === "fgColor" ? "fg" : "bg"}-${CSS.escape(active)})`
        : "").join("; "));

    function setOpen(value: boolean): void {
        if (value && !open) {
            attached = anchor?.matches(":popover-open") ?? false;
            returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        }
        open = value;
    }

    async function openColors(event: Event): Promise<void> {
        event.preventDefault();
        await tick();
        if (!open || !element) return;
        if (!element.matches(":popover-open")) element.showPopover();
        element.querySelector<HTMLButtonElement>(".color-choice:not(:disabled)")?.focus({ preventScroll: true });
    }

    function closeColors(): void {
        open = false;
        if (returnFocus && anchor?.matches(":popover-open") && anchor.contains(returnFocus)) {
            returnFocus.focus({ preventScroll: true });
        }
        else if (editor && !editor.isDestroyed) editor.view.focus();
    }

    function colorLabel(value: ActiveColor): string {
        if (value === undefined) return "混合";
        return colors.find(color => color.value === value)?.label ?? "自定义";
    }

    function readColor(instance: Editor, name: ColorMark): ActiveColor {
        const type = instance.schema.marks[name];
        if (!type) return null;
        const { empty, from, to, $from: fromPosition } = instance.state.selection;
        const hasColor = empty
            ? type.isInSet(instance.state.storedMarks ?? fromPosition.marks()) !== undefined
            : instance.state.doc.rangeHasMark(from, to, type);
        if (!hasColor) return null;
        const value = instance.getAttributes(name)[name];
        return typeof value === "string" && instance.isActive(name, { [name]: value }) ? value : undefined;
    }

    function applyColor(name: ColorMark, value: string | null): void {
        if (!editor || editor.isDestroyed || !editor.isEditable) return;
        const chain = editor.chain().focus();
        let applied: boolean;
        if (name === "fgColor") {
            applied = value === null ? chain.unsetFgColor().run() : chain.setFgColor(value).run();
        }
        else {
            applied = value === null ? chain.unsetBgColor().run() : chain.setBgColor(value).run();
        }
        if (!applied) return;
        lastColors[name] = value;
        open = false;
    }

    function readState(instance: Editor | null): ColorFormatState[] {
        const ready = instance !== null && !instance.isDestroyed && instance.isEditable;
        return colorFormats.map(format => ({
            ...format,
            active: ready ? readColor(instance, format.name) : null,
            disabled: !ready || !instance.can().setMark(format.name)
        }));
    }

    $effect(() => {
        const instance = editor;
        let disposed = false;
        let queued = false;
        const heldKeys = new SvelteSet<string>();

        function consume(event: KeyboardEvent): void {
            event.preventDefault();
            event.stopImmediatePropagation();
        }

        function keyDown(event: KeyboardEvent): void {
            // After returning focus to the editor, key repeat must not type the selected color's key.
            if (heldKeys.has(event.code)) {
                consume(event);
                return;
            }
            if (!instance || instance.isDestroyed || !instance.isEditable || event.isComposing || event.key === "Process") return;
            const target = event.target as Node;
            const inside = instance.view.dom.contains(target) || anchor?.contains(target) || element?.contains(target);
            if (!inside) return;
            const modifier = isMac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;

            if (open && event.key === "Escape") {
                consume(event);
                if (!event.repeat) {
                    heldKeys.add(event.code);
                    closeColors();
                }
                return;
            }
            if (modifier && !event.altKey && !event.shiftKey && ["KeyR", "KeyJ", "KeyK"].includes(event.code)) {
                consume(event);
                if (event.repeat) return;
                if (event.code === "KeyR") {
                    if (!open) setOpen(true);
                }
                else {
                    const name = event.code === "KeyJ" ? "fgColor" : "bgColor";
                    const color = lastColors[name];
                    if (color !== undefined) applyColor(name, color);
                }
                return;
            }
            if (!open || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
            const color = keyColors.get(event.code);
            if (!color) return;
            consume(event);
            if (!event.repeat) {
                heldKeys.add(event.code);
                applyColor(color.name, color.value);
            }
        }

        function keyUp(event: KeyboardEvent): void {
            heldKeys.delete(event.code);
        }

        function windowBlur(): void {
            heldKeys.clear();
        }

        function focusIn(event: FocusEvent): void {
            const target = event.target as Node;
            if (open && !element?.contains(target) && !anchor?.contains(target) && !instance?.view.dom.contains(target)) open = false;
        }

        function update(): void {
            if (queued) return;
            queued = true;
            // Blur can dispatch a transaction during Svelte rendering.
            queueMicrotask(() => {
                queued = false;
                if (disposed) return;
                colorState = readState(instance);
                if (!instance || instance.isDestroyed || !instance.isEditable) open = false;
            });
        }

        instance?.on("transaction", update);
        // setEditable emits update without a transaction.
        instance?.on("update", update);
        instance?.on("destroy", update);
        document.addEventListener("keydown", keyDown, true);
        document.addEventListener("keyup", keyUp, true);
        document.addEventListener("focusin", focusIn);
        window.addEventListener("blur", windowBlur);
        update();

        return () => {
            disposed = true;
            instance?.off("transaction", update);
            instance?.off("update", update);
            instance?.off("destroy", update);
            document.removeEventListener("keydown", keyDown, true);
            document.removeEventListener("keyup", keyUp, true);
            document.removeEventListener("focusin", focusIn);
            window.removeEventListener("blur", windowBlur);
        };
    });
</script>