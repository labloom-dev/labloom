// Remembers whether the latest input came from a pointer or the keyboard, so that focus moved by code
// (a popover focusing its first field, say) is drawn the way the user opened it.
let pointer = false;
addEventListener("pointerdown", () => pointer = true, true);
addEventListener("keydown", () => pointer = false, true);

export function fromPointer(): boolean {
    return pointer;
}