import assert from "node:assert/strict";
import test from "node:test";
import { filterIgnoredGuests, parseIgnoredPeople } from "../src/utils";

test("parseIgnoredPeople is capitalization and whitespace agnostic", () => {
  const ignored = parseIgnoredPeople("  Mish , wREN ,,  Dana  Smith ");
  assert.deepEqual([...ignored].sort(), ["dana smith", "mish", "wren"]);
});

test("filterIgnoredGuests drops guests matching a first or full name", () => {
  const guests = ["Mish Anderson", "Wren", "Taylor Swift", "Jamie Fox"];
  assert.deepEqual(
    filterIgnoredGuests(guests, "mish, WREN"),
    ["Taylor Swift", "Jamie Fox"],
  );
  assert.deepEqual(filterIgnoredGuests(guests, "taylor swift"), [
    "Mish Anderson",
    "Wren",
    "Jamie Fox",
  ]);
});

test("filterIgnoredGuests keeps everyone with an empty list or setting", () => {
  const guests = ["Mish Anderson", "Wren"];
  assert.deepEqual(filterIgnoredGuests(guests, ""), guests);
  assert.deepEqual(filterIgnoredGuests([], "Mish"), []);
});

test("full-name exclusions do not accidentally exclude people sharing a name", () => {
  assert.deepEqual(filterIgnoredGuests(["Dana Smith", "Dana Jones", "Jamie Smith"], "Dana Smith"),
    ["Dana Jones", "Jamie Smith"]);
  assert.deepEqual(filterIgnoredGuests(["Dana Smith", "Dana Jones", "Jamie Smith"], "Dana"), ["Jamie Smith"]);
});
