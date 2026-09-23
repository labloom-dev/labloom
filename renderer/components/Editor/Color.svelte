<Popover.Root bind:open>
    <Popover.Trigger bind:ref={colorTrigger} disabled={colorState.every(format => format.disabled)}>
        {#snippet child({ props })}
            <Toolbar.Button {...props} class={open ? "tool-button active" : "tool-button"} title="文字颜色">
                <span class="icon">
                    <!-- eslint-disable-next-line svelte/no-at-html-tags -->
                    {@html paletteIcon}
                </span>
            </Toolbar.Button>
        {/snippet}
    </Popover.Trigger>
    <!-- Keep the menu inside the native popover's top layer. -->
    <Popover.Content
        side="bottom"
        align="end"
        customAnchor={anchor}
        sideOffset={8}
        collisionPadding={8}
        strategy="fixed"
        trapFocus={false}
        onOpenAutoFocus={openColors}
        onCloseAutoFocus={event => event.preventDefault()}
        onEscapeKeydown={closeColors}
    >
        {#snippet child({ props, wrapperProps })}
            <div {...wrapperProps}>
                <div {...props} class="color-menu">
                    {#each colorState as format (format.name)}
                        {@render palette(format)}
                    {/each}
                </div>
            </div>
        {/snippet}
    </Popover.Content>
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
                    title={color.label}
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
        background: var(--dc-c-surface);
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
    import type { Editor } from "@tiptap/core";
    import { Popover, Toolbar } from "bits-ui";
    import paletteIcon from "../../assets/carbon--color-palette.svg?raw";
    import fgColorIcon from "../../assets/carbon--text-color.svg?raw";
    import bgColorIcon from "../../assets/carbon--text-highlight.svg?raw";

    let { editor, anchor, open = $bindable(false) }: {
        editor: Editor | null;
        anchor: HTMLElement | undefined;
        open?: boolean;
    } = $props();
    type ColorMark = "fgColor" | "bgColor";
    type ActiveColor = string | null | undefined;
    type ColorFormatState = {
        name: ColorMark;
        label: string;
        icon: string;
        active: ActiveColor;
        disabled: boolean;
    };
    let colorTrigger = $state<HTMLButtonElement | null>(null);

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
    const colorFormats: { name: ColorMark; label: string; icon: string }[] = [
        { name: "fgColor", label: "前景色", icon: fgColorIcon },
        { name: "bgColor", label: "背景色", icon: bgColorIcon }
    ];
    let colorState = $state(readState(null));

    function openColors(event: Event): void {
        // Mouse clicks keep the editor focused; keyboard activation enters the menu.
        if (document.activeElement !== colorTrigger) event.preventDefault();
    }

    function closeColors(event: KeyboardEvent): void {
        event.preventDefault();
        event.stopImmediatePropagation();
        open = false;
        if (anchor?.contains(document.activeElement)) colorTrigger?.focus({ preventScroll: true });
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
        if (name === "fgColor") {
            if (value === null) chain.unsetFgColor().run();
            else chain.setFgColor(value).run();
        }
        else {
            if (value === null) chain.unsetBgColor().run();
            else chain.setBgColor(value).run();
        }
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
        update();

        return () => {
            disposed = true;
            instance?.off("transaction", update);
            instance?.off("update", update);
            instance?.off("destroy", update);
        };
    });
</script>