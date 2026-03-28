export interface ContextBuilderHistoryItem {
  role: "user" | "assistant" | "system";
  content: string;
}

export class ContextBuilder {
  build(
    userGoal: string,
    projectFileTree: string,
    history: ContextBuilderHistoryItem[],
    relevantKnowledge?: string
  ): string {
    const safeGoal = userGoal?.trim() || "未提供目标";
    const safeTree = projectFileTree?.trim() || "（空）";
    const safeHistory = this.formatHistory(history);

    const sections: string[] = [
      "你将根据以下上下文生成仓颉（Cangjie）语言代码，请确保输出结构清晰、可编译运行，并符合仓颉语言规范。",
      "",
      "## 用户目标",
      safeGoal,
      "",
      "## 当前项目文件树",
      safeTree,
    ];

    if (relevantKnowledge?.trim()) {
      sections.push(
        "",
        "## 相关仓颉语言知识（请结合以下知识准确编写代码）",
        relevantKnowledge.trim()
      );
    }

    sections.push(
      "",
      "## 历史记录",
      safeHistory,
      "",
      "## 生成要求",
      "1. 只输出与目标直接相关的代码与必要说明。",
      "2. 保持模块边界清晰，避免破坏现有结构。",
      "3. 对关键边界情况做错误处理。",
      "4. 使用正确的仓颉包导入语法（import std.collection.* 等）。",
      "5. 优先给出最小可运行实现，再考虑可扩展性。",
      "6. 确保 cjpm.toml 配置正确（name 小驼峰、cjc-version 必填、output-type 必填）。",
      "7. main 函数不使用 func 关键字。",
      "8. 数值类型转换使用类型构造函数（如 Int64(x)），不使用方法调用。",
      "9. **包声明的根包名 = cjpm.toml 的 name 字段值（不是 default）**：src/ 根目录文件可省略 package，子目录文件首行必须写 package <name>.子目录名（如 name='myApp' 时 src/utils/helper.cj → package myApp.utils）。",
      "10. 子包中被外部使用的类型和函数必须声明为 public，main.cj 中使用时必须先 import（如 import myApp.utils.*，以 cjpm.toml name 值为前缀）。"
    );

    return sections.join("\n");
  }

  private formatHistory(history: ContextBuilderHistoryItem[]): string {
    if (!Array.isArray(history) || history.length === 0) {
      return "（无）";
    }

    return history
      .map((item, index) => {
        const role = item.role || "user";
        const content = item.content?.trim() || "（空）";
        return `${index + 1}. [${role}] ${content}`;
      })
      .join("\n");
  }
}
