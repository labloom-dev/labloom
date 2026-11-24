import { type ReaderAnchorGeometry } from "./defs";

type Point = { x: number; y: number };

export function controlsReaderView(event: MouseEvent, viewport: DOMRect): boolean {
    const { target, clientX, clientY } = event;
    return target instanceof Element && (!!target.closest("[data-reader-transform]") ||
        target.matches(".viewer") && (clientX >= viewport.right || clientY >= viewport.bottom));
}

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(value, max));
}

export function keepInView(origin: Point, width: number, height: number, view: DOMRect): Point {
    return {
        x: clamp(origin.x, view.left, view.right - width),
        y: clamp(origin.y, view.top, view.bottom - height)
    };
}

/** Keep the opening offset during scroll and zoom. A resize can choose a new fit. */
export class AnchorLayout {
    private extent: string | undefined;
    private offset: Point = { x: 0, y: 0 };
    private above = false;
    private fittedDrag?: { position: Point; offset: Point };

    place({ target, viewport }: ReaderAnchorGeometry, width: number, height: number, dragged?: Point | null): {
        x: number; y: number; clip: string; visible: boolean;
    } {
        const extent = [width, height, viewport.width, viewport.height].join("/");
        const anchored = target.right > viewport.left && target.left < viewport.right &&
            target.bottom > viewport.top && target.top < viewport.bottom;
        if (anchored && extent !== this.extent) {
            this.above = target.bottom + 4 + height > viewport.bottom;
            const edge = this.above ? target.top : target.bottom;
            const y = this.above ? edge - 4 - height : edge + 4;
            const origin = keepInView({ x: target.left, y }, width, height, viewport);
            this.offset = { x: origin.x - target.left, y: origin.y - edge };
            if (dragged) {
                const fitted = keepInView({ x: target.left + dragged.x, y: target.bottom + dragged.y }, width, height, viewport);
                this.fittedDrag = { position: dragged, offset: { x: fitted.x - target.left, y: fitted.y - target.bottom } };
            }
            this.extent = extent;
        }
        const fitted = this.fittedDrag;
        const offset = fitted && fitted.position === dragged ? fitted.offset : dragged ?? this.offset;
        const x = target.left + offset.x, y = (this.above && !dragged ? target.top : target.bottom) + offset.y;
        const clip = [viewport.top - y, x + width - viewport.right, y + height - viewport.bottom, viewport.left - x]
            .map(edge => edge + "px").join(" ");
        const visible = anchored && x < viewport.right && x + width > viewport.left &&
            y < viewport.bottom && y + height > viewport.top;
        return { x, y, clip: "inset(" + clip + ")", visible };
    }
}