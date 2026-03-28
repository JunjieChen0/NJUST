import dotenv from "dotenv";

import { CANGJIE_SYSTEM_PROMPT } from "../llm/CangjieSystemPrompt.js";
import { ContextBuilder } from "../llm/ContextBuilder.js";
import { LLMProvider } from "../llm/LLMProvider.js";
import { KnowledgeBase } from "../knowledge/KnowledgeBase.js";
import { CangjieMCPClient } from "../mcp/MCPClient.js";

dotenv.config({ override: true });

async function testLLMConnectivity(): Promise<void> {
  console.log("\n=== 测试 1: LLM 连通性 ===");
  try {
    const provider = new LLMProvider();
    const reply = await provider.chat(
      CANGJIE_SYSTEM_PROMPT,
      "仓颉语言中如何使用 spawn 关键字？请给一个最小示例。"
    );

    console.log("LLM 返回结果：");
    console.log(reply);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`LLM 连通性测试失败: ${message}`);
  }
}

function testContextBuilder(): void {
  console.log("\n=== 测试 2: Context 构建 ===");
  try {
    const builder = new ContextBuilder();
    const prompt = builder.build(
      "为项目新增一个仓颉代码生成命令，并保证错误处理完备。",
      [
        "src/",
        "  cli/",
        "    verify-setup.ts",
        "  llm/",
        "    LLMProvider.ts",
        "    ContextBuilder.ts",
        "  mcp/",
        "    MCPClient.ts",
      ].join("\n"),
      []
    );

    const hasUndefined = prompt.includes("undefined");
    const isEmpty = prompt.trim().length === 0;
    const preview = prompt.slice(0, 200);

    console.log(`Prompt 长度: ${prompt.length}`);
    console.log(`包含 undefined: ${hasUndefined ? "是" : "否"}`);
    console.log(`为空字符串: ${isEmpty ? "是" : "否"}`);
    console.log("Prompt 前 200 个字符：");
    console.log(preview);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Context 构建测试失败: ${message}`);
  }
}

async function testMCPConnectivityIfConfigured(): Promise<void> {
  console.log("\n=== 测试 3: MCP 连接（可选） ===");

  const transport = process.env.MCP_TRANSPORT?.trim().toLowerCase() ?? "stdio";
  const mcpClient = new CangjieMCPClient();

  try {
    if (transport === "http") {
      const httpUrl = process.env.MCP_HTTP_URL?.trim();
      if (!httpUrl) {
        console.log("MCP_TRANSPORT=http 但未配置 MCP_HTTP_URL，跳过 MCP 测试");
        return;
      }
      const authToken = process.env.MCP_AUTH_TOKEN?.trim() || undefined;
      await mcpClient.connectHTTP(httpUrl, authToken);
      console.log(`已通过 HTTP 连接到: ${httpUrl}`);
    } else {
      const serverPath = process.env.MCP_SERVER_PATH?.trim();
      if (!serverPath) {
        console.log("请在 .env 中配置 MCP_SERVER_PATH 或 MCP_HTTP_URL 以测试连接");
        return;
      }
      const rawArgs = process.env.MCP_SERVER_ARGS?.trim() ?? "";
      const args = rawArgs.length > 0 ? rawArgs.split(/\s+/) : [];
      await mcpClient.connect(serverPath, args);
      console.log(`已通过 stdio 连接到: ${serverPath}`);
    }

    const tools = await mcpClient.listTools();
    console.log(`MCP 连接成功，可用工具数量: ${tools.length}`);
    console.log("工具列表：");
    console.log(tools);

    await mcpClient.close();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`MCP 连接测试失败: ${message}`);
    await mcpClient.close().catch(() => {});
  }
}

async function testKnowledgeBase(): Promise<void> {
  console.log("\n=== 测试 4: 知识库加载 ===");
  const skillsPath = process.env.CANGJIE_SKILLS_PATH?.trim();
  if (!skillsPath) {
    console.log("未配置 CANGJIE_SKILLS_PATH，跳过知识库测试。");
    return;
  }

  try {
    const kb = new KnowledgeBase();
    await kb.loadFromDirectory(skillsPath);
    console.log(`知识库已加载，共 ${kb.skillCount} 个主题。`);

    const testQuery = "使用 HashMap 和 ArrayList 实现一个简单的缓存";
    const result = kb.queryRelevantKnowledge(testQuery, 2);
    console.log(`检索测试（"${testQuery}"）：`);
    console.log(result ? `找到相关知识（${result.length} 字符）` : "未找到相关知识");
    if (result) {
      console.log("前 300 字符：");
      console.log(result.slice(0, 300));
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`知识库测试失败: ${message}`);
  }
}

async function main(): Promise<void> {
  await testLLMConnectivity();
  testContextBuilder();
  await testKnowledgeBase();
  await testMCPConnectivityIfConfigured();
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`verify-setup 执行失败: ${message}`);
  process.exitCode = 1;
});
