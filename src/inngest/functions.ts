import { generateText, stepCountIs, hasToolCall } from "ai";
import { google } from "@ai-sdk/google";
import { Sandbox } from "@e2b/code-interpreter";

import { inngest } from "./client";
import { getSandbox } from "@/inngest/utils";
import z from "zod";
import { PROMPT } from "@/prompt";
import { extractTaskSummary } from "@/lib/utils";

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

    // Try to ensure the dev server in the sandbox is up before proceeding
    await step.run("ensure-dev-server", async () => {
      const sandbox = await getSandbox(sandboxId);
      const isServerUp = async (): Promise<boolean> => {
        const res = await sandbox.commands.run(
          'bash -lc "curl -s -o /dev/null -w "%{http_code}" http://localhost:3000"'
        );
        const code = res.stdout.trim();
        return code === "200" || code === "404";
      };
      if (await isServerUp()) return "up";
      try {
        await sandbox.commands.run(
          'bash -lc "export PNPM_HOME=~/.local/share/pnpm; export PATH="$PNPM_HOME:$PATH"; corepack enable || true; pnpm i --silent --no-frozen-lockfile || npm ci --no-audit --no-fund"'
        );
        await sandbox.commands.run(
          'bash -lc "nohup pnpm dev --port 3000 > /tmp/dev.log 2>&1 & echo $!"'
        );
        for (let i = 0; i < 30; i++) {
          if (await isServerUp()) return "started";
          await new Promise((r) => setTimeout(r, 1000));
        }
        return "timeout";
      } catch (err) {
        return `Error: ${err}`;
      }
    });

    // In-memory persistent state for this function invocation
    const updatedFiles: Record<string, string> = {};
    let summary: string | undefined;
    let taskSummaryAchieved = false;

    const { text } = await generateText({
      model: google("gemini-2.5-pro"),
      temperature: 0.1,
      system:
        PROMPT +
        "\n\nAgent guidelines:" +
        "\n- Use tools to inspect, create, and run the project. Prefer small, iterative steps." +
        "\n- If the server isn't running, start it on port 3000 and verify it's reachable before summarizing." +
        "\n- When done, either emit <task_summary>...</task_summary> or call finalizeTask with the plain-text summary.",
      stopWhen: [
        stepCountIs(10),
        hasToolCall("finalizeTask"),
        () => taskSummaryAchieved,
      ],
      prompt: event.data.value,
      tools: {
        terminal: {
          description: "Run a shell command in the sandbox (non-interactive).",
          inputSchema: z.object({
            command: z.string().describe("The command to run."),
          }),
          execute: async ({ command }) => {
            return await step.run("terminal", async () => {
              const buffers = { stdout: "", stderr: "" };
              try {
                const sandbox = await getSandbox(sandboxId);
                const result = await sandbox.commands.run(command, {
                  onStdout: (data: string) => {
                    buffers.stdout += data;
                  },
                  onStderr: (data: string) => {
                    buffers.stderr += data;
                  },
                });
                return result.stdout;
              } catch (err) {
                return `Command failed: ${err} \n stdout: ${buffers.stdout} \n stderr: ${buffers.stderr}`;
              }
            });
          },
        },
        readFiles: {
          description: "Read files from the sandbox (alias of readFile).",
          inputSchema: z.object({
            files: z
              .array(
                z.object({
                  path: z.string().describe("The path to the file."),
                })
              )
              .describe("The files to read from the sandbox."),
          }),
          execute: async ({ files }) => {
            return await step.run("read-files", async () => {
              try {
                const sandbox = await getSandbox(sandboxId);
                const contents: Array<{ path: string; content: string }> = [];
                for (const file of files) {
                  const content = await sandbox.files.read(file.path);
                  contents.push({ path: file.path, content });
                }
                return JSON.stringify(contents);
              } catch (err) {
                return `Error: ${err}`;
              }
            });
          },
        },
        createOrUpdateFiles: {
          description: "Create or update files in the sandbox.",
          inputSchema: z.object({
            files: z.array(
              z.object({
                path: z.string().describe("The path to the file."),
                content: z.string().describe("The content of the file."),
              })
            ),
          }),
          execute: async ({ files }) => {
            return await step.run("create-or-update-files", async () => {
              try {
                const sandbox = await getSandbox(sandboxId);
                for (const file of files) {
                  await sandbox.files.write(file.path, file.content);
                  updatedFiles[file.path] = file.content;
                }
                return { updatedFiles } as const;
              } catch (err) {
                return `Error: ${err}`;
              }
            });
          },
        },
        readFile: {
          description: "Read files from the sandbox.",
          inputSchema: z.object({
            files: z
              .array(
                z.object({
                  path: z.string().describe("The path to the file."),
                })
              )
              .describe("The files to read from the sandbox."),
          }),
          execute: async ({ files }) => {
            return await step.run("read-files", async () => {
              try {
                const sandbox = await getSandbox(sandboxId);
                const contents: Array<{ path: string; content: string }> = [];
                for (const file of files) {
                  const content = await sandbox.files.read(file.path);
                  contents.push({ path: file.path, content });
                }
                return JSON.stringify(contents);
              } catch (err) {
                return `Error: ${err}`;
              }
            });
          },
        },
        startDevServer: {
          description:
            "Install deps and start the dev server on port 3000 in background.",
          inputSchema: z.object({
            install: z
              .boolean()
              .default(true)
              .describe("Whether to install dependencies before starting."),
            cmd: z
              .string()
              .default("pnpm dev --port 3000")
              .describe("The command to start the dev server."),
          }),
          execute: async ({ install, cmd }) => {
            return await step.run("start-dev-server", async () => {
              try {
                const sandbox = await getSandbox(sandboxId);
                if (install) {
                  await sandbox.commands.run(
                    'bash -lc "export PNPM_HOME=~/.local/share/pnpm; export PATH="$PNPM_HOME:$PATH"; corepack enable && pnpm i --silent --no-frozen-lockfile"'
                  );
                }
                const start = await sandbox.commands.run(
                  'bash -lc "nohup ' +
                    cmd.replace(/"/g, '\\"') +
                    ' > /tmp/dev.log 2>&1 & echo $!"'
                );
                return `Started dev server with PID ${start.stdout.trim()}`;
              } catch (err) {
                return `Error: ${err}`;
              }
            });
          },
        },
        checkServerStatus: {
          description:
            "Check if the dev server on localhost:3000 is responding.",
          inputSchema: z.object({}),
          execute: async () => {
            return await step.run("check-server-status", async () => {
              try {
                const sandbox = await getSandbox(sandboxId);
                const result = await sandbox.commands.run(
                  'bash -lc "curl -s -o /dev/null -w "%{http_code}" http://localhost:3000"'
                );
                return `HTTP ${result.stdout.trim()}`;
              } catch (err) {
                return `Error: ${err}`;
              }
            });
          },
        },
        finalizeTask: {
          description:
            "Call this tool exactly once when the task is complete and you have produced <task_summary>text</task_summary>. Provide only the inner summary text (no tags).",
          inputSchema: z.object({
            summary: z
              .string()
              .min(1)
              .describe("The final task summary without any XML tags."),
          }),
          execute: async ({ summary: providedSummary }) => {
            return await step.run("finalize-task", async () => {
              summary = (providedSummary ?? "").trim();
              taskSummaryAchieved = Boolean(summary);
              return "OK";
            });
          },
        },
      },
      onStepFinish: async (result) => {
        const maybeSummary = extractTaskSummary(result.text || "");
        if (maybeSummary && !summary) {
          summary = maybeSummary;
          taskSummaryAchieved = true;
        }
      },
    });

    return {
      title: "Fragment",
      files: updatedFiles,
      summary: summary,
      sandboxUrl,
    };
  }
);
