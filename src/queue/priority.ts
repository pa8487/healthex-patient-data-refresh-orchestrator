const MIN_REFRESH_PRIORITY = 1;
const MAX_REFRESH_PRIORITY = 3;

export function toBullMqPriority(refreshPriority: number): number {
  const normalizedPriority = Math.min(
    Math.max(Math.trunc(refreshPriority), MIN_REFRESH_PRIORITY),
    MAX_REFRESH_PRIORITY
  );

  // Domain priority is higher-is-better, while BullMQ dequeues lower numeric
  // priority first, so the value is inverted at the queue boundary.
  return MAX_REFRESH_PRIORITY - normalizedPriority + 1;
}
