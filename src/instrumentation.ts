export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.DISABLE_JOBS !== "1") {
    const { startScheduler } = await import("./lib/jobs");
    startScheduler();
  }
}
