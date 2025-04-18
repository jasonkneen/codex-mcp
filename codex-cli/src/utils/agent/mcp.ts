import type {ResponseInputItem} from "openai/resources/responses/responses.mjs";
import {Client} from "@modelcontextprotocol/sdk/client/index.js";
import {SSEClientTransport} from "@modelcontextprotocol/sdk/client/sse.js";
import {ORIGIN, CLI_VERSION} from "../session.js";

const mcpClients: Record<string, Client> = {};

/**
 * Generate OpenAI function definitions for each configured MCP server.
 */
export function getMcpToolDefinitions(
  servers?: Record<string, { url: string }>
): any[] {
  if (!servers) return [];
  return Object.entries(servers).map(([serverName]) => ({
    type: "function",
    name: serverName,
    description: `Call remote MCP server '${serverName}' tool`,
    strict: false,
    parameters: {
      type: "object",
      properties: {
        name: {type: "string", description: "Tool name"},
        args: {type: "object", description: "Tool args"},
      },
      required: ["name", "args"],
      additionalProperties: false,
    },
  }));
}

/**
 * Handle a function call routed to an MCP server.
 * Parses arguments, initializes client, invokes tool, and formats output.
 */
export async function handleMcpFunctionCall(
  servers: Record<string, { url: string }>,
  serverName: string,
  rawArguments: string | undefined,
  callId: string
): Promise<ResponseInputItem.FunctionCallOutput[]> {
  const paramsRaw = rawArguments ?? "{}";

  const formatRaw = (raw: string) => [
    {type: "function_call_output" as const, call_id: callId, output: raw},
  ];

  const formatOutput = (
    output: string,
    exit_code: number,
    duration_seconds: number
  ) => ({
    type: "function_call_output" as const,
    call_id: callId,
    output: JSON.stringify({output, metadata: {exit_code, duration_seconds}}),
  });

  if (!servers[serverName]) {
    return formatRaw(paramsRaw);
  }

  let parsed: any;
  try {
    parsed = JSON.parse(paramsRaw);
  } catch {
    return formatRaw(paramsRaw);
  }

  const {name: toolName, args, ...other} = parsed;
  if (typeof toolName !== "string") return formatRaw(paramsRaw);

  const callArgs = args ?? other;

  if (!mcpClients[serverName]) {
    const client = new Client({name: ORIGIN, version: CLI_VERSION});
    const transport = new SSEClientTransport(
      new URL(servers[serverName].url)
    );
    await client.connect(transport);
    mcpClients[serverName] = client;
  }

  const start = Date.now();

  const getDuration = () => Math.round((Date.now() - start) / 100) / 10;

  try {
    const response = await mcpClients[serverName].callTool({
      name: toolName,
      arguments: callArgs,
    });
    const outputText = Array.isArray((response as any).content)
      ? (response as any).content.map((c: any) => c.text).join("\n")
      : JSON.stringify(response);
    return [formatOutput(outputText, 0, getDuration())];
  } catch (err: any) {
    const msg = err instanceof Error ? err.message : String(err);
    return [formatOutput(`MCP error: ${msg}`, 1, getDuration())];
  }
}
