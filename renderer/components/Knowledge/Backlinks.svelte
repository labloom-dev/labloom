<script lang="ts">
    import { isComposingKey } from "../../../shared/content/commands";
    import { type Backlink } from "../../../shared/types/content";
    import { t } from "../../i18n.svelte";
    import Icon from "../utils/Icon.svelte";
    import TextButton from "../base/TextButton.svelte";
    import { kindIcons } from "./labels";

    let { links, onopen }: { links: Backlink[]; onopen: (id: string, otherGroup: boolean, anchorId?: string) => void } = $props();
    let details = $state<HTMLDetailsElement>();
    function keys(event: KeyboardEvent): void {
        if (!details || isComposingKey(event) || !["ArrowDown", "ArrowUp"].includes(event.key)) return;
        const targets = Array.from(details.querySelectorAll<HTMLElement>("summary,button"));
        if (!details.open) details.open = true;
        const index = targets.indexOf(document.activeElement as HTMLElement);
        targets[Math.max(0, Math.min(targets.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)))]?.focus();
        event.preventDefault();
        event.stopPropagation();
    }
</script>

{#if links.length}
    <details class="editor-backlinks" bind:this={details} onkeydown={keys}>
        <summary><Icon name="chevron-right" size="var(--ui-icon-small)" />{t("editor.backlinks", { count: links.length })}</summary>
        <ul>
            {#each links as link (link.sourceId)}
                <li><TextButton text={link.title || t("shell.untitled")} icon={kindIcons[link.pageKind]}
                    onclick={event => onopen(link.sourceId, event.ctrlKey, link.sourceBlockId)} /></li>
            {/each}
        </ul>
    </details>
{/if}

<style>
    .editor-backlinks, li { min-width: 0; }
</style>