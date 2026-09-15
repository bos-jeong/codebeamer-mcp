# codebeamer-mcp

An MCP (Model Context Protocol) server for Codebeamer ALM. Allows Claude and other MCP clients to read and write projects, trackers, and items in Codebeamer using natural language.

[![codebeamer-mcp MCP server](https://glama.ai/mcp/servers/3KniGHtcZ/codebeamer-mcp/badges/card.svg)](https://glama.ai/mcp/servers/3KniGHtcZ/codebeamer-mcp)

## Tools (21)

### Read

| Tool | Description |
|---|---|
| `list_projects` | List all projects |
| `get_project` | Get project details |
| `list_trackers` | List trackers in a project |
| `get_tracker` | Get tracker details |
| `list_tracker_items` | List items in a tracker |
| `search_items` | Full-text / cbQL search |
| `get_item` | Get item summary: ID, name, tracker, status and description. Lightweight — use when you only need to identify the item and read its content |
| `get_item_details` | Get full structured detail of an item: project, priority, assignees, timestamps, story points, custom fields and test steps. Description omitted — fetch it via `get_item` |
| `get_item_relations` | Get outgoing/incoming associations (depends on, blocks, …) |
| `get_item_references` | Get upstream/downstream traceability references (derived from, covers, …) |
| `get_item_comments` | Get item comments |
| `get_item_reviews` | Get Review Hub reviews for an item (result, reviewers, votes) |
| `list_item_attachments` | List image attachments referenced in the current Wiki description, with IDs, names and available file metadata |
| `get_item_image` | Return an attached PNG, JPEG, GIF or WebP as MCP image content for visual analysis (max 5 MiB) |
| `get_user` | Get user details |

### Write

| Tool | Description |
|---|---|
| `create_item` | Create a new item in a tracker. Supports folders, item type, and parent nesting |
| `update_item` | Update an existing item (name, description, status, priority, assignee, custom fields) |
| `add_comment` | Add a comment to an item |
| `create_association` | Create an association between two items (e.g. depends on, blocks) |
| `create_reference` | Add a downstream traceability reference between two items |
| `create_harm` | Create a harm entry in an RM Harms List tracker with IMDRF code and severity (1–5) |

### Images and diagrams

To inspect an image in a tracker item:

1. Find the item ID with `list_tracker_items` or `search_items`.
2. Call `list_item_attachments` with `{ "itemId": 500 }` to find the image's attachment ID.
3. Call `get_item_image` with `{ "itemId": 500, "attachmentId": 12 }`.

The image tool downloads the attachment using the configured Codebeamer credentials
and returns an MCP `image` content block containing Base64 data and the detected MIME
type, not just an image link. The MCP client/model must support image content to
display or analyze it. Existing `get_item` responses remain text-only.

Supported formats are PNG, JPEG, GIF and WebP, limited to 5 MiB per downloaded image
(before Base64 encoding). File type is detected from the bytes even when Codebeamer
returns `application/octet-stream`. Access restrictions and missing attachments are
reported as tool errors.

`list_item_attachments` only returns attachments referenced as images in the current
Wiki description, using `[!filename!]` or `[!filename#hash!]`. Filenames must match
exactly; when a hash is present, it must match a prefix of the attachment's `sha512`.
Images removed from the description, ordinary file links and files only attached to
the item are excluded. Empty or non-Wiki descriptions return no matches. HTML
descriptions and other image-reference syntax are not supported by this filter.

External image URLs, tracker-level wiki/document images, SVG and editable
diagram source files are not rendered; export these diagrams to a supported image
format and insert them into the item's Wiki description first.

The tools use the REST API v3 endpoints `GET /items/{itemId}`,
`GET /items/{itemId}/attachments` and
`GET /items/{itemId}/attachments/{attachmentId}/content`.

To use local source changes, run `npm run build`, point the MCP configuration to
`node` with an absolute path to `dist/index.js`, and restart the MCP server.
Configurations using `npx codebeamer-mcp` still run the published package, not this
local checkout.

### Rate limits and automatic retries

Read requests (`GET`), including image downloads, automatically retry HTTP 429
responses up to 3 times after the initial request (4 attempts total).

- A valid `Retry-After` header takes priority, supporting seconds or an HTTP date.
- Missing or invalid headers use exponential backoff: 1, 2, then 4 seconds.
- Total retry waiting is limited to 30 seconds per request. If the server asks for
  more than the remaining budget, the request fails with a rate limit error instead
  of retrying earlier than requested. Network time is not included in this budget.
- After retries are exhausted, the rate limit error is returned to the MCP client.
- Write requests (`POST` and `PUT`) are not automatically retried, avoiding duplicate
  operations. Other HTTP errors and connection failures are not retried either.

Retries are per request; this does not impose a shared rate limit on concurrent
tool calls. No additional environment variables are required.

## Installation

### Requirements
- Node.js 20+
- Access to a Codebeamer instance (URL, username, password)

### Claude Code (CLI)

The fastest way — run this command in your terminal:

```bash
claude mcp add codebeamer -e CB_URL=https://your-instance.example.com/cb/api \
  -e CB_USERNAME=your_username -e CB_PASSWORD=your_password \
  -- npx -y codebeamer-mcp
```

Or add it manually to `.mcp.json` in the project root (or `~/.claude/mcp.json` for global scope):

```json
{
  "mcpServers": {
    "codebeamer": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "codebeamer-mcp"],
      "env": {
        "CB_URL": "https://your-instance.example.com/cb/api",
        "CB_USERNAME": "your_username",
        "CB_PASSWORD": "your_password"
      }
    }
  }
}
```

### Claude Desktop

Edit the config file for your platform:

| Platform | Path |
|---|---|
| macOS | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Windows | `%APPDATA%\Claude\claude_desktop_config.json` |
| Linux | `~/.config/Claude/claude_desktop_config.json` |

```json
{
  "mcpServers": {
    "codebeamer": {
      "command": "npx",
      "args": ["-y", "codebeamer-mcp"],
      "env": {
        "CB_URL": "https://your-instance.example.com/cb/api",
        "CB_USERNAME": "your_username",
        "CB_PASSWORD": "your_password"
      }
    }
  }
}
```

Restart Claude Desktop after saving.

### Cursor

Add to `.cursor/mcp.json` in the project root (project scope) or `~/.cursor/mcp.json` (global):

```json
{
  "mcpServers": {
    "codebeamer": {
      "command": "npx",
      "args": ["-y", "codebeamer-mcp"],
      "env": {
        "CB_URL": "https://your-instance.example.com/cb/api",
        "CB_USERNAME": "your_username",
        "CB_PASSWORD": "your_password"
      }
    }
  }
}
```

### Windsurf

Add to `~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "codebeamer": {
      "command": "npx",
      "args": ["-y", "codebeamer-mcp"],
      "env": {
        "CB_URL": "https://your-instance.example.com/cb/api",
        "CB_USERNAME": "your_username",
        "CB_PASSWORD": "your_password"
      }
    }
  }
}
```

### VS Code (Copilot)

Add to `.vscode/mcp.json` in the project root:

```json
{
  "servers": {
    "codebeamer": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "codebeamer-mcp"],
      "env": {
        "CB_URL": "https://your-instance.example.com/cb/api",
        "CB_USERNAME": "your_username",
        "CB_PASSWORD": "your_password"
      }
    }
  }
}
```

### Gemini CLI

Add to `~/.gemini/settings.json`:

```json
{
  "mcpServers": {
    "codebeamer": {
      "command": "npx",
      "args": ["-y", "codebeamer-mcp"],
      "env": {
        "CB_URL": "https://your-instance.example.com/cb/api",
        "CB_USERNAME": "your_username",
        "CB_PASSWORD": "your_password"
      }
    }
  }
}
```

### Alternative: global install

```bash
npm install -g codebeamer-mcp
```

Then use `"command": "codebeamer-mcp"` (no `args`) instead of `npx` in any config above.

### Pinning a specific version

```json
"args": ["-y", "codebeamer-mcp@0.2.0"]
```

### Updates

| Method | Update behavior |
|---|---|
| `npx -y codebeamer-mcp` | Always fetches the latest version |
| `npm install -g codebeamer-mcp` | Stays on installed version. Run `npm update -g codebeamer-mcp` to update |
| Pinned version (`@0.2.0`) | Never auto-updates; change the version string manually |

> ⚠️ **Never commit `.mcp.json` with real credentials** — it is listed in `.gitignore`.

### From source (development)

```bash
git clone https://github.com/3KniGHtcZ/codebeamer-mcp.git
cd codebeamer-mcp
npm install
npm run build
```

Then use `"command": "node"` with `"args": ["dist/index.js"]` in your `.mcp.json`.

## Development & Testing

```bash
# Run tests (no real Codebeamer instance needed)
npm test

# Start the mock API server (port 3001)
node mock-server.mjs

# Interactive testing via MCP Inspector
CB_URL=http://localhost:3001 CB_USERNAME=mock CB_PASSWORD=mock \
  npx @modelcontextprotocol/inspector node dist/index.js
```

## Configuration

| Variable | Description | Default |
|---|---|---|
| `CB_URL` | Codebeamer API URL, e.g. `https://your-instance.example.com/cb/api` (the server appends `/v3` automatically) | _(required)_ |
| `CB_USERNAME` | Login username | _(required)_ |
| `CB_PASSWORD` | Password | _(required)_ |
| `CB_UNSAFE_SSL` | Set to `true` to allow connections to servers with unverified/self-signed certificates | `false` |
| `CB_API_VERSION` | API version | `v3` |
| `CB_TIMEOUT_MS` | Request timeout (ms) | `30000` |
| `CB_MAX_ITEMS` | Max items per page | `100` |