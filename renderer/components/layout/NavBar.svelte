<header class="titlebar">
    <!-- Codicon layout-sidebar-left, Microsoft, CC BY 4.0: https://github.com/microsoft/vscode-codicons/blob/main/LICENSE; path unchanged. -->
    <button class="panel-toggle" class:active={!shell.collapsed} aria-pressed={!shell.collapsed} aria-label={commands.sidebar.label} title={`${commands.sidebar.label} (${commands.sidebar.shortcut})`} onclick={() => runCommand("sidebar")}><svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M12.5 1C13.881 1 15 2.119 15 3.5V12.5C15 13.881 13.881 15 12.5 15H3.5C2.119 15 1 13.881 1 12.5V3.5C1 2.119 2.119 1 3.5 1H12.5ZM12.5 14C13.328 14 14 13.328 14 12.5V3.5C14 2.672 13.328 2 12.5 2H7V14H12.5Z" /></svg></button>
    <button class="brand" onclick={() => openDestination("overview")} aria-label="知织首页"><img src={icon} alt="" /></button>
    <Menu />
    <div class="search"><GSLauncher /></div>
</header>
<style>
    .titlebar { -webkit-app-region: drag; position: relative; display: flex; align-items: center; height: env(titlebar-area-height, var(--titlebar-height)); min-height: var(--titlebar-height); flex-shrink: 0; padding-left: max(8px, env(titlebar-area-x, 0px)); padding-right: max(8px, calc(100vw - env(titlebar-area-x, 0px) - env(titlebar-area-width, 100vw))); border-bottom: var(--border-width) solid var(--c-line); background: var(--c-navbar-background); }
    .titlebar :global(button), .search { -webkit-app-region: no-drag; }
    .brand { display: grid; place-items: center; width: var(--activity-width); height: var(--button-height); flex-shrink: 0; }
    .panel-toggle { display: grid; place-items: center; width: var(--button-height); height: var(--button-height); flex-shrink: 0; border-radius: var(--control-radius); color: var(--c-muted); }
    .panel-toggle.active { color: var(--c-ink); background: var(--c-gold-light); }
    .panel-toggle:hover { background: var(--c-cream); }
    img { width: var(--logo-size); height: var(--logo-size); object-fit: contain; -webkit-user-drag: none; }
    .search { position: absolute; left: 50%; transform: translateX(-50%); width: min(var(--search-width), calc(100% - 620px)); min-width: 120px; }
    @media (max-width: 850px) { .search { position: static; transform: none; flex: 1; width: auto; margin-inline: 8px; } }
</style>
<script lang="ts">
    import icon from "../../assets/icon.png";
    import GSLauncher from "../globalSearch/GSLauncher.svelte";
    import Menu from "./Menu.svelte";
    import { openDestination } from "./navigation";
    import { commands, runCommand } from "./commands";
    import { shell } from "./shell.svelte";
</script>