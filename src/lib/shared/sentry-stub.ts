const DSN = process.env["NEXT_PUBLIC_SENTRY_DSN"] || "";
const ENABLED = Boolean(
  DSN && DSN.length > 8 && !DSN.includes("your-sentry") && !DSN.includes("example"),
);

type ScopeCallback = (scope: unknown) => void;

export function init(_options: Record<string, unknown> = {}): void {
  if (!ENABLED) return;
}

export function captureException(
  err: unknown,
  _hintOrCb?: unknown | ScopeCallback,
): string | undefined {
  if (!ENABLED) return undefined;
  try {
    if (process.env["NODE_ENV"] !== "production") {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn("[Sentry stub: captureException disabled]", msg);
    }
  } catch {
    /* noop */
  }
  return undefined;
}

export function captureMessage(_msg: string, _level?: string): string | undefined {
  if (!ENABLED) return undefined;
  return undefined;
}

export function withScope(cb: ScopeCallback): void {
  if (!ENABLED) return;
  try {
    cb({});
  } catch {
    /* noop */
  }
}

export const SentryStub = {
  ENABLED,
  DSN: ENABLED ? "<configured>" : "<disabled: NEXT_PUBLIC_SENTRY_DSN missing or placeholder>",
  init,
  captureException,
  captureMessage,
  withScope,
} as const;

export default SentryStub;
