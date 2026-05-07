import { GoogleGenAI } from "@google/genai";

let _client: GoogleGenAI | null = null;
export function gemini() {
  if (_client) return _client;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not set in .env.local");
  }
  _client = new GoogleGenAI({ apiKey });
  return _client;
}

export const MODELS = {
  research: "gemini-2.5-flash",
  image: "imagen-4.0-fast-generate-001",
} as const;
