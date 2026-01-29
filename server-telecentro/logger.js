// logger.js
import pino from "pino";

/**
 * Create a pino logger instance.
 * - `transport` with `pino-pretty` for dev-friendly output
 * - `level` defaults to 'info'
 */
const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  transport: {
    target: "pino-pretty",
    options: {
      colorize: true,
      translateTime: "SYS:standard",
      ignore: "pid,hostname", // optional: remove pid/hostname from output
    },
  },
});

export default logger;
