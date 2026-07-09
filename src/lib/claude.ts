import Anthropic from "@anthropic-ai/sdk";

let _client: Anthropic | null = null;
export function claude() {
  if (_client) return _client;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not set in .env.local");
  }
  _client = new Anthropic({ apiKey });
  return _client;
}

export const CLAUDE_MODEL = "claude-fable-5" as const;
