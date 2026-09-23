import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const styles = readFileSync(new URL("../renderer/styles/colors.css", import.meta.url), "utf8");
const menu = readFileSync(new URL("../renderer/components/Editor/Color.svelte", import.meta.url), "utf8");
const options = [...menu.matchAll(/\{ value: (null|"[\w-]+"), label:/gu)]
    .map(([, value]) => value === "null" ? "default" : JSON.parse(value));
assert.ok(options.length > 1, "Read all color options, including the default.");
assert.equal(new Set(options).size, options.length, "Color options must be unique.");

function palette(kind) {
    const declarations = [...styles.matchAll(new RegExp(`--dc-c-${kind}-([\\w-]+):\\s*([^;]+);`, "gu"))];
    const colors = new Map(declarations.map(([, name, value]) => [name, value.trim()]));
    assert.equal(colors.size, declarations.length, `${kind}: duplicate color declarations`);
    assert.deepEqual([...colors.keys()].sort(), [...options].sort(), `${kind}: match every menu option`);
    for (const [name, value] of colors) {
        assert.match(value, /^#[\da-f]{6}$/iu, `${kind}/${name}: use an opaque sRGB hex color`);
    }
    return colors;
}

// WCAG relative luminance and contrast ratio, evaluated before rounding:
// https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html
function luminance(hex) {
    const [red, green, blue] = hex.slice(1).match(/../gu).map(channel => {
        const srgb = parseInt(channel, 16) / 255;
        return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrast(foreground, background) {
    const a = luminance(foreground);
    const b = luminance(background);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

assert.equal(contrast("#000000", "#ffffff"), 21);
assert.equal(contrast("#777777", "#777777"), 1);
const foregrounds = palette("fg");
const backgrounds = palette("bg");
assert.equal(foregrounds.get("default"), "#000000");
assert.equal(backgrounds.get("default"), "#ffffff");

const failures = [];
let worst = { ratio: Infinity, foreground: "", background: "" };
for (const [foreground, fg] of foregrounds) {
    for (const [background, bg] of backgrounds) {
        const ratio = contrast(fg, bg);
        if (ratio < worst.ratio) worst = { ratio, foreground, background };
        if (ratio < 3) failures.push(`${foreground} on ${background}: ${ratio.toFixed(4)}:1`);
    }
}
assert.equal(failures.length, 0, `Contrast must be at least 3:1:\n${failures.join("\n")}`);
console.log(`Editor colors: ${foregrounds.size * backgrounds.size} pairs passed; minimum ${worst.ratio.toFixed(4)}:1 (${worst.foreground} on ${worst.background}).`);