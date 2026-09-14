export type ModelTag = {
  label: string;
  className: string;
};

export type ModelTagModel = {
  id: string;
  name: string;
};

export const getModelTags = (model: ModelTagModel): ModelTag[] => {
  const id = model.id.toLowerCase();
  const name = model.name.toLowerCase();

  const tags: ModelTag[] = [];

  // 免费 / 收费
  if (
    id === "openrouter-ae88/openrouter/free" ||
    id.endsWith(":free") ||
    id === "openrouter-ae88/google/gemini-3.6-flash" ||
    id === "googleapis-836c/models/gemini-3.6-flash" ||
    id.includes("z-ai/glm-4.7-flash") ||
    id === "groq-1f06/openai/gpt-oss-120b" ||
    id === "openrouter-ae88/openai/gpt-oss-120b"
  ) {
    tags.push({
      label: "免费",
      className:
        "border-green-500/30 bg-green-500/10 text-green-600 dark:text-green-400",
    });
  } else {
    tags.push({
      label: "收费",
      className:
        "border-orange-500/30 bg-orange-500/10 text-orange-600 dark:text-orange-400",
    });
  }

  // GPT-5.6 Luna
  if (id.includes("gpt-5.6-luna") || name.includes("gpt-5.6 luna")) {
    tags.push(
      {
        label: "日常",
        className:
          "border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-400",
      },
      {
        label: "推理",
        className:
          "border-purple-500/30 bg-purple-500/10 text-purple-600 dark:text-purple-400",
      },
    );
  }

  // GPT-6 Astra
  else if (id.includes("gpt-6-astra") || name.includes("gpt-6 astra")) {
    tags.push(
      {
        label: "推理",
        className:
          "border-purple-500/30 bg-purple-500/10 text-purple-600 dark:text-purple-400",
      },
      {
        label: "编程",
        className:
          "border-cyan-500/30 bg-cyan-500/10 text-cyan-600 dark:text-cyan-400",
      },
      {
        label: "多模态",
        className:
          "border-pink-500/30 bg-pink-500/10 text-pink-600 dark:text-pink-400",
      },
    );
  }

  // Claude Opus 5
  else if (
    id.includes("claude-opus-5") ||
    name.includes("claude opus 5")
  ) {
    tags.push(
      {
        label: "编程",
        className:
          "border-cyan-500/30 bg-cyan-500/10 text-cyan-600 dark:text-cyan-400",
      },
      {
        label: "推理",
        className:
          "border-purple-500/30 bg-purple-500/10 text-purple-600 dark:text-purple-400",
      },
    );
  }

  // DeepSeek V4 Pro
  else if (
    id.includes("deepseek-v4-pro") ||
    name.includes("deepseek v4 pro")
  ) {
    tags.push(
      {
        label: "推理",
        className:
          "border-purple-500/30 bg-purple-500/10 text-purple-600 dark:text-purple-400",
      },
      {
        label: "编程",
        className:
          "border-cyan-500/30 bg-cyan-500/10 text-cyan-600 dark:text-cyan-400",
      },
    );
  }

  // DeepSeek V4 Flash
  else if (
    id.includes("deepseek-v4-flash") ||
    name.includes("deepseek v4 flash")
  ) {
    tags.push(
      {
        label: "高速",
        className:
          "border-yellow-500/30 bg-yellow-500/10 text-yellow-600 dark:text-yellow-400",
      },
      {
        label: "编程",
        className:
          "border-cyan-500/30 bg-cyan-500/10 text-cyan-600 dark:text-cyan-400",
      },
      {
        label: "推理",
        className:
          "border-purple-500/30 bg-purple-500/10 text-purple-600 dark:text-purple-400",
      },
    );
  }

  // Gemini Flash
  else if (
    id.includes("gemini") &&
    (id.includes("flash") || name.includes("flash"))
  ) {
    tags.push(
      {
        label: "高速",
        className:
          "border-yellow-500/30 bg-yellow-500/10 text-yellow-600 dark:text-yellow-400",
      },
      {
        label: "多模态",
        className:
          "border-pink-500/30 bg-pink-500/10 text-pink-600 dark:text-pink-400",
      },
    );
  }

  // Codex / 编程模型
  else if (id.includes("codex") || name.includes("codex")) {
    tags.push({
      label: "编程",
      className:
        "border-cyan-500/30 bg-cyan-500/10 text-cyan-600 dark:text-cyan-400",
    });
  }

  return tags;
};
