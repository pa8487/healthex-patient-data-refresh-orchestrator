import { closeQueue, getRefreshQueue } from "../src/queue/queue.js";

async function clearQueue(): Promise<void> {
  const queue = getRefreshQueue();
  await queue.obliterate({ force: true });

  console.log(
    JSON.stringify({
      event: "queue_cleared",
      queue: queue.name
    })
  );
}

clearQueue()
  .catch((error: unknown) => {
    console.error(
      JSON.stringify({
        event: "queue_clear_failed",
        error: error instanceof Error ? error.message : String(error)
      })
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeQueue();
  });
