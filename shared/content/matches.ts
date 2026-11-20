// Lowercasing can expand a character (e.g. İ). Keep positions in the original text.
export function* matchRanges(text: string, keyword: string): Generator<[number, number]> {
    const folded = text.toLocaleLowerCase(), needle = keyword.toLocaleLowerCase();
    if (!needle) return;
    let index = folded.indexOf(needle);
    if (index < 0) return;
    const original: number[] = [];
    if (folded.length !== text.length) {
        let offset = 0;
        for (const character of text) {
            const length = character.toLocaleLowerCase().length;
            for (let i = 0; i < length; i++) original.push(offset);
            offset += character.length;
        }
    }
    while (index >= 0) {
        const end = index + needle.length;
        if (original.length) {
            const last = original[end - 1];
            yield [original[index], last + (text.codePointAt(last)! > 0xffff ? 2 : 1)];
        }
        else yield [index, end];
        index = folded.indexOf(needle, end);
    }
}