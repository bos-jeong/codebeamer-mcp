import { describe, it, expect } from "vitest";
import { http, HttpResponse } from "msw";
import { mockServer } from "../../setup.js";
import { makeTracker } from "../../mocks/fixtures/trackers.js";
import { HttpClient } from "../../../src/client/http-client.js";
import { CodebeamerClient, type CbTrackerConfiguration } from "../../../src/client/codebeamer-client.js";
import {
  formatTrackerList,
  formatTracker,
} from "../../../src/formatters/tracker-formatter.js";

const BASE = "https://test-cb.example.com/v3";

function makeClient() {
  const http = new HttpClient({
    baseUrl: BASE,
    username: "testuser",
    password: "testpass",
  });
  return new CodebeamerClient(http);
}

describe("list_trackers", () => {
  it("returns formatted tracker list", async () => {
    const client = makeClient();
    const result = await client.listTrackers(1, 1, 25);
    const text = formatTrackerList(result);

    expect(text).toContain("## Trackers");
    expect(text).toContain("1 total");
    expect(text).toContain("Bug Tracker");
    expect(text).toContain("100");
    expect(text).toContain("| Folder |");
    expect(text).toContain("| Development |");
    expect(result[0].status).toEqual({ id: 4, name: "Spec Out" });
    expect(text).toContain("Status (color-based)");
    expect(text).toContain("Spec Out (ID: 4)");
  });

  it("maps nested folders through tracker children without changing list order", async () => {
    const requests: string[] = [];
    mockServer.use(
      http.get(`${BASE}/projects/:projectId/trackers`, ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get("page")).toBe("2");
        expect(url.searchParams.get("pageSize")).toBe("10");
        return HttpResponse.json([206240, 372586, 32527, 99, 98, 97].map((id) => ({
          id, name: `Tracker ${id}`, type: "TrackerReference",
        })));
      }),
      http.get(`${BASE}/trackers/tree`, ({ request }) => {
        requests.push(new URL(request.url).searchParams.get("projectId")!);
        return HttpResponse.json([
          { isFolder: true, text: "Empty" },
          { isFolder: true, text: "Requirements", children: [
            { isFolder: true, text: "Safety", children: [
              { trackerId: 206240, children: [{ trackerId: 372586 }] },
            ] },
          ] },
          { isFolder: true, text: "Templates", children: [{ trackerId: 32527 }] },
          { trackerId: 99, children: [{ trackerId: 97 }] },
        ]);
      }),
    );

    const result = await makeClient().listTrackers(10, 2, 10);
    expect(requests).toEqual(["10"]);
    expect(result.map(({ id, folderPath }) => ({ id, folderPath }))).toEqual([
      { id: 206240, folderPath: "Requirements / Safety" },
      { id: 372586, folderPath: "Requirements / Safety" },
      { id: 32527, folderPath: "Templates" },
      { id: 99, folderPath: "/" },
      { id: 98, folderPath: undefined },
      { id: 97, folderPath: "/" },
    ]);
    const text = formatTrackerList(result);
    expect(text).toContain("| 372586 | Tracker 372586 | - | - | Requirements / Safety |");
    expect(text).toContain("| 98 | Tracker 98 | - | - | Unknown |");
    expect(text).toContain("| 99 | Tracker 99 | - | - | / |");
  });

  it("leaves folder information unknown when the tree is empty", async () => {
    mockServer.use(http.get(`${BASE}/trackers/tree`, () => HttpResponse.json([])));
    const result = await makeClient().listTrackers(1, 1, 25);
    expect(result).toHaveLength(1);
    expect(result[0].folderPath).toBeUndefined();
    expect(formatTrackerList(result)).toContain("| Unknown |");
  });

  it("skips tree and configuration requests for an empty tracker list", async () => {
    let treeRequests = 0;
    let configurationRequests = 0;
    mockServer.use(
      http.get(`${BASE}/projects/:projectId/trackers`, () => HttpResponse.json([])),
      http.get(`${BASE}/tracker/:id/configuration`, () => {
        configurationRequests += 1;
        return HttpResponse.json({});
      }),
      http.get(`${BASE}/trackers/tree`, () => {
        treeRequests += 1;
        return HttpResponse.json([]);
      }),
    );
    const result = await makeClient().listTrackers(1, 1, 25);
    expect(formatTrackerList(result)).toContain("No trackers found");
    expect(treeRequests).toBe(0);
    expect(configurationRequests).toBe(0);
  });

  it("propagates a tree lookup failure instead of claiming trackers are at root", async () => {
    mockServer.use(http.get(`${BASE}/trackers/tree`, () => new HttpResponse(null, { status: 403 })));
    await expect(makeClient().listTrackers(1, 1, 25)).rejects.toThrow();
  });

  it("escapes folder names in the markdown table", () => {
    const text = formatTrackerList([makeTracker({ folderPath: "Design | Review\r\nSafety" })]);
    expect(text).toContain("| Design \\| Review Safety |");
  });
});

describe("get_tracker", () => {
  it("returns formatted tracker with fields and items", async () => {
    const client = makeClient();
    const [tracker, fields, { items }] = await Promise.all([
      client.getTracker(100),
      client.getTrackerFields(100),
      client.listTrackerItems(100, 1, 100),
    ]);
    const text = formatTracker(tracker, fields, items);

    expect(text).toContain("Bug Tracker");
    expect(text).toContain("Summary");
    expect(text).toContain("Description");
    expect(text).toContain("TextFieldValue");
    expect(text).toContain("### Items");
    expect(text).toContain("Login button does not respond");
    expect(text).toContain("Open");
    expect(tracker.status).toEqual({ id: 4, name: "Spec Out" });
    expect(text).toContain("**Status (color-based):** Spec Out (ID: 4)");
  });
});

describe("tracker color-based status", () => {
  it("escapes status names in the markdown table", () => {
    const text = formatTrackerList([makeTracker({ status: { id: 4, name: "Spec | Out\r\nReview" } })]);
    expect(text).toContain("| Spec \\| Out Review (ID: 4) |");
  });

  const statusField = {
    referenceId: 7,
    choiceOptionSetting: {
      choiceOptions: [{ id: 4, name: "Spec Out", color: "#ababab" }],
    },
  };

  it("normalizes color casing and whitespace and ignores other choice fields", async () => {
    mockServer.use(http.get(`${BASE}/tracker/:id/configuration`, () => HttpResponse.json({
      basicInformation: { color: " #ABABAB " },
      fields: [
        { ...statusField, referenceId: 14 },
        statusField,
      ],
    })));
    const tracker = await makeClient().getTracker(100);
    expect(tracker.status).toEqual({ id: 4, name: "Spec Out" });
  });

  const unknownConfigurations: Array<[string, CbTrackerConfiguration]> = [
    ["missing color", { fields: [statusField] }],
    ["empty color", { basicInformation: { color: " " }, fields: [statusField] }],
    ["unmatched color", { basicInformation: { color: "#ffffff" }, fields: [statusField] }],
    ["missing fields", { basicInformation: { color: "#ababab" } }],
    ["missing status field", { basicInformation: { color: "#ababab" }, fields: [{ ...statusField, referenceId: 14 }] }],
    ["missing options", { basicInformation: { color: "#ababab" }, fields: [{ referenceId: 7 }] }],
    ["missing option color", {
      basicInformation: { color: "#ababab" },
      fields: [{ referenceId: 7, choiceOptionSetting: { choiceOptions: [{ id: 4, name: "Spec Out" }] } }],
    }],
    ["duplicate colors", {
      basicInformation: { color: "#ababab" },
      fields: [{ referenceId: 7, choiceOptionSetting: { choiceOptions: [
        { id: 4, name: "Spec Out", color: "#ababab" },
        { id: 5, name: "Approved", color: "#ABABAB" },
      ] } }],
    }],
  ];

  it.each(unknownConfigurations)("returns unknown for %s", async (_name, configuration) => {
    mockServer.use(http.get(`${BASE}/tracker/:id/configuration`, () => HttpResponse.json(configuration)));
    const tracker = await makeClient().getTracker(100);
    expect(tracker.status).toBeUndefined();
    expect(formatTracker(tracker, [])).toContain("**Status (color-based):** Unknown");
    expect(formatTrackerList([tracker])).toContain("| Unknown |");
  });

  it("uses each tracker's configuration when listing trackers", async () => {
    mockServer.use(
      http.get(`${BASE}/projects/:projectId/trackers`, () => HttpResponse.json([
        makeTracker({ id: 100 }), makeTracker({ id: 101 }),
      ])),
      http.get(`${BASE}/tracker/:id/configuration`, ({ params }) => HttpResponse.json({
        basicInformation: { color: params.id === "100" ? "#ababab" : "#ffffff" },
        fields: [statusField],
      })),
    );
    const trackers = await makeClient().listTrackers(1, 1, 25);
    expect(trackers.map((tracker) => tracker.status)).toEqual([{ id: 4, name: "Spec Out" }, undefined]);
  });

  it("propagates configuration lookup failures for detail and list", async () => {
    mockServer.use(http.get(`${BASE}/tracker/:id/configuration`, () => new HttpResponse(null, { status: 403 })));
    await expect(makeClient().getTracker(100)).rejects.toThrow();
    await expect(makeClient().listTrackers(1, 1, 25)).rejects.toThrow();
  });
});
