"use client";
import { createContext, useActionState, useLayoutEffect, useRef, type ComponentProps } from "react";
import type { ActionResult } from "@/lib/action-errors";
import { clearFormDraft } from "./form-draft";
import { draftCreationSucceeded } from "@/lib/form-draft";

export const FormFeedbackContext = createContext<ActionResult | null>(null);

export function ActionForm({ action, children, draftKey, ...props }: Omit<ComponentProps<"form">, "action"> & { action: (data: FormData) => Promise<ActionResult>; draftKey?: string }) {
  const form = useRef<HTMLFormElement>(null);
  const alert = useRef<HTMLParagraphElement>(null);
  type Control = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
  const preserved = useRef<Array<{ element: Control; value: string; checked?: boolean }> | null>(null);
  const [result, submit] = useActionState(async (_previous: ActionResult | null, data: FormData) => {
    const fields = Array.from(form.current?.elements ?? []).filter((el): el is Control =>
      el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement || (el instanceof HTMLInputElement && !["file", "submit", "hidden"].includes(el.type)))
      .map((element) => ({ element, value: element.value, checked: element instanceof HTMLInputElement ? element.checked : undefined }));
    let next: ActionResult;
    try { next = await action(data); }
    catch (error) {
      // A session-expiry redirect to login is not a successful creation.
      if (draftKey && typeof error === "object" && error && "digest" in error && draftCreationSucceeded(draftKey, error.digest, window.location.origin)) clearFormDraft(draftKey);
      throw error;
    }
    if (next.ok && draftKey) clearFormDraft(draftKey);
    preserved.current = next.error ? fields : null;
    return next;
  }, null);
  // React resets uncontrolled forms after a resolved action, including validation results.
  // Restore current values after that reset, while leaving defaults intact for a later success.
  useLayoutEffect(() => {
    for (const { element, value, checked } of preserved.current ?? []) {
      element.value = value;
      if (element instanceof HTMLInputElement && checked !== undefined) element.checked = checked;
    }
    preserved.current = null;
    if (result?.error) {
      form.current?.querySelectorAll<HTMLDetailsElement>("details[data-form-expand-on-error]").forEach((details) => { details.open = true; });
      alert.current?.focus();
    }
  }, [result]);
  return <FormFeedbackContext.Provider value={result}>
    <form {...props} action={submit} ref={form} onInvalidCapture={(event) => {
      // Native validation runs before the action; expose a folded invalid field so it can receive focus.
      let parent = (event.target as HTMLElement).parentElement;
      while (parent && parent !== form.current) {
        if (parent instanceof HTMLDetailsElement) parent.open = true;
        parent = parent.parentElement;
      }
      props.onInvalidCapture?.(event);
    }}>
      {result?.error && <p ref={alert} role="alert" tabIndex={-1} className="col-span-full w-full rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 outline-none">{result.error}</p>}
      {children}
    </form>
  </FormFeedbackContext.Provider>;
}
