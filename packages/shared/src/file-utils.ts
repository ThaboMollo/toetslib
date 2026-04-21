import fg from "fast-glob";
import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { dirname } from "node:path";

export async function globFiles(
  dir: string,
  patterns: string | string[]
): Promise<string[]> {
  return fg(patterns, { cwd: dir, absolute: true });
}

export async function readFileContent(filePath: string): Promise<string> {
  return readFile(filePath, "utf-8");
}

export async function writeFileContent(
  filePath: string,
  content: string
): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf-8");
}

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}
