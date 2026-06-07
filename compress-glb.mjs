#!/usr/bin/env node
import { execSync } from "child_process";
import { statSync, existsSync } from "fs";
import { resolve, basename, dirname } from "path";

const input = process.argv[2];

if (!input) {
  console.log("Usage: node compress-glb.mjs <input.glb>");
  process.exit(1);
}

if (!existsSync(input)) {
  console.error(`File not found: ${input}`);
  process.exit(1);
}

const inputPath = resolve(input);
const outputPath = resolve(
  dirname(inputPath),
  basename(inputPath, ".glb") + "-draco.glb"
);

const before = statSync(inputPath).size;

console.log(`Input:  ${input} (${(before / 1024 / 1024).toFixed(2)} MB)`);
console.log("Compressing with Draco...");

execSync(
  `npx --yes @gltf-transform/cli draco "${inputPath}" "${outputPath}"`,
  { stdio: "inherit" }
);

const after = statSync(outputPath).size;
const savings = (((before - after) / before) * 100).toFixed(1);

console.log(`Output: ${basename(outputPath)} (${(after / 1024 / 1024).toFixed(2)} MB)`);
console.log(`Saved:  ${savings}%`);
