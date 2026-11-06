<nav>
    <button class="icon-container">
        <!-- eslint-disable-next-line svelte/no-at-html-tags -->
        {@html home}
    </button>
    <button class="icon-container" title="订阅" aria-label="打开订阅" onclick={openFeed}>
        <!-- eslint-disable-next-line svelte/no-at-html-tags -->
        {@html rss}
    </button>
    <button class="icon-container">
        <!-- eslint-disable-next-line svelte/no-at-html-tags -->
        {@html book}
    </button>
    <button class="icon-container">
        <!-- eslint-disable-next-line svelte/no-at-html-tags -->
        {@html calendar}
    </button>
    <button class="icon-container">
        <!-- eslint-disable-next-line svelte/no-at-html-tags -->
        {@html library}
    </button>
    <button class="icon-container">
        <!-- eslint-disable-next-line svelte/no-at-html-tags -->
        {@html ai}
    </button>
    <div class="flex-end flex">
        <button class="icon-container">
            <!-- eslint-disable-next-line svelte/no-at-html-tags -->
            {@html add}
        </button>
        <button class="icon-container">
            <!-- eslint-disable-next-line svelte/no-at-html-tags -->
            {@html settings}
        </button>
    </div>
</nav>


<style>
    nav {
        -webkit-app-region: drag;
        background-color: var(--c-sidebar-background);
        height: 100%;
        width: 48px;
        display: flex;
        flex-flow: column nowrap;
        justify-content: center;
    }
    nav :global(*) {
        -webkit-app-region: no-drag;
    }
    .icon-container {
        display: grid;
        place-items: center;
        padding: 12px;
    }
    .flex-end {
        margin-top: auto;
    }
    .flex {
        display: flex;
        flex-flow: column nowrap;
        justify-content: center;
    }
</style>


<script lang="ts">
    import { activateTab, addTab, getTabID } from "../Tab/api";
    import { tabState } from "../Tab/state.svelte";
    import home from "../../assets/carbon--home.svg?raw";
    import rss from "../../assets/carbon--rss.svg?raw";
    import book from "../../assets/basil--book-outline.svg?raw";
    import calendar from "../../assets/carbon--calendar.svg?raw";
    import library from "../../assets/codicon--library.svg?raw";
    import ai from "../../assets/carbon--ai-agent.svg?raw";
    import add from "../../assets/carbon--add-large.svg?raw";
    import settings from "../../assets/carbon--settings.svg?raw";

    function openFeed(): void {
        const tab = tabState.groups.flatMap(group => group.tabs).find(tab => tab.type === "feed");
        if (tab) activateTab(tab.id);
        else addTab(tabState.focusedGroupId, { id: getTabID(), title: "订阅", type: "feed" });
    }
</script>