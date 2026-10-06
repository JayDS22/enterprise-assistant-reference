/**
 * OTel wiring for the Agents SDK.
 *
 * File + console exporter only (FINAL plan §6). No OTLP, no external backend.
 * The SDK ships its own tracer (Trace/Span classes, BatchTraceProcessor);
 * we plug in a ConsoleSpanExporter and a FileSpanExporter via setTraceProcessors.
 *
 * ponytail: setTraceProcessors replaces the SDK default (which would ship to
 * OpenAI's tracing backend). Switch to addTraceProcessor if we ever want both.
 */
import { createWriteStream, mkdirSync, type WriteStream } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  BatchTraceProcessor,
  ConsoleSpanExporter,
  setTraceProcessors,
  Span,
  Trace,
  type TracingExporter,
} from "@openai/agents";

type TraceOrSpan = Trace | Span<any>;

const DEFAULT_FILE_PATH = ".otel/traces.jsonl";

let _initialized = false;
let _processor: BatchTraceProcessor | null = null;
let _fileExporter: FileSpanExporter | null = null;

/**
 * Writes each span as one JSON line (append). Buffers in-memory; flushes
 * on shutdown or when the stream drains.
 */
export class FileSpanExporter implements TracingExporter {
  readonly #stream: WriteStream | null;
  readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = resolve(filePath);
    // Fail-soft on mkdir: in a read-only container (/app owned by root,
    // process runs as nextjs) the default .otel path throws EACCES. Catch
    // and leave the stream null; export() becomes a no-op. The console
    // exporter still runs so traces aren't lost.
    try {
      mkdirSync(dirname(this.filePath), { recursive: true });
      this.#stream = createWriteStream(this.filePath, { flags: "a" });
    } catch (err) {
      console.warn(
        `[otel] file exporter disabled: ${(err as Error).message}. ` +
          `Console exporter still active. Set OTEL_FILE_EXPORTER_PATH to a writable dir to re-enable.`,
      );
      this.#stream = null;
    }
  }

  async export(items: TraceOrSpan[], _signal?: AbortSignal): Promise<void> {
    if (!this.#stream) return; // mkdir failed; console exporter carries the load
    const lines: string[] = [];
    for (const item of items) {
      if (item.type !== "trace.span") continue; // skip Trace envelopes; we only emit spans
      lines.push(JSON.stringify(serializeSpan(item as Span<any>)));
    }
    if (lines.length === 0) return;
    const payload = lines.join("\n") + "\n";
    const stream = this.#stream;
    const ok = stream.write(payload);
    if (!ok) {
      await new Promise<void>((res) => stream.once("drain", () => res()));
    }
  }

  async shutdown(): Promise<void> {
    if (!this.#stream) return;
    const stream = this.#stream;
    await new Promise<void>((res, rej) => {
      stream.end((err?: Error | null) => (err ? rej(err) : res()));
    });
  }
}

/**
 * Minimal JSON shape per span. gen_ai.* attributes come from the SDK's
 * spanData payload; we flatten the important bits and keep raw data too.
 */
export function serializeSpan(span: Span<any>): Record<string, unknown> {
  const data = span.spanData ?? {};
  const startedAt = span.startedAt;
  const endedAt = span.endedAt;
  const durationMs =
    startedAt && endedAt
      ? new Date(endedAt).getTime() - new Date(startedAt).getTime()
      : null;

  const attributes: Record<string, unknown> = { ...data };
  // Hoist usage into gen_ai.usage.* if the SDK provided it on a generation span.
  if (data && typeof data === "object" && "usage" in data && data.usage) {
    attributes["gen_ai.usage"] = data.usage;
  }
  if (data && typeof data === "object" && "model" in data && data.model) {
    attributes["gen_ai.request.model"] = data.model;
  }

  return {
    name:
      (data && typeof data === "object" && "name" in data && data.name) ||
      (data && typeof data === "object" && "type" in data && data.type) ||
      "span",
    trace_id: span.traceId,
    span_id: span.spanId,
    parent_span_id: span.parentId,
    start_time: startedAt,
    end_time: endedAt,
    duration_ms: durationMs,
    attributes,
    status: span.error ? { code: "ERROR", message: span.error.message } : { code: "OK" },
  };
}

export function initTelemetry(options?: {
  filePath?: string;
  serviceName?: string;
}): void {
  if (_initialized) return;
  _initialized = true;

  const filePath =
    options?.filePath ??
    process.env.OTEL_FILE_EXPORTER_PATH ??
    DEFAULT_FILE_PATH;
  const serviceName =
    options?.serviceName ??
    process.env.OTEL_SERVICE_NAME ??
    "enterprise-assistant-reference";

  _fileExporter = new FileSpanExporter(filePath);
  const consoleExporter = new ConsoleSpanExporter();

  // One batch processor per exporter so each gets its own queue/drain cycle.
  const consoleProc = new BatchTraceProcessor(consoleExporter);
  const fileProc = new BatchTraceProcessor(_fileExporter);
  _processor = fileProc;

  // Replace SDK defaults (which would ship to OpenAI's backend).
  setTraceProcessors([consoleProc, fileProc]);

  // Record service name for anyone grepping the file later.
  // ponytail: not using resource attributes — single-process, name is enough.
  if (process.env.NODE_ENV !== "test") {
    // eslint-disable-next-line no-console
    console.log(`[otel] initialized service=${serviceName} file=${filePath}`);
  }
}

export async function shutdownTelemetry(): Promise<void> {
  if (!_initialized) return;
  await _processor?.forceFlush();
  await _processor?.shutdown();
  await _fileExporter?.shutdown();
  _initialized = false;
  _processor = null;
  _fileExporter = null;
}

/** Test-only: reset the module flag so each test can init fresh. */
export function _resetForTests(): void {
  _initialized = false;
  _processor = null;
  _fileExporter = null;
}

export function _isInitialized(): boolean {
  return _initialized;
}
