<button type="button" onclick={openFilesMenu}>Files</button>


<script lang="ts">
    function openFilesMenu(event: MouseEvent): void {
        const button = event.currentTarget as HTMLButtonElement;
        const bounds = button.getBoundingClientRect();
        window.electron.ipcRenderer.send("menu:files", bounds.left, bounds.bottom);
    }
</script>