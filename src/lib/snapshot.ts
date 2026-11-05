import { z } from 'zod';
import { experimentSchema, type ExperimentConfig } from './experiments';

const maximumBytes = 64 * 1024;
const snapshotSchema = z.object({
  version: z.literal(1),
  savedAt: z.iso.datetime({ offset: true }),
  experiment: experimentSchema,
}).strict();

function checkSize(text: string): void {
  if (new TextEncoder().encode(text).byteLength > maximumBytes) {
    throw new Error('快照不能超过 64 KiB，请减少文件内容。');
  }
}

export function serializeSnapshot(config: ExperimentConfig): string {
  const parsed = experimentSchema.safeParse(config);
  if (!parsed.success) {
    throw new Error('实验参数无效，无法导出快照，请检查数值范围、样本 ID 和 k。');
  }
  const text = JSON.stringify({
    version: 1,
    savedAt: new Date().toISOString(),
    experiment: parsed.data,
  });
  checkSize(text);
  return text;
}

export function parseSnapshot(text: string): ExperimentConfig {
  checkSize(text);
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error('快照不是有效的 JSON，请检查文件内容。');
  }
  const result = snapshotSchema.safeParse(value);
  if (!result.success) {
    const issues = result.error.issues;
    if (issues.some(({ path }) => path[0] === 'version')) {
      throw new Error('快照版本不受支持，仅支持版本 1。');
    }
    if (issues.some(({ path }) => path[0] === 'savedAt')) {
      throw new Error('快照保存时间无效，需要 ISO 格式时间。');
    }
    throw new Error('快照内容无效，请检查实验参数、样本 ID、k 及是否有多余字段。');
  }
  return result.data.experiment;
}
