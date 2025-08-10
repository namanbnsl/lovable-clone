import Sandbox from "@e2b/code-interpreter";

export async function getSandbox(sandboxId: string) {
  const sandbox = await Sandbox.connect(sandboxId, {
    apiKey: process.env.E2B_ACCESS_TOKEN,
  });
  return sandbox;
}
