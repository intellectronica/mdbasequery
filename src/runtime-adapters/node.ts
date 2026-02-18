import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import type { RuntimeAdapter, RuntimeFileEntry } from "../types.js";

async function listFilesRecursiveInternal(root: string): Promise<RuntimeFileEntry[]> {
  const queue: string[] = [root];
  const output: RuntimeFileEntry[] = [];

  while (queue.length > 0) {
    const current = queue.pop();

    if (!current) {
      continue;
    }

    const dirEntries = await readdir(current, { withFileTypes: true });

    for (const entry of dirEntries) {
      const fullPath = path.join(current, entry.name);

      if (entry.isDirectory()) {
        queue.push(fullPath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      const metadata = await stat(fullPath);

      output.push({
        path: fullPath,
        stat: {
          isFile: metadata.isFile(),
          size: metadata.size,
          ctime: metadata.birthtime,
          mtime: metadata.mtime,
        },
      });
    }
  }

  output.sort((left, right) => left.path.localeCompare(right.path));

  return output;
}

export const nodeAdapter: RuntimeAdapter = {
  cwd() {
    return process.cwd();
  },
  resolve(...parts: string[]) {
    return path.resolve(...parts);
  },
  relative(from: string, to: string) {
    return path.relative(from, to).replaceAll("\\", "/");
  },
  basename(targetPath: string) {
    return path.basename(targetPath);
  },
  extname(targetPath: string) {
    return path.extname(targetPath);
  },
  async readTextFile(targetPath: string) {
    return readFile(targetPath, "utf8");
  },
  async writeTextFile(targetPath: string, content: string) {
    await writeFile(targetPath, content, "utf8");
  },
  async listFilesRecursive(targetPath: string) {
    return listFilesRecursiveInternal(targetPath);
  },
  async exists(targetPath: string) {
    try {
      await stat(targetPath);
      return true;
    } catch {
      return false;
    }
  },
};
