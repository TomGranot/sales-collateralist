export const logger = {
  info(message: string, data?: unknown) {
    console.log(JSON.stringify({ level: "info", message, data, time: new Date().toISOString() }));
  },
  error(message: string, error?: unknown, data?: unknown) {
    console.error(
      JSON.stringify({
        level: "error",
        message,
        error: error instanceof Error ? { message: error.message, stack: error.stack } : error,
        data,
        time: new Date().toISOString(),
      })
    );
  },
};
