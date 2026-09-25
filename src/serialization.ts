export interface SerializedToolResult {
  content: Array<{ type: "text"; text: string }>;
  structuredContent: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * Serialize one canonical JSON representation and use that exact object as the
 * MCP structured payload. This keeps text and structured output identical and
 * prevents undefined values or non-finite numbers from diverging between them.
 */
export function serializeToolResult(value: Record<string, unknown>): SerializedToolResult {
  const text = JSON.stringify(value);
  if (text === undefined) {
    throw new TypeError("Tool result is not JSON serializable");
  }
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new TypeError("Tool result must serialize to a JSON object");
  }
  return {
    content: [{ type: "text", text }],
    structuredContent: parsed as Record<string, unknown>,
  };
}
