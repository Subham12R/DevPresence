import { test } from "node:test";
import assert from "node:assert/strict";
import {
  dotFrame,
  formatActiveTime,
  renderStatusText,
  isLoopbackAgentUrl,
} from "../presence";

test("formatActiveTime: seconds under a minute", () => {
  assert.equal(formatActiveTime(0), "0s");
  assert.equal(formatActiveTime(45_000), "45s");
  assert.equal(formatActiveTime(59_999), "59s");
});

test("formatActiveTime: whole minutes under an hour", () => {
  assert.equal(formatActiveTime(60_000), "1m");
  assert.equal(formatActiveTime(24 * 60_000), "24m");
  assert.equal(formatActiveTime(59 * 60_000), "59m");
});

test("formatActiveTime: hours and zero-padded minutes", () => {
  assert.equal(formatActiveTime((3 * 60 + 24) * 60_000), "3h 24m");
  assert.equal(formatActiveTime((1 * 60 + 2) * 60_000), "1h 02m");
  assert.equal(formatActiveTime(60 * 60_000), "1h 00m");
});

test("dotFrame: cycles through 4 frames and wraps", () => {
  assert.equal(dotFrame(0), "");
  assert.equal(dotFrame(1), "·");
  assert.equal(dotFrame(2), "··");
  assert.equal(dotFrame(3), "···");
  assert.equal(dotFrame(4), "");
});

test("renderStatusText: animated active kind shows icon, phrase, dots, time", () => {
  const text = renderStatusText("writing", 2, (3 * 60 + 24) * 60_000);
  assert.equal(text, "$(radio-tower) Writing Code·· · Active for 3h 24m");
});

test("renderStatusText: idle shows time but no animated dots", () => {
  const text = renderStatusText("idle", 3, (1 * 60 + 2) * 60_000);
  assert.equal(text, "$(clock) Idle · Active for 1h 02m");
});

test("renderStatusText: offline shows neither dots nor time", () => {
  assert.equal(renderStatusText("offline", 1, 99_000), "$(circle-slash) Offline");
});

test("isLoopbackAgentUrl: loopback hosts are true, remote and garbage are false", () => {
  assert.equal(isLoopbackAgentUrl("http://127.0.0.1:7337"), true);
  assert.equal(isLoopbackAgentUrl("http://localhost:7337"), true);
  assert.equal(isLoopbackAgentUrl("https://example.com/activity"), false);
  assert.equal(isLoopbackAgentUrl("not a url"), false);
});
