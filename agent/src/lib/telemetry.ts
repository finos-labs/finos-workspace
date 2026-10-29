import { trace, context, type Context, type SpanContext, type Tracer } from "@opentelemetry/api";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import {
  BatchSpanProcessor,
  ConsoleSpanExporter,
  SimpleSpanProcessor,
  type SpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from "@opentelemetry/semantic-conventions";
import type { TelemetrySettings } from "ai";
import { getLogger } from "./logger.ts";

const logger = getLogger(["app", "telemetry"]);

export const TRACER_NAME = "ines";

export function resolveTracesUrl(
  base: string | undefined,
  signalSpecific: string | undefined,
): string | undefined {
  if (signalSpecific) return signalSpecific;
  if (!base) return undefined;
  return `${base.replace(/\/+$/, "")}/v1/traces`;
}

function otlpEndpoint(): string | undefined {
  return resolveTracesUrl(
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT || undefined,
    process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT || undefined,
  );
}

function consoleTraces(): boolean {
  return process.env.OTEL_TRACES_CONSOLE === "true";
}

export function telemetryEnabled(): boolean {
  return otlpEndpoint() !== undefined || consoleTraces();
}

function recordPrompts(): boolean {
  return process.env.OTEL_RECORD_PROMPTS === "true";
}

let provider: NodeTracerProvider | undefined;

export function initTelemetry(): void {
  if (provider) return;
  const url = otlpEndpoint();
  if (!url && !consoleTraces()) {
    logger.debug(
      "Telemetry disabled (set OTEL_EXPORTER_OTLP_ENDPOINT to export, or OTEL_TRACES_CONSOLE=true to print spans)",
    );
    return;
  }

  const spanProcessors: SpanProcessor[] = [];
  if (url) spanProcessors.push(new BatchSpanProcessor(new OTLPTraceExporter({ url })));
  if (consoleTraces()) spanProcessors.push(new SimpleSpanProcessor(new ConsoleSpanExporter()));

  provider = new NodeTracerProvider({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME || "ines",
      [ATTR_SERVICE_VERSION]: process.env.OTEL_SERVICE_VERSION || "dev",
    }),
    spanProcessors,
  });
  provider.register();

  logger.info("Telemetry enabled", {
    endpoint: url ?? null,
    console: consoleTraces(),
    recordPrompts: recordPrompts(),
  });
}

export async function shutdownTelemetry(): Promise<void> {
  if (!provider) return;
  await provider.shutdown();
  provider = undefined;
}

export function getTracer(): Tracer {
  return trace.getTracer(TRACER_NAME);
}

const TRACEPARENT_RE = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;
const ZERO_TRACE_ID = "0".repeat(32);
const ZERO_SPAN_ID = "0".repeat(16);
const TRACEPARENT_LEN = 55;

export function parseTraceparent(raw: unknown): SpanContext | null {
  if (typeof raw !== "string" || raw.length !== TRACEPARENT_LEN) return null;
  const m = TRACEPARENT_RE.exec(raw);
  if (!m) return null;
  const [, traceId, spanId, flags] = m;
  if (traceId === ZERO_TRACE_ID || spanId === ZERO_SPAN_ID) return null;
  return {
    traceId,
    spanId,
    traceFlags: parseInt(flags, 16),
    isRemote: true,
  };
}

export function formatTraceparent(ctx: {
  traceId: string;
  spanId: string;
  traceFlags: number;
}): string | null {
  if (!TRACEPARENT_RE.test(`00-${ctx.traceId}-${ctx.spanId}-00`)) return null;
  if (ctx.traceId === ZERO_TRACE_ID || ctx.spanId === ZERO_SPAN_ID) return null;
  const flags = (ctx.traceFlags & 0xff).toString(16).padStart(2, "0");
  return `00-${ctx.traceId}-${ctx.spanId}-${flags}`;
}

export function traceIdForLogs(ctx: { traceId: string }): string | undefined {
  return ctx.traceId === ZERO_TRACE_ID ? undefined : ctx.traceId;
}

export function contextFromSpanContext(spanContext: SpanContext): Context {
  return trace.setSpanContext(context.active(), spanContext);
}

export function aiTelemetry(
  functionId: string,
  metadata: Record<string, string | number | boolean | undefined>,
): TelemetrySettings {
  const clean: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(metadata)) {
    if (v !== undefined) clean[k] = v;
  }
  return {
    isEnabled: telemetryEnabled(),
    recordInputs: recordPrompts(),
    recordOutputs: recordPrompts(),
    functionId,
    metadata: clean,
  };
}
