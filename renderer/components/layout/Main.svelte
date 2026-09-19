<main>
    <Tab.Root initialTabs={[
        { id: getTabID(), title: "总览", type: "overview" },
        { id: getTabID(), title: "设置", type: "settings" },
        { id: getTabID(), title: "关于", type: "about" },
        { id: getTabID(), title: "编辑器测试", type: "page", pageId: getUUID() }
    ]} />
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
    import { getUUID } from "../../../shared/types/uuid";
    import * as Tab from "../Tab";
</script>