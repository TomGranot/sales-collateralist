import { ManagedSlackModaAgent, normalizeExports } from "./lib/anthropic.js";
import { downloadToBuffer } from "./lib/download.js";
import fs from "node:fs/promises";
import path from "node:path";

function usage(): never {
  console.error("Usage: npm run local:test -- --prompt \"list all one-pagers\" [--session smoke] [--name \"Tom\"] [--download]");
  process.exit(1);
}

function readArg(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index === -1) {
    return undefined;
  }
  return process.argv[index + 1];
}

async function main() {
  const promptArg = readArg("--prompt");
  if (!promptArg) {
    usage();
  }
  const prompt = promptArg;

  const sessionKey = readArg("--session") ?? "local-smoke-test";
  const requesterName = readArg("--name") ?? "Local Tester";
  const shouldDownload = process.argv.includes("--download");
  const outDir = readArg("--out-dir") ?? "local-exports";

  const agent = new ManagedSlackModaAgent();
  await agent.bootstrap();

  const payload = normalizeExports(
    await agent.handleLocalPrompt({
      sessionKey,
      requesterName,
      text: prompt,
    })
  );

  console.log(JSON.stringify(payload, null, 2));

  if (shouldDownload && payload.exports?.length) {
    await fs.mkdir(outDir, { recursive: true });
    for (const exportRef of payload.exports) {
      const buffer = await downloadToBuffer(exportRef.download_url);
      const filePath = path.resolve(outDir, exportRef.filename);
      await fs.writeFile(filePath, buffer);
      console.log(`${filePath}: ${buffer.byteLength} bytes downloaded`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
