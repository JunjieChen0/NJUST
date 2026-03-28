import { CANGJIE_SYSTEM_PROMPT } from "../llm/CangjieSystemPrompt.js";
import { ContextBuilder } from "../llm/ContextBuilder.js";
import { LLMProvider } from "../llm/LLMProvider.js";
import { KnowledgeBase } from "../knowledge/KnowledgeBase.js";
import { CangjieMCPClient } from "../mcp/MCPClient.js";
import { ProjectStateTracker } from "../memory/ProjectStateTracker.js";
import { ShortTermMemory } from "../memory/ShortTermMemory.js";
import { PlanStep, TaskPlanner } from "./TaskPlanner.js";

const CANGJIE_FILE_PACKAGE_REMINDER = [
  "【写 .cj 文件的强制要求】",
  "用 write_to_file 写 .cj 文件时，文件内容（content）的第一行必须是 package 声明。",
  "根包名 = cjpm.toml 的 name 字段值（不是 default）。",
  "例如 cjpm.toml name=\"helloWorld\" 时：",
  "  - src/main.cj 内容第一行 → package helloWorld",
  "  - src/utils/helper.cj 内容第一行 → package helloWorld.utils",
  "  - main.cj 中导入 → import helloWorld.utils.*",
  "  - 子包中被外部使用的函数/类型必须加 public 修饰符",
  "绝对不允许生成不带 package 声明的 .cj 文件内容！",
].join("\n");

interface ToolDecision {
  tool: string;
  arguments: Record<string, unknown>;
}

interface StepExecutionResult {
  stepId: number;
  description: string;
  success: boolean;
  tool?: string;
  error?: string;
}

export class Orchestrator {
  constructor(
    private readonly llmProvider: LLMProvider,
    private readonly mcpClient: CangjieMCPClient,
    private readonly tracker: ProjectStateTracker,
    private readonly shortTermMemory: ShortTermMemory,
    private readonly planner: TaskPlanner,
    private readonly contextBuilder: ContextBuilder,
    private readonly knowledgeBase?: KnowledgeBase
  ) {}

  async execute(userGoal: string): Promise<void> {
    if (!userGoal?.trim()) {
      throw new Error("userGoal 不能为空");
    }

    await this.tracker.refreshFileTree();
    const plan = await this.planner.plan(userGoal, this.tracker.getFileTreeSummary());
    const stepResults: StepExecutionResult[] = [];

    for (const step of plan.steps) {
      const stepResult = await this.executeStep(step, userGoal);
      stepResults.push(stepResult);
    }

    this.printReport(stepResults);
  }

  private async executeStep(step: PlanStep, userGoal: string): Promise<StepExecutionResult> {
    console.log(`[Step ${step.id}] 开始执行: ${step.description}`);

    const firstAttempt = await this.runSingleAttempt(step, userGoal);
    if (firstAttempt.success) {
      return firstAttempt;
    }

    const repaired = await this.trySelfCorrection(step, userGoal, firstAttempt.error ?? "unknown error");
    return repaired;
  }

  private async runSingleAttempt(step: PlanStep, userGoal: string): Promise<StepExecutionResult> {
    try {
      const decision = await this.generateToolDecision(step, userGoal);
      const toolResult = await this.mcpClient.callTool(decision.tool, decision.arguments);

      const resultText = this.toResultText(toolResult);
      this.shortTermMemory.addStep(`tool:${decision.tool}`, resultText, true);
      await this.tracker.refreshFileTree();

      return {
        stepId: step.id,
        description: step.description,
        success: true,
        tool: decision.tool,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.shortTermMemory.addStep(`step:${step.id}`, message, false);

      return {
        stepId: step.id,
        description: step.description,
        success: false,
        error: message,
      };
    }
  }

  private async trySelfCorrection(
    step: PlanStep,
    userGoal: string,
    previousError: string
  ): Promise<StepExecutionResult> {
    try {
      const fileTree = this.tracker.getFileTreeSummary();
      const memorySummary = this.shortTermMemory.getHistorySummary();
      const knowledge = this.getRelevantKnowledge(`${userGoal} ${step.description} ${previousError}`);
      const repairPrompt = [
        this.contextBuilder.build(
          `原始目标: ${userGoal}\n当前步骤: ${step.description}`,
          fileTree,
          [{ role: "system", content: memorySummary }],
          knowledge
        ),
        "",
        "上一次执行失败，错误如下：",
        previousError,
        "",
        CANGJIE_FILE_PACKAGE_REMINDER,
        "",
        '请只输出纯 JSON，格式：{"tool":"工具名","arguments":{...}}',
        "要求：针对该错误给出修复动作，并尽量选择最小变更。写文件必须用 write_to_file，禁止删除任何文件。",
      ].join("\n");

      const raw = await this.llmProvider.chat(CANGJIE_SYSTEM_PROMPT, repairPrompt);
      const decision = this.parseToolDecision(raw);
      const toolResult = await this.mcpClient.callTool(decision.tool, decision.arguments);

      const resultText = this.toResultText(toolResult);
      this.shortTermMemory.addStep(`repair:${decision.tool}`, resultText, true);
      await this.tracker.refreshFileTree();

      return {
        stepId: step.id,
        description: step.description,
        success: true,
        tool: decision.tool,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.shortTermMemory.addStep(`step:${step.id}`, `修复失败: ${message}`, false);
      return {
        stepId: step.id,
        description: step.description,
        success: false,
        error: `原始错误: ${previousError}; 修复失败: ${message}`,
      };
    }
  }

  private async generateToolDecision(step: PlanStep, userGoal: string): Promise<ToolDecision> {
    const fileTree = this.tracker.getFileTreeSummary();
    const memorySummary = this.shortTermMemory.getHistorySummary();
    const knowledge = this.getRelevantKnowledge(`${userGoal} ${step.description}`);
    const prompt = [
      this.contextBuilder.build(
        `总体目标: ${userGoal}\n当前步骤: ${step.description}`,
        fileTree,
        [{ role: "system", content: memorySummary }],
        knowledge
      ),
      "",
      "请根据上下文决策下一步要调用的 MCP 工具。",
      "可用工具：read_file, write_to_file, list_files, search_files, execute_command, apply_diff。",
      "重要规则：创建或写入文件必须用 write_to_file，禁止用 execute_command 的 echo/重定向写文件，禁止删除任何文件。",
      "",
      CANGJIE_FILE_PACKAGE_REMINDER,
      "",
      '必须返回纯 JSON，严格格式：{"tool":"工具名","arguments":{...}}',
      "不要返回 Markdown，不要包含额外解释。",
    ].join("\n");

    const raw = await this.llmProvider.chat(CANGJIE_SYSTEM_PROMPT, prompt);
    return this.parseToolDecision(raw);
  }

  private getRelevantKnowledge(queryText: string): string {
    if (!this.knowledgeBase || this.knowledgeBase.skillCount === 0) {
      return "";
    }
    return this.knowledgeBase.queryRelevantKnowledge(queryText, 3);
  }

  private parseToolDecision(raw: string): ToolDecision {
    const first = this.tryParseDecision(raw);
    if (first.success) {
      return first.data;
    }

    const cleaned = this.cleanupMarkdown(raw);
    const second = this.tryParseDecision(cleaned);
    if (second.success) {
      return second.data;
    }

    throw new Error(
      [
        "无法解析 LLM 的工具决策 JSON。",
        `第一次错误: ${first.error}`,
        `清理后错误: ${second.error}`,
        `原始输出: ${raw}`,
      ].join("\n")
    );
  }

  private tryParseDecision(
    input: string
  ): { success: true; data: ToolDecision } | { success: false; error: string } {
    try {
      const parsed = JSON.parse(input) as Partial<ToolDecision>;
      if (!parsed.tool || typeof parsed.tool !== "string") {
        return { success: false, error: "field tool missing or not string" };
      }
      if (!parsed.arguments || typeof parsed.arguments !== "object" || Array.isArray(parsed.arguments)) {
        return { success: false, error: "field arguments missing or not object" };
      }

      return {
        success: true,
        data: {
          tool: parsed.tool,
          arguments: parsed.arguments as Record<string, unknown>,
        },
      };
    } catch (error: unknown) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private cleanupMarkdown(text: string): string {
    const trimmed = text.trim();
    const codeBlockMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    if (codeBlockMatch?.[1]) {
      return codeBlockMatch[1].trim();
    }

    return trimmed.replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
  }

  private toResultText(result: unknown): string {
    if (typeof result === "string") {
      return result;
    }
    try {
      return JSON.stringify(result);
    } catch {
      return String(result);
    }
  }

  private printReport(results: StepExecutionResult[]): void {
    const successCount = results.filter((r) => r.success).length;
    const failCount = results.length - successCount;
    console.log("\n=== Orchestrator 执行总结 ===");
    console.log(`总步骤: ${results.length}, 成功: ${successCount}, 失败: ${failCount}`);
    for (const item of results) {
      if (item.success) {
        console.log(`[Step ${item.stepId}] SUCCESS - ${item.description} (${item.tool ?? "unknown tool"})`);
      } else {
        console.log(`[Step ${item.stepId}] FAILED - ${item.description}; error=${item.error ?? "unknown"}`);
      }
    }
    console.log("\n最近操作记忆：");
    console.log(this.shortTermMemory.getHistorySummary());
  }
}
