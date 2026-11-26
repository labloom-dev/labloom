<script lang="ts">
    import { onMount, tick, type Snippet } from "svelte";
    import type { AttributeDefinition, AttributeValue } from "../../../shared/types/attributes";
    import { isComposingKey, tableShortcuts } from "../../../shared/content/commands";
    import Input from "../base/Input.svelte";
    import Popover from "../base/Popover.svelte";
    import AttributeInput from "./AttributeInput.svelte";

    let { label, definition, value, contents, onchange, onstage, onfinish }: {
        label: string; definition?: AttributeDefinition; value: AttributeValue; contents: Snippet;
        onchange: (value: AttributeValue) => void; onstage: (ids: string[]) => boolean;
        onfinish: (save: boolean, focus: boolean, step?: number) => void;
    } = $props();
    const direct = $derived(!definition || definition.type === "string" || definition.type === "number" || definition.type === "url");
    let anchor = $state<HTMLElement>(), input = $state<HTMLInputElement>(), popup = $state<HTMLElement>();
    let composing = false, active = true, revision = 0;
    const virtual = { getBoundingClientRect: () => anchor?.getBoundingClientRect() ?? new DOMRect() };
    onMount(() => {
        if (direct) {
            input?.focus({ preventScroll: true });
            if (definition?.type !== "number") input?.select();
        }
    });
    function close(save: boolean, focus: boolean, step?: number): void {
        if (active) {
            active = false; onfinish(save, focus, step);
        }
    }
    function change(raw: string): void {
        if (!composing) onchange(definition?.type === "number" ? raw ? Number(raw) : null : raw);
    }
    function blur(): void {
        // The platform can deliver the accepted IME text just after focus leaves.
        if (composing) setTimeout(() => close(true, false), 32);
        else close(true, false);
    }
    function inEditor(event: KeyboardEvent): boolean {
        return event.target instanceof Node && (!!anchor?.contains(event.target) || !!popup?.contains(event.target));
    }
    function capture(event: KeyboardEvent): void {
        if (!active || !inEditor(event)) return;
        if (isComposingKey(event)) {
            event.stopPropagation();
            return;
        }
        if (event.ctrlKey || event.altKey || event.metaKey) return;
        let save = true, step: number | undefined;
        if (event.key === tableShortcuts.cancel) save = false;
        else if (event.key === tableShortcuts.nextCell) {
            step = event.shiftKey ? -1 : 1;
            if (!direct && event.target instanceof HTMLInputElement) event.target.blur();
        }
        else if (event.key !== tableShortcuts.apply) return;
        else if (!direct && !(revision && event.target instanceof Element && event.target.closest(".ui-popup") === popup?.closest(".ui-popup"))) {
            const before = revision;
            queueMicrotask(() => {
                if (revision !== before) close(true, true);
            });
            return;
        }
        event.preventDefault(); event.stopPropagation();
        close(save, true, step);
    }
    function apply(event: KeyboardEvent): void {
        if (active && !direct && inEditor(event) && !isComposingKey(event) && !event.defaultPrevented && event.key === tableShortcuts.apply) {
            event.preventDefault(); event.stopPropagation();
            close(true, true);
        }
    }
</script>

<svelte:document onkeydowncapture={capture} onkeydown={apply} />
{#if direct}
    <div class="cell-input" data-cell-editor bind:this={anchor}>
        <Input {label} bind:input value={value == null ? "" : String(value)} type={definition?.type === "number" ? "number" : "text"}
            oninput={change} inputProps={{ step: definition?.type === "number" ? "any" : undefined, onblur: blur,
                oncompositionstart: () => composing = true,
                oncompositionend: event => {
                    composing = false; change((event.currentTarget as HTMLInputElement).value);
                } }} />
    </div>
{:else if definition}
    <span class="cell-anchor" data-cell-editor bind:this={anchor}>{@render contents()}</span>
    <Popover {label} bind:open={() => true, open => {
 if (!open) close(true, false);
}}
        contentProps={{ customAnchor: virtual, class: "table-cell-popup", onOpenAutoFocus: event => {
            event.preventDefault(); void tick().then(() => {
                if (popup && !popup.contains(document.activeElement) && !document.activeElement?.closest(":popover-open")) {
                    popup.querySelector<HTMLElement>("input,button:not([disabled])")?.focus({ preventScroll: true });
                }
            });
        }, onCloseAutoFocus: event => event.preventDefault() }}>
        <div data-cell-editor bind:this={popup}>
            <AttributeInput {definition} {value} onchange={value => {
                revision++; onchange(value);
            }} initiallyOpen
                onstage={definition.type === "file" || definition.type === "files" ? ids => {
                    const accepted = onstage(ids);
                    if (accepted) revision++;
                    return accepted;
                } : undefined} />
        </div>
    </Popover>
{/if}

<style>
    .cell-input { width: 100%; min-width: 0; }
    .cell-input :global(.ui-field) { width: 100%; height: var(--ui-row-height); }
    .cell-anchor { display: flex; align-items: center; min-width: 0; height: 100%; width: 100%; gap: var(--ui-space-2); }
    :global(.table-cell-popup) { min-width: var(--bits-popover-anchor-width); max-width: var(--ui-properties-width); }
</style>