const assert = require("node:assert/strict");
const { test } = require("node:test");
const { connectionTargetLabel, normalizeConnectionTarget, parseConnectionsFeature, parseToolConnectionFeatures, resolveConnectionSlotIds, resolveConnectionSlots } = require("../out/utils/connectionSlots");

test("resolves modern connection counts and ranges up to ten slots", () => {
    assert.deepEqual(resolveConnectionSlots({ connections: 0 }), { min: 0, max: 0 });
    assert.deepEqual(resolveConnectionSlots({ connections: 10 }), { min: 10, max: 10 });
    assert.deepEqual(resolveConnectionSlots({ connections: { min: 2, max: 10 } }), { min: 2, max: 10 });
    assert.deepEqual(resolveConnectionSlots({ connections: { max: 5 } }), { min: 1, max: 5 });
});

test("retains the desktop legacy connection defaults", () => {
    assert.deepEqual(resolveConnectionSlots(), { min: 1, max: 1 });
    assert.deepEqual(resolveConnectionSlots({ multiConnection: "optional" }), { min: 1, max: 2 });
    assert.deepEqual(resolveConnectionSlots({ multiConnection: "required" }), { min: 2, max: 2 });
    assert.deepEqual(resolveConnectionSlots({ connectionRequirement: "optional" }), { min: 0, max: 1 });
});

test("parses registry connection metadata and rejects invalid values", () => {
    assert.equal(parseConnectionsFeature("10"), 10);
    assert.deepEqual(parseConnectionsFeature('{"min":0,"max":4}'), { min: 0, max: 4 });
    assert.equal(parseConnectionsFeature("11"), undefined);
    assert.equal(parseConnectionsFeature('{"min":5,"max":2}'), undefined);
    assert.equal(parseConnectionsFeature('{"min":0,"max":2,"other":1}'), undefined);
});

test("parses package features and prefers modern connections over legacy fields", () => {
    assert.deepEqual(parseToolConnectionFeatures({ connections: 4, multiConnection: "optional" }), { connections: 4, enabledForPowerPlatformAPI: undefined });
    assert.deepEqual(parseToolConnectionFeatures({ multiConnection: "required", connectionRequirement: "optional" }), {
        multiConnection: "required",
        connectionRequirement: "optional",
        enabledForPowerPlatformAPI: undefined,
    });
    assert.equal(parseToolConnectionFeatures({ connections: 11 }), undefined);
});

test("normalizes indexed connection targets and labels slots", () => {
    assert.equal(normalizeConnectionTarget("primary"), 0);
    assert.equal(normalizeConnectionTarget("secondary"), 1);
    assert.equal(normalizeConnectionTarget(9), 9);
    assert.equal(connectionTargetLabel(9), "Connection 10");
    assert.throws(() => normalizeConnectionTarget(-1), RangeError);
});

test("resolves positional slot IDs without shifting empty positions", () => {
    assert.deepEqual(resolveConnectionSlotIds(["first", null, "third", "fourth"], 1, 4), ["first", null, "third", "fourth"]);
    assert.equal(resolveConnectionSlotIds(["first", null], 2, 2), undefined);
    assert.deepEqual(resolveConnectionSlotIds([], 0, 0), []);
});
