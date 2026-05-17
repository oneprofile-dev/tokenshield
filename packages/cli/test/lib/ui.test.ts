import { test } from "node:test";
import assert from "node:assert/strict";
import { stripAnsi, indent, wrapText, table, box } from "../../src/lib/ui.js";

test("stripAnsi removes color codes", () => {
  const colored = "\x1b[32mok\x1b[39m \x1b[31mfail\x1b[39m";
  assert.equal(stripAnsi(colored), "ok fail");
});

test("indent pads non-empty lines only", () => {
  const out = indent("a\n\nb", 2);
  assert.equal(out, "  a\n\n  b");
});

test("wrapText breaks at word boundaries", () => {
  const lines = wrapText("aaa bbb ccc ddd", 7);
  assert.deepEqual(lines, ["aaa bbb", "ccc ddd"]);
});

test("wrapText preserves empty paragraph separators", () => {
  const lines = wrapText("hello\n\nworld", 80);
  assert.deepEqual(lines, ["hello", "", "world"]);
});

test("table renders aligned columns", () => {
  const out = table(
    [
      ["a", "100"],
      ["bbb", "1"],
    ],
    { header: ["X", "Y"] },
  );
  // Strip ANSI to test layout only
  const lines = stripAnsi(out).split("\n");
  assert.equal(lines.length, 3);
  assert.match(lines[1]!, /^a\s+100$/);
  assert.match(lines[2]!, /^bbb\s+1$/);
});

test("box wraps content and renders a title", () => {
  const out = stripAnsi(box("hi there", { title: "Hello" }));
  const lines = out.split("\n");
  assert.equal(lines.length, 3);
  assert.match(lines[0]!, /^┌─ Hello /);
  assert.match(lines[1]!, /│\s+hi there\s+│/);
  assert.match(lines[2]!, /^└.*┘$/);
});
