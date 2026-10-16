export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { ensureBootstrapAdmin } = await import("./lib/auth/staff");
  await ensureBootstrapAdmin().catch((e) => console.error("bootstrap admin failed", e));
  const { env } = await import("./lib/env");
  if (env.runWorkerInProcess) {
    const { startWorker } = await import("./lib/jobs/worker");
    startWorker();
  }
}
