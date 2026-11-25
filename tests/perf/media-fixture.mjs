import { spawn } from "node:child_process";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createCanvas } from "@napi-rs/canvas";

const sizes = [[64, 48], [640, 360], [1200, 800], [3840, 2160], [6000, 4000]];
export async function generateMedia(directory) {
    await mkdir(directory, { recursive: true });
    const fixtures = [];
    for (const [index, [width, height]] of sizes.entries()) {
        const canvas = createCanvas(width, height), context = canvas.getContext("2d");
        const gradient = context.createLinearGradient(0, 0, width, height);
        gradient.addColorStop(0, "#1b4557");
        gradient.addColorStop(1, "#cea665");
        context.fillStyle = gradient;
        context.fillRect(0, 0, width, height);
        context.fillStyle = "#e6eacc";
        for (let i = 0; i < 24; i++) {
            const x = (i * 137 % 97) / 97 * width, y = (i * 103 % 89) / 89 * height;
            context.fillRect(x, y, width / 12, height / 25);
        }
        for (const format of ["png", "jpeg", "webp", "svg", "gif"]) {
            const path = join(directory, `Image-${index}-${format}.${format}`);
            const bytes = format === "svg"
                ? `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#1b4557"/><circle cx="${width / 2}" cy="${height / 2}" r="${height / 3}" fill="#cea665"/></svg>`
                : format === "gif" ? gif(width, height) : await canvas.encode(format, 90);
            await writeFile(path, bytes);
            fixtures.push({ path, width, height });
        }
    }
    const large = join(directory, "Large video.mp4"), small = join(directory, "Short reference.mp4");
    if (((await stat(large).catch(() => null))?.size ?? 0) < 1_000_000_000) await video(large, 128);
    if (((await stat(small).catch(() => null))?.size ?? 0) < 150_000_000) await video(small, 24);
    const images = Array.from({ length: 300 }, (_, i) => fixtures[(i * 7) % fixtures.length]);
    await writeFile(join(directory, "media.json"), JSON.stringify({ images, large, small }));
}

function gif(width, height) {
    const bytes = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");
    bytes.writeUInt16LE(width, 6);
    bytes.writeUInt16LE(height, 8);
    return bytes;
}

async function video(path, duration) {
    const rate = "67108864";
    const child = spawn(process.env.FFMPEG ?? "ffmpeg", ["-nostdin", "-hide_banner", "-loglevel", "error", "-y",
        "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=12", "-t", String(duration), "-c:v", "libx264", "-preset", "ultrafast",
        "-threads", "2", "-level", "5.1", "-b:v", rate, "-minrate", rate, "-maxrate", rate, "-bufsize", rate, "-x264-params", "nal-hrd=cbr",
        "-pix_fmt", "yuv420p", "-movflags", "+faststart", path], { windowsHide: true, stdio: "inherit" });
    await new Promise((resolve, reject) => {
        child.once("error", reject);
        child.once("exit", code => code === 0 ? resolve() : reject(new Error("FFmpeg exited with code " + code)));
    });
}