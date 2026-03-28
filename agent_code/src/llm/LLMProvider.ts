import dotenv from "dotenv";
import OpenAI from "openai";

dotenv.config({ override: true });

export interface LLMProviderOptions {
  apiKey?: string;
  basePath?: string;
  model?: string;
  temperature?: number;
}

const PROXY_ENV_KEYS = [
  "HTTPS_PROXY",
  "https_proxy",
  "HTTP_PROXY",
  "http_proxy",
  "ALL_PROXY",
  "all_proxy",
] as const;

function normalizeProxyEnv(): { enabled: string[]; ignored: string[] } {
  const enabled: string[] = [];
  const ignored: string[] = [];

  for (const key of PROXY_ENV_KEYS) {
    const value = process.env[key]?.trim();
    if (!value) {
      continue;
    }

    try {
      const proxyUrl = new URL(value);
      if (!proxyUrl.protocol || !proxyUrl.hostname) {
        throw new Error("missing protocol or hostname");
      }
      enabled.push(`${key}=${proxyUrl.protocol}//${proxyUrl.host}`);
    } catch {
      ignored.push(`${key}=${value}`);
      // Invalid proxy values often break underlying HTTP clients; ignore them safely.
      delete process.env[key];
    }
  }

  return { enabled, ignored };
}

export class LLMProvider {
  private readonly client: OpenAI;
  private readonly model: string;
  private readonly temperature: number;
  private readonly baseURL?: string;
  private readonly proxyInfo: { enabled: string[]; ignored: string[] };

  constructor(options: LLMProviderOptions = {}) {
    const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("Missing API key. Please set OPENAI_API_KEY in .env.");
    }

    const basePath =
      options.basePath ?? process.env.OPENAI_BASE_URL ?? process.env.OPENAI_BASE_PATH;
    this.baseURL = basePath ?? undefined;
    this.proxyInfo = normalizeProxyEnv();

    this.client = new OpenAI({
      apiKey,
      baseURL: basePath,
    });

    this.model = options.model ?? process.env.MODEL ?? process.env.OPENAI_MODEL ?? "deepseek-chat";
    this.temperature =
      options.temperature ?? Number(process.env.OPENAI_TEMPERATURE ?? "0.2");
  }

  async chat(systemPrompt: string, userPrompt: string): Promise<string> {
    if (!systemPrompt?.trim()) {
      throw new Error("systemPrompt cannot be empty");
    }
    if (!userPrompt?.trim()) {
      throw new Error("userPrompt cannot be empty");
    }

    let completion;
    try {
      completion = await this.client.chat.completions.create({
        model: this.model,
        temperature: this.temperature,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      const proxyEnabled = this.proxyInfo.enabled.length
        ? this.proxyInfo.enabled.join(", ")
        : "none";
      const proxyIgnored = this.proxyInfo.ignored.length
        ? this.proxyInfo.ignored.join(", ")
        : "none";
      throw new Error(
        `LLM request failed: ${message}. baseURL=${this.baseURL ?? "default"}, model=${this.model}, proxyEnabled=${proxyEnabled}, proxyIgnored=${proxyIgnored}`
      );
    }

    const content = completion.choices[0]?.message?.content;
    if (!content) {
      throw new Error("OpenAI response does not contain message content");
    }

    return content;
  }
}
