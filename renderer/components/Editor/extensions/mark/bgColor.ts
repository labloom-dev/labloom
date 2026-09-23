import { Mark } from "@tiptap/core";

declare module "@tiptap/core" {
    interface Commands<ReturnType> {
        bgColor: {
            setBgColor: (bgColor: string) => ReturnType;
            unsetBgColor: () => ReturnType;
        };
    }
}

export default Mark.create({
    name: "bgColor",
    keepOnSplit: false,
    addAttributes() {
        return {
            bgColor: {
                default: null,
                parseHTML: findBGColor,
                renderHTML: attrs => attrs.bgColor ? {class: `dc-bc-${attrs.bgColor}`} : {}
            }
        };
    },
    parseHTML() {
        return [{
            tag: "span[class]",
            getAttrs: element => findBGColor(element) === null ? false : null
        }];
    },
    renderHTML: ({ HTMLAttributes }) => ["span", HTMLAttributes, 0],
    addCommands() {
        return {
            setBgColor: bgColor => ({ commands }) => /^\S+$/u.test(bgColor) && commands.setMark(this.name, { bgColor }),
            unsetBgColor: () => ({ commands }) => commands.unsetMark(this.name)
        };
    }
});

function findBGColor(element: HTMLElement): string | null {
    for (const className of element.classList) {
        const match = className.match(/^dc-bc-(\S+)$/u);
        if (match) return match[1];
    }
    return null;
}