import { z } from "zod";

import { CANGJIE_SYSTEM_PROMPT } from "../llm/CangjieSystemPrompt.js";
import { LLMProvider } from "../llm/LLMProvider.js";
import { KnowledgeBase } from "../knowledge/KnowledgeBase.js";

export const PlanStepSchema = z.object({
  id: z.number(),
  description: z.string(),
  type: z.enum(["coder", "debugger", "tester"]),
  expected_outcome: z.string(),
});

export const PlanSchema = z.object({
  steps: z.array(PlanStepSchema),
});

export type PlanStep = z.infer<typeof PlanStepSchema>;
export type Plan = z.infer<typeof PlanSchema>;

export class TaskPlanner {
  private readonly llmProvider: LLMProvider;
  private readonly knowledgeBase?: KnowledgeBase;

  constructor(llmProvider?: LLMProvider, knowledgeBase?: KnowledgeBase) {
    this.llmProvider = llmProvider ?? new LLMProvider();
    this.knowledgeBase = knowledgeBase;
  }

  async plan(userGoal: string, fileTree: string): Promise<Plan> {
    if (!userGoal?.trim()) {
      throw new Error("userGoal 不能为空");
    }

    const knowledgeSection = this.buildKnowledgeSection(userGoal);

    const userPrompt = [
      "你是一个仓颉（Cangjie）语言架构师。请将用户目标拆解为具体的执行步骤。",
      "你必须返回纯 JSON，不要返回 Markdown，不要使用 ```json 代码块，不要添加额外解释文本。",
      "返回格式必须为：",
      '{"steps":[{"id":1,"description":"...","type":"coder","expected_outcome":"..."}]}',
      "",
      "约束：",
      "- steps 至少 1 步。",
      "- id 必须从 1 递增。",
      "- type 只能是 coder / debugger / tester。",
      "- expected_outcome 必须可验证。",
      "- 如果是新建项目，第一步应创建 cjpm.toml（name 小驼峰、cjc-version 必填、output-type 必填）。",
      "- 代码文件放在 src/ 目录下，入口文件为 src/main.cj。",
      "- 最后一步应包含 cjpm build 编译验证。",
      "",
      knowledgeSection,
      "用户目标：",
      userGoal.trim(),
      "",
      "当前项目文件树：",
      fileTree?.trim() || "(empty)",
    ].join("\n");

    const raw = await this.llmProvider.chat(CANGJIE_SYSTEM_PROMPT, userPrompt);
    const firstTry = this.tryParsePlan(raw);
    if (firstTry.success) {
      return firstTry.data;
    }

    const cleaned = this.cleanupMarkdown(raw);
    const secondTry = this.tryParsePlan(cleaned);
    if (secondTry.success) {
      return secondTry.data;
    }

    throw new Error(
      [
        "TaskPlanner 解析 LLM 规划结果失败。",
        `第一次解析错误: ${firstTry.error}`,
        `清理后解析错误: ${secondTry.error}`,
        `LLM 原始输出: ${raw}`,
        `清理后输出: ${cleaned}`,
      ].join("\n")
    );
  }

  private buildKnowledgeSection(userGoal: string): string {
    if (!this.knowledgeBase || this.knowledgeBase.skillCount === 0) {
      return "";
    }

    const knowledge = this.knowledgeBase.queryRelevantKnowledge(userGoal, 2);
    if (!knowledge) return "";

    return [
      "以下是与任务相关的仓颉语言参考知识，请在规划时考虑：",
      knowledge,
      "",
    ].join("\n");
  }

  private tryParsePlan(input: string): { success: true; data: Plan } | { success: false; error: string } {
    try {
      const parsed = JSON.parse(input) as unknown;
      const validated = PlanSchema.safeParse(parsed);
      if (validated.success) {
        return { success: true, data: validated.data };
      }

      return {
        success: false,
        error: validated.error.issues
          .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
          .join("; "),
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
}
