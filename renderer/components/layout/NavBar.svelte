<nav>
    <img src="../../assets/icon.png" alt="Labloom Logo" />
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
        margin-left: .25rem;
        margin-right: .5rem;
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