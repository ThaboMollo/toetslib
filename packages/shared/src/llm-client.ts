import Anthropic from "@anthropic-ai/sdk";

interface GenerateOptions {
  system: string;
  messages: Anthropic.MessageParam[];
  maxTokens?: number;
}

interface GenerateWithImagesOptions extends GenerateOptions {
  images: Array<{
    data: string;
    mediaType: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
  }>;
}

interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export class LlmClient {
  private client: Anthropic;
  private usage: TokenUsage = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  };

  constructor(apiKey?: string) {
    this.client = new Anthropic({
      apiKey: apiKey ?? process.env.ANTHROPIC_API_KEY,
    });
  }

  async generate(opts: GenerateOptions): Promise<string> {
    const response = await this.callWithRetry(opts);
    return this.extractText(response);
  }

  async generateWithImages(opts: GenerateWithImagesOptions): Promise<string> {
    const lastMessage = opts.messages[opts.messages.length - 1]!;
    const lastText =
      typeof lastMessage.content === "string" ? lastMessage.content : "";

    const imageBlocks: Anthropic.ImageBlockParam[] = opts.images.map((img) => ({
      type: "image",
      source: {
        type: "base64",
        media_type: img.mediaType,
        data: img.data,
      },
    }));

    const textBlock: Anthropic.TextBlockParam = {
      type: "text",
      text: lastText,
    };

    const messages: Anthropic.MessageParam[] = [
      ...opts.messages.slice(0, -1),
      {
        role: "user" as const,
        content: [...imageBlocks, textBlock],
      },
    ];

    const response = await this.callWithRetry({ ...opts, messages });
    return this.extractText(response);
  }

  getUsage(): TokenUsage {
    return { ...this.usage };
  }

  private async callWithRetry(
    opts: GenerateOptions,
    retries = 3
  ): Promise<Anthropic.Message> {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const response = await this.client.messages.create({
          model: "claude-sonnet-4-20250514",
          max_tokens: opts.maxTokens ?? 8192,
          system: [
            {
              type: "text",
              text: opts.system,
              cache_control: { type: "ephemeral" },
            },
          ],
          messages: opts.messages,
        });

        this.trackUsage(response.usage);
        return response;
      } catch (error) {
        if (attempt === retries) throw error;
        const delay = Math.pow(2, attempt) * 1000;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
    throw new Error("Unreachable");
  }

  private trackUsage(usage: Anthropic.Usage): void {
    this.usage.inputTokens += usage.input_tokens;
    this.usage.outputTokens += usage.output_tokens;
    const usageAny = usage as unknown as Record<string, unknown>;
    if (typeof usageAny.cache_read_input_tokens === "number") {
      this.usage.cacheReadTokens += usageAny.cache_read_input_tokens;
    }
    if (typeof usageAny.cache_creation_input_tokens === "number") {
      this.usage.cacheWriteTokens += usageAny.cache_creation_input_tokens;
    }
  }

  private extractText(response: Anthropic.Message): string {
    return response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("");
  }
}
