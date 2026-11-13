<header class="titlebar">
    <button class="brand" onclick={() => openDestination("overview")} aria-label="知织首页"><img src={icon} alt="" /></button>
    <Menu />
    <div class="search"><GSLauncher /></div>
</header>
<style>
    .titlebar { -webkit-app-region: drag; position: relative; display: flex; align-items: center; height: env(titlebar-area-height, var(--titlebar-height)); min-height: var(--titlebar-height); flex-shrink: 0; padding-left: max(8px, env(titlebar-area-x, 0px)); padding-right: max(8px, calc(100vw - env(titlebar-area-x, 0px) - env(titlebar-area-width, 100vw))); border-bottom: var(--border-width) solid var(--c-line); background: var(--c-navbar-background); }
    .titlebar :global(button), .search { -webkit-app-region: no-drag; }
    .brand { display: grid; place-items: center; width: var(--activity-width); height: var(--button-height); flex-shrink: 0; }
    img { width: var(--logo-size); height: var(--logo-size); object-fit: contain; -webkit-user-drag: none; }
    .search { position: absolute; left: 50%; transform: translateX(-50%); width: min(var(--search-width), calc(100% - 620px)); min-width: 120px; }
    @media (max-width: 850px) { .search { position: static; transform: none; flex: 1; width: auto; margin-inline: 8px; } }
</style>
<script lang="ts">
    import icon from "../../assets/icon.png";
    import GSLauncher from "../globalSearch/GSLauncher.svelte";
    import Menu from "./Menu.svelte";
    import { openDestination } from "./navigation";
</script>