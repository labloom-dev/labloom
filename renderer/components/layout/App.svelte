<NavBar />
<div class="container">
    <Sidebar />
    <Main />
</div>


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
    import "../../styles/elements.css";

    import NavBar from "./NavBar.svelte";
    import Sidebar from "./Sidebar.svelte";
    import Main from "./Main.svelte";
</script>