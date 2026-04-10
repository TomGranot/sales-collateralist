import { config } from "./config.js";
import { ManagedSlackModaAgent } from "./lib/anthropic.js";
import { logger } from "./lib/logger.js";
import { createServer } from "./server.js";

async function main() {
  const agent = new ManagedSlackModaAgent();
  await agent.bootstrap();

  const app = createServer(agent);
  app.listen(config.port, () => {
    logger.info("Managed agents Slack server listening", { port: config.port });
  });
}

main().catch((error) => {
  logger.error("Fatal startup error", error);
  process.exit(1);
});
