import { routes as pages } from "../../main/pages/ipc";

function measure(label: string, check: () => unknown): void {
    for (let round = 0; round < 10; round++) check();
    const times = Array.from({ length: 100 }, () => {
        const start = performance.now();
        check();
        return performance.now() - start;
    }).sort((first, second) => first - second);
    const p95 = times[94];
    console.log(label, "P95", p95.toFixed(3), "ms | limit 5", p95 <= 5 ? "PASS" : "FAIL");
    if (p95 > 5) process.exitCode = 1;
}

const blocks = Array.from({ length: 1000 }, (_, index) => ({
    id: `block-${index}`, type: "paragraph", children: [], payload: { schemaVersion: 1, type: "paragraph", inline: [
        { type: "text", text: `Research note ${index}`, marks: [{ type: "link", attrs: { href: "https://example.org", metadata: { references: ["A", "B"] } } }] }
    ] }
}));
const commit = [{ pageId: "A", tabId: "B", batch: 1, blocks }];
const sync = ["A", Array.from({ length: 10000 }, (_, index) => `block-${index}`)];
measure("IPC | commitEdit 1000 rich blocks", () => pages.commitEdit.check(commit));
measure("IPC | syncBlocks 10000 ids", () => pages.syncBlocks.check(sync));
const largeBlock = { ...blocks[0], payload: { ...blocks[0].payload, inline: [{ type: "text", text: "A".repeat(1000000) }] } };
const largeCommit = [{ ...commit[0], blocks: [largeBlock] }];
measure("IPC | commitEdit 1 block with 1000000 characters", () => pages.commitEdit.check(largeCommit));