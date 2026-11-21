import type { JSONContent } from "@tiptap/core";
import { payload } from "../../../shared/content/blocks";
import type { Backlink, BlockPayload, ContentBlockKind, InlineNode, PageRecord } from "../../../shared/types/content";
import { blockJSON } from "../../components/Editor/document";

const protocolId = "012a3731-258c-4982-8658-8736e8287689";
export const protocol = {
    target: { kind: "page", id: "3d99b744-5b89-4bcf-bae6-b08a878ffa69" } as const,
    excerptId: protocolId,
    title: "采样协议",
    text: "每个点位录制三分钟，保留现场底噪。复测时使用同一支麦克风和同一增益。"
};
export const emptyId = "a1cd57f0-7ca0-4079-a944-d698ada65bee";
export const sharedId = "f8729711-bff2-4cfb-89f9-947f6f3d33da";

function block(type: ContentBlockKind, content: string | Partial<BlockPayload>, children: JSONContent[] = [], id: string = crypto.randomUUID()): JSONContent {
    const body = typeof content === "string" ? payload(type, content) : { ...payload(type), ...content };
    return blockJSON({ id, type, payload: body, children: [] }, children);
}
const ordered = (text: string, ...children: JSONContent[]): JSONContent => block("ordered_list", text, children);
const bullet = (text: string, ...children: JSONContent[]): JSONContent => block("unordered_list", text, children);
function text(value: string, mark?: string, color?: string): Extract<InlineNode, { type: "text" }> {
    return { type: "text", text: value, ...(mark ? { marks: [{ type: mark, ...(color ? { attrs: { [mark]: color } } : {}) }] } : {}) };
}

export function sampleDocument(): JSONContent {
    const readings = [
        ["点位", "时段", "平均声级"],
        ["A · 码头", "06:30", "51 dB"],
        ["B · 街口", "08:00", "64 dB"]
    ];
    return { type: "doc", content: [
        block("title", "港口声景观察"),
        block("paragraph", "清晨六点半，我们在码头与街口各停留了十分钟。Field recording 保留了渡船靠岸前后的声音变化，也记录下风向与人流。把两段 waveform 放在一起时，能听出同一片街区醒来的先后顺序。"),
        block("paragraph", "", [], emptyId),
        block("heading_1", "现场记录"),
        block("paragraph", { inline: [text("记录以"), text("点位", "bold"), text("为单位，"),
            text("ambient sound", "italic"), text(" 一栏保留"), text("原始描述", "underline"), text("。将"),
            text("晚间", "strike"), text("改为清晨，录音模式设为 "), text("stereo", "code"), text("。")] }),
        block("paragraph", { inline: [text("标注时用"), text("蓝色", "fgColor", "blue"), text("记录水声，"),
            text("绿色", "fgColor", "green"), text("记录鸟鸣，"), text("红色", "fgColor", "red"), text("标出干扰。"),
            text("待复核", "bgColor", "yellow"), text("和"), text("已归档", "bgColor", "purple"), text("的片段分别标底色。")] }),
        block("blockquote", "渡船离开后，最先听清的是岸边自行车的铃声。"),
        block("callout", { inline: [text("复测时请沿用"), { type: "inlineReference", attrs: { target: protocol.target, label: protocol.title } }, text("，以便对照不同日期的记录。")] }),
        block("heading_2", "采样顺序"),
        ordered("准备设备", ordered("检查录音机", ordered("确认电量"), ordered("试听底噪")), ordered("校准时间")),
        ordered("记录现场"), ordered("备份录音"),
        block("paragraph", "返程另开一组记录。"),
        ordered("沿原路线复测"), ordered("核对两次采样的时间戳"),
        block("heading_3", "声音来源"),
        bullet("岸边", bullet("自然声", bullet("海浪"), bullet("鸟鸣")), bullet("脚步声")), bullet("渡船"),
        block("code", { inline: [text("const samples = [51, 64];"), { type: "hardBreak" }, text("const peak = Math.max(...samples);")] }),
        block("table", { table: {
            type: "table",
            content: readings.map((row, i) => ({
                type: "tableRow",
                content: row.map(value => ({
                    type: i === 0 ? "tableHeader" : "tableCell",
                    content: [{ type: "paragraph", content: [text(value)] }]
                }))
            }))
        } }),
        block("hr", ""),
        block("heading_2", protocol.title),
        block("paragraph", protocol.text, [], protocolId),
        block("blocked_reference", { target: protocol.target }),
        block("paragraph", "两个小组共用同一条记录：本轮录音均已完成备份。", [], sharedId)
    ] };
}

export const exampleLinks: Backlink[] = [
    { sourceId: "journal", title: "十一月田野日记", pageKind: "editable", deleted: false, sourceKind: "reference" },
    { sourceId: "methods", title: "城市声景的测量方法", pageKind: "paper", deleted: false, sourceKind: "reference" },
    { sourceId: "route", title: "第一版采样路线", pageKind: "editable", deleted: true, sourceKind: "reference" }
];

export function pickerPages(): PageRecord[] {
    return exampleLinks.slice(0, 2).map(({ sourceId: id, title, pageKind: kind }) => {
        const first = id + "-a", second = id + "-b";
        return { id, title, kind, excerpt: protocol.text, attributes: {}, titleBlockId: id + "-title", children: [first], blocks: {
            [first]: { id: first, type: "heading_1", payload: payload("heading_1", "现场记录"), children: [second] },
            [second]: { id: second, type: "paragraph", payload: payload("paragraph", protocol.text), children: [] }
        } };
    });
}