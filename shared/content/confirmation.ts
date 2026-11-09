import { type ChangePreview } from "../types/content";

export function confirmationText(preview: ChangePreview): string {
    const lines = preview.deletedBlocks.map(({ excerpt, pages, positions, links }) => {
        const impact: string[] = [];
        if (positions) impact.push(`将从 ${pages ? pages + " 个页面的 " : ""}${positions} 个位置消失`);
        if (links) impact.push(`${links} 个链接引用将显示“已删除”`);
        if (!impact.length) return `将删除${excerpt}。`;
        return positions ? excerpt + impact.join("，") + "。" : `删除${excerpt}后，${impact[0]}。`;
    });
    const pages = new Map([...preview.direct, ...preview.recycled].map(page => [page.id, page.title]));
    if (pages.size) lines.push("将移入回收站：" + [...pages.values()].join("、") + "。");
    return lines.join("\n");
}