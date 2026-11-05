import { z } from 'zod';
import { AiError, generateExperimentPlan, getAiConfiguration, isAiConfigured } from '@/lib/ai';
import { experimentSchema } from '@/lib/experiments';

export const runtime = 'nodejs';

const maxBodyBytes = 32 * 1024;
const deadlineMs = 20_000;
const requestSchema = z.object({
  prompt: z.string().trim().min(1).max(1000),
  current: experimentSchema,
}).strict();

const processState = globalThis as typeof globalThis & {
  __jianliLabAiRequests?: number[];
};

function takeRequestSlot(): void {
  const now = Date.now();
  const requests = (processState.__jianliLabAiRequests ?? []).filter(
    (timestamp) => timestamp > now - 60_000,
  );
  processState.__jianliLabAiRequests = requests;
  if (requests.length >= 12) {
    throw new AiError('RATE_LIMITED', 'AI 请求过于频繁，每分钟最多 12 次，请稍后重试。', 429);
  }
  requests.push(now);
}

async function readRequestBody(request: Request, signal: AbortSignal): Promise<unknown> {
  if (Number(request.headers.get('content-length')) > maxBodyBytes) {
    throw new AiError('BODY_TOO_LARGE', '请求正文不能超过 32 KiB。', 413);
  }
  if (!request.body) {
    throw new AiError('INVALID_REQUEST', '请求必须包含有效的 JSON 正文。', 400);
  }

  const reader = request.body.getReader();
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let bytes = 0;
    let text = '';
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBodyBytes) {
        cancel();
        throw new AiError('BODY_TOO_LARGE', '请求正文不能超过 32 KiB。', 413);
      }
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } catch (error) {
    if (error instanceof AiError) throw error;
    if (signal.aborted) {
      throw new AiError('AI_TIMEOUT', 'AI 请求已超过 20 秒，请稍后重试。', 504);
    }
    throw new AiError('INVALID_REQUEST', '请求必须包含有效的 JSON 正文。', 400);
  } finally {
    signal.removeEventListener('abort', cancel);
    reader.releaseLock();
  }
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

export function GET(): Response {
  return json({ configured: isAiConfigured() });
}

export async function POST(request: Request): Promise<Response> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new AiError('AI_TIMEOUT', 'AI 请求已超过 20 秒，请稍后重试。', 504));
    }, deadlineMs);
  });

  try {
    return await Promise.race([
      (async () => {
        getAiConfiguration();
        const parsed = requestSchema.safeParse(await readRequestBody(request, controller.signal));
        controller.signal.throwIfAborted();
        if (!parsed.success) {
          throw new AiError('INVALID_REQUEST', '请求参数无效：请输入 1—1000 字的描述，并提供有效的当前实验。', 400);
        }
        takeRequestSlot();
        const plan = await generateExperimentPlan(parsed.data.prompt, parsed.data.current, controller.signal);
        return json({ plan });
      })(),
      deadline,
    ]);
  } catch (error) {
    const failure = error instanceof AiError
      ? error
      : new AiError('AI_UPSTREAM_ERROR', 'AI 服务暂时不可用，请稍后重试。', 502);
    return json({ error: failure.message, code: failure.code }, failure.status);
  } finally {
    clearTimeout(timer);
  }
}
