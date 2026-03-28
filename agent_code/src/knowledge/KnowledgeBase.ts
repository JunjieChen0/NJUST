import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, basename } from "node:path";

interface SkillEntry {
  name: string;
  description: string;
  keywords: string[];
  filePath: string;
  content: string;
}

export class KnowledgeBase {
  private readonly skills: SkillEntry[] = [];
  private readonly maxChunkSize: number;

  constructor(maxChunkSize = 6000) {
    this.maxChunkSize = maxChunkSize;
  }

  get skillCount(): number {
    return this.skills.length;
  }

  async loadFromDirectory(rootDir: string): Promise<void> {
    if (!existsSync(rootDir)) {
      console.warn(`[KnowledgeBase] 知识库目录不存在: ${rootDir}`);
      return;
    }

    const skillsDir = join(rootDir, ".opencode", "skills");
    if (!existsSync(skillsDir)) {
      console.warn(`[KnowledgeBase] 未找到 .opencode/skills 目录: ${skillsDir}`);
      return;
    }

    this.scanDirectory(skillsDir, skillsDir);
    console.log(`[KnowledgeBase] 已加载 ${this.skills.length} 个知识主题`);
  }

  private scanDirectory(dir: string, rootDir: string): void {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = join(dir, entry);
      let stat;
      try {
        stat = statSync(fullPath);
      } catch {
        continue;
      }

      if (stat.isDirectory()) {
        if (entry === "cangjie_full_docs") continue;
        this.scanDirectory(fullPath, rootDir);
      } else if (entry === "SKILL.md" || entry.endsWith(".md")) {
        this.loadSkillFile(fullPath, rootDir);
      }
    }
  }

  private loadSkillFile(filePath: string, rootDir: string): void {
    let raw: string;
    try {
      raw = readFileSync(filePath, "utf-8");
    } catch {
      return;
    }

    const { frontmatter, body } = this.parseFrontmatter(raw);
    if (!body.trim()) return;

    const dirName = basename(join(filePath, ".."));
    const name = frontmatter.name ?? dirName;
    const description = frontmatter.description ?? "";

    const keywords = this.extractKeywords(name, description, dirName);

    this.skills.push({
      name,
      description,
      keywords,
      filePath: relative(rootDir, filePath),
      content: body.trim(),
    });
  }

  private parseFrontmatter(raw: string): { frontmatter: Record<string, string>; body: string } {
    const match = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
    if (!match) {
      return { frontmatter: {}, body: raw };
    }

    const fm: Record<string, string> = {};
    for (const line of match[1].split("\n")) {
      const kv = line.match(/^(\w[\w-]*):\s*"?(.+?)"?\s*$/);
      if (kv) {
        fm[kv[1]] = kv[2];
      }
    }

    return { frontmatter: fm, body: match[2] };
  }

  private extractKeywords(name: string, description: string, dirName: string): string[] {
    const kws = new Set<string>();

    const topicMappings: Record<string, string[]> = {
      basic_concepts: ["基础", "变量", "let", "var", "const", "关键字", "作用域", "值类型", "引用类型", "if", "while", "for", "循环", "条件"],
      basic_data_type: ["数据类型", "整数", "浮点", "布尔", "字符", "Rune", "字符串", "String", "元组", "数组", "Array", "VArray", "区间", "Range", "运算符"],
      function: ["函数", "func", "Lambda", "闭包", "重载", "运算符重载", "管道", "变长参数", "命名参数"],
      class: ["类", "class", "继承", "抽象类", "构造函数", "init", "终结器", "override", "访问修饰符", "属性", "prop"],
      struct: ["结构体", "struct", "值类型", "mut", "值语义"],
      interface: ["接口", "interface", "多态", "默认实现", "sealed", "Any", "菱形继承"],
      enum: ["枚举", "enum", "模式匹配", "Equatable", "构造器"],
      generic: ["泛型", "generic", "类型参数", "where", "约束", "型变"],
      option: ["Option", "可选", "空值", "None", "Some", "安全", "if-let", "while-let"],
      error_handle: ["错误处理", "异常", "Exception", "try", "catch", "throw", "finally"],
      pattern_match: ["模式匹配", "match", "case", "解构", "穷举"],
      concurrency: ["并发", "线程", "spawn", "Future", "Mutex", "Atomic", "同步", "synchronized", "锁"],
      collections: ["集合", "ArrayList", "HashMap", "HashSet", "TreeMap", "链表", "队列", "栈"],
      array: ["Array", "数组", "定长数组"],
      arraylist: ["ArrayList", "动态数组", "变长数组", "列表"],
      hashmap: ["HashMap", "哈希表", "键值", "映射", "字典", "map"],
      hashset: ["HashSet", "集合", "去重"],
      package: ["包", "package", "import", "导入", "模块", "访问控制"],
      project_management: ["项目", "cjpm", "构建", "build", "依赖", "toml", "工程"],
      string: ["字符串", "String", "拼接", "分割", "查找", "替换", "编码"],
      std: ["标准库", "std", "核心库"],
      stdx: ["扩展库", "stdx", "json", "http", "序列化", "加密", "日志"],
      network: ["网络", "HTTP", "TCP", "UDP", "Socket", "WebSocket", "TLS", "HTTPS"],
      http_client: ["HTTP客户端", "请求", "GET", "POST"],
      http_server: ["HTTP服务端", "服务器", "路由", "监听"],
      socket: ["Socket", "TCP", "UDP"],
      websocket: ["WebSocket"],
      tls: ["TLS", "SSL", "加密通信"],
      cffi: ["C互操作", "FFI", "foreign", "CFunc", "unsafe", "CString"],
      macro: ["宏", "macro", "元编程", "Token", "quote"],
      reflect_and_annotation: ["反射", "注解", "Annotation", "TypeInfo"],
      regulations: ["规范", "命名", "格式", "最佳实践", "代码风格"],
      toolchains: ["工具链", "编译器", "调试器", "格式化"],
      const: ["常量", "const", "编译期"],
      for: ["for-in", "迭代器", "Iterator", "遍历"],
      extend: ["扩展", "extend", "孤儿规则"],
      type_system: ["类型系统", "子类型", "型变", "is", "as", "类型别名"],
      unittest: ["测试", "单元测试", "@Test", "断言", "Mock"],
      io: ["IO", "流", "InputStream", "OutputStream", "缓冲"],
      fs: ["文件", "目录", "路径", "File", "Directory"],
      stdio: ["标准输入", "标准输出", "print", "println", "readln"],
      args: ["命令行参数", "argopt"],
      json: ["JSON", "序列化", "反序列化", "编解码"],
      config: ["配置", "stdx"],
    };

    for (const part of dirName.replace("cangjie_", "").split(/[_/\\]/)) {
      const mapped = topicMappings[part];
      if (mapped) {
        for (const kw of mapped) kws.add(kw.toLowerCase());
      }
      kws.add(part.toLowerCase());
    }

    for (const part of name.replace("cangjie-", "").split(/[-_]/)) {
      kws.add(part.toLowerCase());
    }

    const descTokens = description
      .replace(/[，。、；：""''（）\[\]{}|/\\]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length >= 2);
    for (const token of descTokens) {
      kws.add(token.toLowerCase());
    }

    return [...kws];
  }

  queryRelevantKnowledge(taskDescription: string, maxTopics = 3): string {
    if (this.skills.length === 0) return "";

    const queryTokens = this.tokenize(taskDescription);
    const scored = this.skills.map((skill) => ({
      skill,
      score: this.computeRelevanceScore(queryTokens, skill),
    }));

    scored.sort((a, b) => b.score - a.score);
    const topMatches = scored.filter((s) => s.score > 0).slice(0, maxTopics);

    if (topMatches.length === 0) return "";

    const chunks: string[] = [];
    let totalLength = 0;

    for (const match of topMatches) {
      const content = this.truncateContent(match.skill.content);
      if (totalLength + content.length > this.maxChunkSize) {
        const remaining = this.maxChunkSize - totalLength;
        if (remaining > 200) {
          chunks.push(`### ${match.skill.name}\n${content.slice(0, remaining)}...\n`);
        }
        break;
      }
      chunks.push(`### ${match.skill.name}\n${content}\n`);
      totalLength += content.length;
    }

    return chunks.join("\n---\n\n");
  }

  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[，。、；：""''（）\[\]{}|/\\<>]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length >= 1);
  }

  private computeRelevanceScore(queryTokens: string[], skill: SkillEntry): number {
    let score = 0;
    const lowerName = skill.name.toLowerCase();
    const lowerDesc = skill.description.toLowerCase();

    for (const token of queryTokens) {
      for (const kw of skill.keywords) {
        if (kw === token) {
          score += 10;
        } else if (kw.includes(token) || token.includes(kw)) {
          score += 5;
        }
      }

      if (lowerName.includes(token)) score += 8;
      if (lowerDesc.includes(token)) score += 3;
    }

    return score;
  }

  private truncateContent(content: string): string {
    const perTopicMax = Math.floor(this.maxChunkSize / 2);
    if (content.length <= perTopicMax) return content;
    return content.slice(0, perTopicMax) + "\n... (内容已截断)";
  }

  listTopics(): string[] {
    return this.skills.map((s) => `${s.name}: ${s.description || s.filePath}`);
  }
}
