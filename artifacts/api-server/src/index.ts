import app from "./app";
import { logger } from "./lib/logger";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// Bind to loopback only — never expose directly to the network.
// If you need LAN access, put a reverse proxy (nginx/caddy) in front.
const HOST = process.env.HOST ?? "127.0.0.1";

app.listen(port, HOST, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port, host: HOST }, "Server listening");
});
