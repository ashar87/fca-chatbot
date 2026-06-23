import {
  BedrockRuntimeClient,
  InvokeModelWithResponseStreamCommand,
} from "@aws-sdk/client-bedrock-runtime";
import type { FunctionDeclaration } from "@google/genai";

// ─── Credential check ─────────────────────────────────────────────────────────

/**
 * Returns true if all three AWS credential env vars are present.
 * Does NOT make a network call — credential expiry is detected at call time.
 */
export function isBedrockAvailable(): boolean {
  return !!(
    process.env.AWS_ACCESS_KEY_ID &&
    process.env.AWS_SECRET_ACCESS_KEY &&
    process.env.AWS_SESSION_TOKEN
  );
}

/**
 * Returns true if the error looks like an expired or missing AWS session.
 */
export function isBedrockAuthError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  const name = err instanceof Error ? (err as NodeJS.ErrnoException).name ?? "" : "";
  return (
    name === "ExpiredTokenException" ||
    name === "UnrecognizedClientException" ||
    name === "InvalidSignatureException" ||
    msg.includes("ExpiredToken") ||
    msg.includes("security token") ||
    msg.includes("UnrecognizedClient") ||
    msg.includes("InvalidSignature") ||
    // HTTP 403 from Bedrock typically means auth failure
    msg.includes("403")
  );
}

// ─── Tool declaration conversion ──────────────────────────────────────────────

type AnthropicToolSchema = {
  type: "object";
  properties: Record<string, { type: string; description?: string }>;
  required?: string[];
};

type AnthropicTool = {
  name: string;
  description: string;
  input_schema: AnthropicToolSchema;
};

/**
 * Converts Gemini FunctionDeclaration[] to Anthropic tool format.
 * Gemini uses uppercase type strings (STRING, NUMBER, OBJECT); Anthropic uses lowercase.
 */
export function toAnthropicTools(declarations: FunctionDeclaration[]): AnthropicTool[] {
  return declarations.map((decl) => {
    const params = decl.parameters as {
      properties?: Record<string, { type: unknown; description?: string }>;
      required?: string[];
    } | undefined;

    const properties: Record<string, { type: string; description?: string }> = {};
    for (const [key, val] of Object.entries(params?.properties ?? {})) {
      properties[key] = {
        type: String(val.type).toLowerCase(),
        ...(val.description ? { description: val.description } : {}),
      };
    }

    return {
      name: decl.name ?? "",
      description: decl.description ?? "",
      input_schema: {
        type: "object" as const,
        properties,
        ...(params?.required ? { required: params.required } : {}),
      },
    };
  });
}

// ─── History conversion ───────────────────────────────────────────────────────

type GeminiPart = { text?: string; functionCall?: { name: string; args: Record<string, unknown> }; functionResponse?: { name: string; response: unknown } };
type GeminiHistoryItem = { role: string; parts: GeminiPart[] };

type AnthropicContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string };

type AnthropicMessage = { role: "user" | "assistant"; content: AnthropicContentBlock[] };

let _toolUseIdCounter = 0;
function nextToolUseId(): string {
  _toolUseIdCounter = (_toolUseIdCounter + 1) % 100000;
  return `toolu_${String(_toolUseIdCounter).padStart(5, "0")}`;
}

/**
 * Converts Gemini-format localHistory to Anthropic MessageParam[].
 * Gemini roles: "user" / "model"  →  Anthropic roles: "user" / "assistant"
 */
export function toAnthropicHistory(history: GeminiHistoryItem[]): AnthropicMessage[] {
  const result: AnthropicMessage[] = [];

  for (const item of history) {
    const role: "user" | "assistant" = item.role === "model" ? "assistant" : "user";
    const content: AnthropicContentBlock[] = [];

    for (const part of item.parts) {
      if (part.text) {
        content.push({ type: "text", text: part.text });
      } else if (part.functionCall) {
        content.push({
          type: "tool_use",
          id: nextToolUseId(),
          name: part.functionCall.name,
          input: part.functionCall.args,
        });
      } else if (part.functionResponse) {
        content.push({
          type: "tool_result",
          tool_use_id: nextToolUseId(),
          content: JSON.stringify(part.functionResponse.response),
        });
      }
    }

    if (content.length > 0) {
      result.push({ role, content });
    }
  }

  return result;
}

// ─── Agentic loop ─────────────────────────────────────────────────────────────

type ToolExecutor = (name: string, input: Record<string, unknown>) => Promise<unknown>;
type SendFn = (text: string) => void;
type SendStatusFn = (text: string) => void;
type ToolStatusFn = (name: string) => string;

export async function runBedrockLoop({
  messages,
  systemPrompt,
  tools,
  toolDeclarations,
  executeTool,
  send,
  sendStatus,
  toolStatusLabel,
  ip,
  reqStart,
}: {
  messages: { role: string; content: string }[];
  systemPrompt: string;
  tools: AnthropicTool[];
  toolDeclarations: FunctionDeclaration[];
  executeTool: ToolExecutor;
  send: SendFn;
  sendStatus: SendStatusFn;
  toolStatusLabel: ToolStatusFn;
  ip: string;
  reqStart: number;
}): Promise<boolean> {
  void toolDeclarations; // already converted to tools; kept for symmetry with caller signature

  const client = new BedrockRuntimeClient({
    region: process.env.AWS_REGION ?? "eu-west-1",
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
      sessionToken: process.env.AWS_SESSION_TOKEN!,
    },
  });

  const modelId = process.env.BEDROCK_MODEL_ID ?? "arn:aws:bedrock:eu-west-1:429326349027:application-inference-profile/uafbxgbdqw21";

  // Build initial Anthropic message history from prior messages (all but last)
  const geminiHistory: GeminiHistoryItem[] = messages.slice(0, -1).map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  const lastMessage = messages[messages.length - 1];

  // Anthropic requires alternating user/assistant turns — convert Gemini history
  let anthropicMessages: AnthropicMessage[] = toAnthropicHistory(geminiHistory);

  // Append the current user message
  anthropicMessages.push({
    role: "user",
    content: [{ type: "text", text: lastMessage.content }],
  });

  sendStatus("Thinking…");
  let responseGenerated = false;

  for (let turn = 0; turn < 5; turn++) {
    console.log("[chat] bedrock turn=%d ip=%s", turn + 1, ip);
    const turnStart = Date.now();

    const requestBody = {
      anthropic_version: "bedrock-2023-05-31",
      max_tokens: 4096,
      system: systemPrompt,
      messages: anthropicMessages,
      tools,
    };

    const command = new InvokeModelWithResponseStreamCommand({
      modelId,
      contentType: "application/json",
      accept: "application/json",
      body: new TextEncoder().encode(JSON.stringify(requestBody)),
    });

    const response = await client.send(command);
    console.log("[chat] bedrock turn=%d elapsed=%dms ip=%s", turn + 1, Date.now() - turnStart, ip);

    // Collect the full streamed response
    let fullText = "";
    const toolUseBlocks: { id: string; name: string; inputJson: string }[] = [];
    let currentToolUse: { id: string; name: string; inputJson: string } | null = null;
    let stopReason = "end_turn";

    if (response.body) {
      for await (const chunk of response.body) {
        if (!chunk.chunk?.bytes) continue;
        const decoded = new TextDecoder().decode(chunk.chunk.bytes);
        let event: Record<string, unknown>;
        try {
          event = JSON.parse(decoded);
        } catch {
          continue;
        }

        const type = event.type as string;

        if (type === "content_block_start") {
          const block = event.content_block as Record<string, unknown>;
          if (block?.type === "tool_use") {
            currentToolUse = {
              id: block.id as string,
              name: block.name as string,
              inputJson: "",
            };
          }
        } else if (type === "content_block_delta") {
          const delta = event.delta as Record<string, unknown>;
          if (delta?.type === "text_delta") {
            fullText += delta.text as string;
          } else if (delta?.type === "input_json_delta" && currentToolUse) {
            currentToolUse.inputJson += delta.partial_json as string;
          }
        } else if (type === "content_block_stop") {
          if (currentToolUse) {
            toolUseBlocks.push(currentToolUse);
            currentToolUse = null;
          }
        } else if (type === "message_delta") {
          const delta = event.delta as Record<string, unknown>;
          if (delta?.stop_reason) {
            stopReason = delta.stop_reason as string;
          }
        }
      }
    }

    if (stopReason === "tool_use" && toolUseBlocks.length > 0) {
      const toolNames = toolUseBlocks.map((t) => t.name).join(", ");
      console.log("[chat] bedrock tool_calls turn=%d tools=[%s] ip=%s", turn + 1, toolNames, ip);

      const label = toolUseBlocks.length === 1
        ? toolStatusLabel(toolUseBlocks[0].name)
        : "Fetching data…";
      sendStatus(label);

      // Build assistant message with tool_use blocks
      const assistantContent: AnthropicContentBlock[] = toolUseBlocks.map((t) => ({
        type: "tool_use" as const,
        id: t.id,
        name: t.name,
        input: (() => {
          try { return JSON.parse(t.inputJson) as Record<string, unknown>; }
          catch { return {}; }
        })(),
      }));
      if (fullText) {
        assistantContent.unshift({ type: "text", text: fullText });
      }
      anthropicMessages.push({ role: "assistant", content: assistantContent });

      // Execute tools and build user tool_result message
      sendStatus("Processing results…");
      const toolResults = await Promise.all(
        toolUseBlocks.map(async (t) => {
          const input = (() => {
            try { return JSON.parse(t.inputJson) as Record<string, unknown>; }
            catch { return {}; }
          })();
          const toolStart = Date.now();
          let output: unknown;
          try {
            output = await executeTool(t.name, input);
            const resultSize = JSON.stringify(output).length;
            if (resultSize > 80_000) {
              console.warn("[chat] bedrock tool_large_result tool=%s resultSize=%d ip=%s", t.name, resultSize, ip);
            }
            console.log("[chat] bedrock tool_ok tool=%s elapsed=%dms ip=%s", t.name, Date.now() - toolStart, ip);
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : "Tool execution failed";
            console.error("[chat] bedrock tool_error tool=%s error=%s ip=%s", t.name, errMsg, ip);
            output = { error: errMsg };
          }
          return {
            type: "tool_result" as const,
            tool_use_id: t.id,
            content: JSON.stringify(output),
          };
        })
      );

      anthropicMessages.push({ role: "user", content: toolResults });
      continue;
    }

    // Final text response
    if (fullText) {
      console.log(
        "[chat] bedrock response_ok turns=%d totalElapsed=%dms responseLen=%d ip=%s",
        turn + 1,
        Date.now() - reqStart,
        fullText.length,
        ip
      );
      const words = fullText.split(/(\s+)/);
      for (const chunk of words) {
        send(chunk);
        await new Promise((r) => setTimeout(r, 10));
      }
      responseGenerated = true;
    } else {
      console.warn("[chat] bedrock empty_response turn=%d ip=%s", turn + 1, ip);
    }
    break;
  }

  return responseGenerated;
}
