export type LogFields = Record<string, unknown>;

export type StructuredLogger = {
  info(fields: LogFields, message: string): void;
  warn(fields: LogFields, message: string): void;
  error(fields: LogFields, message: string): void;
  debug(fields: LogFields, message: string): void;
};

type LogLevel = "info" | "warn" | "error" | "debug";

const logLevelPriority: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
};

function getConfiguredLogLevel(): LogLevel {
  const level = process.env.LOG_LEVEL;

  if (
    level === "debug" ||
    level === "info" ||
    level === "warn" ||
    level === "error"
  ) {
    return level;
  }

  return "info";
}

function writeLog(
  level: LogLevel,
  component: string,
  fields: LogFields,
  message: string
): void {
  if (logLevelPriority[level] < logLevelPriority[getConfiguredLogLevel()]) {
    return;
  }

  const payload = {
    level,
    time: new Date().toISOString(),
    component,
    msg: message,
    ...fields
  };

  const line = JSON.stringify(payload);

  if (level === "error") {
    console.error(line);
    return;
  }

  if (level === "warn") {
    console.warn(line);
    return;
  }

  console.log(line);
}

export function createConsoleLogger(component: string): StructuredLogger {
  return {
    info: (fields, message) => writeLog("info", component, fields, message),
    warn: (fields, message) => writeLog("warn", component, fields, message),
    error: (fields, message) => writeLog("error", component, fields, message),
    debug: (fields, message) => writeLog("debug", component, fields, message)
  };
}
