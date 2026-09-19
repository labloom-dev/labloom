<nav>
    <img src="../../assets/icon.png" alt="Labloom Logo" />
    <div style:width="1rem"></div>
    <NavGroup panelOpened={true} canBack={false} canForward={true} />
    <div style:width="2rem"></div>
    <GlobalSearchLauncher />
    <div style:width="2rem"></div>
</nav>


<style>
    nav {
        /* Note: We cannot ignore this and this only. */
        app-region: drag;
        flex-shrink: 0;
        display: flex;
        flex-direction: row;
        align-items: center;
        height: calc(env(titlebar-area-height) + 1px);
        background-color: #ddd;
    }
    nav :global(*) {
        /* Note: We cannot ignore this and this only. */
        app-region: no-drag;
    }
    img {
        /* Note: We cannot ignore this and this only. */
        app-region: drag;
        aspect-ratio: 1/1;
        height: calc(env(titlebar-area-height) * 0.8);
        -webkit-user-drag: none;
        margin-left: .2rem;
        margin-right: .5rem;
    }
</style>


<script lang="ts">
    import NavGroup from "../NavGroup.svelte";
    import GlobalSearchLauncher from "../globalSearch/GlobalSearchLauncher.svelte";
</script>