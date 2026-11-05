import type { BridgeConfig } from './experiments';

export type BridgeResult = {
  resistors: { r1: number; r2: number; r3: number; r4: number };
  leftVoltage: number; rightVoltage: number;
  outputVoltage: number; approxVoltage: number;
  deltaResistance: number;
};

export function calculateBridge(config: BridgeConfig): BridgeResult {
  const { resistance, excitation, mode, activeArm } = config;
  const delta = config.gaugeFactor * config.strainMicro * 1e-6;
  const deltaResistance = resistance * delta;
  const resistors = { r1: resistance, r2: resistance, r3: resistance, r4: resistance };
  const otherArm = activeArm === 'r1' ? 'r2' : 'r1';
  resistors[activeArm] += deltaResistance;
  if (mode !== 'quarter') resistors[otherArm] -= deltaResistance;
  if (mode === 'full') {
    resistors.r3 = resistors.r2;
    resistors.r4 = resistors.r1;
  }
  const leftRatio = resistors.r2 / (resistors.r1 + resistors.r2);
  const rightRatio = resistors.r4 / (resistors.r3 + resistors.r4);
  const coefficient = mode === 'quarter' ? 0.25 : mode === 'half' ? 0.5 : 1;
  return {
    resistors,
    leftVoltage: excitation * leftRatio,
    rightVoltage: excitation * rightRatio,
    outputVoltage: excitation * (leftRatio - rightRatio),
    approxVoltage: (activeArm === 'r1' ? -1 : 1) * excitation * delta * coefficient,
    deltaResistance,
  };
}
