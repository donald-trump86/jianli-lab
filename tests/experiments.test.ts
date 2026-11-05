import { describe, expect, it } from 'vitest';
import {
  applyPlan,
  experimentSchema,
  makeBridge,
  makeKnn,
  planSchema,
  type BridgeConfig,
  type ExperimentPlan,
  type KnnConfig,
  type Sample,
} from '@/lib/experiments';
import { classify, distance } from '@/lib/knn';
import { calculateBridge } from '@/lib/bridge';
import { parseSnapshot, serializeSnapshot } from '@/lib/snapshot';

const sample = (id: string, label: 'A' | 'B', x: number, y = 0): Sample => ({ id, label, x, y });
const knnWith = (points: Sample[], k = 1): KnnConfig => ({
  ...makeKnn(), points, k, query: { x: 0, y: 0 },
});
const knnPlan = (): ExperimentPlan => ({
  title: '比较距离', question: '改变尺度后邻居会改变吗？', explanation: '先缩放坐标差，再计算距离。',
  experiment: 'knn', parameters: {
    query: { x: 0.25, y: -0.75 }, k: 3, metric: 'manhattan', scaleX: 2, scaleY: 0.5,
  },
});
const snapshot = (experiment: unknown, extra: Record<string, unknown> = {}) => JSON.stringify({
  version: 1, savedAt: '2026-11-05T07:00:00.000Z', experiment, ...extra,
});

function expectChineseError(action: () => unknown) {
  expect(action).toThrow(/[\u3400-\u9fff]/u);
}

describe('shared experiment defaults and strict validation', () => {
  it('generates stable seeded 24-point samples without shared mutable defaults', () => {
    const first = makeKnn(42);
    expect(first).toEqual(makeKnn(42));
    expect(makeKnn()).toEqual(makeKnn());
    expect(first.points).not.toEqual(makeKnn(43).points);
    expect(first.points).toHaveLength(24);
    expect(new Set(first.points.map(({ id }) => id)).size).toBe(24);
    expect(first.points.every(({ id }) => /^[\x20-\x7e]+$/.test(id))).toBe(true);
    expect(new Set(first.points.map(({ label }) => label))).toEqual(new Set(['A', 'B']));
    expect(first).toMatchObject({ k: 5, metric: 'euclidean', scaleX: 1, scaleY: 1 });
    expect(experimentSchema.safeParse(first).success).toBe(true);
    first.points[0].x = 5;
    expect(makeKnn(42).points).not.toEqual(first.points);
    expect(experimentSchema.safeParse(makeKnn(0)).success).toBe(true);
  });

  it('provides the specified bridge defaults', () => {
    expect(makeBridge()).toEqual({
      kind: 'bridge', strainMicro: 500, gaugeFactor: 2, resistance: 120,
      excitation: 5, mode: 'quarter', activeArm: 'r1',
    });
  });

  it('accepts inclusive KNN bounds and rejects invalid sample counts and k', () => {
    const points = Array.from({ length: 64 }, (_, i) => sample(`p${i}`, i % 2 ? 'A' : 'B', i % 2 ? -5 : 5));
    expect(experimentSchema.safeParse({
      ...knnWith(points, 15), query: { x: -5, y: 5 }, scaleX: 0.1, scaleY: 10,
    }).success).toBe(true);
    expect(experimentSchema.safeParse(knnWith(points.slice(0, 2), 2)).success).toBe(true);
    for (const count of [0, 1, 65]) {
      const invalid = Array.from({ length: count }, (_, i) => sample(`p${i}`, 'A', 0));
      expect(experimentSchema.safeParse(knnWith(invalid)).success).toBe(false);
    }
    for (const k of [0, 1.5, 16, 25, NaN, Infinity]) {
      expect(experimentSchema.safeParse({ ...makeKnn(), k }).success).toBe(false);
    }
    expect(experimentSchema.safeParse(knnWith(points.slice(0, 2), 3)).success).toBe(false);
  });

  it('rejects duplicate ids, invalid labels, non-finite coordinates and extra nested fields', () => {
    const config = makeKnn();
    const invalid: unknown[] = [
      { ...config, unexpected: true },
      { ...config, query: { x: 0, y: 0, z: 1 } },
      { ...config, query: { x: 5.01, y: 0 } },
      { ...config, query: { x: 0, y: -5.01 } },
      { ...config, query: { x: Infinity, y: 0 } },
      { ...config, query: { x: NaN, y: 0 } },
      { ...config, scaleX: 0.099 },
      { ...config, scaleY: 10.01 },
      { ...config, scaleY: Infinity },
      knnWith([sample('same', 'A', 0), sample('same', 'B', 1)]),
      knnWith([sample('', 'A', 0), sample('other', 'B', 1)]),
      { ...config, points: [{ ...config.points[0], label: 'C' }, ...config.points.slice(1)] },
      { ...config, points: [{ ...config.points[0], x: -Infinity }, ...config.points.slice(1)] },
      { ...config, points: [{ ...config.points[0], extra: 1 }, ...config.points.slice(1)] },
    ];
    for (const value of invalid) expect(experimentSchema.safeParse(value).success).toBe(false);
  });

  it.each([
    ['strainMicro', -3000, 3000], ['gaugeFactor', 1, 4],
    ['resistance', 50, 1000], ['excitation', 1, 12],
  ] as const)('validates finite inclusive bridge bounds for %s', (key, minimum, maximum) => {
    for (const value of [minimum, maximum]) {
      expect(experimentSchema.safeParse({ ...makeBridge(), [key]: value }).success).toBe(true);
    }
    for (const value of [minimum - 0.01, maximum + 0.01, NaN, Infinity, -Infinity]) {
      expect(experimentSchema.safeParse({ ...makeBridge(), [key]: value }).success).toBe(false);
    }
  });

  it('rejects unknown bridge fields and modes', () => {
    for (const patch of [{ extra: true }, { mode: 'other' }, { activeArm: 'r3' }]) {
      expect(experimentSchema.safeParse({ ...makeBridge(), ...patch }).success).toBe(false);
    }
  });
});

describe('validated experiment plans', () => {
  it('uses exactly the KNN and bridge parameter shapes, without kind or points', () => {
    const { kind: _kind, ...parameters } = makeBridge();
    const bridgePlan = { ...knnPlan(), experiment: 'bridge', parameters };
    expect(planSchema.safeParse(knnPlan()).success).toBe(true);
    expect(planSchema.safeParse(bridgePlan).success).toBe(true);
    for (const plan of [
      { ...knnPlan(), extra: 1 },
      { ...knnPlan(), parameters: { ...knnPlan().parameters, kind: 'knn' } },
      { ...knnPlan(), parameters: { ...knnPlan().parameters, points: makeKnn().points } },
      { ...knnPlan(), parameters: { ...knnPlan().parameters, query: { x: 0, y: 0, z: 1 } } },
      { ...knnPlan(), parameters: { ...knnPlan().parameters, k: 1.5 } },
      { ...knnPlan(), parameters: { ...knnPlan().parameters, scaleX: Infinity } },
      { ...bridgePlan, parameters: { ...parameters, kind: 'bridge' } },
      { ...bridgePlan, parameters: { ...parameters, resistance: 0 } },
    ]) expect(planSchema.safeParse(plan).success).toBe(false);
  });

  it.each([['title', 80], ['question', 200], ['explanation', 1200]] as const)(
    'enforces the %s text bound', (field, limit) => {
      expect(planSchema.safeParse({ ...knnPlan(), [field]: '中'.repeat(limit) }).success).toBe(true);
      expect(planSchema.safeParse({ ...knnPlan(), [field]: '中'.repeat(limit + 1) }).success).toBe(false);
    },
  );

  it('preserves current KNN samples exactly and validates merged k without mutation', () => {
    const current = knnWith([
      sample('custom1', 'A', -1.23456789, 2.34567891),
      sample('custom2', 'B', 4.321, -3.21),
      sample('custom3', 'A', 0.0000001, -0.0000001),
    ], 2);
    const before = structuredClone(current);
    const plan = knnPlan();
    expect(applyPlan(plan, current)).toEqual({ ...current, ...plan.parameters });
    expect(current).toEqual(before);
    expect(() => applyPlan(plan, { ...current, points: current.points.slice(0, 2) })).toThrow();
    const planWithExtraField = { ...plan, extra: true };
    expect(() => applyPlan(planWithExtraField, current)).toThrow();
  });

  it('uses default points when switching from a bridge to KNN and applies bridge parameters', () => {
    const plan = knnPlan();
    expect(applyPlan(plan, makeBridge())).toEqual({ ...makeKnn(), ...plan.parameters });
    const { kind: _kind, ...parameters } = { ...makeBridge(), strainMicro: -1000, mode: 'full' as const };
    const bridgePlan: ExperimentPlan = { ...knnPlan(), experiment: 'bridge', parameters };
    expect(applyPlan(bridgePlan, makeKnn())).toEqual({ kind: 'bridge', ...parameters });
    expect(applyPlan(bridgePlan, makeBridge())).toEqual({ kind: 'bridge', ...parameters });
  });
});

describe('deterministic distance and KNN voting', () => {
  it('computes the three metrics after scaling coordinate differences', () => {
    const a = { x: 1, y: 2 };
    const b = { x: 4, y: 6 };
    expect(distance(a, b, 'euclidean', 1, 1)).toBe(5);
    expect(distance(a, b, 'manhattan', 1, 1)).toBe(7);
    expect(distance(a, b, 'chebyshev', 1, 1)).toBe(4);
    expect(distance(a, b, 'euclidean', 2, 0.5)).toBeCloseTo(Math.sqrt(40), 12);
    expect(distance(a, b, 'manhattan', 2, 0.5)).toBe(8);
    expect(distance(a, b, 'chebyshev', 2, 0.5)).toBe(6);
    expect(distance(a, a, 'euclidean', 10, 0.1)).toBe(0);
  });

  it('changes the nearest neighbor with scale while leaving coordinates untouched', () => {
    const config = knnWith([sample('x-near', 'A', 0.1, 2), sample('y-near', 'B', 1, 0.1)]);
    const before = structuredClone(config);
    expect(classify(config).neighbors[0].id).toBe('y-near');
    const scaled = classify({ ...config, scaleY: 0.1 });
    expect(scaled.label).toBe('A');
    expect(scaled.neighbors[0]).toEqual({ ...config.points[0], distance: Math.hypot(0.1, 0.2) });
    expect(config).toEqual(before);
  });

  it('breaks equal-distance neighbor ties using ASCII id order regardless of input order', () => {
    const points = [sample('a', 'B', 1), sample('Z', 'A', -1)];
    expect(classify(knnWith(points)).neighbors.map(({ id }) => id)).toEqual(['Z']);
    expect(classify(knnWith([...points].reverse())).neighbors.map(({ id }) => id)).toEqual(['Z']);
  });

  it('uses majority votes and reports vote share rather than nearest-label confidence', () => {
    const result = classify(knnWith([
      sample('b-near', 'B', 0.1), sample('a1', 'A', 0.2), sample('a2', 'A', 0.3),
    ], 3));
    expect(result).toMatchObject({ label: 'A', votes: { A: 2, B: 1 }, voteShare: 2 / 3 });
  });

  it('breaks a vote tie by the closest class and then by A, independently of id order', () => {
    const closest = classify(knnWith([
      sample('b1', 'B', 0.1), sample('a1', 'A', 0.2),
      sample('a2', 'A', 0.3), sample('b2', 'B', 0.4),
    ], 4));
    expect(closest).toMatchObject({ label: 'B', votes: { A: 2, B: 2 }, voteShare: 0.5 });
    const equal = classify(knnWith([sample('A-id', 'B', 1), sample('z-id', 'A', -1)], 2));
    expect(equal.neighbors[0].label).toBe('B');
    expect(equal.label).toBe('A');
  });

  it('supports a query override for decision regions without mutating the configured query', () => {
    const config = knnWith([sample('a', 'A', -2), sample('b', 'B', 2)]);
    expect(classify(config, { x: 2, y: 0 }).label).toBe('B');
    expect(config.query).toEqual({ x: 0, y: 0 });
  });
});

describe('ideal strain bridge calculations', () => {
  it('matches the default exact quarter-bridge output and small-signal value', () => {
    const config = makeBridge();
    const result = calculateBridge(config);
    expect(result.resistors).toEqual({ r1: 120.12, r2: 120, r3: 120, r4: 120 });
    expect(result.deltaResistance).toBeCloseTo(0.12, 12);
    expect(result.leftVoltage).toBeCloseTo(5 * 120 / 240.12, 12);
    expect(result.rightVoltage).toBe(2.5);
    expect(result.outputVoltage).toBeCloseTo(-0.00124937531234375, 12);
    expect(result.approxVoltage).toBeCloseTo(-0.00125, 12);
  });

  it.each(['quarter', 'half', 'full'] as const)('balances %s at zero strain for either active arm', (mode) => {
    for (const activeArm of ['r1', 'r2'] as const) {
      const result = calculateBridge({ ...makeBridge(), mode, activeArm, strainMicro: 0 });
      expect(result.resistors).toEqual({ r1: 120, r2: 120, r3: 120, r4: 120 });
      expect(result.leftVoltage).toBe(2.5);
      expect(result.rightVoltage).toBe(2.5);
      expect(result.outputVoltage).toBe(0);
      expect(result.approxVoltage).toBeCloseTo(0, 12);
      expect(result.deltaResistance).toBe(0);
    }
  });

  it.each([
    ['half', -0.0025, { r1: 120.12, r2: 119.88, r3: 120, r4: 120 }],
    ['full', -0.005, { r1: 120.12, r2: 119.88, r3: 119.88, r4: 120.12 }],
  ] as const)('uses the specified %s wiring', (mode, output, resistors) => {
    const result = calculateBridge({ ...makeBridge(), mode });
    expect(result.resistors).toEqual(resistors);
    expect(result.outputVoltage).toBeCloseTo(output, 12);
    expect(result.approxVoltage).toBeCloseTo(output, 12);
  });

  it.each(['quarter', 'half', 'full'] as const)('reverses %s polarity with R2 or negative strain', (mode) => {
    const positive = calculateBridge({ ...makeBridge(), mode });
    const r2 = calculateBridge({ ...makeBridge(), mode, activeArm: 'r2' });
    const negative = calculateBridge({ ...makeBridge(), mode, strainMicro: -500 });
    expect(positive.outputVoltage).toBeLessThan(0);
    expect(r2.outputVoltage).toBeGreaterThan(0);
    expect(negative.outputVoltage).toBeGreaterThan(0);
    expect(r2.outputVoltage).toBeCloseTo(-positive.outputVoltage, 12);
    expect(r2.approxVoltage).toBeCloseTo(-positive.approxVoltage, 12);
    expect(negative.approxVoltage).toBeCloseTo(-positive.approxVoltage, 12);
    expect(negative.deltaResistance).toBeCloseTo(-0.12, 12);
  });

  it.each([
    { strainMicro: -3000, gaugeFactor: 4, resistance: 1000, excitation: 12 },
    { strainMicro: 3000, gaugeFactor: 1, resistance: 50, excitation: 1 },
    { strainMicro: 1234, gaugeFactor: 2.7, resistance: 350, excitation: 3.3 },
  ])('stays finite and obeys voltage division across configurations: %j', (parameters) => {
    for (const mode of ['quarter', 'half', 'full'] as const) {
      for (const activeArm of ['r1', 'r2'] as const) {
        const config: BridgeConfig = { ...makeBridge(), ...parameters, mode, activeArm };
        const result = calculateBridge(config);
        const { r1, r2, r3, r4 } = result.resistors;
        expect(Object.values(result.resistors).every((value) => value > 0 && Number.isFinite(value))).toBe(true);
        expect(Number.isFinite(result.outputVoltage)).toBe(true);
        expect(result.outputVoltage).toBeCloseTo(parameters.excitation * (r2 / (r1 + r2) - r4 / (r3 + r4)), 12);
        const changedResistance = calculateBridge({
          ...config, resistance: parameters.resistance === 50 ? 100 : parameters.resistance / 2,
        });
        expect(changedResistance.outputVoltage).toBeCloseTo(result.outputVoltage, 12);
      }
    }
  });
});

describe('version 1 experiment snapshots', () => {
  it('round-trips precise imported point values, ids and all experiment settings', () => {
    const config = knnWith([
      sample('imported-A', 'A', -1.2345678912345, 4.987654321),
      sample('imported-B', 'B', 0.000000000123, -3.7654321987),
    ], 2);
    const serialized = serializeSnapshot(config);
    const envelope = JSON.parse(serialized);
    expect(Object.keys(envelope).sort()).toEqual(['experiment', 'savedAt', 'version']);
    expect(envelope.version).toBe(1);
    expect(new Date(envelope.savedAt).toISOString()).toBe(envelope.savedAt);
    expect(parseSnapshot(serialized)).toEqual(config);
    expect(parseSnapshot(serializeSnapshot(makeBridge()))).toEqual(makeBridge());
  });

  it('reports malformed JSON, envelopes, dates, versions and extra fields in Chinese', () => {
    const valid = JSON.parse(snapshot(makeKnn()));
    for (const text of [
      '', '{', 'null', '[]', JSON.stringify(makeKnn()),
      JSON.stringify({ ...valid, version: 2 }),
      JSON.stringify({ ...valid, version: '1' }),
      JSON.stringify({ ...valid, savedAt: 'today' }),
      JSON.stringify({ ...valid, savedAt: undefined }),
      JSON.stringify({ ...valid, extra: true }),
    ]) expectChineseError(() => parseSnapshot(text));
  });

  it('rejects invalid experiment data, duplicate ids, non-finite numbers and excess parameters', () => {
    const config = makeKnn();
    for (const experiment of [
      { ...config, points: [config.points[0], config.points[0]] },
      { ...config, k: 25 },
      { ...config, query: { x: 6, y: 0 } },
      { ...config, scaleY: null },
      { ...config, apiKey: 'not-a-real-key' },
      { ...makeBridge(), resistance: -120 },
    ]) expectChineseError(() => parseSnapshot(snapshot(experiment)));
    const finite = snapshot({ ...makeBridge(), strainMicro: 123.456 });
    expectChineseError(() => parseSnapshot(finite.replace('123.456', '1e400')));
    expectChineseError(() => serializeSnapshot({ ...config, scaleX: Infinity }));
  });

  it('enforces 64 KiB using UTF-8 bytes, including whitespace and multibyte ids', () => {
    const valid = snapshot(makeBridge());
    const exactLimit = valid + ' '.repeat(64 * 1024 - new TextEncoder().encode(valid).length);
    expect(parseSnapshot(exactLimit)).toEqual(makeBridge());
    expectChineseError(() => parseSnapshot(exactLimit + ' '));
    const multibyte = knnWith([sample('中'.repeat(23000), 'A', 0), sample('b', 'B', 1)]);
    const oversized = snapshot(multibyte);
    expect(oversized.length).toBeLessThan(64 * 1024);
    expect(new TextEncoder().encode(oversized).length).toBeGreaterThan(64 * 1024);
    expectChineseError(() => parseSnapshot(oversized));
    expectChineseError(() => serializeSnapshot(multibyte));
  });
});
