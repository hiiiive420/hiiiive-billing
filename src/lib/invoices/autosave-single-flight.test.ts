import assert from "node:assert/strict";
import { test } from "node:test";
import { runSingleFlight } from "./autosave-single-flight";

test("rapid first-save triggers share one create promise, then later saves update its draft ID", async () => {
  const state: { current: Promise<string> | null } = { current: null };
  let draftId = "";
  let creates = 0;
  let updates = 0;
  let releaseCreate!: () => void;
  const createGate = new Promise<void>((resolve) => { releaseCreate = resolve; });
  const save = () => runSingleFlight(state, async () => {
    if (!draftId) {
      creates += 1;
      await createGate;
      draftId = "draft-123";
    } else updates += 1;
    return draftId;
  });

  const first = save();
  const second = save();
  assert.equal(first, second);
  await Promise.resolve();
  assert.equal(creates, 1);
  releaseCreate();
  assert.equal(await first, "draft-123");

  assert.equal(await save(), "draft-123");
  assert.equal(creates, 1);
  assert.equal(updates, 1);
});
