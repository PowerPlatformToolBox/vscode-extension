const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const Module = require("node:module");

let respond;
const calls = [];
const output = { appendLine() {}, show() {}, dispose() {} };
const vscode = {
    window: { createOutputChannel: () => output, showInformationMessage() {} },
    Uri: { joinPath: (uri, child) => ({ fsPath: path.join(uri.fsPath, child) }) },
    EventEmitter: class {
        event = () => ({ dispose() {} });
        fire() {}
        dispose() {}
    },
};
const client = {
    from(table) {
        return {
            select(columns) {
                const call = { table, columns, filters: {} };
                calls.push(call);
                const query = {
                    eq(key, value) {
                        call.filters[key] = value;
                        return this;
                    },
                    in(key, value) {
                        call.filters[key] = value;
                        return this;
                    },
                    range(from, to) {
                        call.range = [from, to];
                        return this;
                    },
                    or(value) {
                        call.search = value;
                        return this;
                    },
                    single() {
                        call.single = true;
                        return this;
                    },
                    then(resolve, reject) {
                        return Promise.resolve(respond(call)).then(resolve, reject);
                    },
                };
                return query;
            },
        };
    },
};
const originalLoad = Module._load;
Module._load = function (name, parent, isMain) {
    if (name === "vscode") return vscode;
    if (name === "@supabase/supabase-js") return { createClient: () => client };
    return originalLoad.call(this, name, parent, isMain);
};
const { ToolRegistryManager } = require("../out/managers/toolRegistryManager");
const { ToolManager } = require("../out/managers/toolManager");
Module._load = originalLoad;
process.env.PPTB_SUPABASE_URL = "https://example.test";
process.env.PPTB_SUPABASE_ANON_KEY = "test-anon-key";

const current = {
    id: "sample",
    name: "Sample",
    description: "Searchable",
    version: "2.0.0",
    status: "active",
    download: "https://example.test/current.tgz",
    icon: "https://example.test/current.png",
    maturity_status: "verified",
    multi_connection: "optional",
    connection_requirement: "required",
    enabled_for_power_platform_api: true,
    mcp_enabled: true,
    min_api: "1.2.0",
    max_api: "2.0.0",
    checksum: "sha256:test",
    size: 1234,
    csp_exceptions: { connectSrc: ["https://example.test"] },
    tool_categories: [{ categories: { name: "DevOps" } }],
    tool_contributors: [{ contributors: { name: "Author" } }],
    tool_analytics: { downloads: 42, rating: 4.5, mau: 7 },
};

test("catalog list and detail expose release and typed metadata without inventing capability tags", async () => {
    calls.length = 0;
    respond = (call) => (call.table === "tools_catalog" ? { data: call.single ? current : [current], count: 1, error: null } : { data: null, error: { message: "unexpected table" } });
    const registry = new ToolRegistryManager(output);
    const { tools, total } = await registry.getTools({ category: "DevOps", search: "Search" });
    assert.equal(total, 1);
    assert.equal(calls[0].table, "tools_catalog");
    assert.equal(calls[0].filters.category, undefined);
    assert.deepEqual(calls[0].range, [0, 999]);
    assert.match(calls[0].search, /Search/);
    assert.equal(tools[0].download, current.download);
    assert.equal(tools[0].icon, current.icon);
    assert.deepEqual(tools[0].categories, ["DevOps"]);
    assert.deepEqual(tools[0].contributors, ["Author"]);
    assert.equal(tools[0].downloads, 42);
    assert.equal(tools[0].isVerified, true);
    assert.equal(tools[0].multiConnection, "optional");
    assert.equal(tools[0].connectionRequirement, "required");
    assert.equal(tools[0].enabledForPowerPlatformAPI, true);
    assert.equal(tools[0].mcpEnabled, true);
    assert.equal(tools[0].maturityStatus, "verified");
    assert.equal(tools[0].minAPI, "1.2.0");
    assert.equal(tools[0].maxAPI, "2.0.0");
    assert.equal(tools[0].checksum, "sha256:test");
    assert.equal(tools[0].size, 1234);
    assert.deepEqual(tools[0].cspExceptions, current.csp_exceptions);
    assert.equal(tools[0].capabilityTags, undefined);
    assert.deepEqual(await registry.getToolById("sample"), tools[0]);
    assert.equal((await registry.getLatestVersions(["sample"])).get("sample"), "2.0.0");
    assert.deepEqual(await registry.getAllIconUrls(), [current.icon]);
    assert.equal(
        calls.some((call) => call.table === "tools" || call.table === "tool_maturity"),
        false,
    );
});

test("absent MCP stays absent and maturity does not inherit an unrelated badge", async () => {
    respond = (call) => ({
        data: call.single ? { ...current, mcp_enabled: null, maturity_status: "community", verified: true } : [{ ...current, mcp_enabled: null, maturity_status: "community", verified: true }],
        count: 1,
        error: null,
    });
    const tool = (await new ToolRegistryManager(output).getTools()).tools[0];
    assert.equal(tool.mcpEnabled, undefined);
    assert.equal(tool.isVerified, false);
    respond = (call) => ({ data: call.single ? { ...current, mcp_enabled: false } : [{ ...current, mcp_enabled: false }], count: 1, error: null });
    assert.equal((await new ToolRegistryManager(output).getTools()).tools[0].mcpEnabled, false);
});

test("known invocation tags come from capability_tags, not MCP or release metadata", async () => {
    calls.length = 0;
    respond = (call) =>
        call.table === "capability_tags" ? { data: [{ tag: "fetchxml" }, { tag: "entity-picker" }, { tag: "fetchxml" }], error: null } : { data: null, error: { message: "unexpected table" } };
    assert.deepEqual(await new ToolRegistryManager(output).getKnownCapabilityTags(), ["entity-picker", "fetchxml"]);
    assert.deepEqual(
        calls.map((call) => call.table),
        ["capability_tags"],
    );
});

test("plain catalog reads hydrate relations for category filtering and details", async () => {
    calls.length = 0;
    const other = { ...current, id: "other", name: "Other" };
    respond = (call) => {
        if (call.table === "tools_catalog" && call.columns.includes("tool_categories")) return { data: null, error: { message: "no view relationship" } };
        if (call.table === "tools_catalog") return { data: call.single ? current : [current, other], count: 2, error: null };
        if (call.table === "tool_categories") return { data: [{ tool_id: "sample", categories: { name: "DevOps" } }], error: null };
        if (call.table === "tool_contributors") return { data: [{ tool_id: "sample", contributors: { name: "Author" } }], error: null };
        if (call.table === "tool_analytics") return { data: [{ tool_id: "sample", downloads: 42 }], error: null };
        return { data: null, error: { message: "unexpected" } };
    };
    const registry = new ToolRegistryManager(output);
    const result = await registry.getTools({ category: "DevOps" });
    assert.equal(result.total, 1);
    assert.deepEqual(
        result.tools.map((tool) => tool.id),
        ["sample"],
    );
    assert.deepEqual(result.tools[0].contributors, ["Author"]);
    assert.equal(result.tools[0].downloads, 42);
    assert.deepEqual((await registry.getToolById("sample")).categories, ["DevOps"]);
    assert.equal(
        calls.some((call) => call.table === "tools"),
        false,
    );
});

test("category pages are sliced after filtering relation names", async () => {
    const rows = Array.from({ length: 105 }, (_, index) => ({
        ...current,
        id: `tool-${index}`,
        tool_categories: [{ categories: { name: index === 0 ? "Other" : "DevOps" } }],
    }));
    respond = (call) => ({ data: call.single ? rows[0] : rows.slice(call.range?.[0] ?? 0, (call.range?.[1] ?? 104) + 1), count: 105, error: null });
    const result = await new ToolRegistryManager(output).getTools({ category: "DevOps", page: 2 });
    assert.equal(result.total, 104);
    assert.deepEqual(
        result.tools.map((tool) => tool.id),
        ["tool-101", "tool-102", "tool-103", "tool-104"],
    );
});

test("catalog deployment is required and legacy tools are never queried", async () => {
    calls.length = 0;
    respond = () => ({ data: null, error: { message: "not deployed" } });
    const registry = new ToolRegistryManager(output);
    assert.deepEqual(await registry.getTools(), { tools: [], total: 0 });
    assert.equal(await registry.getToolById("sample"), null);
    assert.deepEqual(await registry.getLatestVersions(["sample"]), new Map());
    assert.deepEqual(await registry.getAllIconUrls(), []);
    assert.deepEqual(await registry.getKnownCapabilityTags(), []);
    assert.equal(
        calls.some((call) => call.table === "tools"),
        false,
    );
});

test("install and update download the release selected by the catalog", async () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), "pptb-registry-"));
    const requests = [];
    const server = http.createServer((request, response) => {
        requests.push(request.url);
        response.writeHead(200);
        response.end(request.url);
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
        let version = "2.0.0";
        respond = (call) => {
            const row = { ...current, version, download: `${base}/${version}.js` };
            return { data: call.single ? row : [row], error: null };
        };
        const registry = new ToolRegistryManager(output);
        const context = { globalStorageUri: { fsPath: temp }, subscriptions: [] };
        const manager = new ToolManager(context);
        const first = await registry.getToolById("sample");
        await manager.install(first);
        assert.equal(fs.readFileSync(path.join(manager.getToolPath("sample"), "2.0.0.js"), "utf8"), "/2.0.0.js");
        version = "3.0.0";
        assert.equal((await registry.getLatestVersions(["sample"])).get("sample"), version);
        await manager.updateTool(await registry.getToolById("sample"));
        assert.equal(manager.getById("sample").version, "3.0.0");
        assert.deepEqual(requests, ["/2.0.0.js", "/3.0.0.js"]);
    } finally {
        server.close();
        fs.rmSync(temp, { recursive: true, force: true });
    }
});
