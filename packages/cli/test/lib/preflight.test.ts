import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:net";
import { checkPort, classifyApiKey, requirePortFree } from "../../src/lib/preflight.js";
import { TokenShieldError } from "../../src/lib/errors.js";

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const addr = s.address();
      if (typeof addr === "object" && addr) {
        const port = addr.port;
        s.close(() => resolve(port));
      }
    });
  });
}

test("checkPort reports a free port as available", async () => {
  const port = await freePort();
  const result = await checkPort(port);
  assert.equal(result.available, true);
});

test("checkPort detects port in use", async () => {
  const port = await freePort();
  const server = createServer();
  await new Promise<void>((r) => server.listen(port, "127.0.0.1", () => r()));
  try {
    const result = await checkPort(port);
    assert.equal(result.available, false);
    assert.match(result.detail ?? "", /in use|EADDRINUSE/i);
  } finally {
    await new Promise((r) => server.close(() => r(null)));
  }
});

test("requirePortFree throws TokenShieldError when port busy", async () => {
  const port = await freePort();
  const server = createServer();
  await new Promise<void>((r) => server.listen(port, "127.0.0.1", () => r()));
  try {
    await assert.rejects(() => requirePortFree(port, "test"), (err) => {
      assert.ok(err instanceof TokenShieldError);
      assert.equal((err as TokenShieldError).code, "PORT_IN_USE");
      return true;
    });
  } finally {
    await new Promise((r) => server.close(() => r(null)));
  }
});

test("classifyApiKey: missing", () => {
  assert.equal(classifyApiKey(undefined).state, "missing");
  assert.equal(classifyApiKey("").state, "missing");
});

test("classifyApiKey: wrong prefix", () => {
  assert.equal(classifyApiKey("sk-foobar").state, "wrong_prefix");
});

test("classifyApiKey: ok", () => {
  assert.equal(classifyApiKey("sk-ant-abcdef").state, "ok");
});
