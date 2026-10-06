import test from "node:test";
import assert from "node:assert/strict";
import { Translator } from "../src/core/translator.js";

test("local translator caches repeated lines and uses readable language names", async () => {
  const calls = [];
  const engine = {
    async translate(text, source, target) {
      calls.push({ text, source, target });
      return "Hello world";
    }
  };
  const translator = new Translator(engine);

  assert.equal(await translator.translate("Ciao mondo", "it", "en"), "Hello world");
  assert.equal(await translator.translate("Ciao mondo", "it", "en"), "Hello world");
  assert.deepEqual(calls, [{ text: "Ciao mondo", source: "Italian", target: "English" }]);
});

test("local translator bypasses inference when translation is unnecessary", async () => {
  const engine = { translate: () => assert.fail("engine should not be called") };
  const translator = new Translator(engine);
  assert.equal(await translator.translate("Ciao", "it", "it"), "Ciao");
  assert.equal(await translator.translate("Ciao", "it", "none"), "Ciao");
});

test("foreground translation interrupts look-ahead prefetching", async () => {
  const calls = [];
  let rejectBackground;
  const engine = {
    translate(text) {
      calls.push(text);
      if (text === "next") return new Promise((_resolve, reject) => { rejectBackground = reject; });
      return Promise.resolve(`translated ${text}`);
    },
    cancel() { rejectBackground?.(new Error("cancelled")); }
  };
  const translator = new Translator(engine);
  const prefetch = translator.prefetch(["next", "later"], "it", "en");
  await Promise.resolve();
  assert.equal(await translator.translate("current", "it", "en"), "translated current");
  await prefetch;
  assert.deepEqual(calls, ["next", "current"]);
});
