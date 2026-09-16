
<Tab.Root initialTabs={[
    {
        id: getTabID(),
        title: "Overview",
        type: "overview"
    },
    {
        id: getTabID(),
        title: "Settings",
        type: "settings"
    },
    {
        id: getTabID(),
        title: "Editor",
        type: "page",
        pageId: getUUID()
    }
]}>
    <NavBar />
    <div class="container occupy">
        <Sidebar />
        <Main />
    </div>
</Tab.Root>


<style>
    .container {
        display: flex;
        flex-direction: row;
        flex: 1;
        min-height: 0;
    }
</style>


<script lang="ts">
    import "../../styles/base.css";
    import NavBar from "./NavBar.svelte";
    import Sidebar from "./Sidebar.svelte";
    import Main from "./Main.svelte";
    import * as Tab from "../Tab";
    import { getTabID } from "../Tab/definitions";
    import { getUUID } from "../../../shared/data/uuid";
</script>