import type Database from "better-sqlite3";
import { builtinAttrs, builtinAttrsByPageKind } from "../../shared/attrs/builtins";
import { defaultValue, encodeValue } from "../../shared/attrs/values";
import { payload } from "../../shared/content/blocks";
import type { AttributeValue } from "../../shared/types/attributes";
import { setKeywords } from "../../main/feed/service";

const refreshedAt = Date.UTC(2026, 10, 24, 6, 20) / 1000;
const day = 86400;
const sizes = [4500, 1800, 1000, 300, ...Array<number>(16).fill(150)];
const followed = ["quasar", "光谱", "coastal sampling"];

function uuid(n: number): string {
    return "20000000-0000-4000-8000-" + n.toString(16).padStart(12, "0");
}

const longArticle = Array.from({ length: 40 }, (_, i) => `<h2>Observation ${i + 1}</h2>
    <p>${"Repeated coastal measurements include a comparison of successive observations. ".repeat(5)}</p>
    <blockquote><p>实验记录包含中英文正文。</p></blockquote>
    <pre><code>const sample = ${i + 1};</code></pre>
    <table><tr><th>Site</th><th>Sample</th></tr><tr><td>Coast</td><td>${i + 1}</td></tr></table>
    <ul><li>Measurements</li><li><a href="/methods">Methods</a></li></ul><hr>`).join("")
    + `<figure><img src="https://feeds.example.test/coast.png" alt="Coast" width="800" height="400"><figcaption>Coastal survey</figcaption></figure>`;

// Run after seedLibrary in the same workspace so imported entries reference real papers.
export function seedFeed(sql: Database.Database): void {
    const block = sql.prepare("INSERT INTO blocks(id,type,content,children) VALUES(?,'title',?,'[]')");
    const page = sql.prepare("INSERT INTO pages(id,kind,title_block_id,children) VALUES(?,'feed',?,'[]')");
    const attr = sql.prepare("INSERT INTO page_attrs(page_id,attr_id,value) VALUES(?,?,?)");
    const insert = sql.prepare(`INSERT INTO feed_items(id,source_id,external_id,title,url,normalized_url,authors,summary,raw_content,has_full_content,
        published_at,is_read,paper_id,pdf_url) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    const papers = sql.prepare("SELECT id FROM pages WHERE kind='paper' ORDER BY id").pluck().all() as string[];
    sql.transaction(() => {
        let serial = 0;
        for (const [i, size] of sizes.entries()) {
            const id = uuid(i * 2), titleId = uuid(i * 2 + 1);
            const name = (i % 2 ? "Observatory " : "观测站 ") + String(i + 1);
            const url = `https://feeds.example.test/${i + 1}/rss`;
            const values: Record<string, AttributeValue> = {
                independent: true, created_at: refreshedAt - day, modified_at: refreshedAt,
                feed_url: url, feed_status: i >= 18 ? "cancelled" : i >= 16 ? "paused" : "enabled",
                feed_refresh: { every: i % 2 ? 30 : 60, unit: "minute" },
                feed_last_refreshed: refreshedAt - i * 60, feed_last_checked: refreshedAt, feed_last_added: i,
                feed_error: i === 3 ? JSON.stringify({ kind: "feed-http", status: 503, diagnostic: "Synthetic response: HTTP 503" }) : "",
                feed_failures: i === 3 ? 1 : 0
            };
            block.run(titleId, JSON.stringify(payload("title", name)));
            page.run(id, titleId);
            for (const key of builtinAttrsByPageKind.feed) {
                const definition = { ...builtinAttrs[key], id: key };
                const value = encodeValue(definition, values[key] ?? defaultValue(definition.type));
                attr.run(id, key, typeof value === "number" ? BigInt(value) : value);
            }
            for (let j = 0; j < size; j++, serial++) {
                const chinese = serial % 3 === 0;
                const title = (chinese ? "沿岸观测与测量分析 " : "Coastal measurements and observations ") + serial.toString().padStart(5, "0");
                const word = serial % 31 === 0 ? " " + followed[Math.floor(serial / 31) % followed.length] : "";
                const summary = (chinese ? "本期报告比较不同测站的采样结果。" : "Comparing sample series from several observatories.") + word;
                const full = serial % 8 === 0, address = serial % 43 === 42 ? null : `https://feeds.example.test/items/${serial}`;
                insert.run(uuid(serial + 100), id, String(j), title, address, address, chinese ? "张明" : "A. Brown", summary,
                    full ? longArticle : "<p>" + summary + "</p>", Number(full), serial % 37 === 36 ? null : (refreshedAt - serial * 64) * 1000,
                    serial % 2, serial % 19 === 3 ? papers[serial % papers.length] ?? null : null, address && serial % 17 === 0 ? address + ".pdf" : null);
            }
        }
    })();
    setKeywords(followed);
}

// Preserve library benchmark rows and add the overview's task data only to its fixture.
export function seedOverviewTasks(sql: Database.Database): void {
    const pages = sql.prepare("SELECT id FROM pages WHERE kind IN ('editable','paper') ORDER BY id").pluck().all() as string[];
    const set = sql.prepare("INSERT INTO page_attrs(page_id,attr_id,value) VALUES(?,?,?)");
    const date = Math.floor(refreshedAt / day) * day;
    sql.transaction(() => {
        for (const [i, id] of pages.entries()) {
            if (i % 3 === 2) continue;
            set.run(id, "task_status", i % 7 === 0 ? "done" : i % 2 === 0 ? "todo" : "doing");
            if (i % 4 !== 0) set.run(id, "schedule_date", BigInt(date + (i % 31 - 15) * day));
        }
    })();
}