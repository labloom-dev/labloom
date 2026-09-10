<nav>
    <NavGroup panelOpened={true} canBack={false} canForward={false} />
    <div class="space"></div>
    <MenuGroup />
    <div class="space"></div>
    <Tab.List />
</nav>


<style>
    nav {
        /* Note: We cannot ignore this and this only. */
        app-region: drag;
        display: flex;
        flex-direction: row;
        height: env(titlebar-area-height);
    }
    nav :global(*) {
        /* Note: We cannot ignore this and this only. */
        app-region: no-drag;
    }
    .space {
        width: 2rem;
    }
</style>


<script lang="ts">
    import MenuGroup from "../MenuGroup.svelte";
    import NavGroup from "../NavGroup.svelte";
    import * as Tab from "../Tab";
</script>