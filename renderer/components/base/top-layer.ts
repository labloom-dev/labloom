import { isComposingKey } from "../../../shared/content/commands";

type Escape = (event: KeyboardEvent) => void;
const layers = new Map<HTMLElement, Escape | undefined>();

export function hasOpenLayer(): boolean {
    return layers.size > 0;
}

function escape(event: KeyboardEvent): void {
    if (event.key !== "Escape" || event.defaultPrevented || isComposingKey(event)) return;
    const top = [...layers].findLast(([element]) => element.matches(":popover-open,dialog:modal"));
    if (!top || !top[1] && !event.repeat) return;
    event.preventDefault();
    event.stopPropagation();
    if (!event.repeat) top[1]?.(event);
}

function track(element: HTMLElement, onEscape?: Escape): () => void {
    if (!layers.size) window.addEventListener("keydown", escape, true);
    layers.set(element, onEscape);
    return () => {
        layers.delete(element);
        if (!layers.size) window.removeEventListener("keydown", escape, true);
    };
}

export function showLayer(element: HTMLElement, onEscape?: Escape): () => void {
    element.showPopover();
    const untrack = track(element, onEscape);
    return () => {
        untrack();
        if (element.matches(":popover-open")) element.hidePopover();
    };
}

export function showModal(element: HTMLDialogElement): () => void {
    element.showModal();
    return track(element, () => element.requestClose());
}