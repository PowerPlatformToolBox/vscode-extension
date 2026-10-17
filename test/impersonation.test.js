const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createImpersonationPickerItems, formatConnectionStatus, resolveImpersonationPickerSelection } = require("../out/utils/impersonation");

const user = {
    fullname: "Test User",
    internalemailaddress: "test@example.com",
    domainname: "example\\test",
    azureactivedirectoryobjectid: "object-id",
    systemuserid: "user-id",
};

test("keeps Skip Impersonation first with users and empty results", () => {
    const withUsers = createImpersonationPickerItems([user], true);
    assert.match(withUsers[0].label, /Skip Impersonation/);
    assert.equal(withUsers[0].skip, true);
    assert.equal(withUsers[1].user, user);
    assert.equal(withUsers[2].loadMore, true);

    const empty = createImpersonationPickerItems([], false);
    assert.equal(empty.length, 1);
    assert.equal(empty[0].skip, true);
});

test("keeps Skip Impersonation available when user loading fails", () => {
    const items = createImpersonationPickerItems([], false, "Dataverse unavailable");
    assert.equal(items[0].skip, true);
    assert.deepEqual(items[1], { label: "Could not load users", description: "Dataverse unavailable" });
});

test("distinguishes user selection, skip, load more, and no selection", () => {
    const [skipItem, userItem, loadMoreItem] = createImpersonationPickerItems([user], true);

    assert.deepEqual(resolveImpersonationPickerSelection(userItem, true), { type: "user", user });
    assert.deepEqual(resolveImpersonationPickerSelection(skipItem, true), { type: "skip" });
    assert.deepEqual(resolveImpersonationPickerSelection(loadMoreItem, true), { type: "loadMore" });
    assert.deepEqual(resolveImpersonationPickerSelection(loadMoreItem, false), { type: "none" });
    assert.deepEqual(resolveImpersonationPickerSelection(undefined, true), { type: "none" });
});

test("summarizes connection and impersonation status per slot", () => {
    const summary = formatConnectionStatus([
        { index: 0, connectionId: "connection-1", connectionName: "Production", impersonatedUserName: "Test User" },
        { index: 1, connectionId: "connection-2", connectionName: "Development" },
        { index: 2, connectionId: null },
    ], 3);

    assert.equal(summary.text, "$(database) Connections: 2/3 · Impersonation: 1/2");
    assert.equal(summary.tooltip, [
        "Primary: Production · impersonating Test User",
        "Secondary: Development · no impersonation",
        "Connection 3: Not set · no impersonation",
        "Click to manage this tool's connection slots",
    ].join("\n"));
});

test("uses a stable connection count when there are no assigned slots", () => {
    const summary = formatConnectionStatus([{ index: 0, connectionId: null }], 1);
    assert.equal(summary.text, "$(database) Connections: 0/1 · Impersonation: 0/0");
});
