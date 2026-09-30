import { HttpClient } from "./http-client.js";
import { fileTypeFromBuffer } from "file-type";

// --- Response types (only fields used by formatters) ---

export interface CbReference {
  id: number;
  name: string;
  type?: string;
}

export interface CbProject {
  id: number;
  name: string;
  keyName?: string;
  description?: string;
  category?: string;
  closed?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface CbTracker {
  id: number;
  name: string;
  type?: CbReference;
  project?: CbReference;
  description?: string;
  keyName?: string;
  folderPath?: string;
  color?: string;
  status?: CbReference;
}

export interface CbTrackerConfiguration {
  basicInformation?: { color?: string };
  fields?: Array<{
    referenceId: number;
    choiceOptionSetting?: {
      choiceOptions?: Array<{ id: number; name: string; color?: string }>;
    };
  }>;
}

export interface CbTrackerTree {
  isFolder?: boolean;
  text?: string;
  trackerId?: number;
  children?: CbTrackerTree[];
}

export interface CbTrackerField {
  fieldId: number;
  name: string;
  type?: string;
  required?: boolean;
  hidden?: boolean;
}

export interface CbTrackerSchemaOption {
  id: number;
  name: string;
}

export interface CbTrackerSchemaField {
  id: number;
  name: string;
  type?: string;
  trackerItemField?: string;
  legacyRestName?: string;
  options?: CbTrackerSchemaOption[];
}

export interface CbTestStep {
  index?: number;
  actionDescription?: string;
  expectedResults?: string;
}

export interface CbItem {
  id: number;
  name: string;
  typeName?: string;
  description?: string | { markup?: string; value?: string };
  descriptionFormat?: string;
  tracker?: CbReference;
  parent?: CbReference;
  project?: CbReference;
  status?: CbReference;
  priority?: CbReference;
  assignedTo?: CbReference[];
  categories?: CbReference[];
  createdAt?: string;
  updatedAt?: string;
  submittedAt?: string;
  createdBy?: CbReference;
  modifiedBy?: CbReference;
  storyPoints?: number;
  customFields?: Array<{ fieldId: number; name: string; type?: string; value?: unknown; values?: unknown[] }>;
}

export interface CbRelation {
  id: number;
  type?: CbReference;
  itemRevision?: { id: number; name: string; version?: number };
}

export interface CbItemRelationsPage {
  outgoingAssociations?: CbRelation[];
  incomingAssociations?: CbRelation[];
  upstreamReferences?: CbRelation[];
  downstreamReferences?: CbRelation[];
}

export interface CbComment {
  id: number;
  comment?: string;
  commentFormat?: string;
  createdAt?: string;
  createdBy?: CbReference;
}

export interface CbAttachment {
  id: number;
  name?: string;
  fileSize?: number;
  size?: number;
  sha512?: string;
  mimeType?: string;
}

export interface CbUser {
  id: number;
  name: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  status?: string;
  registryDate?: string;
}

export interface CbTrackerItemReviewConfig {
  requiredApprovals?: number;
  requiredRejections?: number;
  requiredSignature?: "NONE" | "PASSWORD" | "USERNAME_AND_PASSWORD";
  roleRequired?: boolean;
}

export interface CbTrackerItemReviewVote {
  user?: CbReference;
  asRole?: CbReference;
  decision?: "APPROVED" | "REJECTED" | "UNDECIDED";
  reviewedAt?: string;
}

export interface CbTrackerItemReview {
  config?: CbTrackerItemReviewConfig;
  result?: "APPROVED" | "REJECTED" | "UNDECIDED";
  reviewers?: CbTrackerItemReviewVote[];
  trackerItem?: { id: number; name: string; version?: number };
}

// --- Request types for write operations ---

export interface CbCreateItemRequest {
  name: string;
  description?: string;
  categories?: Array<{ id: number; type: string }>;
  status?: { id: number };
  priority?: { id: number };
  assignedTo?: Array<{ id: number }>;
  storyPoints?: number;
  customFields?: Array<{ fieldId: number; type: string; value: unknown }>;
}

export interface CbUpdateItemRequest {
  name?: string;
  description?: string;
  status?: { id: number; type?: string };
  priority?: { id: number };
  assignedTo?: Array<{ id: number }>;
  storyPoints?: number;
  customFields?: Array<{ fieldId: number; type: string; values?: Array<{ id: number; type: string }>; value?: unknown }>;
}

export interface CbEditableField {
  fieldId: number;
  name: string;
  values?: Array<{ id: number; name?: string; type?: string }>;
  value?: unknown;
  type?: string;
}

export interface CbCreateCommentRequest {
  comment: string;
  commentFormat?: string;
}

export interface CbCreateAssociationRequest {
  from: { id: number };
  to: { id: number };
  type: { id: number };
  description?: string;
}

export interface CbAssociation {
  id: number;
  from?: CbReference;
  to?: CbReference;
  type?: CbReference;
  description?: string;
}

// --- Helpers ---

// Codebeamer API returns either a plain array or a paginated object depending on the endpoint/version.
// Known keys: "items" (query endpoint), "itemRefs" (tracker items endpoint in some versions).
function toArray<T>(response: unknown): T[] {
  if (Array.isArray(response)) return response as T[];
  if (response && typeof response === "object") {
    const obj = response as Record<string, unknown>;
    if (Array.isArray(obj["items"])) return obj["items"] as T[];
    if (Array.isArray(obj["itemRefs"])) return obj["itemRefs"] as T[];
    // Generic fallback: find first array-valued key
    for (const key of Object.keys(obj)) {
      if (Array.isArray(obj[key])) {
        console.error(`[codebeamer-mcp] Using response key "${key}" instead of "items"`);
        return obj[key] as T[];
      }
    }
    console.error("[codebeamer-mcp] No array found in response:", JSON.stringify(obj).slice(0, 300));
  }
  return [];
}

// --- Client ---

export class CodebeamerClient {
  constructor(private readonly http: HttpClient) {}

  // Projects
  async listProjects(page: number, pageSize: number): Promise<CbProject[]> {
    const raw = await this.http.get<unknown>("/projects", {
      params: { page, pageSize },
      resource: "projects",
    });
    return toArray(raw);
  }

  getProject(id: number): Promise<CbProject> {
    return this.http.get(`/projects/${id}`, { resource: `project ${id}` });
  }

  // Trackers
  async listTrackers(
    projectId: number,
    page: number,
    pageSize: number,
  ): Promise<CbTracker[]> {
    const raw = await this.http.get<unknown>(`/projects/${projectId}/trackers`, {
      params: { page, pageSize },
      resource: `trackers for project ${projectId}`,
    });
    const trackers = toArray<CbTracker>(raw);
    if (trackers.length === 0) return trackers;

    const tree = await this.http.get<CbTrackerTree[]>("/trackers/tree", {
      params: { projectId },
      resource: `tracker tree for project ${projectId}`,
    });
    const folderPaths = new Map<number, string>();
    function visit(nodes: CbTrackerTree[], folders: string[]): void {
      for (const node of nodes) {
        const path = node.isFolder && node.text
          ? [...folders, node.text]
          : folders;
        if (!node.isFolder && node.trackerId !== undefined) {
          folderPaths.set(node.trackerId, path.join(" / ") || "/");
        }
        if (node.children) visit(node.children, path);
      }
    }
    visit(tree, []);

    return Promise.all(trackers.map((tracker) => this.withTrackerStatus({
      ...tracker,
      folderPath: folderPaths.get(tracker.id),
    })));
  }

  async getTracker(id: number): Promise<CbTracker> {
    const tracker = await this.http.get<CbTracker>(`/trackers/${id}`, { resource: `tracker ${id}` });
    return this.withTrackerStatus(tracker);
  }

  private async withTrackerStatus(tracker: CbTracker): Promise<CbTracker> {
    const configuration = await this.http.get<CbTrackerConfiguration>(
      `/tracker/${tracker.id}/configuration`,
      { resource: `configuration for tracker ${tracker.id}` },
    );
    const color = configuration.basicInformation?.color;
    const normalizedColor = color?.trim().toLowerCase();
    const options = configuration.fields?.find((field) => field.referenceId === 7)
      ?.choiceOptionSetting?.choiceOptions ?? [];
    const matches = normalizedColor
      ? options.filter((option) => option.color?.trim().toLowerCase() === normalizedColor)
      : [];
    const status = matches.length === 1
      ? { id: matches[0].id, name: matches[0].name }
      : undefined;
    return { ...tracker, color, status };
  }

  getTrackerFields(id: number): Promise<CbTrackerField[]> {
    return this.http.get(`/trackers/${id}/fields`, {
      resource: `fields for tracker ${id}`,
    });
  }

  getTrackerSchema(id: number): Promise<CbTrackerSchemaField[]> {
    return this.http.get(`/trackers/${id}/schema`, {
      resource: `schema for tracker ${id}`,
    });
  }

  // Items
  getItem(id: number): Promise<CbItem> {
    return this.http.get(`/items/${id}`, { resource: `item ${id}` });
  }

  async listItemAttachments(itemId: number): Promise<CbAttachment[]> {
    const item = await this.getItem(itemId);
    if (item.descriptionFormat && item.descriptionFormat !== "Wiki") return [];
    const description = typeof item.description === "string"
      ? item.description
      : item.description?.value ?? item.description?.markup ?? "";
    const references = Array.from(description.matchAll(/\[!([^!\[\]\r\n]+)!\]/g), (match) => {
      const [name, hash] = match[1].split("#", 2);
      return { name, hash };
    }).filter(({ name }) => !/[/:\\]/.test(name));
    if (references.length === 0) return [];

    const raw = await this.http.get<unknown>(`/items/${itemId}/attachments`, {
      resource: `attachments for item ${itemId}`,
    });
    return toArray<CbAttachment>(raw)
      .filter((attachment) => references.some(({ name, hash }) =>
        attachment.name === name && (!hash || (
          /^[a-f0-9]+$/i.test(hash) && attachment.sha512?.toLowerCase().startsWith(hash.toLowerCase())
        )),
      ))
      .map((attachment) => ({ ...attachment, fileSize: attachment.fileSize ?? attachment.size }));
  }

  async getItemImage(itemId: number, attachmentId: number): Promise<{
    data: string;
    mimeType: string;
  }> {
    const { data } = await this.http.getBinary(
      `/items/${itemId}/attachments/${attachmentId}/content`,
      { resource: `attachment ${attachmentId} for item ${itemId}` },
    );
    const detected = await fileTypeFromBuffer(data);
    if (!detected || !["image/png", "image/jpeg", "image/gif", "image/webp"].includes(detected.mime)) {
      throw new Error(
        "Attachment is not a supported image. Use PNG, JPEG, GIF or WebP; " +
        "export SVG or editable diagrams to one of these formats first.",
      );
    }
    return { data: data.toString("base64"), mimeType: detected.mime };
  }

  async listTrackerItems(
    trackerId: number,
    page: number,
    pageSize: number,
  ): Promise<{ items: CbItem[]; debug?: string }> {
    const raw = await this.http.get<unknown>("/items/query", {
      params: { queryString: `tracker.id IN (${trackerId})`, page, pageSize },
      resource: `items for tracker ${trackerId}`,
    });
    const items = toArray<CbItem>(raw);
    if (items.length > 0) return { items };

    // Items empty — also try the direct endpoint so we can show raw debug info
    let rawDirect: unknown;
    try {
      rawDirect = await this.http.get<unknown>(`/trackers/${trackerId}/items`, {
        params: { page, pageSize },
        resource: `items for tracker ${trackerId} (direct)`,
      });
    } catch {
      rawDirect = null;
    }
    const rawObj = raw as Record<string, unknown> | null;
    const directObj = rawDirect as Record<string, unknown> | null;
    const queryTotal = rawObj?.["total"] ?? "?";
    const directTotal = directObj?.["total"] ?? "?";
    const directItems = toArray<CbItem>(rawDirect);
    const debug =
      `API vrátilo total=${queryTotal} pro cbQL query a total=${directTotal} pro přímý endpoint.\n` +
      `Pokud je total=0, Codebeamer říká že tam žádné itemy nejsou (špatný tracker ID, chybí oprávnění nebo prázdný tracker).\n` +
      `query: ${JSON.stringify(raw).slice(0, 300)}\n` +
      `direct: ${JSON.stringify(rawDirect).slice(0, 300)}`;
    return { items: directItems, debug };
  }

  async searchItems(
    queryString: string,
    page: number,
    pageSize: number,
  ): Promise<CbItem[]> {
    const raw = await this.http.get<unknown>("/items/query", {
      params: { queryString, page, pageSize },
      resource: "item query",
    });
    return toArray(raw);
  }

  // Item reviews (Review Hub)
  async getItemReviews(id: number): Promise<CbTrackerItemReview[]> {
    const raw = await this.http.get<unknown>(`/items/${id}/reviews`, {
      resource: `reviews for item ${id}`,
    });
    return Array.isArray(raw) ? raw : [];
  }

  // Item details
  getItemRelations(id: number): Promise<CbItemRelationsPage> {
    return this.http.get(`/items/${id}/relations`, {
      resource: `relations for item ${id}`,
    });
  }

  async getItemComments(id: number): Promise<CbComment[]> {
    const raw = await this.http.get<unknown>(`/items/${id}/comments`, {
      resource: `comments for item ${id}`,
    });
    return toArray(raw);
  }

  // Users
  getUser(id: number): Promise<CbUser> {
    return this.http.get(`/users/${id}`, { resource: `user ${id}` });
  }

  // --- Write operations ---

  createItem(trackerId: number, data: CbCreateItemRequest, parentId?: number): Promise<CbItem> {
    return this.http.post(`/trackers/${trackerId}/items`, {
      params: parentId !== undefined ? { parentItemId: parentId } : undefined,
      body: data,
      resource: `create item in tracker ${trackerId}`,
    });
  }

  async updateItem(itemId: number, data: CbUpdateItemRequest): Promise<CbItem> {
    // Use the field-based endpoint so updates of individual fields (e.g. description)
    // do not trigger an unintended status transition on the full-item PUT endpoint.
    const item = await this.getItem(itemId);
    const trackerId = item.tracker?.id;
    if (!trackerId) throw new Error(`Cannot determine tracker for item ${itemId}`);

    const schema = await this.getTrackerSchema(trackerId);
    const fieldByLegacy = (legacyName: string) =>
      schema.find((f) => f.legacyRestName === legacyName);

    const fieldValues: Array<Record<string, unknown>> = [];

    if (data.name !== undefined) {
      const f = fieldByLegacy("name") ?? fieldByLegacy("summary");
      if (f) fieldValues.push({ fieldId: f.id, type: "TextFieldValue", value: data.name });
    }
    if (data.description !== undefined) {
      const f = fieldByLegacy("description");
      if (f) fieldValues.push({ fieldId: f.id, type: "WikiTextFieldValue", value: data.description });
    }
    if (data.status !== undefined) {
      const f = fieldByLegacy("status");
      if (f) fieldValues.push({
        fieldId: f.id,
        type: "ChoiceFieldValue",
        values: [{ id: data.status.id, type: "ChoiceOptionReference" }],
      });
    }
    if (data.priority !== undefined) {
      const f = fieldByLegacy("priority");
      if (f) fieldValues.push({
        fieldId: f.id,
        type: "ChoiceFieldValue",
        values: [{ id: data.priority.id, type: "ChoiceOptionReference" }],
      });
    }
    if (data.assignedTo !== undefined) {
      const f = fieldByLegacy("assignedTo");
      if (f) fieldValues.push({
        fieldId: f.id,
        type: "ChoiceFieldValue",
        values: data.assignedTo.map((u) => ({ id: u.id, type: "UserReference" })),
      });
    }
    if (data.storyPoints !== undefined) {
      const f = fieldByLegacy("storyPoints");
      if (f) fieldValues.push({ fieldId: f.id, type: "IntegerFieldValue", value: data.storyPoints });
    }

    if (fieldValues.length === 0) return item;

    await this.http.put(`/items/${itemId}/fields`, {
      params: { quietMode: true },
      body: { fieldValues },
      resource: `update item ${itemId}`,
    });

    return this.getItem(itemId);
  }

  addComment(itemId: number, data: CbCreateCommentRequest): Promise<CbComment> {
    return this.http.post(`/items/${itemId}/comments`, {
      formData: {
        comment: data.comment,
        ...(data.commentFormat ? { commentFormat: data.commentFormat } : {}),
      },
      resource: `add comment to item ${itemId}`,
    });
  }

  createAssociation(data: CbCreateAssociationRequest): Promise<CbAssociation> {
    return this.http.post("/associations", {
      body: data,
      resource: "create association",
    });
  }

  async getItemEditableFields(id: number): Promise<CbEditableField[]> {
    const raw = await this.http.get<{ editableFields?: CbEditableField[] }>(
      `/items/${id}/fields`,
      { resource: `editable fields for item ${id}` },
    );
    return raw.editableFields ?? [];
  }

  async createDownstreamReference(fromItemId: number, toItemId: number): Promise<void> {
    // Downstream reference is created by setting the "superordinateRequirement" field
    // on the downstream (to) item to point to the upstream (from) item.
    const toItem = await this.getItem(toItemId);
    const trackerId = toItem.tracker?.id;
    if (!trackerId) throw new Error(`Cannot determine tracker for item ${toItemId}`);

    const schema = await this.getTrackerSchema(trackerId);
    const superordinateField = schema.find(
      (f) => f.legacyRestName === "superordinateRequirement",
    );
    if (!superordinateField) {
      throw new Error(
        `Tracker ${trackerId} has no superordinateRequirement field. Cannot create downstream reference.`,
      );
    }

    const fields = await this.getItemEditableFields(toItemId);
    const currentField = fields.find((f) => f.fieldId === superordinateField.id);
    const existingValues = currentField?.values ?? [];
    if (existingValues.some((v) => v.id === fromItemId)) return; // already linked

    const newValues = [...existingValues, { id: fromItemId, type: "TrackerItemReference" }];

    await this.http.put(`/items/${toItemId}/fields`, {
      body: {
        fieldValues: [
          {
            fieldId: superordinateField.id,
            type: "ChoiceFieldValue",
            values: newValues,
          },
        ],
      },
      resource: `add downstream reference from ${fromItemId} to ${toItemId}`,
    });
  }
}
