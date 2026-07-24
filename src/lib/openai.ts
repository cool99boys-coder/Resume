import OpenAI from "openai";
import { env } from "@/env";

const openai = new OpenAI({
  apiKey: env.GEMINI_API_KEY,
});

export default openai;
