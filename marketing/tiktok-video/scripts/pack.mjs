/**
 * Zip every deliverable in ./out into one download:
 *   npm run pack   →  out/split-index-tiktok-pack.zip
 * Includes the masters, SFX versions, cut-down, covers, formats and the posting kit.
 */
import { execSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";

const zip = "out/split-index-tiktok-pack.zip";
if (existsSync(zip)) rmSync(zip);
execSync(`zip -q -j ${zip} out/*.mp4 out/*.png POSTING-KIT.md README.md && zip -q ${zip} out/formats/*.mp4`, { stdio: "inherit" });
execSync(`unzip -l ${zip} | tail -1`, { stdio: "inherit" });
console.log(`✓ ${zip}`);
