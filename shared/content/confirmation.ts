import { type ChangePreview } from "../types/content";
import { createI18n, type Translate } from "../i18n";

const chinese = createI18n("zh-CN");
const defaultTranslation: Translate = (key, options) => chinese.t(key, options);

export function confirmationText(preview: ChangePreview, t: Translate = defaultTranslation): string {
    const lines = preview.deletedBlocks.map(({ excerpt, pages, positions, links }) => {
        const impact: string[] = [];
        if (positions) impact.push(t(pages ? "dialog.pagePositions" : "dialog.positions", { pages, count: positions }));
        if (links) impact.push(t("dialog.linkImpact", { count: links }));
        if (!impact.length) return t("dialog.deleteExcerpt", { excerpt });
        return t(positions ? "dialog.excerptImpact" : "dialog.deleteImpact", { excerpt, impact: impact.join(t("dialog.join")) });
    });
    const pages = new Map([...preview.direct, ...preview.recycled].map(page => [page.id, page.title]));
    if (pages.size) lines.push(t("dialog.recycle", { titles: [...pages.values()].join(t("dialog.listJoin")) }));
    return lines.join("\n");
}