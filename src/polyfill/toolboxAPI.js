(function () {
    const CHANNEL_REQUEST = "pptb:request";
    const CHANNEL_RESPONSE = "pptb:response";
    const CHANNEL_EVENT = "pptb:event";
    const SOURCE = "pptb-polyfill";

    const pendingRequests = new Map();
    const eventListeners = new Set();
    const targetOrigin = window.location.origin;

    let requestCounter = 0;
    let cachedContext = window.TOOLBOX_CONTEXT || null;

    const POWER_PLATFORM_CATEGORIES = [
        "Analytics",
        "AppManagement",
        "Authorization",
        "Connectivity",
        "CopilotStudio",
        "Dynamics",
        "EnvironmentManagement",
        "Governance",
        "Licensing",
        "PowerApps",
        "PowerAutomate",
        "PowerPages",
        "ResourceQuery",
        "UserManagement",
        "WorkflowAgents",
    ];

    function nextRequestId() {
        requestCounter += 1;
        return `pptb-${Date.now()}-${requestCounter}`;
    }

    function invoke(namespace, method, args) {
        const requestId = nextRequestId();

        return new Promise((resolve, reject) => {
            pendingRequests.set(requestId, { resolve, reject });

            window.parent.postMessage(
                {
                    source: SOURCE,
                    type: CHANNEL_REQUEST,
                    requestId,
                    namespace,
                    method,
                    args,
                },
                targetOrigin,
            );
        });
    }

    function addEventListener(callback) {
        eventListeners.add(callback);
        return function removeEventListener() {
            eventListeners.delete(callback);
        };
    }

    function buildPowerPlatformCategoryClient(category) {
        return {
            Get(path = "", connectionTarget = "primary", headers) {
                return invoke("powerplatform", "request", [category, "GET", path, undefined, connectionTarget, headers]);
            },
            Post(path = "", body, connectionTarget = "primary", headers) {
                return invoke("powerplatform", "request", [category, "POST", path, body, connectionTarget, headers]);
            },
            Put(path = "", body, connectionTarget = "primary", headers) {
                return invoke("powerplatform", "request", [category, "PUT", path, body, connectionTarget, headers]);
            },
            Patch(path = "", body, connectionTarget = "primary", headers) {
                return invoke("powerplatform", "request", [category, "PATCH", path, body, connectionTarget, headers]);
            },
            Delete(path = "", connectionTarget = "primary", headers, body) {
                return invoke("powerplatform", "request", [category, "DELETE", path, body, connectionTarget, headers]);
            },
        };
    }

    const powerplatformAPI = POWER_PLATFORM_CATEGORIES.reduce((acc, category) => {
        acc[category] = buildPowerPlatformCategoryClient(category);
        return acc;
    }, {});

    const dataverseAPI = {
        create(entityLogicalName, record, connectionTarget = "primary") {
            return invoke("dataverse", "create", [entityLogicalName, record, connectionTarget]);
        },
        retrieve(entityLogicalName, id, columns, connectionTarget = "primary") {
            return invoke("dataverse", "retrieve", [entityLogicalName, id, columns, connectionTarget]);
        },
        update(entityLogicalName, id, record, connectionTarget = "primary") {
            return invoke("dataverse", "update", [entityLogicalName, id, record, connectionTarget]);
        },
        delete(entityLogicalName, id, connectionTarget = "primary") {
            return invoke("dataverse", "delete", [entityLogicalName, id, connectionTarget]);
        },
        retrieveMultiple(fetchXml, connectionTarget = "primary") {
            return invoke("dataverse", "retrieveMultiple", [fetchXml, connectionTarget]);
        },
        execute(request, connectionTarget = "primary") {
            return invoke("dataverse", "execute", [request, connectionTarget]);
        },
        fetchXmlQuery(fetchXml, connectionTarget = "primary") {
            return invoke("dataverse", "fetchXmlQuery", [fetchXml, connectionTarget]);
        },
        getEntityMetadata(entityLogicalName, searchByLogicalName, entityProperties, connectionTarget = "primary") {
            return invoke("dataverse", "getEntityMetadata", [entityLogicalName, searchByLogicalName, entityProperties, connectionTarget]);
        },
        getAllEntitiesMetadata(entityProperties, connectionTarget = "primary") {
            return invoke("dataverse", "getAllEntitiesMetadata", [entityProperties, connectionTarget]);
        },
        getEntityRelatedMetadata(entityLogicalName, relatedPath, entityProperties, connectionTarget = "primary") {
            return invoke("dataverse", "getEntityRelatedMetadata", [entityLogicalName, relatedPath, entityProperties, connectionTarget]);
        },
        getSolutions(selectColumns, connectionTarget = "primary") {
            return invoke("dataverse", "getSolutions", [selectColumns, connectionTarget]);
        },
        getCSDLDocument(connectionTarget = "primary") {
            return invoke("dataverse", "getCSDLDocument", [connectionTarget]);
        },
        queryData(odataQuery, connectionTarget = "primary") {
            return invoke("dataverse", "queryData", [odataQuery, connectionTarget]);
        },
        publishCustomizations(tableLogicalName, connectionTarget = "primary") {
            return invoke("dataverse", "publishCustomizations", [tableLogicalName, connectionTarget]);
        },
        createMultiple(entityLogicalName, records, connectionTarget = "primary") {
            return invoke("dataverse", "createMultiple", [entityLogicalName, records, connectionTarget]);
        },
        updateMultiple(entityLogicalName, records, connectionTarget = "primary") {
            return invoke("dataverse", "updateMultiple", [entityLogicalName, records, connectionTarget]);
        },
        getEntitySetName(entityLogicalName, connectionTarget = "primary") {
            return invoke("dataverse", "getEntitySetName", [entityLogicalName, connectionTarget]);
        },
        associate(primaryEntityName, primaryEntityId, relationshipName, relatedEntityName, relatedEntityId, connectionTarget = "primary") {
            return invoke("dataverse", "associate", [primaryEntityName, primaryEntityId, relationshipName, relatedEntityName, relatedEntityId, connectionTarget]);
        },
        disassociate(primaryEntityName, primaryEntityId, relationshipName, relatedEntityId, connectionTarget = "primary") {
            return invoke("dataverse", "disassociate", [primaryEntityName, primaryEntityId, relationshipName, relatedEntityId, connectionTarget]);
        },
        deploySolution(base64SolutionContent, options, connectionTarget = "primary") {
            return invoke("dataverse", "deploySolution", [base64SolutionContent, options, connectionTarget]);
        },
        getImportJobStatus(importJobId, connectionTarget = "primary") {
            return invoke("dataverse", "getImportJobStatus", [importJobId, connectionTarget]);
        },
        buildLabel(text, languageCode = 1033) {
            return invoke("dataverse", "buildLabel", [text, languageCode]);
        },
        getAttributeODataType(attributeType) {
            return invoke("dataverse", "getAttributeODataType", [attributeType]);
        },
        createEntityDefinition(entityDefinition, options, connectionTarget = "primary") {
            return invoke("dataverse", "createEntityDefinition", [entityDefinition, options, connectionTarget]);
        },
        updateEntityDefinition(entityIdentifier, entityDefinition, options, connectionTarget = "primary") {
            return invoke("dataverse", "updateEntityDefinition", [entityIdentifier, entityDefinition, options, connectionTarget]);
        },
        deleteEntityDefinition(entityIdentifier, connectionTarget = "primary") {
            return invoke("dataverse", "deleteEntityDefinition", [entityIdentifier, connectionTarget]);
        },
        createAttribute(entityLogicalName, attributeDefinition, options, connectionTarget = "primary") {
            return invoke("dataverse", "createAttribute", [entityLogicalName, attributeDefinition, options, connectionTarget]);
        },
        updateAttribute(entityLogicalName, attributeIdentifier, attributeDefinition, options, connectionTarget = "primary") {
            return invoke("dataverse", "updateAttribute", [entityLogicalName, attributeIdentifier, attributeDefinition, options, connectionTarget]);
        },
        deleteAttribute(entityLogicalName, attributeIdentifier, connectionTarget = "primary") {
            return invoke("dataverse", "deleteAttribute", [entityLogicalName, attributeIdentifier, connectionTarget]);
        },
        createPolymorphicLookupAttribute(entityLogicalName, attributeDefinition, options, connectionTarget = "primary") {
            return invoke("dataverse", "createPolymorphicLookupAttribute", [entityLogicalName, attributeDefinition, options, connectionTarget]);
        },
        createRelationship(relationshipDefinition, options, connectionTarget = "primary") {
            return invoke("dataverse", "createRelationship", [relationshipDefinition, options, connectionTarget]);
        },
        updateRelationship(relationshipIdentifier, relationshipDefinition, options, connectionTarget = "primary") {
            return invoke("dataverse", "updateRelationship", [relationshipIdentifier, relationshipDefinition, options, connectionTarget]);
        },
        deleteRelationship(relationshipIdentifier, connectionTarget = "primary") {
            return invoke("dataverse", "deleteRelationship", [relationshipIdentifier, connectionTarget]);
        },
        createGlobalOptionSet(optionSetDefinition, options, connectionTarget = "primary") {
            return invoke("dataverse", "createGlobalOptionSet", [optionSetDefinition, options, connectionTarget]);
        },
        updateGlobalOptionSet(optionSetIdentifier, optionSetDefinition, options, connectionTarget = "primary") {
            return invoke("dataverse", "updateGlobalOptionSet", [optionSetIdentifier, optionSetDefinition, options, connectionTarget]);
        },
        deleteGlobalOptionSet(optionSetIdentifier, connectionTarget = "primary") {
            return invoke("dataverse", "deleteGlobalOptionSet", [optionSetIdentifier, connectionTarget]);
        },
        insertOptionValue(params, connectionTarget = "primary") {
            return invoke("dataverse", "insertOptionValue", [params, connectionTarget]);
        },
        updateOptionValue(params, connectionTarget = "primary") {
            return invoke("dataverse", "updateOptionValue", [params, connectionTarget]);
        },
        deleteOptionValue(params, connectionTarget = "primary") {
            return invoke("dataverse", "deleteOptionValue", [params, connectionTarget]);
        },
        orderOption(params, connectionTarget = "primary") {
            return invoke("dataverse", "orderOption", [params, connectionTarget]);
        },
    };

    const toolboxAPI = {
        getToolContext() {
            return invoke("toolbox", "getToolContext", []);
        },

        connections: {
            getActiveConnection() {
                return invoke("connections", "getActiveConnection", []);
            },
            getSecondaryConnection() {
                return invoke("connections", "getSecondaryConnection", []);
            },
        },

        dataverse: dataverseAPI,

        utils: {
            showNotification(options) {
                return invoke("utils", "showNotification", [options]);
            },
            openInConnectionBrowser(url, connectionTarget = "primary") {
                return invoke("utils", "openInConnectionBrowser", [url, connectionTarget]);
            },
            copyToClipboard(text) {
                return invoke("utils", "copyToClipboard", [text]);
            },
            getCurrentTheme() {
                return invoke("utils", "getCurrentTheme", []);
            },
            executeParallel() {
                const operations = Array.from(arguments);
                const promises = operations.map((operation) => (typeof operation === "function" ? operation() : operation));
                return Promise.all(promises);
            },
        },

        fileSystem: {
            readText(path) {
                return invoke("fileSystem", "readText", [path]);
            },
            readBinary(path) {
                return invoke("fileSystem", "readBinary", [path]);
            },
            exists(path) {
                return invoke("fileSystem", "exists", [path]);
            },
            stat(path) {
                return invoke("fileSystem", "stat", [path]);
            },
            readDirectory(path) {
                return invoke("fileSystem", "readDirectory", [path]);
            },
            writeText(path, content) {
                return invoke("fileSystem", "writeText", [path, content]);
            },
            createDirectory(path) {
                return invoke("fileSystem", "createDirectory", [path]);
            },
            saveFile(defaultPath, content, filters) {
                return invoke("fileSystem", "saveFile", [defaultPath, content, filters]);
            },
            selectPath(options) {
                return invoke("fileSystem", "selectPath", [options]);
            },
        },

        terminal: {
            create(options) {
                return invoke("terminal", "create", [options]);
            },
            execute(terminalId, command) {
                return invoke("terminal", "execute", [terminalId, command]);
            },
            close(terminalId) {
                return invoke("terminal", "close", [terminalId]);
            },
            get(terminalId) {
                return invoke("terminal", "get", [terminalId]);
            },
            list() {
                return invoke("terminal", "list", []);
            },
            setVisibility(terminalId, visible) {
                return invoke("terminal", "setVisibility", [terminalId, visible]);
            },
        },

        events: {
            on(callback) {
                return addEventListener(callback);
            },
            off(callback) {
                eventListeners.delete(callback);
            },
            getHistory(limit) {
                return invoke("events", "getHistory", [limit]);
            },
        },

        settings: {
            getAll() {
                return invoke("settings", "getAll", []);
            },
            get(key) {
                return invoke("settings", "get", [key]);
            },
            set(key, value) {
                return invoke("settings", "set", [key, value]);
            },
            setAll(settings) {
                return invoke("settings", "setAll", [settings]);
            },
        },

        invocation: {
            getLaunchContext() {
                return invoke("invocation", "getLaunchContext", []);
            },
            returnData(returnData) {
                return invoke("invocation", "returnData", [returnData]);
            },
            launchTool(targetToolId, prefillData, options) {
                return invoke("invocation", "launchTool", [targetToolId, prefillData, options]);
            },
            findToolsByCapability(tag) {
                return invoke("invocation", "findToolsByCapability", [tag]);
            },
            getKnownCapabilityTags() {
                return invoke("invocation", "getKnownCapabilityTags", []);
            },
        },

        powerplatform: powerplatformAPI,
    };

    function handleResponseMessage(message) {
        const pending = pendingRequests.get(message.requestId);
        if (!pending) {
            return;
        }

        pendingRequests.delete(message.requestId);

        if (message.success) {
            pending.resolve(message.data);
            return;
        }

        pending.reject(new Error(message.error || "Unknown toolboxAPI error"));
    }

    function handleEventMessage(message) {
        const payload = message.payload;
        eventListeners.forEach((callback) => {
            try {
                callback(message.event, payload);
            } catch {
                // Ignore individual listener errors.
            }
        });
    }

    function handleContextMessage(message) {
        cachedContext = message.context;
        window.TOOLBOX_CONTEXT = cachedContext;
    }

    window.addEventListener("message", (event) => {
        if (event.origin !== targetOrigin) {
            return;
        }

        const message = event.data;
        if (!message || typeof message !== "object" || message.source !== "pptb-host") {
            return;
        }

        if (message.type === CHANNEL_RESPONSE) {
            handleResponseMessage(message);
            return;
        }

        if (message.type === CHANNEL_EVENT) {
            handleEventMessage(message);
            return;
        }

        if (message.type === "pptb:context") {
            handleContextMessage(message);
        }
    });

    window.toolboxAPI = toolboxAPI;
    window.dataverseAPI = dataverseAPI;
    window.powerplatformAPI = powerplatformAPI;
    window.TOOLBOX_CONTEXT = cachedContext;
})();
