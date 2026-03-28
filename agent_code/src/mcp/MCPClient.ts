import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

type Transport = StdioClientTransport | StreamableHTTPClientTransport;

const DEFAULT_CONNECT_TIMEOUT_MS = 15_000;
const DEFAULT_TOOL_TIMEOUT_MS = 30_000;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, action: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${action} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    promise
      .then((result) => {
        clearTimeout(timer);
        resolve(result);
      })
      .catch((error: unknown) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

export class CangjieMCPClient {
  private readonly client: Client;
  private transport?: Transport;
  private connected = false;

  constructor(clientName = "cangjie-orchestrator", clientVersion = "1.0.0") {
    this.client = new Client({
      name: clientName,
      version: clientVersion,
    });
  }

  async connect(serverPath: string, args: string[] = []): Promise<void> {
    if (!serverPath || serverPath.trim().length === 0) {
      throw new Error("serverPath is required to connect to MCP server");
    }

    try {
      this.transport = new StdioClientTransport({
        command: serverPath,
        args,
      });

      await withTimeout(
        this.client.connect(this.transport),
        DEFAULT_CONNECT_TIMEOUT_MS,
        "MCP server connection"
      );
      this.connected = true;
    } catch (error: unknown) {
      this.connected = false;
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to connect to MCP server (${serverPath}): ${message}`);
    }
  }

  async connectHTTP(url: string, authToken?: string): Promise<void> {
    if (!url || url.trim().length === 0) {
      throw new Error("url is required to connect to MCP HTTP server");
    }

    try {
      const headers: Record<string, string> = {};
      if (authToken) {
        headers["Authorization"] = `Bearer ${authToken}`;
      }

      this.transport = new StreamableHTTPClientTransport(
        new URL(url),
        { requestInit: { headers } },
      );

      await withTimeout(
        this.client.connect(this.transport),
        DEFAULT_CONNECT_TIMEOUT_MS,
        "MCP HTTP server connection"
      );
      this.connected = true;
    } catch (error: unknown) {
      this.connected = false;
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to connect to MCP HTTP server (${url}): ${message}`);
    }
  }

  async listTools(): Promise<unknown[]> {
    this.ensureConnected();

    try {
      const response = await withTimeout(
        this.client.listTools(),
        DEFAULT_TOOL_TIMEOUT_MS,
        "listTools"
      );

      return response?.tools ?? [];
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to list MCP tools: ${message}`);
    }
  }

  async callTool(toolName: string, arguments_: any): Promise<unknown> {
    this.ensureConnected();

    if (!toolName || toolName.trim().length === 0) {
      throw new Error("toolName is required");
    }

    try {
      return await withTimeout(
        this.client.callTool({
          name: toolName,
          arguments: arguments_,
        }),
        DEFAULT_TOOL_TIMEOUT_MS,
        `callTool(${toolName})`
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to call MCP tool "${toolName}": ${message}`);
    }
  }

  async close(): Promise<void> {
    try {
      if (this.transport) {
        await this.transport.close();
      }
    } finally {
      this.connected = false;
      this.transport = undefined;
    }
  }

  private ensureConnected(): void {
    if (!this.connected) {
      throw new Error("MCP client is not connected. Call connect() first.");
    }
  }
}
