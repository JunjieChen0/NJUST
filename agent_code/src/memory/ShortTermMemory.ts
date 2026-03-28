export interface MemoryStep {
  action: string;
  result: string;
  success: boolean;
  timestamp: string;
}

const MAX_SUMMARY_STEPS = 5;
const LOOP_FAILURE_THRESHOLD = 3;

export class ShortTermMemory {
  private readonly steps: MemoryStep[] = [];

  addStep(action: string, result: string, success: boolean): void {
    const normalizedAction = action?.trim();
    if (!normalizedAction) {
      throw new Error("action 不能为空");
    }

    const normalizedResult = result?.trim() || "(empty)";
    const nextStep: MemoryStep = {
      action: normalizedAction,
      result: normalizedResult,
      success,
      timestamp: new Date().toISOString(),
    };

    this.steps.push(nextStep);
    this.detectLoop();
  }

  getHistorySummary(): string {
    if (this.steps.length === 0) {
      return "（暂无操作记录）";
    }

    const recent = this.steps.slice(-MAX_SUMMARY_STEPS);
    return recent
      .map((step, index) => {
        const status = step.success ? "SUCCESS" : "FAILED";
        return `${index + 1}. [${status}] action=${step.action}; result=${step.result}`;
      })
      .join("\n");
  }

  private detectLoop(): void {
    if (this.steps.length < LOOP_FAILURE_THRESHOLD) {
      return;
    }

    const latest = this.steps[this.steps.length - 1];
    if (latest.success) {
      return;
    }

    const lastN = this.steps.slice(-LOOP_FAILURE_THRESHOLD);
    const sameActionFailed = lastN.every(
      (step) => !step.success && step.action === latest.action
    );
    if (sameActionFailed) {
      throw new Error("进入死循环，请求人工干预");
    }
  }
}
