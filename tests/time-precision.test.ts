import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { KnowledgeService } from "../main/knowledge/service";
import { EditHistory } from "../main/knowledge/history";
import { createWorkspace, openWorkspace } from "../main/storage/workspace";
import { builtinAttrs } from "../shared/attrs/builtins";
import { convertValue } from "../shared/attrs/convert";
import { display, search } from "../shared/attrs/format";
import { defaultValue, encodeValue, validateDefinition, validateValue } from "../shared/attrs/values";
import { dayToSeconds, monthToSeconds, scheduleDay, secondsToDay, secondsToMonth, secondsToWall, secondsToYear, timeToSeconds, timeTypes, wallToSeconds, yearToSeconds } from "../shared/content/time";
import { type AttributeDefinition, type AttributeType, type AttributeValue } from "../shared/types/attributes";

const definition = (type: AttributeType, id = "custom:" + randomUUID()): AttributeDefinition => ({ name: "属性", id, type, metadata: {} });
const zone = "Asia/Shanghai";
const instant = Date.UTC(2026, 10, 7, 17, 12, 56) / 1000;

function fixture(t: TestContext): ReturnType<typeof createWorkspace> & { service: KnowledgeService; setZone: (value: string) => void } {
    const workspace = createWorkspace(mkdtempSync(join(process.env.LABLOOM_TEST_ROOT!, "time-precision-")));
    t.after(() => {
        if (workspace.database.open) workspace.database.close();
    });
    let timeZone = zone;
    const service = new KnowledgeService(workspace.db, () => timeZone);
    return { ...workspace, service, setZone: (value: string) => timeZone = value };
}

test("five nullable precisions validate UTC boundaries and reject legacy type names", () => {
    const day = dayToSeconds("2026-11-11"), month = monthToSeconds("2026-11"), year = yearToSeconds("2026");
    for (const type of timeTypes) {
        const def = definition(type);
        validateDefinition(def);
        assert.equal(defaultValue(type), null);
        assert.equal(encodeValue(def, null), null);
        for (const value of [1.5, Infinity, NaN, Number.MAX_SAFE_INTEGER, "2026-11-11", "", [], false]) assert.throws(() => validateValue(def, value));
    }
    for (const type of ["minute", "hour"] as const) for (const value of [instant, instant + 1, -1, 0]) validateValue(definition(type), value);
    for (const [type, good, bad] of [["day", day, day + 8 * 3600], ["month", month, day], ["year", year, month]] as const) {
        validateValue(definition(type), good);
        assert.throws(() => validateValue(definition(type), bad));
        assert.throws(() => validateValue(definition(type), good + 1));
    }
    for (const type of ["date", "datetime"]) assert.throws(() => validateDefinition({ ...definition("day"), type }));
});

test("UTC calendar parsers reject rollover and round-trip leap days and four-digit years", () => {
    for (const day of ["0001-01-01", "1969-12-31", "2024-02-29", "2026-11-11", "9999-12-31"]) assert.equal(secondsToDay(dayToSeconds(day)), day);
    assert.equal(secondsToMonth(monthToSeconds("2026-11")), "2026-11");
    assert.equal(secondsToYear(yearToSeconds("2026")), "2026");
    for (const day of ["2026-02-29", "2026-04-31", "2026-13-01", "2026-00-01", "2026-11-00", "2026-1-01"]) assert.throws(() => dayToSeconds(day));
    for (const month of ["2026-13", "2026-00", "2026-1", "2026-11-01"]) assert.throws(() => monthToSeconds(month));
    for (const year of ["26", "20260", "abcd", "2026-01"]) assert.throws(() => yearToSeconds(year));
    for (const wall of ["2026-02-29T14:30", "2026-11-11T24:00", "2026-11-11T14:60"]) assert.throws(() => wallToSeconds(wall, zone));
});

test("display and search use UTC for calendar precision and the selected zone for instants", () => {
    for (const timeZone of [zone, "UTC", "America/New_York", "invalid-zone"]) {
        for (const [type, value, expected] of [["day", dayToSeconds("2026-11-11"), "2026-11-11"], ["month", monthToSeconds("2026-11"), "2026-11"], ["year", yearToSeconds("2026"), "2026"]] as const) {
            assert.equal(display(definition(type), value, { zone: timeZone }), expected);
            assert.equal(search(definition(type), value, { zone: timeZone }), expected);
        }
    }
    assert.equal(display(definition("minute"), instant, { zone }), "2026-11-08 01:12");
    assert.equal(display(definition("minute"), instant, { zone: "UTC" }), "2026-11-07 17:12");
    const hour = timeToSeconds("hour", "2026-11-11 14时", "Asia/Kolkata");
    assert.equal(hour, Date.UTC(2026, 10, 11, 8, 30) / 1000);
    assert.equal(display(definition("hour"), hour, { zone: "Asia/Kolkata" }), "2026-11-11 14时");
    assert.equal(search(definition("hour"), hour, { zone: "Asia/Kolkata" }), "2026-11-11 14时");
});

test("retyping truncates or expands calendar precision and preserves seconds between instant precisions", () => {
    const cases: [AttributeType, AttributeValue, AttributeType, AttributeValue][] = [
        ["minute", instant, "day", dayToSeconds("2026-11-08")],
        ["hour", instant, "month", monthToSeconds("2026-11")],
        ["minute", instant, "year", yearToSeconds("2026")],
        ["day", dayToSeconds("2026-11-11"), "month", monthToSeconds("2026-11")],
        ["day", dayToSeconds("2026-11-11"), "year", yearToSeconds("2026")],
        ["month", monthToSeconds("2026-11"), "year", yearToSeconds("2026")],
        ["year", yearToSeconds("2026"), "month", monthToSeconds("2026-01")],
        ["month", monthToSeconds("2026-11"), "day", dayToSeconds("2026-11-01")],
        ["day", dayToSeconds("2026-11-08"), "minute", Date.UTC(2026, 10, 7, 16) / 1000],
        ["month", monthToSeconds("2026-11"), "hour", Date.UTC(2026, 9, 31, 16) / 1000],
        ["year", yearToSeconds("2026"), "minute", Date.UTC(2025, 11, 31, 16) / 1000],
        ["minute", instant, "hour", instant], ["hour", instant, "minute", instant],
        ["string", "2026-11-11 14:30", "minute", wallToSeconds("2026-11-11T14:30", zone)],
        ["string", "2026-11-11 14时", "hour", wallToSeconds("2026-11-11T14:00", zone)],
        ["string", "2026-11-11", "day", dayToSeconds("2026-11-11")],
        ["string", "2026-11", "month", monthToSeconds("2026-11")],
        ["string", "2026", "year", yearToSeconds("2026")],
        ["day", dayToSeconds("2026-11-11"), "string", "2026-11-11"],
        ["hour", instant, "string", "2026-11-08 01时"],
        ["number", dayToSeconds("2026-11-11"), "day", dayToSeconds("2026-11-11")],
        ["number", instant, "day", null], ["minute", instant, "number", instant],
        ["string", "2026-11-11", "month", null], ["day", null, "boolean", false]
    ];
    for (const [from, value, to, expected] of cases) assert.deepEqual(convertValue(definition(from), definition(to), value, zone), expected, `${from} → ${to}`);
    for (const type of timeTypes) {
        assert.equal(convertValue(definition("string"), definition(type), "无法解析", zone), null);
        assert.equal(convertValue(definition(type), definition("number"), null, zone), null);
    }
    assert.equal(convertValue(definition("string"), definition("minute"), "2026-03-08 02:30", "America/New_York"), null);
    assert.equal(convertValue(definition("string"), definition("hour"), "2026-11-01 01时", "America/New_York"), null);
    assert.equal(convertValue(definition("day"), definition("hour"), dayToSeconds("2011-12-30"), "Pacific/Apia"), null);
});

test("all precisions persist as SQLite integers and rejected writes roll back atomically", t => {
    const { service, database } = fixture(t);
    const page = service.create("event", "A", { schedule_date: dayToSeconds("2026-11-11") });
    const values = [instant, instant, dayToSeconds("2026-11-11"), monthToSeconds("2026-11"), yearToSeconds("2026")];
    for (const [index, type] of timeTypes.entries()) {
        const def = definition(type);
        assert.equal(service.setDefinition(def.id, def, "test"), null);
        service.attributes.write(page.id, { [def.id]: values[index] });
        assert.deepEqual(database.prepare("SELECT value,typeof(value) AS type FROM page_attrs WHERE page_id=? AND attr_id=?").get(page.id, def.id), { value: values[index], type: "integer" });
        assert.throws(() => service.attributes.write(page.id, { pinned: true, [def.id]: type === "minute" || type === "hour" ? 1.5 : values[index] + 1 }));
        assert.equal(service.get(page.id).attributes.pinned, false);
        service.attributes.write(page.id, { [def.id]: null });
        assert.equal(service.get(page.id).attributes[def.id], null);
    }
    for (const type of ["date", "datetime"]) assert.throws(() => service.setDefinition("custom:" + randomUUID(), { ...definition("day"), type } as AttributeDefinition, "test"));
    for (const id of ["created_at", "modified_at", "recycled_at", "schedule_start", "schedule_end", "feed_last_checked"] as const) assert.equal(service.attributes.definition(id).type, "minute");
    assert.equal(service.attributes.definition("schedule_date").type, "day");
    assert.equal(service.attributes.definition("paper_year").type, "string");
    assert.equal(builtinAttrs.paper_year.type, "string");
});

test("definition preview and commit share conversion, invalidate undo, and refresh tokens after a zone change", t => {
    const { service, setZone } = fixture(t);
    const history = new EditHistory(service);
    const page = service.create("editable", "A"), def = definition("minute");
    service.setDefinition(def.id, def, "manager");
    assert.equal(service.commitEdit({ pageId: page.id, tabId: "editor", batch: 1, blocks: [], attributes: { [def.id]: instant } }).status, "saved");
    assert.equal(history.state("editor").canUndo, true);
    const target = { ...def, type: "day" as const };
    const preview = service.setDefinition(def.id, target, "manager")!;
    assert.deepEqual(preview.pages.map(p => p.id), [page.id]);
    assert.equal(service.get(page.id).attributes[def.id], instant);
    setZone("UTC");
    const updated = service.setDefinition(def.id, target, "manager", preview.token)!;
    assert.notEqual(updated.token, preview.token);
    assert.equal(service.get(page.id).attributes[def.id], instant);
    assert.equal(service.setDefinition(def.id, target, "manager", updated.token), null);
    assert.equal(service.get(page.id).attributes[def.id], convertValue(def, target, instant, "UTC"));
    assert.equal(history.state("editor").canUndo, false);
    const text = { ...target, type: "string" as const };
    const back = service.setDefinition(def.id, text, "manager")!;
    service.setDefinition(def.id, text, "manager", back.token);
    assert.equal(service.get(page.id).attributes[def.id], "2026-11-07");
});

test("calendar search and grouping stay on the same day after changing zones and reopening", t => {
    const { service, database, info, setZone } = fixture(t);
    const day = dayToSeconds("2026-11-11");
    const event = service.create("event", "A", { schedule_date: day });
    const task = service.create("task", "B", { schedule_date: day, schedule_start: instant });
    // Keep system timestamps from also matching the date keyword under test.
    database.prepare("UPDATE page_attrs SET value=? WHERE attr_id IN ('created_at','modified_at')").run(yearToSeconds("2000"));
    for (const timeZone of [zone, "UTC", "America/New_York"]) {
        setZone(timeZone);
        assert.deepEqual(new Set(service.list({ keyword: "2026-11" }).items.map(p => p.id)), new Set([event.id, task.id]));
        assert.equal(service.list({ keyword: "2026-11-11" }).total, 2);
        assert.equal(service.list({ keyword: String(day) }).total, 0);
        assert.equal(scheduleDay(service.get(event.id).attributes, timeZone), "2026-11-11");
        assert.equal(scheduleDay(service.get(task.id).attributes, timeZone), secondsToWall(instant, timeZone).slice(0, 10));
    }
    database.close();
    const reopened = openWorkspace(info.path);
    t.after(() => reopened.database.close());
    const next = new KnowledgeService(reopened.db, () => "America/New_York");
    assert.equal(next.get(event.id).attributes.schedule_date, day);
    assert.equal(next.list({ keyword: "2026-11-11" }).total, 2);
    assert.equal(scheduleDay(next.get(event.id).attributes, "America/New_York"), "2026-11-11");
});