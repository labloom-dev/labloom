<main>
    <Tab.Root initialTabs={[{ id: getTabID(), title: "我的花园", type: "overview" }]} />
</main>


<style>
    main {
        display: flex;
        min-width: 0;
        min-height: 0;
        flex: 1;
        height: 100%;
        width: 100%;
    }
</style>


<script lang="ts">
    import { getTabID } from "../Tab/api";
    import * as Tab from "../Tab";
</script>