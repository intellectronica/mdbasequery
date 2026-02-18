import path from "node:path";

import type { RuntimeAdapter, RuntimeFileEntry } from "../types.js";

interface DenoLike {
  cwd(): string;
  stat(path: string): Promise<{
    isFile: boolean;
    size: number;
    mtime: Date | null;
    birthtime: Date | null;
  }>;
  readTextFile(path: string): Promise<string>;
  writeTextFile(path: string, content: string): Promise<void>;
  readDir(path: string): AsyncIterable<{
    name: string;
    isFile: boolean;
    isDirectory: boolean;
  }>;
}

function getDeno(): DenoLike {
  const deno = (globalThis as { Deno?: DenoLike }).Deno;

  if (!deno) {
    throw new Error("Deno runtime is not available");
  }

  return deno;
}

async function listFilesRecursiveInternal(root: string): Promise<RuntimeFileEntry[]> {
  const deno = getDeno();
  const queue: string[] = [root];
  const output: RuntimeFileEntry[] = [];

  while (queue.length > 0) {
    const current = queue.pop();

    if (!current) {
      continue;
    }

    for await (const entry of deno.readDir(current)) {
      const fullPath = path.join(current, entry.name);

      if (entry.isDirectory) {
        queue.push(fullPath);
        continue;
      }

      if (!entry.isFile) {
        continue;
      }

      const metadata = await deno.stat(fullPath);

      output.push({
        path: fullPath,
        stat: {
          isFile: metadata.isFile,
          size: metadata.size,
          ctime: metadata.birthtime ?? new Date(0),
          mtime: metadata.mtime ?? new Date(0),
        },
      });
    }
  }

  output.sort((left, right) => left.path.localeCompare(right.path));

  return output;
}

export const denoAdapter: RuntimeAdapter = {
  cwd() {
    return getDeno().cwd();
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
    return getDeno().readTextFile(targetPath);
  },
  async writeTextFile(targetPath: string, content: string) {
    await getDeno().writeTextFile(targetPath, content);
  },
  async listFilesRecursive(targetPath: string) {
    return listFilesRecursiveInternal(targetPath);
  },
  async exists(targetPath: string) {
    try {
      await getDeno().stat(targetPath);
      return true;
    } catch {
      return false;
    }
  },
};
