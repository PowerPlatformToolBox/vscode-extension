const assert = require("node:assert/strict");
const { test } = require("node:test");
const Module = require("node:module");

const originalLoad = Module._load;
Module._load = function (name, parent, isMain) {
    if (name === "vscode") {
        return {
            EventEmitter: class {
                fire() {}
            },
        };
    }
    if (name === "uuid") {
        return { v4: () => "generated-id" };
    }
    return originalLoad.call(this, name, parent, isMain);
};
const { ConnectionsManager } = require("../out/managers/connectionsManager");
Module._load = originalLoad;

function createManager() {
    const state = new Map();
    return new ConnectionsManager({
        globalState: {
            get(key, fallback) {
                return state.has(key) ? state.get(key) : fallback;
            },
            async update(key, value) {
                state.set(key, value);
            },
        },
        secrets: {
            async get() {
                return undefined;
            },
            async store() {},
            async delete() {},
        },
    });
}

test("imports an unversioned Desktop connection file and maps its authentication type", async () => {
    const manager = createManager();
    const result = await manager.importConnections({
        connections: [
            {
                id: "desktop-connection",
                name: "Desktop",
                url: "https://example.crm.dynamics.com",
                environment: "Production",
                authenticationType: "interactive",
            },
        ],
    });

    assert.equal(result.imported, 1);
    assert.equal(result.skipped, 0);
    assert.equal(manager.getById("desktop-connection").authType, "InteractiveBrowser");
});

test("imports incomplete connections with warnings and prevents use until required fields are fixed", async () => {
    const manager = createManager();
    const result = await manager.importConnections({
        version: 1,
        connections: [{ id: "incomplete", name: "Partial" }],
    });
    const connection = manager.getById("incomplete");

    assert.equal(result.imported, 1);
    assert.equal(result.skipped, 0);
    assert.match(result.warnings[0], /missing required fields: url, environment, authType/);
    assert.deepEqual(connection.missingRequiredFields, ["url", "environment", "authType"]);
    await assert.rejects(manager.setActiveConnection(connection.id), /Cannot connect: incomplete required fields or credentials/);

    await manager.update({
        ...connection,
        url: "https://example.crm.dynamics.com",
        environment: "Production",
        missingRequiredFields: undefined,
    });
    await manager.setActiveConnection(connection.id);
    assert.equal(manager.getActiveConnection().id, connection.id);

    const exported = manager.exportConnections().connections[0];
    assert.equal("missingRequiredFields" in exported, false);
});

test("prevents imported connections with missing credentials from becoming active until credentials are saved", async () => {
    const manager = createManager();
    await manager.importConnections({
        version: 1,
        connections: [
            {
                id: "missing-secret",
                name: "Service principal",
                url: "https://example.crm.dynamics.com",
                environment: "Production",
                authType: "ClientCredentials",
            },
        ],
    });
    const connection = manager.getById("missing-secret");

    assert.equal(connection.hasIncompleteCredentials, true);
    await assert.rejects(manager.setActiveConnection(connection.id), /incomplete required fields or credentials: credentials/);

    await manager.update({ ...connection, clientId: "client-id", clientSecret: "client-secret" });
    assert.equal(manager.getById(connection.id).hasIncompleteCredentials, false);
    await manager.setActiveConnection(connection.id);
});
