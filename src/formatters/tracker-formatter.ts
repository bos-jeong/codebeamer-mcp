import type {
  CbTracker,
  CbTrackerField,
  CbItem,
} from "../client/codebeamer-client.js";

export function formatTrackerList(trackers: CbTracker[]): string {
  const header = `## Trackers (${trackers.length} total)\n`;

  if (trackers.length === 0) return `${header}\n_No trackers found._`;

  const rows = trackers.map(
    (t) =>
      `| ${t.id} | ${t.name} | ${t.type?.name ?? "-"} | ${t.keyName ?? "-"} | ${(t.folderPath ?? "Unknown").replace(/\|/g, "\\|").replace(/[\r\n]+/g, " ")} |`,
  );

  return [
    header,
    "| ID | Name | Type | Key | Folder |",
    "|----|------|------|-----|--------|",
    ...rows,
  ].join("\n");
}

function formatTrackerStatus(tracker: CbTracker): string {
  return tracker.status
    ? `${tracker.status.name} (ID: ${tracker.status.id})`
    : "Unknown";
}

function extractDescription(desc: CbItem["description"]): string {
  const text =
    typeof desc === "string"
      ? desc
      : desc?.value ?? desc?.markup ?? "";
  return text.length > 120 ? text.slice(0, 120) + "…" : text;
}

export function formatTracker(
  tracker: CbTracker,
  fields: CbTrackerField[],
  items: CbItem[] = [],
): string {
  const lines: string[] = [
    `## ${tracker.name}`,
    "",
    `- **ID:** ${tracker.id}`,
    `- **Type:** ${tracker.type?.name ?? "?"}`,
    `- **Project:** ${tracker.project?.name ?? "?"} (ID: ${tracker.project?.id ?? "?"})`,
    `- **Status (color-based):** ${formatTrackerStatus(tracker)}`,
  ];

  if (tracker.keyName) {
    lines.push(`- **Key:** ${tracker.keyName}`);
  }
  if (tracker.description) {
    lines.push("", "### Description", "", tracker.description);
  }

  if (fields.length > 0) {
    const visibleFields = fields.filter((f) => !f.hidden);
    lines.push("", "### Fields", "");
    lines.push("| ID | Name | Type | Required |");
    lines.push("|----|------|------|----------|");
    for (const f of visibleFields) {
      lines.push(
        `| ${f.fieldId} | ${f.name} | ${f.type ?? "-"} | ${f.required ? "Yes" : "No"} |`,
      );
    }
  }

  if (items.length > 0) {
    lines.push("", `### Items (${items.length})`, "");
    lines.push("| ID | Name | Status | Type | Description |");
    lines.push("|----|------|--------|------|-------------|");
    for (const item of items) {
      const desc = extractDescription(item.description);
      lines.push(
        `| ${item.id} | ${item.name} | ${item.status?.name ?? "-"} | ${item.tracker?.type ?? tracker.type?.name ?? "-"} | ${desc} |`,
      );
    }
  }

  return lines.join("\n");
}
