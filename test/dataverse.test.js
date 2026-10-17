const assert = require("node:assert/strict");
const { test } = require("node:test");
const axios = require("axios");
const { DataverseManager } = require("../out/managers/dataverseManager");

function connection() {
    return {
        id: "connection-id",
        name: "Test environment",
        url: "https://example.crm.dynamics.com",
        authType: "InteractiveBrowser",
        environment: "Test",
    };
}

test("scopes CallerObjectId to requests made inside the impersonation context", async () => {
    const requests = [];
    const originalCreate = axios.create;
    axios.create = () => ({
        request: async (config) => {
            requests.push(config);
            return { data: { value: [] } };
        },
    });

    try {
        const manager = new DataverseManager({
            async acquireToken() {
                return "token";
            },
            async refreshToken() {
                return "token";
            },
        });

        await Promise.all([manager.withImpersonation("caller-object-id", () => manager.queryData(connection(), "accounts")), manager.queryData(connection(), "contacts")]);

        const impersonatedRequest = requests.find((request) => request.url === "accounts");
        const regularRequest = requests.find((request) => request.url === "contacts");
        assert.equal(impersonatedRequest.headers.CallerObjectId, "caller-object-id");
        assert.equal(regularRequest.headers?.CallerObjectId, undefined);
    } finally {
        axios.create = originalCreate;
    }
});

test("searches active system users and rejects continuation URLs outside the connection", async () => {
    const requests = [];
    const originalCreate = axios.create;
    axios.create = () => ({
        request: async (config) => {
            requests.push(config);
            return { data: { value: [{ systemuserid: "user-id", azureactivedirectoryobjectid: "object-id", fullname: "Test User" }] } };
        },
    });

    try {
        const manager = new DataverseManager({
            async acquireToken() {
                return "token";
            },
            async refreshToken() {
                return "token";
            },
        });

        const page = await manager.searchSystemUsers(connection(), "O'Brien");
        assert.equal(page.users[0].fullname, "Test User");
        assert.equal(page.nextLink, null);
        const filter = new URL(requests[0].url).searchParams.get("$filter");
        assert.match(filter, /contains\(fullname,'O''Brien'\)/);
        assert.equal(requests[0].headers.Prefer, "odata.maxpagesize=50");

        await assert.rejects(manager.searchSystemUsers(connection(), "", "https://other.crm.dynamics.com/api/data/v9.2/systemusers?$skiptoken=x"), /Invalid Dataverse user search continuation/);
        assert.equal(requests.length, 1);
    } finally {
        axios.create = originalCreate;
    }
});
