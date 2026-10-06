import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { access, chmod, copyFile, cp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const nativeRoot = path.join(root, "native");
const sdkRoot = path.join(nativeRoot, "sdk");
const releaseRoot = path.join(nativeRoot, "release");
const archivePath = path.join(nativeRoot, "litert_lm_c_api-0.1.0.zip");
const sdk = {
  url: "https://github.com/google-ai-edge/LiteRT-LM/releases/download/v0.16.0/litert_lm_c_api-0.1.0.zip",
  bytes: 161_599_098,
  sha256: "f0f3ae7b5730af783d1f018f7ad9a8de20c25fedf01af4e35fc11d4382246f7d"
};

await ensureSdk();
await rm(releaseRoot, { recursive: true, force: true });
await mkdir(releaseRoot, { recursive: true });

const source = path.join(nativeRoot, "translator_helper.cpp");
const includes = path.join(sdkRoot, "include");
if (process.platform === "darwin" && process.arch === "arm64") {
  const library = path.join(sdkRoot, "lib", "macos_arm64", "liblitert-lm.dylib");
  await run("c++", ["-std=c++17", "-O2", "-pthread", "-I", includes, source, library,
    "-Wl,-rpath,@loader_path", "-o", path.join(releaseRoot, "live-music-translator-helper")]);
  await copyFile(library, path.join(releaseRoot, "liblitert-lm.so"));
} else if (process.platform === "linux" && ["x64", "arm64"].includes(process.arch)) {
  const architecture = process.arch === "x64" ? "linux_x86_64" : "linux_arm64";
  const library = path.join(sdkRoot, "lib", architecture, "liblitert-lm.so");
  await run("c++", ["-std=c++17", "-O2", "-pthread", "-I", includes, source, library,
    "-Wl,-rpath,$ORIGIN", "-o", path.join(releaseRoot, "live-music-translator-helper")]);
  await copyFile(library, path.join(releaseRoot, "liblitert-lm.so"));
} else if (process.platform === "win32" && process.arch === "x64") {
  const windowsInclude = path.join(nativeRoot, "windows-include");
  await cp(includes, windowsInclude, { recursive: true });
  for (const file of ["engine.h", "conversation.h"]) {
    const header = path.join(windowsInclude, file);
    const contents = await readFile(header, "utf8");
    await writeFile(header, contents.replaceAll("__declspec(dllexport)", "__declspec(dllimport)"));
  }
  const libraryRoot = path.join(sdkRoot, "lib", "windows_x86_64");
  const vcvars = await findVisualCppEnvironment();
  const compilerArguments = [
    "/nologo", "/std:c++17", "/O2", "/EHsc",
    `/I${quoteWindows(windowsInclude)}`,
    quoteWindows(source),
    quoteWindows(path.join(libraryRoot, "lib", "litert-lm.lib")),
    `/Fe:${quoteWindows(path.join(releaseRoot, "live-music-translator-helper.exe"))}`
  ].join(" ");
  const command = `call ${quoteWindows(vcvars)} && cl ${compilerArguments}`;
  await run("cmd.exe", ["/d", "/s", "/c", command]);
  await copyFile(path.join(libraryRoot, "bin", "litert-lm.dll"), path.join(releaseRoot, "litert-lm.dll"));
  await rm(windowsInclude, { recursive: true, force: true });
} else {
  throw new Error(`LiteRT-LM native builds do not support ${process.platform}-${process.arch}`);
}

if (process.platform !== "win32") await chmod(path.join(releaseRoot, "live-music-translator-helper"), 0o755);
await copyFile(path.join(sdkRoot, "LICENSE"), path.join(releaseRoot, "LiteRT-LM-LICENSE"));
await cp(path.join(sdkRoot, "licenses"), path.join(releaseRoot, "licenses"), { recursive: true });
process.stdout.write(`Native LiteRT-LM runtime ready: ${releaseRoot}\n`);

async function ensureSdk() {
  const marker = path.join(sdkRoot, "include", "engine.h");
  if (await exists(marker)) return;
  await mkdir(nativeRoot, { recursive: true });
  if (!(await validArchive())) await downloadArchive();
  await rm(sdkRoot, { recursive: true, force: true });
  await mkdir(sdkRoot, { recursive: true });
  if (process.platform === "win32") {
    await run("powershell.exe", ["-NoProfile", "-Command", "Expand-Archive", "-LiteralPath", archivePath, "-DestinationPath", sdkRoot, "-Force"]);
  } else {
    await run("unzip", ["-q", archivePath, "-d", sdkRoot]);
  }
}

async function validArchive() {
  try {
    const info = await stat(archivePath);
    if (info.size !== sdk.bytes) return false;
    return await digest(archivePath) === sdk.sha256;
  } catch {
    return false;
  }
}

async function downloadArchive() {
  const response = await fetch(sdk.url, { redirect: "follow" });
  if (!response.ok || !response.body) throw new Error(`LiteRT-LM SDK download failed (${response.status})`);
  const temporary = `${archivePath}.part`;
  await pipeline(response.body, createWriteStream(temporary));
  const info = await stat(temporary);
  const sha256 = await digest(temporary);
  if (info.size !== sdk.bytes || sha256 !== sdk.sha256) {
    await rm(temporary, { force: true });
    throw new Error("LiteRT-LM SDK checksum verification failed");
  }
  await rm(archivePath, { force: true });
  await import("node:fs/promises").then(({ rename }) => rename(temporary, archivePath));
}

function digest(file) {
  const hash = createHash("sha256");
  return pipeline(createReadStream(file), hash).then(() => hash.digest("hex"));
}

function exists(file) {
  return access(file).then(() => true, () => false);
}

function run(command, arguments_) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, arguments_, { cwd: root, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`${command} exited with code ${code}`)));
  });
}

async function findVisualCppEnvironment() {
  const programFiles = process.env["ProgramFiles(x86)"] || process.env.ProgramFiles;
  if (!programFiles) throw new Error("Visual Studio Build Tools 2022 with C++ support is required");
  const vswhere = path.join(programFiles, "Microsoft Visual Studio", "Installer", "vswhere.exe");
  const installation = await capture(vswhere, [
    "-latest", "-products", "*", "-requires", "Microsoft.VisualStudio.Component.VC.Tools.x86.x64",
    "-property", "installationPath"
  ]);
  if (!installation) throw new Error("Visual Studio Build Tools 2022 with C++ support is required");
  return path.join(installation, "VC", "Auxiliary", "Build", "vcvars64.bat");
}

function capture(command, arguments_) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, arguments_, { cwd: root, stdio: ["ignore", "pipe", "inherit"] });
    let output = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve(output.trim()) : reject(new Error(`${command} exited with code ${code}`)));
  });
}

function quoteWindows(value) {
  return `"${value.replaceAll('"', '""')}"`;
}
