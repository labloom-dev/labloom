export function wallTime(iso: string, zone: string): string {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(iso));
    const get = (type: string): string | undefined => parts.find(part => part.type === type)?.value;
    return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

export function toInstant(wall: string, zone: string): string {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(wall)) throw new Error("请输入完整日期和时间。");
    const reference = Date.parse(`${wall}:00.000Z`);
    let guess = reference;
    for (let i = 0; i < 4; i++) guess += reference - Date.parse(`${wallTime(new Date(guess).toISOString(), zone)}:00.000Z`);
    const candidates = new Set<number>();
    for (let delta = -180; delta <= 180; delta += 30) {
        const candidate = guess + delta * 60000;
        if (wallTime(new Date(candidate).toISOString(), zone) === wall) candidates.add(candidate);
    }
    if (!candidates.size) throw new Error("该时区不存在这个本地时间，请避开夏令时跳变时间。");
    if (candidates.size > 1) throw new Error("此时间在夏令时切换时出现两次。请暂将时区设为 UTC 后输入明确时间。");
    return new Date([...candidates][0]).toISOString();
}