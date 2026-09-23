import { Mark } from "@tiptap/core";

declare module "@tiptap/core" {
    interface Commands<ReturnType> {
        fgColor: {
            setFgColor: (fgColor: string) => ReturnType;
            unsetFgColor: () => ReturnType;
        };
    }
}

export default Mark.create({
    name: "fgColor",
    // Wrap decoration marks so their lines inherit the foreground color.
    priority: 1000,
    keepOnSplit: false,
    addAttributes() {
        return {
            fgColor: {
                default: null,
                parseHTML: findFGColor,
                renderHTML: attrs => attrs.fgColor ? {class: `dc-fc-${attrs.fgColor}`} : {}
            }
        };
    },
    parseHTML() {
        return [{
            tag: "span[class]",
            getAttrs: element => findFGColor(element) === null ? false : null
        }];
    },
    renderHTML: ({ HTMLAttributes }) => ["span", HTMLAttributes, 0],
    addCommands() {
        return {
            setFgColor: fgColor => ({ commands }) => /^\S+$/u.test(fgColor) && commands.setMark(this.name, { fgColor }),
            unsetFgColor: () => ({ commands }) => commands.unsetMark(this.name)
        };
    }
});

function findFGColor(element: HTMLElement): string | null {
    for (const className of element.classList) {
        const match = className.match(/^dc-fc-(\S+)$/u);
        if (match) return match[1];
    }
    return null;
}