import { test } from "node:test";
import assert from "node:assert/strict";
import { SSEParser } from "../src/proxy/sse.js";

test("SSEParser: single complete event", () => {
  const p = new SSEParser();
  const events = p.push(`event: message_start\ndata: {"hello":1}\n\n`);
  assert.equal(events.length, 1);
  assert.equal(events[0]!.event, "message_start");
  assert.equal(events[0]!.data, '{"hello":1}');
});

test("SSEParser: split across multiple pushes preserves boundaries", () => {
  const p = new SSEParser();
  let events = p.push("event: messa");
  assert.equal(events.length, 0);
  events = p.push("ge_start\ndata: {\"a\":");
  assert.equal(events.length, 0);
  events = p.push("1}\n\nevent: ping\ndata: \n\n");
  assert.equal(events.length, 2);
  assert.equal(events[0]!.event, "message_start");
  assert.equal(events[0]!.data, '{"a":1}');
  assert.equal(events[1]!.event, "ping");
});

test("SSEParser: ignores comment lines and unknown fields", () => {
  const p = new SSEParser();
  const events = p.push(`: keep-alive\nid: 42\nevent: x\ndata: y\n\n`);
  assert.equal(events.length, 1);
  assert.equal(events[0]!.event, "x");
  assert.equal(events[0]!.data, "y");
});

test("SSEParser: multi-line data is joined with newlines", () => {
  const p = new SSEParser();
  const events = p.push(`event: x\ndata: line1\ndata: line2\n\n`);
  assert.equal(events.length, 1);
  assert.equal(events[0]!.data, "line1\nline2");
});

test("SSEParser: CRLF line endings", () => {
  const p = new SSEParser();
  const events = p.push(`event: x\r\ndata: ok\r\n\r\n`);
  assert.equal(events.length, 1);
  assert.equal(events[0]!.event, "x");
  assert.equal(events[0]!.data, "ok");
});

test("SSEParser: handles event with no explicit event name", () => {
  const p = new SSEParser();
  const events = p.push(`data: hello\n\n`);
  assert.equal(events.length, 1);
  assert.equal(events[0]!.event, "message");
  assert.equal(events[0]!.data, "hello");
});
