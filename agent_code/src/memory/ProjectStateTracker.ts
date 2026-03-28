import { CangjieMCPClient } from "../mcp/MCPClient.js";

type ListFilesToolResponse =
  | string[]
  | {
      files?: string[];
      paths?: string[];
      data?: {
        files?: string[];
        paths?: string[];
      };
      content?: Array<{
        type?: string;
        text?: string;
      }>;
    };

type TreeNode = Map<string, TreeNode>;

export class ProjectStateTracker {
  private readonly mcpClient: CangjieMCPClient;
  private files: string[] = [];

  constructor(mcpClient: CangjieMCPClient) {
    this.mcpClient = mcpClient;
  }

  async refreshFileTree(): Promise<string[]> {
    const raw = (await this.mcpClient.callTool("list_files", { path: ".", recursive: true })) as ListFilesToolResponse;
    const files = this.extractFileList(raw);
    this.files = files;
    return [...this.files];
  }

  getFileTreeSummary(): string {
    if (this.files.length === 0) {
      return "(empty)";
    }

    const root: TreeNode = new Map();
    for (const filePath of this.files) {
      const segments = filePath.split("/").filter(Boolean);
      let cursor = root;
      for (const segment of segments) {
        if (!cursor.has(segment)) {
          cursor.set(segment, new Map());
        }
        cursor = cursor.get(segment)!;
      }
    }

    const lines: string[] = [];
    this.renderTree(root, "", lines);
    return lines.join("\n");
  }

  private renderTree(node: TreeNode, prefix: string, lines: string[]): void {
    const entries = [...node.entries()].sort(([a], [b]) => a.localeCompare(b));
    entries.forEach(([name, child], index) => {
      const isLast = index === entries.length - 1;
      lines.push(`${prefix}${isLast ? "└── " : "├── "}${name}`);
      this.renderTree(child, `${prefix}${isLast ? "    " : "│   "}`, lines);
    });
  }

  private extractFileList(raw: ListFilesToolResponse): string[] {
    const direct =
      (Array.isArray(raw) ? raw : undefined) ??
      (!Array.isArray(raw) ? raw.files : undefined) ??
      (!Array.isArray(raw) ? raw.paths : undefined) ??
      (!Array.isArray(raw) ? raw.data?.files : undefined) ??
      (!Array.isArray(raw) ? raw.data?.paths : undefined);

    if (Array.isArray(direct)) {
      return this.normalizeFileList(direct);
    }

    const textChunk = !Array.isArray(raw)
      ? raw.content?.find((item) => item.type === "text")?.text
      : undefined;

    if (textChunk) {
      try {
        const parsed = JSON.parse(textChunk) as { files?: string[]; paths?: string[] };
        const fromJson = parsed.files ?? parsed.paths;
        if (Array.isArray(fromJson)) {
          return this.normalizeFileList(fromJson);
        }
      } catch {
        // Ignore parse errors and fallback to a line-based split.
      }

      return this.normalizeFileList(textChunk.split(/\r?\n/));
    }

    throw new Error('list_files 返回格式无法识别，请检查 MCP Server 工具返回结构');
  }

  private normalizeFileList(values: string[]): string[] {
    return [...new Set(values.map((v) => v.trim().replace(/\\/g, "/")).filter(Boolean))].sort(
      (a, b) => a.localeCompare(b)
    );
  }
}
