import dotenv from "dotenv";

import { ContextBuilder } from "../llm/ContextBuilder.js";
import { LLMProvider } from "../llm/LLMProvider.js";
import { KnowledgeBase } from "../knowledge/KnowledgeBase.js";
import { CangjieMCPClient } from "../mcp/MCPClient.js";
import { ProjectStateTracker } from "../memory/ProjectStateTracker.js";
import { ShortTermMemory } from "../memory/ShortTermMemory.js";
import { Orchestrator } from "../orchestrator/Orchestrator.js";
import { TaskPlanner } from "../orchestrator/TaskPlanner.js";

dotenv.config({ override: true });

function parseMcpArgs(raw: string | undefined): string[] {
  if (!raw?.trim()) {
    return [];
  }
  return raw.split(/\s+/).filter(Boolean);
}

async function connectMCP(mcpClient: CangjieMCPClient): Promise<void> {
  const transport = process.env.MCP_TRANSPORT?.trim().toLowerCase() ?? "stdio";

  if (transport === "http") {
    const httpUrl = process.env.MCP_HTTP_URL?.trim();
    if (!httpUrl) {
      throw new Error(
        "MCP_TRANSPORT=http 时必须设置 MCP_HTTP_URL，例如 http://127.0.0.1:3100/mcp"
      );
    }
    const authToken = process.env.MCP_AUTH_TOKEN?.trim() || undefined;
    await mcpClient.connectHTTP(httpUrl, authToken);
    console.log(`已通过 HTTP 连接到 MCP Server: ${httpUrl}`);
    return;
  }

  const serverPath = process.env.MCP_SERVER_PATH?.trim();
  if (!serverPath) {
    throw new Error("缺少 MCP_SERVER_PATH，请在 .env 中配置 MCP 服务路径。");
  }
  const mcpArgs = parseMcpArgs(process.env.MCP_SERVER_ARGS);
  await mcpClient.connect(serverPath, mcpArgs);
  console.log(`已通过 stdio 连接到 MCP Server: ${serverPath}`);
}

async function initKnowledgeBase(): Promise<KnowledgeBase | undefined> {
  const skillsPath = process.env.CANGJIE_SKILLS_PATH?.trim();
  if (!skillsPath) {
    console.log("[KnowledgeBase] 未配置 CANGJIE_SKILLS_PATH，跳过知识库加载。");
    return undefined;
  }

  const kb = new KnowledgeBase();
  await kb.loadFromDirectory(skillsPath);

  if (kb.skillCount === 0) {
    console.warn("[KnowledgeBase] 知识库加载完成但未找到任何主题。");
    return undefined;
  }

  console.log(`[KnowledgeBase] 知识库就绪，共 ${kb.skillCount} 个主题可供检索。`);
  return kb;
}

async function main(): Promise<void> {
  const goal = process.argv[2]?.trim();
  if (!goal) {
    console.log("用法: node dist/cli/index.js \"你的任务目标\"");
    process.exitCode = 1;
    return;
  }

  const llmProvider = new LLMProvider();
  const mcpClient = new CangjieMCPClient();
  const tracker = new ProjectStateTracker(mcpClient);
  const shortTermMemory = new ShortTermMemory();

  const knowledgeBase = await initKnowledgeBase();

  const planner = new TaskPlanner(llmProvider, knowledgeBase);
  const contextBuilder = new ContextBuilder();
  const orchestrator = new Orchestrator(
    llmProvider,
    mcpClient,
    tracker,
    shortTermMemory,
    planner,
    contextBuilder,
    knowledgeBase
  );

  try {
    await connectMCP(mcpClient);
    console.log(`🚀 正在启动仓颉自主 Agent，目标：'${goal}'...`);
    await orchestrator.execute(goal);
  } finally {
    await mcpClient.close().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`关闭 MCP 连接时发生错误: ${message}`);
    });
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Agent 启动失败: ${message}`);
  process.exitCode = 1;
});
