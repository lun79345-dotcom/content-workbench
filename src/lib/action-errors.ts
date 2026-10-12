/** Only intentional business validation messages may be returned to the browser. */
export class UserFacingError extends Error {}

export type ActionResult = { ok: true; error?: never } | { ok?: never; error: string };

export async function actionResult(action: () => Promise<unknown>): Promise<ActionResult> {
  try { await action(); return { ok: true }; }
  catch (error) {
    if (error instanceof UserFacingError) return { error: error.message };
    // Redirects and unexpected failures retain Next's normal handling; no raw errors leak.
    throw error;
  }
}
