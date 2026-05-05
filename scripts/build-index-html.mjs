import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, "..");
const partialsRoot = resolve(projectRoot, "src", "client", "index-partials");
const outputPath = resolve(projectRoot, "index.html");

const orderedPartials = [
  "head.html",
  "header-shell.html",
  "sections/geo.html",
  "sections/reinforcement.html",
  "sections/geometry.html",
  "sections/strength.html",
  "sections/control-plan.html",
  "sections/summary.html",
  "sections/journal.html",
  "sections/knowledge.html",
  "post-main.html",
  "tail.html"
];

const chunks = await Promise.all(
  orderedPartials.map(async (relativePath) => {
    const absolutePath = resolve(partialsRoot, relativePath);
    return readFile(absolutePath, "utf8");
  })
);

const outputHtml = `${chunks.join("\n").trimEnd()}\n`;
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, outputHtml, "utf8");

console.log(`Index HTML rebuilt from partials -> ${outputPath}`);
