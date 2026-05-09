const MIN_REFRESH_PRIORITY = 1;
const MAX_REFRESH_PRIORITY = 3;

export function toBullMqPriority(refreshPriority: number): number {
  const normalizedPriority = Math.min(
    Math.max(Math.trunc(refreshPriority), MIN_REFRESH_PRIORITY),
    MAX_REFRESH_PRIORITY
  );

  return MAX_REFRESH_PRIORITY - normalizedPriority + 1;
}
