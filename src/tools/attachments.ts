import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CodebeamerClient } from "../client/codebeamer-client.js";

export function registerAttachmentTools(server: McpServer, client: CodebeamerClient): void {
  server.registerTool(
    "list_item_attachments",
    {
      title: "List Item Attachments",
      description:
        "List only image attachments referenced in a Codebeamer item's current Wiki description. " +
        "Use the returned attachment ID with get_item_image to view an image. " +
        "Matches [!filename!] and [!filename#hash!] references. Excludes unreferenced attachments, " +
        "ordinary links and external images. Non-Wiki descriptions return an empty list.",
      inputSchema: {
        itemId: z.number().int().positive().describe("Numeric item ID"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ itemId }) => {
      const attachments = await client.listItemAttachments(itemId);
      const text = attachments.length === 0
        ? `No image attachments referenced in the current Wiki description for item ${itemId}.`
        : `## Attachments for item ${itemId}\n\n` + attachments.map((attachment) => {
          const details = [
            attachment.mimeType,
            attachment.fileSize !== undefined ? `${attachment.fileSize} bytes` : undefined,
          ].filter(Boolean).join(", ");
          return `- [${attachment.id}] ${attachment.name ?? "Unnamed attachment"}${details ? ` (${details})` : ""}`;
        }).join("\n");
      return { content: [{ type: "text", text }] };
    },
  );

  server.registerTool(
    "get_item_image",
    {
      title: "Get Item Image",
      description:
        "Download an image attachment from a Codebeamer tracker item and return actual image content " +
        "for visual analysis. First use list_item_attachments to find the attachment ID. " +
        "Supports PNG, JPEG, GIF and WebP up to 50 MiB. " +
        "Does not render editable diagram source files, SVG, or external image URLs.",
      inputSchema: {
        itemId: z.number().int().positive().describe("Numeric item ID"),
        attachmentId: z.number().int().positive().describe("Attachment ID from list_item_attachments"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ itemId, attachmentId }) => {
      const image = await client.getItemImage(itemId, attachmentId);
      return {
        content: [
          { type: "text", text: `Image attachment ${attachmentId} from item ${itemId}` },
          { type: "image", data: image.data, mimeType: image.mimeType },
        ],
      };
    },
  );
}