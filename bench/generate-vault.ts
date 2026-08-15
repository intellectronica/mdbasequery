import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

function mulberry32(seed: number) {
  let s = seed;
  return function () {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface GenerateVaultOptions {
  outDir: string;
  notes: number;
  seed?: number;
}

const TAG_POOL = ["project/core", "project/review", "team/eng", "team/ops", "status/active", "urgent", "backlog"];
const CATEGORY_POOL = ["engineering", "product", "design", "marketing", "operations"];

export function generateVault(options: GenerateVaultOptions): void {
  const { outDir, notes, seed = 42 } = options;
  const rand = mulberry32(seed);

  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  mkdirSync(resolve(outDir, "nested"), { recursive: true });
  mkdirSync(resolve(outDir, "archive"), { recursive: true });

  const folders = ["", "nested", "archive"];

  for (let i = 0; i < notes; i++) {
    const id = String(i + 1).padStart(5, "0");
    const folder = folders[Math.floor(rand() * folders.length)];
    const score = Math.floor(rand() * 100);
    const category = CATEGORY_POOL[Math.floor(rand() * CATEGORY_POOL.length)];
    const hasDue = rand() > 0.3;
    const year = 2024 + Math.floor(rand() * 3);
    const month = String(Math.floor(rand() * 12) + 1).padStart(2, "0");
    const day = String(Math.floor(rand() * 28) + 1).padStart(2, "0");
    const dateStr = `${year}-${month}-${day}`;

    const tagCount = Math.floor(rand() * 3) + 1;
    const tags: string[] = [];
    for (let t = 0; t < tagCount; t++) {
      const tag = TAG_POOL[Math.floor(rand() * TAG_POOL.length)];
      if (!tags.includes(tag)) tags.push(tag);
    }

    const linkedId = String(Math.floor(rand() * notes) + 1).padStart(5, "0");

    const lines: string[] = ["---"];
    lines.push(`title: Note ${id}`);
    lines.push(`score: ${score}`);
    lines.push(`category: ${category}`);
    if (hasDue) {
      lines.push(`due: ${dateStr}`);
    }
    lines.push(`tags: [${tags.map((t) => JSON.stringify(t)).join(", ")}]`);
    lines.push("---");
    lines.push("");
    lines.push(`# Note ${id}`);
    lines.push("");
    lines.push(
      `This is note content with a link to [[Note ${linkedId}]] and inline tag #${tags[0] ?? "project/core"}.`,
    );
    lines.push("Lorem ipsum dolor sit amet, consectetur adipiscing elit. ".repeat(Math.floor(rand() * 5) + 1));

    const filename = `note_${id}.md`;
    const filePath = folder ? resolve(outDir, folder, filename) : resolve(outDir, filename);
    writeFileSync(filePath, lines.join("\n"), "utf8");
  }
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  let notes = 1000;
  let outDir = resolve(process.cwd(), "fixtures/vaults/synthetic");

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--notes" && args[i + 1]) {
      notes = Number.parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === "--dir" && args[i + 1]) {
      outDir = resolve(process.cwd(), args[i + 1]);
      i++;
    }
  }

  console.log(`Generating synthetic vault with ${notes} notes in ${outDir}...`);
  generateVault({ outDir, notes, seed: 42 });
  console.log("Done.");
}
