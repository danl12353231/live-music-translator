import { createHash } from "node:crypto";
import { mkdir, open, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dist = path.join(root, "dist");
const output = path.join(root, "release-assets");
const platform = argument("--platform");
const maxPartBytes = Number(process.env.RELEASE_PART_BYTES) || 1_900_000_000;
if (!Number.isSafeInteger(maxPartBytes) || maxPartBytes < 1) throw new Error("Invalid release part size");
const extensions = {
  "macos-arm64": [".dmg"],
  "windows-x64": [".exe"],
  "linux-x64": [".appimage"]
};

if (!extensions[platform]) throw new Error(`Unknown release platform: ${platform}`);
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

const files = (await readdir(dist, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && extensions[platform].includes(path.extname(entry.name).toLowerCase()))
  .map((entry) => path.join(dist, entry.name));
if (files.length !== 1) {
  throw new Error(`Expected one ${platform} installer in dist, found ${files.length}`);
}

const source = files[0];
const fileName = path.basename(source);
const info = await stat(source);
const instructions = [];
const checksums = [];

if (info.size <= maxPartBytes) {
  const destination = path.join(output, fileName);
  await rename(source, destination);
  checksums.push(`${await sha256(destination)}  ${fileName}`);
  instructions.push(`Download ${fileName} and open it normally.`);
} else {
  const result = await splitFile(source, output, fileName);
  checksums.push(`${result.fullHash}  ${fileName}`);
  checksums.push(...result.parts.map((part) => `${part.hash}  ${part.name}`));
  instructions.push(...reassemblyInstructions(platform, fileName));
  await rm(source, { force: true });
}

await writeFile(path.join(output, `SHA256SUMS-${platform}.txt`), `${checksums.join("\n")}\n`, "utf8");
await writeFile(path.join(output, `REASSEMBLE-${platform}.txt`), `${instructions.join("\n")}\n`, "utf8");

async function splitFile(file, directory, originalName) {
  const input = await open(file, "r");
  const buffer = Buffer.allocUnsafe(8 * 1024 * 1024);
  const fullHash = createHash("sha256");
  const parts = [];
  let position = 0;
  let partNumber = 1;
  try {
    while (true) {
      const partName = `${originalName}.part-${String(partNumber).padStart(2, "0")}`;
      const partPath = path.join(directory, partName);
      const part = await open(partPath, "w");
      const partHash = createHash("sha256");
      let partBytes = 0;
      try {
        while (partBytes < maxPartBytes) {
          const requested = Math.min(buffer.length, maxPartBytes - partBytes);
          const { bytesRead } = await input.read(buffer, 0, requested, position);
          if (!bytesRead) break;
          const chunk = buffer.subarray(0, bytesRead);
          await part.write(chunk);
          fullHash.update(chunk);
          partHash.update(chunk);
          position += bytesRead;
          partBytes += bytesRead;
        }
      } finally {
        await part.close();
      }
      if (!partBytes) {
        await rm(partPath, { force: true });
        break;
      }
      parts.push({ name: partName, hash: partHash.digest("hex") });
      partNumber += 1;
    }
  } finally {
    await input.close();
  }
  return { fullHash: fullHash.digest("hex"), parts };
}

function reassemblyInstructions(target, originalName) {
  if (target === "windows-x64") {
    return [
      "Download every .part-* file for Windows into the same folder.",
      "Open PowerShell in that folder and run:",
      `$output = [IO.File]::Create(\"${originalName}\")`,
      `Get-ChildItem \"${originalName}.part-*\" | Sort-Object Name | ForEach-Object { $input = [IO.File]::OpenRead($_.FullName); $input.CopyTo($output); $input.Dispose() }`,
      "$output.Dispose()",
      `Then run \"${originalName}\". Windows SmartScreen may warn because this community build is unsigned.`
    ];
  }
  return [
    `Download every ${originalName}.part-* file into the same folder.`,
    "Open Terminal in that folder and run:",
    `cat '${originalName}.part-'* > '${originalName}'`,
    target === "linux-x64" ? `chmod +x '${originalName}'` : "",
    `Then open ${originalName}. These community builds are currently unsigned.`
  ].filter(Boolean);
}

async function sha256(file) {
  const handle = await open(file, "r");
  const hash = createHash("sha256");
  const buffer = Buffer.allocUnsafe(8 * 1024 * 1024);
  try {
    let position = 0;
    while (true) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
      if (!bytesRead) break;
      hash.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
  } finally {
    await handle.close();
  }
  return hash.digest("hex");
}

function argument(name) {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1]) throw new Error(`Missing ${name}`);
  return process.argv[index + 1];
}
