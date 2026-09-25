import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { loadCalibrationCatalog } from "./calibration.js";
import { loadConfig } from "./config.js";
import { LayaClient } from "./laya-client.js";
import { createMcpServer } from "./server.js";
import type { Logger } from "./types.js";

const logger: Logger = {
  debug(message, ...args) {
    console.error(`[laya-mcp] ${message}`, ...args);
  },
  error(message, ...args) {
    console.error(`[laya-mcp] ${message}`, ...args);
  },
};

export async function main(): Promise<void> {
  const config = loadConfig();
  const calibrationCatalog = await loadCalibrationCatalog(config.calibrationFile);
  const client = new LayaClient(config, logger);
  const server = createMcpServer(client, {
    calibrationCatalog,
    confidenceThreshold: config.confidenceThreshold,
  });
  const transport = new StdioServerTransport();

  server.server.onerror = error => {
    logger.error(`MCP server error: ${error.message}`);
  };
  server.server.onclose = () => {
    void client.close();
  };

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.debug(`Received ${signal}; shutting down`);
    await client.close();
    await server.close();
  };

  process.once("SIGINT", () => {
    void shutdown("SIGINT").finally(() => process.exit(0));
  });
  process.once("SIGTERM", () => {
    void shutdown("SIGTERM").finally(() => process.exit(0));
  });

  await server.connect(transport);
  logger.debug(`Ready on stdio (Laya API: ${config.apiUrl})`);
}

main().catch(error => {
  logger.error(`Fatal startup error: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
