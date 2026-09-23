import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { installExecutableHelper } from "../src/helper-installer";

test("embedded helper is installed in the expected folder with executable permissions", async () => {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "simple-meeting-sidebar-helper-"));
  const helperPath = path.join(temporaryDirectory, "bin", "calendar-helper");
  const expectedBytes = Buffer.from("embedded helper bytes");

  try {
    await installExecutableHelper(helperPath, expectedBytes.toString("base64"));

    assert.deepEqual(await readFile(helperPath), expectedBytes);
    await access(helperPath, fsConstants.X_OK);
    assert.equal((await stat(helperPath)).mode & 0o777, 0o755);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("install replaces a non-executable helper atomically", async () => {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "simple-meeting-sidebar-helper-"));
  const helperPath = path.join(temporaryDirectory, "bin", "calendar-helper");
  const expectedBytes = Buffer.from("replacement helper bytes");

  try {
    await mkdir(path.dirname(helperPath), { recursive: true });
    await writeFile(helperPath, "old helper", { mode: 0o644 });
    await installExecutableHelper(helperPath, expectedBytes.toString("base64"));

    assert.deepEqual(await readFile(helperPath), expectedBytes);
    await access(helperPath, fsConstants.X_OK);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("helper upgrades replace old executable bytes and leave current copies untouched", async () => {
  const { ensureExecutableHelper } = await import("../src/helper-installer");
  const directory = await mkdtemp(path.join(os.tmpdir(), "simple-meeting-sidebar-upgrade-"));
  const helperPath = path.join(directory, "calendar-helper");
  const bundled = Buffer.from("new helper");
  try {
    await writeFile(helperPath, "old helper", { mode: 0o755 });
    await ensureExecutableHelper(helperPath, bundled.toString("base64"));
    assert.deepEqual(await readFile(helperPath), bundled);
    const before = await stat(helperPath);
    await ensureExecutableHelper(helperPath, bundled.toString("base64"));
    const after = await stat(helperPath);
    assert.equal(after.ino, before.ino);
    assert.equal(after.mtimeMs, before.mtimeMs);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
