import { type ChangePreview } from "../types/content";
import { createI18n, type Translate } from "../i18n";

const chinese = createI18n("zh-CN");
const defaultTranslation: Translate = (key, options) => chinese.t(key, options);

export function recycledPageNames(preview: ChangePreview): string[] {
    return [...new Map([...preview.direct, ...preview.recycled].map(page => [page.id, page.title])).values()];
}

export function confirmationText(preview: ChangePreview, t: Translate = defaultTranslation, count = recycledPageNames(preview).length): string {
    const lines = preview.deletedBlocks.map(({ excerpt, pages, positions, links }) => {
        const impact: string[] = [];
        if (positions) impact.push(t(pages ? "dialog.pagePositions" : "dialog.positions", { pages, count: positions }));
        if (links) impact.push(t("dialog.linkImpact", { count: links }));
        if (!impact.length) return t("dialog.deleteExcerpt", { excerpt });
        return t(positions ? "dialog.excerptImpact" : "dialog.deleteImpact", { excerpt, impact: impact.join(t("dialog.join")) });
    });
    if (count) lines.push(t(count === 1 ? "dialog.recycleOne" : "dialog.recycle", { count }));
    return lines.join("\n");
}