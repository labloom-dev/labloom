<nav>
    <div class="left-controls">
        <img src={icon} alt="Labloom Logo" />
        <TabNav panelOpened={true} canBack={false} canForward={true} />
        <Menu />
    </div>
    <GSLauncher />
</nav>


<style>
    * {
        --window-controls-width: max(
            0px,
            calc(100vw - env(titlebar-area-x, 0px) - env(titlebar-area-width, 100vw))
        );
        --search-width: min(35vw, 640px);
        --search-gap: 2vw;
    }
    nav {
        /* Note: We cannot ignore this and this only. */
        app-region: drag;
        flex-shrink: 0;
        display: grid;
        grid-template-columns:
            minmax(max-content, 1fr)
            minmax(0, var(--search-width))
            minmax(calc(var(--window-controls-width) + var(--search-gap)), 1fr);
        align-items: center;
        height: calc(env(titlebar-area-height) + 1px);
        background-color: var(--c-navbar-background);
    }
    nav :global(button) {
        /* Note: We cannot ignore this and this only. */
        app-region: no-drag;
    }
    .left-controls {
        display: flex;
        align-items: center;
        justify-self: start;
        height: 100%;
        gap: 2vw;
        padding-left: env(titlebar-area-x, 0px);
        margin-right: var(--search-gap);
    }
    img {
        aspect-ratio: 1;
        height: calc(env(titlebar-area-height) * 0.8);
        -webkit-user-drag: none;
        margin-left: 3.2px;
        margin-right: 8px;
    }
</style>


<script lang="ts">
    import icon from "../../assets/icon.png";
    import TabNav from "../Tab/TabNav.svelte";
    import GSLauncher from "../globalSearch/GSLauncher.svelte";
    import Menu from "./Menu.svelte";
</script>