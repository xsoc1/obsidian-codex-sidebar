import { test } from "node:test";
import assert from "node:assert/strict";
import { conflict_target } from "../src/conflict-view";

test("only exact message conflict keys expose scoped resolution controls", () =>
{
	assert.deepEqual(conflict_target(JSON.stringify(["s", "m"])), { SessionId: "s", MessageId: "m" });
	assert.deepEqual(conflict_target(JSON.stringify(["message", "s", "m"])), { SessionId: "s", MessageId: "m" });
	for(const Key of ['["settings","",""]', '["root","",""]', '["message","",""]', '{}', 'not-json']) { assert.equal(conflict_target(Key), null); }
});
