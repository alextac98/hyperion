// Run on macOS: node scripts/build-brand-icons.mjs
// Resize the approved master without redrawing it; package PNG entries for Windows.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const master = join(root, "public/brand/hyperion-icon-master.png");
const temporary = mkdtempSync(join(tmpdir(), "hyperion-icons-"));
const resize = (size, output) => execFileSync("sips", ["-z", String(size), String(size), master, "--out", output], { stdio: "ignore" });

try {
  const chunks = [["icp4", 16], ["icp5", 32], ["icp6", 64], ["ic07", 128], ["ic08", 256], ["ic09", 512], ["ic10", 1024]].map(([type, size]) => {
    const path = join(temporary, `${type}.png`);
    resize(size, path);
    const png = readFileSync(path);
    const chunk = Buffer.alloc(8);
    chunk.write(type, 0, "ascii");
    chunk.writeUInt32BE(png.length + 8, 4);
    return Buffer.concat([chunk, png]);
  });
  const icnsHeader = Buffer.alloc(8);
  icnsHeader.write("icns", 0, "ascii");
  icnsHeader.writeUInt32BE(8 + chunks.reduce((sum, chunk) => sum + chunk.length, 0), 4);
  writeFileSync(join(root, "build/icon.icns"), Buffer.concat([icnsHeader, ...chunks]));
  resize(1024, join(root, "build/icon.png"));
  resize(128, join(root, "public/brand/hyperion-icon-128.png"));
  resize(64, join(root, "public/favicon.png"));

  const sizes = [16, 32, 48, 64, 128, 256];
  const images = sizes.map(size => {
    const path = join(temporary, `${size}.png`);
    resize(size, path);
    return readFileSync(path);
  });
  const header = Buffer.alloc(6 + sizes.length * 16);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  sizes.forEach((size, index) => {
    const entry = 6 + index * 16;
    header[entry] = header[entry + 1] = size === 256 ? 0 : size;
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(images[index].length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += images[index].length;
  });
  writeFileSync(join(root, "build/icon.ico"), Buffer.concat([header, ...images]));
  console.log("Generated macOS, Windows, Linux and web icons from the approved master.");
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
