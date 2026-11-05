import { z } from 'zod';

export type Vec2 = { x: number; y: number };
export type Sample = Vec2 & { id: string; label: 'A' | 'B' };
export type Metric = 'euclidean' | 'manhattan' | 'chebyshev';
export type KnnConfig = {
  kind: 'knn'; points: Sample[]; query: Vec2; k: number;
  metric: Metric; scaleX: number; scaleY: number;
};
export type BridgeConfig = {
  kind: 'bridge'; strainMicro: number; gaugeFactor: number;
  resistance: number; excitation: number;
  mode: 'quarter' | 'half' | 'full'; activeArm: 'r1' | 'r2';
};
export type ExperimentConfig = KnnConfig | BridgeConfig;
export type KnnParameters = Omit<KnnConfig, 'points' | 'kind'>;
export type BridgeParameters = Omit<BridgeConfig, 'kind'>;
export type ExperimentPlan = {
  title: string; question: string; explanation: string;
} & (
  { experiment: 'knn'; parameters: KnnParameters } |
  { experiment: 'bridge'; parameters: BridgeParameters }
);

const coordinate = z.number().finite().min(-5).max(5);
const vectorSchema = z.object({ x: coordinate, y: coordinate }).strict();
const sampleSchema = z.object({
  ...vectorSchema.shape,
  id: z.string().min(1),
  label: z.enum(['A', 'B']),
}).strict();
const scale = z.number().finite().min(0.1).max(10);
const knnParametersSchema = z.object({
  query: vectorSchema,
  k: z.number().int().min(1).max(15),
  metric: z.enum(['euclidean', 'manhattan', 'chebyshev']),
  scaleX: scale,
  scaleY: scale,
}).strict();
const bridgeParametersSchema = z.object({
  strainMicro: z.number().finite().min(-3000).max(3000),
  gaugeFactor: z.number().finite().min(1).max(4),
  resistance: z.number().finite().min(50).max(1000),
  excitation: z.number().finite().min(1).max(12),
  mode: z.enum(['quarter', 'half', 'full']),
  activeArm: z.enum(['r1', 'r2']),
}).strict();

export const experimentSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('knn'),
    points: z.array(sampleSchema).min(2).max(64),
    ...knnParametersSchema.shape,
  }).strict(),
  z.object({ kind: z.literal('bridge'), ...bridgeParametersSchema.shape }).strict(),
]).superRefine((config, context) => {
  if (config.kind !== 'knn') return;
  if (config.k > config.points.length) {
    context.addIssue({ code: 'custom', path: ['k'], message: 'k 不能超过样本数量。' });
  }
  const ids = new Set<string>();
  config.points.forEach(({ id }, index) => {
    if (ids.has(id)) {
      context.addIssue({ code: 'custom', path: ['points', index, 'id'], message: '样本 ID 不能重复。' });
    }
    ids.add(id);
  });
});

const planText = {
  title: z.string().max(80),
  question: z.string().max(200),
  explanation: z.string().max(1200),
};
export const planSchema = z.discriminatedUnion('experiment', [
  z.object({ ...planText, experiment: z.literal('knn'), parameters: knnParametersSchema }).strict(),
  z.object({ ...planText, experiment: z.literal('bridge'), parameters: bridgeParametersSchema }).strict(),
]);

export function makeKnn(seed = 20261105): KnnConfig {
  let state = seed >>> 0;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  const points: Sample[] = Array.from({ length: 24 }, (_, index) => {
    const label = index < 12 ? 'A' : 'B';
    const direction = label === 'A' ? -1 : 1;
    return {
      id: `p${String(index + 1).padStart(2, '0')}`,
      label,
      x: Number((direction * 1.6 + (random() - 0.5) * 4.5).toFixed(2)),
      y: Number((direction * 0.8 + (random() - 0.5) * 4.5).toFixed(2)),
    };
  });
  return {
    kind: 'knn', points, query: { x: 0, y: 0 }, k: 5,
    metric: 'euclidean', scaleX: 1, scaleY: 1,
  };
}

export function makeBridge(): BridgeConfig {
  return {
    kind: 'bridge', strainMicro: 500, gaugeFactor: 2, resistance: 120,
    excitation: 5, mode: 'quarter', activeArm: 'r1',
  };
}

export function applyPlan(plan: ExperimentPlan, current: ExperimentConfig): ExperimentConfig {
  const validated = planSchema.parse(plan);
  if (validated.experiment === 'bridge') {
    return experimentSchema.parse({ kind: 'bridge', ...validated.parameters });
  }
  const points = current.kind === 'knn' ? current.points : makeKnn().points;
  return experimentSchema.parse({ kind: 'knn', points, ...validated.parameters });
}
