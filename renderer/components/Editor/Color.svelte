<Popover label={t("editor.colors")} bind:open={() => open, setOpen} align={attached ? "end" : "start"}
    contentProps={{ class: "editor-colors", customAnchor: attached ? anchor : caretAnchor, onOpenAutoFocus: openColors,
        onCloseAutoFocus: event => {
            event.preventDefault(); if (!editor?.isDestroyed) restoreFocus();
        } }}>
    {#snippet trigger({ props })}
        <Toolbar.Button disabled={colorState.every(format => format.disabled)}>
            {#snippet child({ props: button })}<IconButton {...mergeProps(button, props)} icon="symbol-color" label={t("editor.colors")} shortcut="Ctrl+R" pressed={open} style={buttonStyle} />{/snippet}
        </Toolbar.Button>
    {/snippet}
    <div class="color-menu" bind:this={element}>
        {#each colorState as format (format.name)}
            <div class="color-section">
                <div class="color-heading"><span>{t(`editor.${format.name}`)}</span><span>{colorLabel(format.active)}</span></div>
                <div class="color-palette">
                    {#each colors as value (value)}
                        <button class="ui-control color-choice" type="button" aria-pressed={format.active === value}
                            aria-label={t(`editor.${format.name}`) + " · " + t(`color.${value ?? "default"}`)} disabled={format.disabled}
                            style:background-color={format.name === "bgColor" && value ? `var(--ui-editor-bg-${value})` : undefined}
                            style:color={format.name === "fgColor" && value ? `var(--ui-editor-fg-${value})` : undefined}
                            onclick={() => applyColor(format.name, value)}>
                            <Icon name={format.icon} size="var(--ui-icon-normal)" />
                            {#if format.active === value}<span class="chosen"><Icon name="check" size="var(--ui-icon-small)" /></span>{/if}
                        </button>
                    {/each}
                </div>
            </div>
        {/each}
    </div>
</Popover>

<style>
    :global(.editor-colors) { width: min(calc(11 * var(--ui-button-height)), calc(100vw - var(--ui-space-5))); }
    .color-section + .color-section { margin-top: var(--ui-space-3); padding-top: var(--ui-space-3); border-top: var(--ui-stroke) solid var(--ui-divider); }
    .color-heading { display: flex; justify-content: space-between; margin-bottom: var(--ui-space-2); color: var(--ui-text-secondary); font-size: var(--ui-font-small); }
    .color-palette { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: var(--ui-space-2); }
    .color-choice { position: relative; padding: 0; border-color: var(--ui-border-input); }
    .color-choice[aria-pressed="true"] { border-color: var(--ui-focus); }
    .chosen { position: absolute; display: flex; right: 0; bottom: 0; border-radius: var(--ui-radius-small); color: var(--ui-text-on-accent); background: var(--ui-accent); }
</style>

<script module lang="ts">
    import type { Editor } from "@tiptap/core";

    type ColorMark = "fgColor" | "bgColor";

</script>

<script lang="ts">
    import { located } from "./transactions";
    import { isComposingKey } from "../../../shared/content/commands";
    import Icon, { type IconName } from "../utils/Icon.svelte";
    import { tick } from "svelte";
    import { SvelteSet } from "svelte/reactivity";
    import { mergeProps, Toolbar } from "bits-ui";
    import { t } from "../../i18n.svelte";
    import IconButton from "../base/IconButton.svelte";
    import Popover from "../base/Popover.svelte";

    let { editor, anchor, element = $bindable(null), open = $bindable(false) }: {
        editor: Editor | null;
        anchor: HTMLElement | undefined;
        element?: HTMLDivElement | null;
        open?: boolean;
    } = $props();
    const lastColors: Partial<Record<ColorMark, string | null>> = {};
    type ActiveColor = string | null | undefined;
    type ColorFormatState = {
        name: ColorMark;
        icon: IconName;
        keys: string[];
        active: ActiveColor;
        disabled: boolean;
    };
    let attached = $state(false);
    let returnFocus: HTMLElement | null = null;
    const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform);
    const caretAnchor = {
        getBoundingClientRect(): DOMRect {
            if (!editor || editor.isDestroyed) return new DOMRect();
            const { left, right, top, bottom } = editor.view.coordsAtPos(editor.state.selection.head);
            return new DOMRect(left, top, right - left, bottom - top);
        }
    };

    const colors = [null, "gray", "light-gray", "red", "yellow", "orange", "green", "lime", "blue", "purple", "brown", "cyan", "pink", "magenta"] as const;
    const colorFormats: { name: ColorMark; icon: IconName; keys: string[] }[] = [
        { name: "fgColor", icon: "text-color", keys: [..."1234567QWERTYU"] },
        { name: "bgColor", icon: "text-highlight", keys: [..."ASDFGHJZXCVBNM"] }
    ];
    const keyColors = new Map<string, { name: ColorMark; value: string | null }>(colorFormats.flatMap(format => format.keys.map((key, index) => [
        `${/\d/.test(key) ? "Digit" : "Key"}${key}`,
        { name: format.name, value: colors[index] }
    ] as const)));
    let colorState = $state(readState(null));
    const buttonStyle = $derived(colorState.map(({ name, active }) => typeof active === "string"
        ? `${name === "fgColor" ? "color" : "background-color"}: var(--ui-editor-${name === "fgColor" ? "fg" : "bg"}-${CSS.escape(active)})`
        : "").join("; "));

    function setOpen(value: boolean): void {
        if (editor && !editor.isDestroyed && editor.view.composing) return;
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
        element.querySelector<HTMLButtonElement>(".color-choice:not(:disabled)")?.focus({ preventScroll: true });
    }

    function restoreFocus(): void {
        if (returnFocus && anchor?.matches(":popover-open") && anchor.contains(returnFocus)) {
            returnFocus.focus({ preventScroll: true });
        }
        else if (editor && !editor.isDestroyed) editor.view.focus();
    }

    function colorLabel(value: ActiveColor): string {
        if (value === undefined) return t("editor.mixed");
        const color = colors.find(item => item === value);
        return color === undefined ? t("editor.custom") : t(`color.${color ?? "default"}`);
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
            if (isComposingKey(event) || instance?.view.composing || instance && located(instance.state)?.node.type.name === "codeBlock") return;
            // After returning focus to the editor, key repeat must not type the selected color's key.
            if (heldKeys.has(event.code)) {
                consume(event);
                return;
            }
            if (!instance || instance.isDestroyed || !instance.isEditable) return;
            const target = event.target as Node;
            const inside = instance.view.dom.contains(target) || anchor?.contains(target) || element?.contains(target);
            if (!inside) return;
            const modifier = isMac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;

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
            if (element && ["ArrowLeft", "ArrowRight", "ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
                const choices = Array.from(element.querySelectorAll<HTMLButtonElement>(".color-choice:not(:disabled)"));
                const index = choices.indexOf(document.activeElement as HTMLButtonElement);
                const delta = event.key === "ArrowDown" ? 7 : event.key === "ArrowUp" ? -7 : event.key === "ArrowLeft" ? -1 : 1;
                choices[event.key === "Home" ? 0 : event.key === "End" ? choices.length - 1 : Math.max(0, Math.min(choices.length - 1, index + delta))]?.focus();
                consume(event); return;
            }
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