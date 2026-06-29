import axios, { AxiosInstance, AxiosRequestConfig } from "axios";
import { DATAVERSE_API_VERSION } from "../constants";
import type { Connection } from "./connectionsManager";
import type { AuthManager } from "./authManager";

// ── Local type definitions mirroring DataverseAPI types ───────────────────────

export interface CreateResult {
    id: string;
    [key: string]: unknown;
}

export interface LocalizedLabel {
    "@odata.type"?: string;
    Label: string;
    LanguageCode: number;
}

export interface Label {
    "@odata.type"?: string;
    LocalizedLabels: LocalizedLabel[];
    UserLocalizedLabel?: LocalizedLabel;
}

export interface EntityMetadata {
    MetadataId: string;
    LogicalName: string;
    DisplayName?: {
        LocalizedLabels: Array<{ Label: string; LanguageCode: number }>;
    };
    [key: string]: unknown;
}

export interface EntityMetadataCollection {
    value: EntityMetadata[];
}

export interface FetchXmlResult {
    value: Record<string, unknown>[];
    "@odata.context"?: string;
    "@Microsoft.Dynamics.CRM.fetchxmlpagingcookie"?: string;
}

export interface ExecuteRequest {
    operationName: string;
    operationType: "action" | "function";
    entityName?: string;
    entityId?: string;
    parameters?: Record<string, unknown>;
}

export interface MetadataOperationOptions {
    solutionUniqueName?: string;
    mergeLabels?: boolean;
    consistencyStrong?: boolean;
}

export type SolutionContentInput = string | ArrayBuffer | ArrayBufferView;

export type EntityRelatedMetadataPath = string;

/**
 * Makes Dataverse Web API calls using axios.
 * Automatically handles 401 responses by refreshing the token once.
 */
export class DataverseManager {
    private readonly authManager: AuthManager;

    constructor(authManager: AuthManager) {
        this.authManager = authManager;
    }

    private buildClient(connection: Connection, token: string): AxiosInstance {
        const baseURL = `${connection.url}/api/data/${DATAVERSE_API_VERSION}/`;
        return axios.create({
            baseURL,
            headers: {
                Authorization: ["Bearer", token].join(" "),
                "OData-MaxVersion": "4.0",
                "OData-Version": "4.0",
                Accept: "application/json",
                "Content-Type": "application/json; charset=utf-8",
            },
        });
    }

    /**
     * Execute an HTTP request with automatic 401 retry (token refresh).
     */
    private async request<T>(connection: Connection, config: AxiosRequestConfig): Promise<T> {
        let token = await this.authManager.acquireToken(connection);
        const client = this.buildClient(connection, token);
        try {
            const response = await client.request<T>(config);
            return response.data;
        } catch (err: unknown) {
            if (axios.isAxiosError(err) && err.response?.status === 401) {
                // Retry once with a fresh token
                token = await this.authManager.refreshToken(connection);
                const retryClient = this.buildClient(connection, token);
                const retryResponse = await retryClient.request<T>(config);
                return retryResponse.data;
            }
            throw err;
        }
    }

    // ---------------------------------------------------------------------------
    // Basic CRUD
    // ---------------------------------------------------------------------------

    async create(connection: Connection, entityLogicalName: string, record: Record<string, unknown>): Promise<CreateResult> {
        const entitySetName = await this.getEntitySetName(connection, entityLogicalName);
        const response = await this.request<Record<string, unknown>>(connection, {
            method: "POST",
            url: entitySetName,
            data: record,
            headers: { Prefer: "return=representation" },
        });
        return { id: response[`${entityLogicalName}id`] as string, ...response };
    }

    async retrieve(connection: Connection, entityLogicalName: string, id: string, columns?: string[]): Promise<Record<string, unknown>> {
        const entitySetName = await this.getEntitySetName(connection, entityLogicalName);
        let url = `${entitySetName}(${id})`;
        if (columns?.length) {
            url += `?$select=${columns.join(",")}`;
        }
        return this.request<Record<string, unknown>>(connection, {
            method: "GET",
            url,
        });
    }

    async update(connection: Connection, entityLogicalName: string, id: string, record: Record<string, unknown>): Promise<void> {
        const entitySetName = await this.getEntitySetName(connection, entityLogicalName);
        await this.request<void>(connection, {
            method: "PATCH",
            url: `${entitySetName}(${id})`,
            data: record,
        });
    }

    async delete(connection: Connection, entityLogicalName: string, id: string): Promise<void> {
        const entitySetName = await this.getEntitySetName(connection, entityLogicalName);
        await this.request<void>(connection, {
            method: "DELETE",
            url: `${entitySetName}(${id})`,
        });
    }

    // ---------------------------------------------------------------------------
    // Query
    // ---------------------------------------------------------------------------

    async retrieveMultiple(connection: Connection, fetchXml: string): Promise<FetchXmlResult> {
        return this.fetchXmlQuery(connection, fetchXml);
    }

    async fetchXmlQuery(connection: Connection, fetchXml: string): Promise<FetchXmlResult> {
        const encoded = encodeURIComponent(fetchXml);
        // Extract entity from fetchXml entity attribute
        const match = fetchXml.match(/entity\s+name=['"]([^'"]+)['"]/);
        if (!match) {
            throw new Error("Could not extract entity name from FetchXML");
        }
        const entityLogicalName = match[1];
        const entitySetName = await this.getEntitySetName(connection, entityLogicalName);
        return this.request<FetchXmlResult>(connection, {
            method: "GET",
            url: `${entitySetName}?fetchXml=${encoded}`,
        });
    }

    async queryData(connection: Connection, odataQuery: string): Promise<Record<string, unknown>> {
        return this.request<Record<string, unknown>>(connection, {
            method: "GET",
            url: odataQuery,
        });
    }

    // ---------------------------------------------------------------------------
    // Execute
    // ---------------------------------------------------------------------------

    async execute(connection: Connection, request: ExecuteRequest): Promise<Record<string, unknown>> {
        const { operationName, operationType, entityName, entityId, parameters } = request;

        if (operationType === "function") {
            let url = operationName;
            if (entityName && entityId) {
                const entitySetName = await this.getEntitySetName(connection, entityName);
                url = `${entitySetName}(${entityId})/Microsoft.Dynamics.CRM.${operationName}`;
            }
            if (parameters && Object.keys(parameters).length > 0) {
                const paramStrings = Object.entries(parameters).map(([k]) => `${k}=@${k}`);
                const valueStrings = Object.entries(parameters).map(([k, v]) => {
                    if (typeof v === "string") {
                        return `@${k}='${v}'`;
                    }
                    return `@${k}=${JSON.stringify(v)}`;
                });
                url += `(${paramStrings.join(",")})?${valueStrings.join("&")}`;
            } else {
                url += "()";
            }
            return this.request<Record<string, unknown>>(connection, {
                method: "GET",
                url,
            });
        } else {
            // Action (POST)
            let url = operationName;
            if (entityName && entityId) {
                const entitySetName = await this.getEntitySetName(connection, entityName);
                url = `${entitySetName}(${entityId})/Microsoft.Dynamics.CRM.${operationName}`;
            }
            return this.request<Record<string, unknown>>(connection, {
                method: "POST",
                url,
                data: parameters ?? {},
            });
        }
    }

    // ---------------------------------------------------------------------------
    // Metadata
    // ---------------------------------------------------------------------------

    async getEntityMetadata(connection: Connection, entityLogicalName: string, searchByLogicalName: boolean, selectColumns?: string[]): Promise<EntityMetadata> {
        let url: string;
        if (searchByLogicalName) {
            url = `EntityDefinitions(LogicalName='${entityLogicalName}')`;
        } else {
            url = `EntityDefinitions(${entityLogicalName})`;
        }
        if (selectColumns?.length) {
            url += `?$select=${selectColumns.join(",")}`;
        }
        return this.request<EntityMetadata>(connection, { method: "GET", url });
    }

    async getAllEntitiesMetadata(connection: Connection, selectColumns?: string[]): Promise<EntityMetadataCollection> {
        let url = "EntityDefinitions";
        if (selectColumns?.length) {
            url += `?$select=${selectColumns.join(",")}`;
        }
        return this.request<EntityMetadataCollection>(connection, {
            method: "GET",
            url,
        });
    }

    async getEntityRelatedMetadata(connection: Connection, entityLogicalName: string, relatedPath: string, selectColumns?: string[]): Promise<Record<string, unknown>> {
        let url = `EntityDefinitions(LogicalName='${entityLogicalName}')/${relatedPath}`;
        if (selectColumns?.length) {
            url += `?$select=${selectColumns.join(",")}`;
        }
        return this.request<Record<string, unknown>>(connection, {
            method: "GET",
            url,
        });
    }

    // ---------------------------------------------------------------------------
    // Solutions
    // ---------------------------------------------------------------------------

    async getSolutions(connection: Connection, selectColumns: string[]): Promise<Record<string, unknown>> {
        const select = selectColumns.length ? `?$select=${selectColumns.join(",")}` : "";
        return this.request<Record<string, unknown>>(connection, {
            method: "GET",
            url: `solutions${select}`,
        });
    }

    async getCSDLDocument(connection: Connection): Promise<string> {
        return this.request<string>(connection, {
            method: "GET",
            url: "$metadata",
            headers: { Accept: "application/xml" },
        });
    }

    async publishCustomizations(connection: Connection, tableLogicalName?: string): Promise<void> {
        const body = tableLogicalName
            ? {
                  ParameterXml: `<importexportxml><entities><entity>${tableLogicalName}</entity></entities></importexportxml>`,
              }
            : {
                  ParameterXml: "<importexportxml></importexportxml>",
              };
        await this.request<void>(connection, {
            method: "POST",
            url: "PublishAllXml",
            data: body,
        });
    }

    // ---------------------------------------------------------------------------
    // Bulk operations
    // ---------------------------------------------------------------------------

    async createMultiple(connection: Connection, entityLogicalName: string, records: Record<string, unknown>[]): Promise<CreateResult[]> {
        const results: CreateResult[] = [];
        for (const record of records) {
            results.push(await this.create(connection, entityLogicalName, record));
        }
        return results;
    }

    async updateMultiple(connection: Connection, entityLogicalName: string, records: Array<Record<string, unknown> & { id: string }>): Promise<void> {
        for (const record of records) {
            const { id, ...fields } = record;
            await this.update(connection, entityLogicalName, id, fields);
        }
    }

    // ---------------------------------------------------------------------------
    // Entity set name
    // ---------------------------------------------------------------------------

    async getEntitySetName(connection: Connection, entityLogicalName: string): Promise<string> {
        const metadata = await this.getEntityMetadata(connection, entityLogicalName, true, ["EntitySetName"]);
        return (metadata as Record<string, unknown>)["EntitySetName"] as string;
    }

    // ---------------------------------------------------------------------------
    // Relationships
    // ---------------------------------------------------------------------------

    async associate(connection: Connection, primaryEntityName: string, primaryEntityId: string, relationshipName: string, relatedEntityName: string, relatedEntityId: string): Promise<void> {
        const primarySetName = await this.getEntitySetName(connection, primaryEntityName);
        const relatedSetName = await this.getEntitySetName(connection, relatedEntityName);
        const baseURL = `${connection.url}/api/data/${DATAVERSE_API_VERSION}/`;
        const associateUrl = `${primarySetName}(${primaryEntityId})/${relationshipName}/$ref`;
        await this.request<void>(connection, {
            method: "POST",
            url: associateUrl,
            data: {
                "@odata.id": `${baseURL}${relatedSetName}(${relatedEntityId})`,
            },
        });
    }

    async disassociate(connection: Connection, primaryEntityName: string, primaryEntityId: string, relationshipName: string, relatedEntityId: string): Promise<void> {
        const primarySetName = await this.getEntitySetName(connection, primaryEntityName);
        const url = `${primarySetName}(${primaryEntityId})/${relationshipName}(${relatedEntityId})/$ref`;
        await this.request<void>(connection, {
            method: "DELETE",
            url,
        });
    }

    // ---------------------------------------------------------------------------
    // Solution deployment
    // ---------------------------------------------------------------------------

    async deploySolution(
        connection: Connection,
        base64SolutionContent: SolutionContentInput,
        options?: {
            publishWorkflows?: boolean;
            overwriteUnmanagedCustomizations?: boolean;
        },
    ): Promise<Record<string, unknown>> {
        let content: string;
        if (typeof base64SolutionContent === "string") {
            content = base64SolutionContent;
        } else {
            const buffer = Buffer.from(base64SolutionContent as ArrayBuffer);
            content = buffer.toString("base64");
        }
        return this.request<Record<string, unknown>>(connection, {
            method: "POST",
            url: "ImportSolution",
            data: {
                CustomizationFile: content,
                PublishWorkflows: options?.publishWorkflows ?? false,
                OverwriteUnmanagedCustomizations: options?.overwriteUnmanagedCustomizations ?? false,
            },
        });
    }

    async getImportJobStatus(connection: Connection, importJobId: string): Promise<Record<string, unknown>> {
        return this.request<Record<string, unknown>>(connection, {
            method: "GET",
            url: `importjobs(${importJobId})`,
        });
    }

    // ---------------------------------------------------------------------------
    // Metadata helpers
    // ---------------------------------------------------------------------------

    buildLabel(text: string, languageCode = 1033): Label {
        const localizedLabel: LocalizedLabel = {
            "@odata.type": "Microsoft.Dynamics.CRM.LocalizedLabel",
            Label: text,
            LanguageCode: languageCode,
        };
        return {
            "@odata.type": "Microsoft.Dynamics.CRM.Label",
            LocalizedLabels: [localizedLabel],
        };
    }

    getAttributeODataType(attributeType: string): string {
        return `Microsoft.Dynamics.CRM.${attributeType}AttributeMetadata`;
    }

    // ---------------------------------------------------------------------------
    // Entity definition CRUD
    // ---------------------------------------------------------------------------

    async createEntityDefinition(connection: Connection, entityDefinition: Record<string, unknown>, options?: MetadataOperationOptions): Promise<Record<string, unknown>> {
        const headers = this.buildMetadataHeaders(options);
        return this.request<Record<string, unknown>>(connection, {
            method: "POST",
            url: "EntityDefinitions",
            data: entityDefinition,
            headers,
        });
    }

    async updateEntityDefinition(connection: Connection, entityIdentifier: string, entityDefinition: Record<string, unknown>, options?: MetadataOperationOptions): Promise<Record<string, unknown>> {
        const headers = this.buildMetadataHeaders(options);
        return this.request<Record<string, unknown>>(connection, {
            method: "PUT",
            url: `EntityDefinitions(${entityIdentifier})`,
            data: entityDefinition,
            headers,
        });
    }

    async deleteEntityDefinition(connection: Connection, entityIdentifier: string): Promise<void> {
        await this.request<void>(connection, {
            method: "DELETE",
            url: `EntityDefinitions(${entityIdentifier})`,
        });
    }

    // ---------------------------------------------------------------------------
    // Attribute CRUD
    // ---------------------------------------------------------------------------

    async createAttribute(connection: Connection, entityLogicalName: string, attributeDefinition: Record<string, unknown>, options?: MetadataOperationOptions): Promise<Record<string, unknown>> {
        const headers = this.buildMetadataHeaders(options);
        return this.request<Record<string, unknown>>(connection, {
            method: "POST",
            url: `EntityDefinitions(LogicalName='${entityLogicalName}')/Attributes`,
            data: attributeDefinition,
            headers,
        });
    }

    async updateAttribute(
        connection: Connection,
        entityLogicalName: string,
        attributeIdentifier: string,
        attributeDefinition: Record<string, unknown>,
        options?: MetadataOperationOptions,
    ): Promise<Record<string, unknown>> {
        const headers = this.buildMetadataHeaders(options);
        return this.request<Record<string, unknown>>(connection, {
            method: "PUT",
            url: `EntityDefinitions(LogicalName='${entityLogicalName}')/Attributes(${attributeIdentifier})`,
            data: attributeDefinition,
            headers,
        });
    }

    async deleteAttribute(connection: Connection, entityLogicalName: string, attributeIdentifier: string): Promise<void> {
        await this.request<void>(connection, {
            method: "DELETE",
            url: `EntityDefinitions(LogicalName='${entityLogicalName}')/Attributes(${attributeIdentifier})`,
        });
    }

    async createPolymorphicLookupAttribute(
        connection: Connection,
        entityLogicalName: string,
        attributeDefinition: Record<string, unknown>,
        options?: MetadataOperationOptions,
    ): Promise<Record<string, unknown>> {
        const headers = this.buildMetadataHeaders(options);
        return this.request<Record<string, unknown>>(connection, {
            method: "POST",
            url: `EntityDefinitions(LogicalName='${entityLogicalName}')/Attributes/Microsoft.Dynamics.CRM.CreatePolymorphicLookupAttribute`,
            data: attributeDefinition,
            headers,
        });
    }

    // ---------------------------------------------------------------------------
    // Relationship CRUD
    // ---------------------------------------------------------------------------

    async createRelationship(connection: Connection, relationshipDefinition: Record<string, unknown>, options?: MetadataOperationOptions): Promise<Record<string, unknown>> {
        const headers = this.buildMetadataHeaders(options);
        return this.request<Record<string, unknown>>(connection, {
            method: "POST",
            url: "RelationshipDefinitions",
            data: relationshipDefinition,
            headers,
        });
    }

    async updateRelationship(
        connection: Connection,
        relationshipIdentifier: string,
        relationshipDefinition: Record<string, unknown>,
        options?: MetadataOperationOptions,
    ): Promise<Record<string, unknown>> {
        const headers = this.buildMetadataHeaders(options);
        return this.request<Record<string, unknown>>(connection, {
            method: "PUT",
            url: `RelationshipDefinitions(${relationshipIdentifier})`,
            data: relationshipDefinition,
            headers,
        });
    }

    async deleteRelationship(connection: Connection, relationshipIdentifier: string): Promise<void> {
        await this.request<void>(connection, {
            method: "DELETE",
            url: `RelationshipDefinitions(${relationshipIdentifier})`,
        });
    }

    // ---------------------------------------------------------------------------
    // Global Option Sets
    // ---------------------------------------------------------------------------

    async createGlobalOptionSet(connection: Connection, optionSetDefinition: Record<string, unknown>, options?: MetadataOperationOptions): Promise<Record<string, unknown>> {
        const headers = this.buildMetadataHeaders(options);
        return this.request<Record<string, unknown>>(connection, {
            method: "POST",
            url: "GlobalOptionSetDefinitions",
            data: optionSetDefinition,
            headers,
        });
    }

    async updateGlobalOptionSet(
        connection: Connection,
        optionSetIdentifier: string,
        optionSetDefinition: Record<string, unknown>,
        options?: MetadataOperationOptions,
    ): Promise<Record<string, unknown>> {
        const headers = this.buildMetadataHeaders(options);
        return this.request<Record<string, unknown>>(connection, {
            method: "PUT",
            url: `GlobalOptionSetDefinitions(${optionSetIdentifier})`,
            data: optionSetDefinition,
            headers,
        });
    }

    async deleteGlobalOptionSet(connection: Connection, optionSetIdentifier: string): Promise<void> {
        await this.request<void>(connection, {
            method: "DELETE",
            url: `GlobalOptionSetDefinitions(${optionSetIdentifier})`,
        });
    }

    // ---------------------------------------------------------------------------
    // Option values
    // ---------------------------------------------------------------------------

    async insertOptionValue(connection: Connection, params: Record<string, unknown>): Promise<Record<string, unknown>> {
        return this.request<Record<string, unknown>>(connection, {
            method: "POST",
            url: "InsertOptionValue",
            data: params,
        });
    }

    async updateOptionValue(connection: Connection, params: Record<string, unknown>): Promise<Record<string, unknown>> {
        return this.request<Record<string, unknown>>(connection, {
            method: "POST",
            url: "UpdateOptionValue",
            data: params,
        });
    }

    async deleteOptionValue(connection: Connection, params: Record<string, unknown>): Promise<Record<string, unknown>> {
        return this.request<Record<string, unknown>>(connection, {
            method: "POST",
            url: "DeleteOptionValue",
            data: params,
        });
    }

    async orderOption(connection: Connection, params: Record<string, unknown>): Promise<Record<string, unknown>> {
        return this.request<Record<string, unknown>>(connection, {
            method: "POST",
            url: "OrderOption",
            data: params,
        });
    }

    // ---------------------------------------------------------------------------
    // Private helpers
    // ---------------------------------------------------------------------------

    private buildMetadataHeaders(options?: MetadataOperationOptions): Record<string, string> {
        const headers: Record<string, string> = {};
        if (options?.solutionUniqueName) {
            headers["MSCRM.SolutionUniqueName"] = options.solutionUniqueName;
        }
        if (options?.mergeLabels !== false) {
            headers["MSCRM.MergeLabels"] = "true";
        }
        if (options?.consistencyStrong) {
            headers["Consistency"] = "Strong";
        }
        return headers;
    }
}
