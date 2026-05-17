import { test } from "node:test";
import assert from "node:assert/strict";
import { TokenShieldError, exitCodeFor, ensureNumber } from "../../src/lib/errors.js";

test("TokenShieldError carries code, message, hint, nextSteps", () => {
  const err = new TokenShieldError({
    code: "PORT_IN_USE",
    message: "Port 7777 in use",
    hint: "kill the process",
    nextSteps: ["lsof -i :7777"],
  });
  assert.equal(err.code, "PORT_IN_USE");
  assert.equal(err.message, "Port 7777 in use");
  assert.equal(err.hint, "kill the process");
  assert.deepEqual(err.nextSteps, ["lsof -i :7777"]);
});

test("exitCodeFor returns category-specific exit codes", () => {
  assert.equal(exitCodeFor(new TokenShieldError({ code: "PORT_IN_USE", message: "x" })), 10);
  assert.equal(exitCodeFor(new TokenShieldError({ code: "DAEMON_NOT_RUNNING", message: "x" })), 11);
  assert.equal(exitCodeFor(new TokenShieldError({ code: "UPSTREAM_UNREACHABLE", message: "x" })), 30);
  assert.equal(exitCodeFor(new Error("plain")), 1);
});

test("ensureNumber accepts strings and numbers, rejects out-of-range", () => {
  assert.equal(ensureNumber("port", "7777"), 7777);
  assert.equal(ensureNumber("port", 7777), 7777);
  assert.throws(() => ensureNumber("port", "abc"), TokenShieldError);
  assert.throws(() => ensureNumber("port", -1), TokenShieldError);
  assert.throws(() => ensureNumber("port", 999999), TokenShieldError);
});
