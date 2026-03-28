import dotenv from "dotenv";

import { LLMProvider } from "../llm/LLMProvider.js";
import { KnowledgeBase } from "../knowledge/KnowledgeBase.js";
import { TaskPlanner } from "../orchestrator/TaskPlanner.js";

dotenv.config({ override: true });

async function main(): Promise<void> {
  const llmProvider = new LLMProvider();

  let knowledgeBase: KnowledgeBase | undefined;
  const skillsPath = process.env.CANGJIE_SKILLS_PATH?.trim();
  if (skillsPath) {
    knowledgeBase = new KnowledgeBase();
    await knowledgeBase.loadFromDirectory(skillsPath);
    console.log(`[KnowledgeBase] 已加载 ${knowledgeBase.skillCount} 个主题`);
  }

  const planner = new TaskPlanner(llmProvider, knowledgeBase);

  const userGoal =
    "帮我创建一个仓颉项目，包含一个 main.cj 文件和一个名为 math 的包，在 math 包里实现一个加法函数，并在主函数中调用它。";
  const fileTree = "src/\n main.cj";

  try {
    const plan = await planner.plan(userGoal, fileTree);
    console.log("解析后的规划 JSON：");
    console.log(JSON.stringify(plan, null, 2));
    console.log(`✅ 任务规划器解析成功，共拆解为 ${plan.steps.length} 个步骤。`);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`❌ 任务规划器解析失败: ${message}`);
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`test-planner 执行失败: ${message}`);
  process.exitCode = 1;
});
