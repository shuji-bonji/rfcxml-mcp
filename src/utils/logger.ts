/**
 * Logger Utility
 * Centralized logging abstraction for future extensibility
 */

/**
 * Log levels
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Logger interface
 */
interface Logger {
  debug(context: string, message: string): void;
  info(context: string, message: string): void;
  warn(context: string, message: string): void;
  error(context: string, message: string, error?: Error): void;
}

/**
 * Format log message
 */
function formatMessage(level: LogLevel, context: string, message: string): string {
  return `[${context}] ${message}`;
}

/**
 * Default logger implementation using console
 * Can be replaced with more sophisticated logging (e.g., winston, pino) in the future
 */
export const logger: Logger = {
  debug(context: string, message: string): void {
    if (process.env.DEBUG) {
      console.debug(formatMessage('debug', context, message));
    }
  },

  info(context: string, message: string): void {
    console.error(formatMessage('info', context, message));
  },

  warn(context: string, message: string): void {
    console.error(formatMessage('warn', context, message));
  },

  error(context: string, message: string, error?: Error): void {
    console.error(formatMessage('error', context, message));
    if (error && process.env.DEBUG) {
      console.error(error.stack);
    }
  },
};
