import { buildApp } from "./app";
import { logger } from "./lib/logger/logger";

const PORT = Number(process.env.PORT ?? 8080);

async function start() {
  try {
    const app = await buildApp();

    const server = app.listen(PORT, () => {
      logger.info({ port: PORT }, `API listening on http://localhost:${PORT}`);
    });

    function shutdown(signal: string) {
      logger.info({ signal }, "Shutting down...");

      server.close(() => {
        logger.info({}, "HTTP server closed");

        // If you later expose mongo adapter / connection from buildApp,
        // close it here as well.

        process.exit(0);
      });

      setTimeout(() => {
        logger.error({}, "Forced shutdown");
        process.exit(1);
      }, 10000);
    }

    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));
  } catch (error) {
    logger.error({ error }, "Failed to start server");
    process.exit(1);
  }
}

void start();