<div class="vertical-container">
    <Tab.Root initialTabs={[{
        id: "tab-0" as TabID,
        title: "Overview",
        type: "overview"
    }]}>
        <NavBar />
        <div class="horizontal-container occupy">
            <Sidebar />
            <div style:width={`${panelWidth}px`}>
                <SidePanel />
            </div>
            <Resizer direction="vertical" changeCB={resizerCB} origin={panelWidth} min={50} max={150} />
            <Main />
        </div>
    </Tab.Root>
</div>


<style>
    .vertical-container {
        display: flex;
        flex-direction: column;
        height: 100%;
        width: 100%;
    }
    .horizontal-container {
        display: flex;
        flex-direction: row;
        height: 100%;
    }
</style>


<script lang="ts">
    import "../../styles/base.css";
    import NavBar from "./NavBar.svelte";
    import Sidebar from "./Sidebar.svelte";
    import SidePanel from "./SidePanel.svelte";
    import Main from "./Main.svelte";
    import Resizer from "../Resizer.svelte";
    import * as Tab from "../Tab";
    import { type TabID } from "../Tab/definitions";

    let panelWidth = $state(100);

    function resizerCB(value: number): void {
        console.log("resizerCB", value);
        panelWidth = value;
    }
</script>