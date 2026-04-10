import fs from "node:fs";
import path from "node:path";

export function ensureEnvFile(projectRoot = process.cwd()): string {
  const envPath = path.resolve(projectRoot, ".env.local");
  if (!fs.existsSync(envPath)) {
    const examplePath = path.resolve(projectRoot, ".env.example");
    const initialContent = fs.existsSync(examplePath) ? fs.readFileSync(examplePath, "utf8") : "";
    fs.writeFileSync(envPath, initialContent, "utf8");
  }

  return envPath;
}

export function upsertEnvValues(updates: Record<string, string>, projectRoot = process.cwd()): string {
  const envPath = ensureEnvFile(projectRoot);
  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  const keys = Object.keys(updates);
  const nextLines = [...lines];

  for (const key of keys) {
    const value = updates[key] ?? "";
    const line = `${key}=${value}`;
    const index = nextLines.findIndex((entry) => entry.startsWith(`${key}=`));
    if (index >= 0) {
      nextLines[index] = line;
    } else {
      nextLines.push(line);
    }
  }

  const output = nextLines.join("\n").replace(/\n*$/, "\n");
  fs.writeFileSync(envPath, output, "utf8");
  return envPath;
}
