// Next.js 15 instrumentation hook — called ONCE at server boot.
// See https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
//
// Dynamic import gates the OTel setup to the nodejs runtime because our
// FileSpanExporter uses `node:fs` and the SDK pulls in `pg`-adjacent deps
// that don't exist on the edge runtime.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { initTelemetry } = await import("./src/otel/setup");
  initTelemetry();
}
