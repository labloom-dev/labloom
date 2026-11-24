<script lang="ts">
    import type { Snippet } from "svelte";
    import { type Destination, destinationIcons } from "./destinations";
    import { commands } from "../../../shared/content/commands";
    import { commandLabel, t } from "../../i18n.svelte";
    import IconButton from "../base/IconButton.svelte";

    let { active, onopen, notifications }: { active?: Destination; onopen: (id: Destination) => void; notifications?: Snippet } = $props();
    const order = ["overview", "feed", "library", "papers", "calendar"] as const;
</script>

<nav class="activity" aria-label={t("shell.mainNavigation")}>
    {#each order as id (id)}
        <IconButton icon={destinationIcons[id]} size="var(--ui-icon-large)"
            label={commandLabel(id)} shortcut={commands[id].shortcut} pressed={active === id} onclick={() => onopen(id)} />
    {/each}
    {@render notifications?.()}
    <IconButton class={notifications ? undefined : "settings"} icon={destinationIcons.settings} size="var(--ui-icon-large)" label={commandLabel("settings")}
        shortcut={commands.settings.shortcut} pressed={active === "settings"} onclick={() => onopen("settings")} />
</nav>

<style>
    .activity { display: flex; flex-direction: column; flex: 0 0 var(--ui-activity-width); width: var(--ui-activity-width); border-right: var(--ui-stroke) solid var(--ui-divider); background: var(--ui-surface-panel); }
    .activity > :global(button.ui-icon-button) { position: relative; flex: none; width: 100%; height: var(--ui-activity-item-height); border: 0; border-radius: 0; background: var(--ui-surface-clear); color: var(--ui-text-secondary); outline-offset: calc(-1 * var(--ui-focus-width)); }
    .activity > :global(button.ui-icon-button:is([aria-pressed="true"], :hover)) { background: var(--ui-surface-clear); color: var(--ui-text); }
    .activity > :global([aria-pressed="true"]::before) { content: ""; position: absolute; inset: 0 auto 0 0; width: var(--ui-active-border); background: var(--ui-accent); }
    .activity :global(:is(.notification-toggle, .settings)) { margin-top: auto; }
</style>