import type { ModelConnection } from "@/lib/model-config";
import { normalizeModelBaseUrl } from "@/lib/model-url";

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function extractModelText(body: unknown, chatFormat: boolean) {
  const root = record(body);
  if (!root) return "";
  const choice = record((root.choices as unknown[] | undefined)?.[0]);
  const message = record(choice?.message);
  const toolArguments = record(
    (message?.tool_calls as unknown[] | undefined)?.[0],
  )?.function;
  const argumentsText = record(toolArguments)?.arguments;
  if (typeof argumentsText === "string") return argumentsText;
  const content = message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content))
    return content
      .map((item) => {
        const part = record(item);
        return typeof part?.text === "string"
          ? part.text
          : typeof part?.content === "string"
            ? part.content
            : "";
      })
      .join("");
  if (typeof choice?.text === "string") return choice.text;
  if (chatFormat) return "";
  if (typeof root.output_text === "string") return root.output_text;
  if (Array.isArray(root.output))
    return root.output
      .flatMap((item) => {
        const output = record(item);
        return Array.isArray(output?.content) ? output.content : [];
      })
      .map((item) => {
        const part = record(item);
        return typeof part?.text === "string"
          ? part.text
          : typeof part?.output_text === "string"
            ? part.output_text
            : "";
      })
      .join("");
  return "";
}

function parseModelJson(text: string): UnknownRecord | null {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  const candidate = start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned;
  try {
    let parsed: unknown = JSON.parse(candidate);
    if (typeof parsed === "string") parsed = JSON.parse(parsed);
    return record(parsed);
  } catch {
    return null;
  }
}

export function getModelRequestTimeoutMs() {
  const configured = Number(process.env.MODEL_REQUEST_TIMEOUT_MS || 45_000);
  return Number.isFinite(configured)
    ? Math.min(60_000, Math.max(500, Math.round(configured)))
    : 45_000;
}

async function readResponseJson(response: Response) {
  const maximumBytes = 1_000_000;
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maximumBytes) {
    await response.body?.cancel();
    throw new Error("模型响应内容过大");
  }
  if (!response.body) throw new Error("模型响应内容为空");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let receivedBytes = 0;
  let text = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      receivedBytes += chunk.value.byteLength;
      if (receivedBytes > maximumBytes) {
        await reader.cancel("模型响应内容过大");
        throw new Error("模型响应内容过大");
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
  } finally {
    reader.releaseLock();
  }
  return JSON.parse(text) as unknown;
}

async function discardResponse(response: Response) {
  try {
    await response.body?.cancel();
  } catch {
    // The fallback request can proceed even if the provider already closed it.
  }
}

export async function requestModelJsonObject(
  connection: ModelConnection,
  systemPrompt: string,
  context: unknown,
  options: {
    beforeRequest?: () => Promise<boolean>;
    deadlineAt?: number;
  } = {},
) {
  if (!connection.apiKey || !connection.model) return null;
  const deadline = options.deadlineAt || Date.now() + getModelRequestTimeoutMs();
  const normalizedBase = await normalizeModelBaseUrl(
    connection.baseUrl || "https://api.openai.com/v1",
    { deadlineAt: deadline },
  );
  const directChat = normalizedBase.endsWith("/chat/completions");
  const directResponses = normalizedBase.endsWith("/responses");
  const responsesUrl =
    directChat || directResponses ? normalizedBase : `${normalizedBase}/responses`;
  const chatUrl = directResponses
    ? normalizedBase.replace(/\/responses$/, "/chat/completions")
    : directChat
      ? normalizedBase
      : `${normalizedBase}/chat/completions`;
  const request = async (url: string, chat: boolean, jsonMode = true) => {
    if (Date.now() >= deadline) throw new Error("模型请求超时");
    if (options.beforeRequest && !(await options.beforeRequest()))
      throw new Error("模型调用额度已用尽");
    return fetch(url, {
      method: "POST",
      signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())),
      redirect: "error",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${connection.apiKey}`,
      },
      body: JSON.stringify(
        chat
          ? {
              model: connection.model,
              messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: JSON.stringify(context) },
              ],
              ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
            }
          : {
              model: connection.model,
              input: [
                {
                  role: "system",
                  content: [{ type: "input_text", text: systemPrompt }],
                },
                {
                  role: "user",
                  content: [
                    { type: "input_text", text: JSON.stringify(context) },
                  ],
                },
              ],
            },
      ),
    });
  };

  let response = await request(responsesUrl, directChat);
  let chatFormat = directChat;
  if (!directChat && [400, 404, 405, 422, 501].includes(response.status)) {
    await discardResponse(response);
    response = await request(chatUrl, true);
    chatFormat = true;
  }
  if (chatFormat && [400, 422].includes(response.status)) {
    await discardResponse(response);
    response = await request(chatUrl, true, false);
  }
  if (!response.ok) {
    await discardResponse(response);
    return null;
  }
  let parsed = parseModelJson(
    extractModelText(await readResponseJson(response), chatFormat),
  );
  if (!parsed && !chatFormat) {
    response = await request(chatUrl, true);
    if ([400, 422].includes(response.status)) {
      await discardResponse(response);
      response = await request(chatUrl, true, false);
    }
    if (response.ok)
      parsed = parseModelJson(
        extractModelText(await readResponseJson(response), true),
      );
    else await discardResponse(response);
  }
  return parsed;
}
