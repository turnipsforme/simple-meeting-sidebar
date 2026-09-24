// This module is loaded only by the guarded Mac-only dynamic import in main.ts.
import { Buffer } from "node:buffer";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

const EXECUTABLE_MODE = 0o755;

export async function installExecutableHelper(helperPath: string, bundledHelperBase64: string): Promise<void> {
  const helperBytes = Buffer.from(bundledHelperBase64, "base64");
  if (helperBytes.length === 0) throw new Error("The embedded calendar helper is empty.");

  const helperDirectory = path.dirname(helperPath);
  const temporaryPath = path.join(helperDirectory, `.calendar-helper-${randomUUID()}.tmp`);
  await mkdir(helperDirectory, { recursive: true });

  try {
    await writeFile(temporaryPath, helperBytes, { mode: EXECUTABLE_MODE });
    await chmod(temporaryPath, EXECUTABLE_MODE);
    await rename(temporaryPath, helperPath);
    await chmod(helperPath, EXECUTABLE_MODE);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

/** Check once per plugin load, so upgrades replace old helpers without rewriting every refresh. */
export async function ensureExecutableHelper(helperPath: string, bundledHelperBase64: string): Promise<void> {
  const installed = await readFile(helperPath).catch(() => null);
  if (installed?.equals(Buffer.from(bundledHelperBase64, "base64"))) {
    await chmod(helperPath, EXECUTABLE_MODE);
    return;
  }
  await installExecutableHelper(helperPath, bundledHelperBase64);
}
