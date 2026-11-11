import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createChats, parseChat } from "../server/chat/chats.ts";
import { MAX_CHATS, type SavedChat } from "../shared/chat-protocol.ts";

const chat = (id: string, used: number, text = "hi"): SavedChat => ({ id, name: id, used, history: [{ role: "user", text }] });

test("chats: parseChat keeps good chats and refuses bad ones", () => {
  assert.deepEqual(parseChat({ id: "a-1", name: "x".repeat(60), history: [{ role: "user", text: "hi" }], used: 3 }), { id: "a-1", name: "x".repeat(40), history: [{ role: "user", text: "hi" }], used: 3 });
  assert.equal(parseChat({ id: "../evil", history: [] }), null);
  assert.equal(parseChat({ id: "a", history: [{ role: "nope" }] }), null);
  assert.equal(parseChat({ id: "a" }), null);
});

test("chats: each saved by its id, the oldest dropped past the limit, kept in the file", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "chats-"));
  const file = path.join(dir, "session.chats.json");
  try {
    const store = createChats(file);
    store.put(chat("a", 1), "w1");
    store.put(chat("b", 2), "w1");
    store.put(chat("a", 3, "changed"), "w2");
    assert.deepEqual(store.list().map((c) => c.id), ["a", "b"]);
    assert.deepEqual(store.list()[0].history, [{ role: "user", text: "changed" }]);
    for (let i = 0; i < MAX_CHATS; i++) store.put(chat(`n${i}`, 10 + i), "w1");
    assert.equal(store.list().length, MAX_CHATS);
    assert.ok(!store.list().some((c) => c.id === "b" || c.id === "a"), "the two used longest ago went");
    store.remove("n0", "w1");
    store.flush();
    const again = createChats(file);
    assert.equal(again.list().length, MAX_CHATS - 1);
    assert.ok(!again.list().some((c) => c.id === "n0"));
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});
