const assert = require("node:assert/strict");
const { test } = require("node:test");
const axios = require("axios");
const { PowerPlatformManager } = require("../out/managers/powerPlatformManager");

test("routes Power Platform requests through the requested numeric connection slot", async () => {
    const targets = [];
    const originalRequest = axios.request;
    const authConnections = [];
    axios.request = async () => ({ data: { ok: true } });
    try {
        const manager = new PowerPlatformManager(
            { async acquireToken(connection) { authConnections.push(connection.id); return `token:${connection.id}`; } },
            async (target) => {
                targets.push(target);
                return { id: `connection-${target}`, enabledForPowerPlatformAPI: true };
            },
        );
        const result = await manager.requestWithConnection({ id: "connection-slot-10", enabledForPowerPlatformAPI: true }, "Dynamics", "GET", "/environments");
        assert.deepEqual(result, { ok: true });
        assert.deepEqual(authConnections, ["connection-slot-10"]);
        await manager.request("Dynamics", "GET", "/environments", undefined, 9);
        assert.deepEqual(targets, [9]);
        await assert.rejects(manager.request("Dynamics", "GET", "", undefined, -1), /Invalid connection target/);
    } finally {
        axios.request = originalRequest;
    }
});
