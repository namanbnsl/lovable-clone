import { generateText } from "ai"
import { google } from "@ai-sdk/google"

import { inngest } from "./client";

export const helloWorld = inngest.createFunction(
  { id: "hello-world" },
  { event: "test/hello.world" },
  async ({ event, step }) => {
    const {text} = await generateText({
      model: google("gemini-2.5-pro"),
      system: "You are an expert summarizer. Summarize the following text in exactly 2 words.",
      prompt: event.data.value,
    })

    return { text };
  },
);