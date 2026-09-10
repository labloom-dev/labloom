<nav>
    <div>sidepanel toggle</div>
    <div>back</div>
    <div>forward</div>
    <MenuGroup />
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
</style>


<script lang="ts">
    import MenuGroup from "../MenuGroup.svelte";
    import * as Tab from "../Tab";
</script>