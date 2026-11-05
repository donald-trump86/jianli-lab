import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeBridge, makeKnn, type ExperimentConfig, type ExperimentPlan } from '@/lib/experiments';

const endpoint = 'http://localhost/api/experiment';
const fetchMock = vi.fn<typeof fetch>();
const processState = globalThis as typeof globalThis & { __jianliLabAiRequests?: number[] };
let api: typeof import('@/app/api/experiment/route');

function knnPlan(): ExperimentPlan {
  return {
    title: '比较距离度量',
    question: '增加横轴尺度后，邻居会怎样变化？',
    explanation: '坐标差先分别乘以尺度，再计算距离。',
    experiment: 'knn',
    parameters: { query: { x: 1, y: -1 }, k: 5, metric: 'manhattan', scaleX: 2, scaleY: 1 },
  };
}

function completion(plan: unknown = knnPlan()): Response {
  return Response.json({ choices: [{ message: { content: JSON.stringify(plan) } }] });
}

function request(prompt = '比较两种距离', current: ExperimentConfig = makeKnn()): Request {
  return new Request(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, current }),
  });
}

function streamRequest(stream: ReadableStream<Uint8Array>, headers?: HeadersInit): Request {
  return new Request(endpoint, {
    method: 'POST', body: stream, headers, ...{ duplex: 'half' },
  });
}

async function expectFailure(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  expect(response.headers.get('cache-control')).toBe('no-store');
  const body = await response.json();
  expect(body).toEqual({ error: expect.any(String), code });
  expect(body.error).toMatch(/[\u4e00-\u9fff]/);
  expect(JSON.stringify(body)).not.toContain('unit-test-key');
  expect(JSON.stringify(body)).not.toContain('PRIVATE_PROVIDER_DETAIL');
}

beforeEach(async () => {
  vi.resetModules();
  vi.stubEnv('AI_API_KEY', 'unit-test-key');
  vi.stubEnv('AI_BASE_URL', '');
  vi.stubEnv('AI_MODEL', '');
  fetchMock.mockReset().mockImplementation(async () => completion());
  vi.stubGlobal('fetch', fetchMock);
  delete processState.__jianliLabAiRequests;
  api = await import('@/app/api/experiment/route');
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  delete processState.__jianliLabAiRequests;
});

describe('AI configuration status and provider settings', () => {
  it('returns only a boolean status and keeps the API key server-side', async () => {
    const response = api.GET();
    expect(await response.json()).toEqual({ configured: true });
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports missing or whitespace-only keys without calling a provider', async () => {
    vi.stubEnv('AI_API_KEY', '  ');
    expect(await api.GET().json()).toEqual({ configured: false });
    await expectFailure(await api.POST(request()), 503, 'AI_NOT_CONFIGURED');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    'relative/path',
    'file:///tmp/provider',
    'ftp://example.invalid/v1',
    'https://user:password@example.invalid/v1',
    'https://example.invalid/v1?token=PRIVATE_PROVIDER_DETAIL',
    'https://example.invalid/v1#fragment',
  ])('rejects an invalid base URL without exposing its contents: %s', async (baseUrl) => {
    vi.stubEnv('AI_BASE_URL', baseUrl);
    expect(await api.GET().json()).toEqual({ configured: false });
    await expectFailure(await api.POST(request()), 503, 'AI_CONFIG_INVALID');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('uses the requested compatible base path and model', async () => {
    vi.stubEnv('AI_BASE_URL', 'https://example.invalid/compatible/v1///');
    vi.stubEnv('AI_MODEL', 'custom-model');
    expect((await api.POST(request())).status).toBe(200);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://example.invalid/compatible/v1/chat/completions');
    expect(JSON.parse(String(init?.body)).model).toBe('custom-model');
  });
});

describe('validated experiment plans', () => {
  it('trims the prompt and requests a complete JSON plan with bounded output', async () => {
    const current = makeKnn(17);
    const response = await api.POST(request('  比较两种距离  ', current));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ plan: knnPlan() });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect(init).toMatchObject({
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer unit-test-key' },
      redirect: 'error',
    });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    const body = JSON.parse(String(init?.body));
    expect(body).toMatchObject({
      model: 'gpt-4.1-mini', max_tokens: 1800, response_format: { type: 'json_object' },
    });
    expect(JSON.parse(body.messages[1].content)).toEqual({ prompt: '比较两种距离', current });
    expect(body.messages[0].content).toContain('左中点减右中点');
    expect(body.messages[0].content).toContain('-Vex*δ*系数');
    expect(body.messages[0].content).not.toContain('unit-test-key');
  });

  it('accepts a bridge plan and a switch to another supported experiment', async () => {
    const { kind: _kind, ...parameters } = makeBridge();
    const plan: ExperimentPlan = {
      title: '比较电桥灵敏度', question: '切换全桥后输出如何变化？',
      explanation: '输出电压以左中点减右中点为正方向。',
      experiment: 'bridge', parameters: { ...parameters, mode: 'full', activeArm: 'r2' },
    };
    fetchMock.mockImplementation(async () => completion(plan));
    const response = await api.POST(request('改为全桥实验'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ plan });
  });

  it('accepts exactly 1000 characters after trimming', async () => {
    expect((await api.POST(request(`  ${'测'.repeat(1000)}  `))).status).toBe(200);
  });

  it.each([
    'not JSON',
    '```json\n{}\n```',
    JSON.stringify({ ...knnPlan(), extra: true }),
    JSON.stringify({ ...knnPlan(), experiment: 'oscilloscope' }),
    JSON.stringify({ ...knnPlan(), parameters: { ...knnPlan().parameters, k: 16 } }),
    JSON.stringify({ ...knnPlan(), parameters: { ...knnPlan().parameters, query: { x: 6, y: 0 } } }),
    JSON.stringify({ ...knnPlan(), parameters: { ...knnPlan().parameters, execute: 'PRIVATE_PROVIDER_DETAIL' } }),
    JSON.stringify({ experiment: 'knn' }),
  ])('rejects malformed, unsupported or non-strict model JSON: %s', async (content) => {
    fetchMock.mockImplementation(async () => Response.json({ choices: [{ message: { content } }] }));
    await expectFailure(await api.POST(request()), 502, 'AI_INVALID_RESPONSE');
  });

  it('validates the final applied configuration against the current sample count', async () => {
    const initial = makeKnn();
    const current = { ...initial, points: initial.points.slice(0, 2), k: 2 };
    const plan = knnPlan();
    if (plan.experiment !== 'knn') throw new Error('Expected a KNN fixture');
    plan.parameters.k = 3;
    fetchMock.mockImplementation(async () => completion(plan));
    await expectFailure(await api.POST(request('取三个邻居', current)), 502, 'AI_INVALID_RESPONSE');
  });
});

describe('request trust boundary', () => {
  it.each(['', '   ', '测'.repeat(1001)])('rejects an invalid prompt before calling a provider', async (prompt) => {
    await expectFailure(await api.POST(request(prompt)), 400, 'INVALID_REQUEST');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    {},
    { prompt: '测试', current: { kind: 'unsupported' } },
    { prompt: '测试', current: makeBridge(), extra: true },
    { prompt: 123, current: makeBridge() },
    { prompt: '测试', current: { ...makeBridge(), strainMicro: 3001 } },
  ])('rejects missing, extra or invalid request fields', async (body) => {
    const response = await api.POST(new Request(endpoint, { method: 'POST', body: JSON.stringify(body) }));
    await expectFailure(response, 400, 'INVALID_REQUEST');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects invalid JSON and empty bodies without calling a provider', async () => {
    for (const body of ['{invalid', '']) {
      await expectFailure(await api.POST(new Request(endpoint, { method: 'POST', body })), 400, 'INVALID_REQUEST');
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a content-length above 32 KiB before consuming the body', async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ cancel });
    const response = await api.POST(streamRequest(stream, { 'content-length': String(32 * 1024 + 1) }));
    await expectFailure(response, 413, 'BODY_TOO_LARGE');
    expect(fetchMock).not.toHaveBeenCalled();
    await stream.cancel();
  });

  it.each([undefined, { 'content-length': '1' }])('enforces the streaming byte limit with absent or false length headers', async (headers) => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(16 * 1024).fill(32));
        controller.enqueue(new Uint8Array(16 * 1024).fill(32));
        controller.enqueue(new Uint8Array([32]));
      },
      cancel,
    });
    const incoming = streamRequest(stream, headers);
    if (!headers) expect(incoming.headers.has('content-length')).toBe(false);
    await expectFailure(await api.POST(incoming), 413, 'BODY_TOO_LARGE');
    expect(cancel).toHaveBeenCalledOnce();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('counts UTF-8 bytes rather than JavaScript character length', async () => {
    const body = JSON.stringify({ prompt: '测'.repeat(11_000), current: makeBridge() });
    expect(body.length).toBeLessThan(32 * 1024);
    expect(new TextEncoder().encode(body).byteLength).toBeGreaterThan(32 * 1024);
    await expectFailure(await api.POST(new Request(endpoint, { method: 'POST', body })), 413, 'BODY_TOO_LARGE');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('allows a valid JSON request of exactly 32 KiB', async () => {
    const body = JSON.stringify({ prompt: '测试', current: makeKnn() });
    const padded = body + ' '.repeat(32 * 1024 - new TextEncoder().encode(body).byteLength);
    expect(new TextEncoder().encode(padded).byteLength).toBe(32 * 1024);
    expect((await api.POST(new Request(endpoint, { method: 'POST', body: padded }))).status).toBe(200);
  });
});

describe('provider failures and whole-request deadline', () => {
  it.each([401, 429, 500])('sanitizes upstream HTTP %s responses', async (status) => {
    fetchMock.mockImplementation(async () => Response.json({ error: 'PRIVATE_PROVIDER_DETAIL unit-test-key' }, { status }));
    await expectFailure(await api.POST(request()), 502, 'AI_UPSTREAM_ERROR');
  });

  it('sanitizes fetch failures', async () => {
    fetchMock.mockRejectedValue(new Error('PRIVATE_PROVIDER_DETAIL unit-test-key'));
    await expectFailure(await api.POST(request()), 502, 'AI_UPSTREAM_ERROR');
  });

  it.each(['{invalid', '{}', '{"choices":[]}', '{"choices":[{"message":{"content":null}}]}'])('rejects malformed completion envelopes', async (body) => {
    fetchMock.mockImplementation(async () => new Response(body, { status: 200 }));
    await expectFailure(await api.POST(request()), 502, 'AI_INVALID_RESPONSE');
  });

  it('aborts an unresponsive provider at 20 seconds', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(() => new Promise<Response>(() => {}));
    const pending = api.POST(request());
    await vi.advanceTimersByTimeAsync(20_000);
    await expectFailure(await pending, 504, 'AI_TIMEOUT');
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true);
  });

  it('includes reading the provider response body in the deadline', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(async () => {
      const response = new Response('{}');
      vi.spyOn(response, 'json').mockImplementation(() => new Promise(() => {}));
      return response;
    });
    const pending = api.POST(request());
    await vi.advanceTimersByTimeAsync(20_000);
    await expectFailure(await pending, 504, 'AI_TIMEOUT');
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('includes stalled incoming request bodies in the deadline and cancels them', async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ cancel });
    const pending = api.POST(streamRequest(stream));
    await vi.advanceTimersByTimeAsync(20_000);
    await expectFailure(await pending, 504, 'AI_TIMEOUT');
    expect(cancel).toHaveBeenCalledOnce();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('process-wide sliding request quota', () => {
  it('charges only configured valid requests, survives module reloads and recovers at one minute', async () => {
    for (let index = 0; index < 13; index += 1) {
      expect((await api.POST(request('  '))).status).toBe(400);
    }
    vi.stubEnv('AI_API_KEY', '');
    for (let index = 0; index < 13; index += 1) {
      expect((await api.POST(request())).status).toBe(503);
    }
    vi.stubEnv('AI_API_KEY', 'unit-test-key');
    vi.stubEnv('AI_BASE_URL', 'invalid');
    expect((await api.POST(request())).status).toBe(503);
    vi.stubEnv('AI_BASE_URL', '');
    const now = 1_800_000_000_000;
    vi.spyOn(Date, 'now').mockReturnValue(now);
    for (let index = 0; index < 12; index += 1) {
      expect((await api.POST(request())).status).toBe(200);
    }
    vi.resetModules();
    api = await import('@/app/api/experiment/route');
    await expectFailure(await api.POST(request()), 429, 'RATE_LIMITED');
    expect(fetchMock).toHaveBeenCalledTimes(12);
    vi.spyOn(Date, 'now').mockReturnValue(now + 60_000);
    expect((await api.POST(request())).status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(13);
  });

  it('counts failed upstream calls because they still consume provider requests', async () => {
    fetchMock.mockImplementation(async () => new Response('PRIVATE_PROVIDER_DETAIL', { status: 500 }));
    for (let index = 0; index < 12; index += 1) {
      expect((await api.POST(request())).status).toBe(502);
    }
    await expectFailure(await api.POST(request()), 429, 'RATE_LIMITED');
    expect(fetchMock).toHaveBeenCalledTimes(12);
  });
});
