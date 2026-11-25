import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { annotationColors } from "../../shared/content/annotations";
import { payload } from "../../shared/content/blocks";
import { PDF_EXTRACTOR_VERSION } from "../../shared/content/pdf-text";
import { knownCoordinatePdf } from "../fixtures/pdf-text";
import { paperServices } from "../support/session";
import { type fixture } from "./fixture";

export async function seedReader(data: ReturnType<typeof fixture>, root: string): Promise<{ paperId: string; fileId: string }> {
    const line = "The coastal survey records observations from the spring sampling stations.";
    const contents = ["BT /F1 13 Tf 1 0 0 1 50 760 Tm", ...Array.from({ length: 23 }, (_, i) =>
        `${i ? "0 -28 Td " : ""}(${line}) Tj`), "ET"].join("\n");
    const path = join(root, "Reader benchmark.pdf");
    writeFileSync(path, knownCoordinatePdf(false, contents, 300));
    const paperId = (await paperServices().importFile(path)).pageId;
    const [fileId] = data.service.get(paperId).attributes.paper_files as string[];
    const block = data.sql.prepare("INSERT INTO blocks(id,type,content) VALUES(?,?,?)");
    const page = data.sql.prepare("INSERT INTO pages(id,kind,title_block_id,children) VALUES(?,'annotation',?,?)");
    const colors = Object.keys(annotationColors), ids: string[] = [];
    const id = (n: number): string => "23400000-0000-4000-8000-" + n.toString(16).padStart(12, "0");
    data.sql.transaction(() => {
        for (let i = 0; i < 1000; i++) {
            const note = id(i * 3 + 1), title = id(i * 3 + 2), body = id(i * 3 + 3);
            const pageNumber = Math.floor(i * 300 / 1000) + 1, lineNumber = 1 + (i % 4) * 5;
            const rectangles = [{ x: 50, y: 760 - lineNumber * 28 - 3, width: 355, height: 16 }];
            block.run(title, "title", JSON.stringify(payload("title", line)));
            block.run(body, "paragraph", JSON.stringify(payload("paragraph", i % 3 === 0 ? "Check the sampling conditions against the data table." : "")));
            page.run(note, title, JSON.stringify([body]));
            data.service.attributes.initializePage(note);
            data.attr.run(0, note, "independent");
            data.attr.run(fileId, note, "annotation_file");
            data.attr.run(JSON.stringify({ page: pageNumber, rects: rectangles }), note, "annotation_position");
            data.attr.run(colors[i % colors.length], note, "annotation_color");
            data.attr.run(line, note, "annotation_quote");
            data.attr.run(line, note, "annotation_context");
            data.attr.run(PDF_EXTRACTOR_VERSION, note, "annotation_extractor");
            ids.push(note);
        }
        data.attr.run(JSON.stringify(ids), paperId, "paper_annotations");
        data.attr.run(1, paperId, "pinned");
    })();
    data.service.rebuildLinks();
    return { paperId, fileId };
}