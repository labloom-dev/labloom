// Keep a single tab stop across independently loaded groups, including after filtering or pagination.
export function panelNavigation(list: HTMLElement): () => void {
    const selector = "button[data-panel-node]";
    const buttons = (): HTMLButtonElement[] => [...list.querySelectorAll<HTMLButtonElement>(selector)];
    let current: HTMLButtonElement | undefined;

    function select(button: HTMLButtonElement): void {
        if (current && current !== button) current.tabIndex = -1;
        current = button;
        current.tabIndex = 0;
    }
    function reconcile(): void {
        if (current && list.contains(current)) return;
        const nodes = buttons();
        const next = nodes.find(node => node.dataset.panelKey === current?.dataset.panelKey) ?? nodes[0];
        if (next) select(next);
    }
    function focus(event: FocusEvent): void {
        if (event.target instanceof HTMLButtonElement && event.target.matches(selector)) select(event.target);
    }
    function keydown(event: KeyboardEvent): void {
        const target = event.target;
        if (event.defaultPrevented || event.isComposing || !(target instanceof HTMLButtonElement) || !target.matches(selector)) return;
        const header = target.closest("section")?.querySelector<HTMLButtonElement>("[data-panel-node=group]");
        const nodes = buttons(), index = nodes.indexOf(target);
        switch (event.key) {
            case "ArrowUp": nodes[Math.max(0, index - 1)]?.focus(); break;
            case "ArrowDown": nodes[Math.min(nodes.length - 1, index + 1)]?.focus(); break;
            case "ArrowRight":
                if (target === header && header.ariaExpanded === "false") header.click();
                break;
            case "ArrowLeft":
                if (target !== header) header?.focus();
                else if (header.ariaExpanded === "true") header.click();
                break;
            case "Enter":
                if (event.ctrlKey && target.dataset.panelNode === "page") target.dispatchEvent(new MouseEvent("click", { bubbles: true, ctrlKey: true }));
                else return;
                break;
            default: return;
        }
        event.preventDefault();
        event.stopPropagation();
    }
    reconcile();
    const observer = new MutationObserver(reconcile);
    observer.observe(list, { childList: true, subtree: true });
    list.addEventListener("focusin", focus);
    list.addEventListener("keydown", keydown);
    return () => {
        observer.disconnect();
        list.removeEventListener("focusin", focus);
        list.removeEventListener("keydown", keydown);
    };
}