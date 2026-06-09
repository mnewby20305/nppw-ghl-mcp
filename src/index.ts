#!/usr/bin/env node
/**
 * GHL MCP Server — GoHighLevel CRM integration for Claude.ai
 *
 * Tools:
 *  - ghl_create_contact        Create a new contact
 *  - ghl_search_contacts       Search contacts by name/email/phone
 *  - ghl_get_contact           Get a single contact by ID
 *  - ghl_list_pipelines        List all pipelines and their stages (IDs included)
 *  - ghl_list_workflows        List all workflows (IDs included)
 *  - ghl_get_opportunities     List opportunities for a contact
 *  - ghl_move_pipeline_stage   Move an opportunity to a different stage
 *  - ghl_trigger_workflow      Add a contact to a workflow
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import { z } from "zod";
import axios, { AxiosError } from "axios";

// ─── Config ─────────────────────────────────────────────────────────────────

const GHL_API_KEY = process.env.GHL_API_KEY;
const GHL_LOCATION_ID = process.env.GHL_LOCATION_ID;
const BASE_URL = "https://services.leadconnectorhq.com";
const CHARACTER_LIMIT = 25000;

// ─── Shared HTTP client ──────────────────────────────────────────────────────

function ghlHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${GHL_API_KEY}`,
    "Content-Type": "application/json",
    Version: "2021-07-28",
  };
}

async function ghlGet<T>(path: string, params: Record<string, unknown> = {}): Promise<T> {
  const response = await axios.get<T>(`${BASE_URL}${path}`, {
    headers: ghlHeaders(),
    params,
    timeout: 30000,
  });
  return response.data;
}

async function ghlPost<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const response = await axios.post<T>(`${BASE_URL}${path}`, body, {
    headers: ghlHeaders(),
    timeout: 30000,
  });
  return response.data;
}

async function ghlPut<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const response = await axios.put<T>(`${BASE_URL}${path}`, body, {
    headers: ghlHeaders(),
    timeout: 30000,
  });
  return response.data;
}

// ─── Error handling ──────────────────────────────────────────────────────────

function handleError(error: unknown): string {
  if (error instanceof AxiosError) {
    const status = error.response?.status;
    const detail = error.response?.data
      ? JSON.stringify(error.response.data)
      : error.message;
    switch (status) {
      case 400: return `Error 400 Bad Request: ${detail}. Check your input fields.`;
      case 401: return "Error 401 Unauthorized: GHL_API_KEY is invalid or expired.";
      case 403: return `Error 403 Forbidden: ${detail}. Check location permissions.`;
      case 404: return `Error 404 Not Found: ${detail}. Verify the ID is correct.`;
      case 422: return `Error 422 Unprocessable: ${detail}. Missing or invalid fields.`;
      case 429: return "Error 429 Rate Limit: Too many requests. Wait a moment and retry.";
      default:  return `Error ${status ?? "unknown"}: ${detail}`;
    }
  }
  return `Unexpected error: ${error instanceof Error ? error.message : String(error)}`;
}

function truncate(text: string): string {
  if (text.length <= CHARACTER_LIMIT) return text;
  return text.slice(0, CHARACTER_LIMIT) + `\n\n[Response truncated at ${CHARACTER_LIMIT} chars. Use pagination or add filters.]`;
}

// ─── GHL type shapes ─────────────────────────────────────────────────────────

interface GHLContact {
  [key: string]: unknown;
  id: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  tags?: string[];
  source?: string;
  locationId?: string;
}

interface GHLOpportunity {
  [key: string]: unknown;
  id: string;
  name?: string;
  status?: string;
  stageId?: string;
  pipelineId?: string;
  contactId?: string;
  monetaryValue?: number;
}

interface GHLPipelineStage {
  id: string;
  name: string;
}

interface GHLPipeline {
  [key: string]: unknown;
  id: string;
  name: string;
  stages: GHLPipelineStage[];
}

interface GHLWorkflow {
  [key: string]: unknown;
  id: string;
  name: string;
  status?: string;
}

// ─── MCP Server ──────────────────────────────────────────────────────────────

const server = new McpServer({
  name: "ghl-mcp-server",
  version: "1.0.0",
});

// ── Tool: create_contact ─────────────────────────────────────────────────────

server.registerTool(
  "ghl_create_contact",
  {
    title: "Create GHL Contact",
    description: `Create a new contact in GoHighLevel CRM.

Args:
  - firstName (string, required): Contact's first name
  - lastName (string, optional): Contact's last name
  - phone (string, optional): Phone number, e.g. "919-555-1234"
  - email (string, optional): Email address
  - tags (string[], optional): Tags to apply, e.g. ["residential", "facebook-lead"]
  - source (string, optional): Lead source, e.g. "Facebook Ad", "Website"
  - companyName (string, optional): Company name (useful for commercial leads)

Returns: The created contact object with its ID.

Examples:
  - "Add new lead John Smith, 919-555-1234, source Facebook" → use this tool
  - "Create commercial contact: ABC Corp, john@abc.com" → use this tool`,
    inputSchema: z.object({
      firstName: z.string().min(1).describe("Contact's first name"),
      lastName: z.string().optional().describe("Contact's last name"),
      phone: z.string().optional().describe("Phone number"),
      email: z.string().email().optional().describe("Email address"),
      tags: z.array(z.string()).optional().describe("Tags to apply"),
      source: z.string().optional().describe("Lead source"),
      companyName: z.string().optional().describe("Company name"),
    }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  async (params) => {
    try {
      const body: Record<string, unknown> = {
        locationId: GHL_LOCATION_ID,
        firstName: params.firstName,
      };
      if (params.lastName)    body.lastName = params.lastName;
      if (params.phone)       body.phone = params.phone;
      if (params.email)       body.email = params.email;
      if (params.tags)        body.tags = params.tags;
      if (params.source)      body.source = params.source;
      if (params.companyName) body.companyName = params.companyName;

      const data = await ghlPost<{ contact: GHLContact }>("/contacts/", body);
      const c = data.contact;

      const text = [
        `✅ Contact created successfully`,
        `ID:    ${c.id}`,
        `Name:  ${[c.firstName, c.lastName].filter(Boolean).join(" ")}`,
        `Phone: ${c.phone ?? "—"}`,
        `Email: ${c.email ?? "—"}`,
        `Tags:  ${c.tags?.join(", ") ?? "—"}`,
      ].join("\n");

      return { content: [{ type: "text", text }], structuredContent: data.contact };
    } catch (error) {
      return { content: [{ type: "text", text: handleError(error) }] };
    }
  }
);

// ── Tool: search_contacts ────────────────────────────────────────────────────

server.registerTool(
  "ghl_search_contacts",
  {
    title: "Search GHL Contacts",
    description: `Search for contacts in GoHighLevel by name, email, or phone.

Args:
  - query (string, required): Search term — name, email, or phone number
  - limit (number, optional): Max results, 1–100 (default: 20)

Returns: List of matching contacts with IDs, names, phones, emails, and tags.

Examples:
  - "Find John Smith" → query="John Smith"
  - "Look up 919-555-1234" → query="919-555-1234"`,
    inputSchema: z.object({
      query: z.string().min(2).describe("Search term: name, email, or phone"),
      limit: z.number().int().min(1).max(100).default(20).describe("Max results"),
    }),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async (params) => {
    try {
      const data = await ghlGet<{ contacts: GHLContact[]; total?: number }>(
        "/contacts/search/",
        { locationId: GHL_LOCATION_ID, query: params.query, limit: params.limit }
      );

      const contacts = data.contacts ?? [];
      if (!contacts.length) {
        return { content: [{ type: "text", text: `No contacts found matching "${params.query}"` }] };
      }

      const lines = [`Found ${contacts.length} contact(s) for "${params.query}":`, ""];
      for (const c of contacts) {
        lines.push(`ID:    ${c.id}`);
        lines.push(`Name:  ${[c.firstName, c.lastName].filter(Boolean).join(" ") || "—"}`);
        lines.push(`Phone: ${c.phone ?? "—"}`);
        lines.push(`Email: ${c.email ?? "—"}`);
        lines.push(`Tags:  ${c.tags?.join(", ") ?? "—"}`);
        lines.push("");
      }

      return {
        content: [{ type: "text", text: truncate(lines.join("\n")) }],
        structuredContent: { contacts, total: data.total ?? contacts.length },
      };
    } catch (error) {
      return { content: [{ type: "text", text: handleError(error) }] };
    }
  }
);

// ── Tool: get_contact ────────────────────────────────────────────────────────

server.registerTool(
  "ghl_get_contact",
  {
    title: "Get GHL Contact by ID",
    description: `Retrieve full details for a single GoHighLevel contact by their contact ID.

Args:
  - contactId (string, required): The GHL contact ID (from search results)

Returns: Full contact record including tags, source, custom fields, and opportunity summary.`,
    inputSchema: z.object({
      contactId: z.string().min(1).describe("GHL contact ID"),
    }),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async (params) => {
    try {
      const data = await ghlGet<{ contact: GHLContact }>(`/contacts/${params.contactId}`);
      const c = data.contact;

      const text = [
        `Contact: ${[c.firstName, c.lastName].filter(Boolean).join(" ")}`,
        `ID:      ${c.id}`,
        `Phone:   ${c.phone ?? "—"}`,
        `Email:   ${c.email ?? "—"}`,
        `Tags:    ${c.tags?.join(", ") ?? "—"}`,
        `Source:  ${c.source ?? "—"}`,
      ].join("\n");

      return { content: [{ type: "text", text }], structuredContent: c };
    } catch (error) {
      return { content: [{ type: "text", text: handleError(error) }] };
    }
  }
);

// ── Tool: list_pipelines ─────────────────────────────────────────────────────

server.registerTool(
  "ghl_list_pipelines",
  {
    title: "List GHL Pipelines and Stages",
    description: `List all pipelines in GoHighLevel with their stage names and IDs.

Use this to look up stageId values before calling ghl_move_pipeline_stage.

Returns: All pipelines, each with pipeline ID, name, and a list of stages (id + name).

Example output:
  Pipeline: Residential (id: abc123)
    Stage: New Lead         (id: stage_111)
    Stage: Estimate Sent    (id: stage_222)
    Stage: Booked           (id: stage_333)`,
    inputSchema: z.object({}),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async () => {
    try {
      const data = await ghlGet<{ pipelines: GHLPipeline[] }>(
        "/opportunities/pipelines",
        { locationId: GHL_LOCATION_ID }
      );

      const pipelines = data.pipelines ?? [];
      if (!pipelines.length) {
        return { content: [{ type: "text", text: "No pipelines found." }] };
      }

      const lines: string[] = [];
      for (const p of pipelines) {
        lines.push(`Pipeline: ${p.name}`);
        lines.push(`  Pipeline ID: ${p.id}`);
        for (const s of p.stages ?? []) {
          lines.push(`  Stage: ${s.name.padEnd(30)} (stageId: ${s.id})`);
        }
        lines.push("");
      }

      return {
        content: [{ type: "text", text: lines.join("\n") }],
        structuredContent: { pipelines },
      };
    } catch (error) {
      return { content: [{ type: "text", text: handleError(error) }] };
    }
  }
);

// ── Tool: list_workflows ─────────────────────────────────────────────────────

server.registerTool(
  "ghl_list_workflows",
  {
    title: "List GHL Workflows",
    description: `List all workflows in GoHighLevel with their IDs and status.

Use this to look up workflowId values before calling ghl_trigger_workflow.

Returns: All workflows with id, name, and status (published/draft).`,
    inputSchema: z.object({}),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async () => {
    try {
      const data = await ghlGet<{ workflows: GHLWorkflow[] }>(
        "/workflows/",
        { locationId: GHL_LOCATION_ID }
      );

      const workflows = data.workflows ?? [];
      if (!workflows.length) {
        return { content: [{ type: "text", text: "No workflows found." }] };
      }

      const lines = workflows.map(
        (w) => `[${w.status ?? "unknown"}] ${w.name.padEnd(50)} workflowId: ${w.id}`
      );

      return {
        content: [{ type: "text", text: `${workflows.length} workflows:\n\n` + lines.join("\n") }],
        structuredContent: { workflows },
      };
    } catch (error) {
      return { content: [{ type: "text", text: handleError(error) }] };
    }
  }
);

// ── Tool: get_opportunities ──────────────────────────────────────────────────

server.registerTool(
  "ghl_get_opportunities",
  {
    title: "Get Opportunities for a Contact",
    description: `List all pipeline opportunities associated with a GHL contact.

Args:
  - contactId (string, required): The GHL contact ID

Returns: Opportunities with their IDs, pipeline, current stage, status, and monetary value.
Use opportunityId from these results with ghl_move_pipeline_stage.`,
    inputSchema: z.object({
      contactId: z.string().min(1).describe("GHL contact ID"),
    }),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async (params) => {
    try {
      const data = await ghlGet<{ opportunities: GHLOpportunity[] }>(
        "/opportunities/search",
        { location_id: GHL_LOCATION_ID, contact_id: params.contactId }
      );

      const opps = data.opportunities ?? [];
      if (!opps.length) {
        return {
          content: [{ type: "text", text: `No opportunities found for contact ${params.contactId}` }],
        };
      }

      const lines: string[] = [`${opps.length} opportunity/opportunities:\n`];
      for (const o of opps) {
        lines.push(`Name:          ${o.name ?? "—"}`);
        lines.push(`Opportunity ID: ${o.id}`);
        lines.push(`Pipeline ID:   ${o.pipelineId ?? "—"}`);
        lines.push(`Stage ID:      ${o.stageId ?? "—"}`);
        lines.push(`Status:        ${o.status ?? "—"}`);
        lines.push(`Value:         $${o.monetaryValue ?? 0}`);
        lines.push("");
      }

      return {
        content: [{ type: "text", text: lines.join("\n") }],
        structuredContent: { opportunities: opps },
      };
    } catch (error) {
      return { content: [{ type: "text", text: handleError(error) }] };
    }
  }
);

// ── Tool: move_pipeline_stage ────────────────────────────────────────────────

server.registerTool(
  "ghl_move_pipeline_stage",
  {
    title: "Move Opportunity to Pipeline Stage",
    description: `Move a GHL opportunity to a different pipeline stage.

Args:
  - opportunityId (string, required): The opportunity ID (from ghl_get_opportunities)
  - stageId (string, required): Target stage ID (from ghl_list_pipelines)
  - status (string, optional): Opportunity status — "open" | "won" | "lost" | "abandoned"

Workflow:
  1. Use ghl_search_contacts to find the contact
  2. Use ghl_get_opportunities to get their opportunityId
  3. Use ghl_list_pipelines to get the target stageId
  4. Call this tool

Returns: Updated opportunity record.`,
    inputSchema: z.object({
      opportunityId: z.string().min(1).describe("GHL opportunity ID"),
      stageId: z.string().min(1).describe("Target pipeline stage ID"),
      status: z.enum(["open", "won", "lost", "abandoned"]).optional().describe("Opportunity status"),
    }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async (params) => {
    try {
      const body: Record<string, unknown> = { stageId: params.stageId };
      if (params.status) body.status = params.status;

      const data = await ghlPut<{ opportunity: GHLOpportunity }>(
        `/opportunities/${params.opportunityId}`,
        body
      );
      const o = data.opportunity;

      const text = [
        `✅ Opportunity moved successfully`,
        `Opportunity ID: ${o.id}`,
        `New Stage ID:   ${o.stageId}`,
        `Status:         ${o.status ?? "—"}`,
      ].join("\n");

      return { content: [{ type: "text", text }], structuredContent: o };
    } catch (error) {
      return { content: [{ type: "text", text: handleError(error) }] };
    }
  }
);

// ── Tool: trigger_workflow ───────────────────────────────────────────────────

server.registerTool(
  "ghl_trigger_workflow",
  {
    title: "Trigger GHL Workflow for Contact",
    description: `Add a contact to a GoHighLevel workflow, triggering it immediately.

Args:
  - contactId (string, required): The GHL contact ID
  - workflowId (string, required): The GHL workflow ID (from ghl_list_workflows)

Use ghl_list_workflows first to find the workflowId by name.

Returns: Confirmation that the workflow was triggered.

Example:
  "Send reactivation sequence to John Smith"
  → 1. ghl_search_contacts query="John Smith" → get contactId
  → 2. ghl_list_workflows → find "Reactivation, Initial Outreach" → get workflowId
  → 3. ghl_trigger_workflow contactId=... workflowId=...`,
    inputSchema: z.object({
      contactId: z.string().min(1).describe("GHL contact ID"),
      workflowId: z.string().min(1).describe("GHL workflow ID"),
    }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async (params) => {
    try {
      await ghlPost(`/contacts/${params.contactId}/workflow/${params.workflowId}`, {
        eventStartTime: new Date().toISOString(),
      });

      const text = [
        `✅ Workflow triggered successfully`,
        `Contact ID:  ${params.contactId}`,
        `Workflow ID: ${params.workflowId}`,
      ].join("\n");

      return { content: [{ type: "text", text }] };
    } catch (error) {
      return { content: [{ type: "text", text: handleError(error) }] };
    }
  }
);

// ─── HTTP server ─────────────────────────────────────────────────────────────

async function runHTTP(): Promise<void> {
  if (!GHL_API_KEY) {
    console.error("ERROR: GHL_API_KEY environment variable is required");
    process.exit(1);
  }
  if (!GHL_LOCATION_ID) {
    console.error("ERROR: GHL_LOCATION_ID environment variable is required");
    process.exit(1);
  }

  const app = express();
  app.use(express.json());

  // Health check
  app.get("/", (_req, res) => {
    res.json({ status: "ok", server: "ghl-mcp-server", version: "1.0.0" });
  });

  // MCP endpoint — new transport per request (stateless)
  app.post("/mcp", async (req, res) => {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on("close", () => transport.close());
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  const port = parseInt(process.env.PORT ?? "3000", 10);
  app.listen(port, () => {
    console.error(`GHL MCP server running on http://localhost:${port}`);
    console.error(`MCP endpoint: http://localhost:${port}/mcp`);
  });
}

runHTTP().catch((error: unknown) => {
  console.error("Server startup error:", error);
  process.exit(1);
});
