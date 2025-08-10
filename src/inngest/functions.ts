import { generateText } from "ai";
import { google } from "@ai-sdk/google";
import { Sandbox } from "@e2b/code-interpreter";

import { inngest } from "./client";
import { getSandbox } from "@/inngest/utils";

export const helloWorld = inngest.createFunction(
  { id: "hello-world" },
  { event: "test/hello.world" },
  async ({ event, step }) => {
    const sandboxId = await step.run("get-sandbox-id", async () => {
      const sandbox = await Sandbox.create("lovable-clone-nextjs", {
        apiKey: process.env.E2B_ACCESS_TOKEN,
      });
      return sandbox.sandboxId;
    });

    const sandboxUrl = await step.run("get-sandbox-url", async () => {
      const sandbox = await getSandbox(sandboxId);
      const host = sandbox.getHost(3000);
      return `https://${host}`;
    });

    const { text } = await generateText({
      model: google("gemini-2.5-pro"),
      system:
        "You are an expert summarizer. Summarize the following text in exactly 2 words.",
      prompt: event.data.value,
    });

    return { text, sandboxUrl };
  }
);
