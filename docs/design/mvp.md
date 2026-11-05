# 见理首版设计

日期：2026-11-05。依据：本轮用户要求在当前仓库开始实现，沿用前轮调研中“两个实验、固定内核与 AI 配置”的建议。本文记录本次采用的实现决定。

## 用户与完成标准

正在学习模式识别与传感器的本科生，可以先预测结果，再操作参数并观察数值变化。打开首页即进入中文实验台；无需模型密钥即可使用两个实验、示例引导和快照。AI 配置完成后，用户可用自然语言建立实验。

首版交付：距离度量/KNN、理想应变电桥、JSON 快照导入导出、服务端 AI 配置接口、启动文档和真实的分步提交。暂不加入登录、教材上传、任意生成代码、完整电路编辑器和第三个实验。

## 技术与界面

- 单个 Next.js App Router 项目，TypeScript、React、普通 CSS、SVG 图形、Zod 校验、Vitest 测试。依赖固定版本，pnpm 锁文件入库。
- Node.js 22.12+（22 系列）、24 或 26+，使用 pnpm；实际验证环境为 Node.js 26.13.0、pnpm 12.16.1。
- 主界面采用 framed-sheet 浅色实验工作台：左侧切换实验，主区并列画布与参数，问题引导和 AI 输入置于实验下方。用户追加设计技能后改为蓝灰底色、白色面板、青蓝数据色；图形同时以形状和标签区分。
- 小屏改为纵向布局，不隐藏核心操作。滑块、选择器、图中可拖动点均支持键盘；状态和错误通过可访问提示展示。
- IBM Plex Sans 字体从依赖本地打包，中文使用系统字体；无远程字体、图片或仿真器嵌入。手动实验不依赖外部请求。

## 共享数据与接口

`src/lib/experiments.ts` 定义并导出以下类型、Zod schema 和默认配置。所有数字必须有限。

```ts
type Vec2 = { x: number; y: number };
type Sample = Vec2 & { id: string; label: 'A' | 'B' };
type Metric = 'euclidean' | 'manhattan' | 'chebyshev';
type KnnConfig = {
  kind: 'knn'; points: Sample[]; query: Vec2; k: number;
  metric: Metric; scaleX: number; scaleY: number;
};
type BridgeConfig = {
  kind: 'bridge'; strainMicro: number; gaugeFactor: number;
  resistance: number; excitation: number;
  mode: 'quarter' | 'half' | 'full'; activeArm: 'r1' | 'r2';
};
type ExperimentConfig = KnnConfig | BridgeConfig;
type KnnParameters = Omit<KnnConfig, 'points' | 'kind'>;
type BridgeParameters = Omit<BridgeConfig, 'kind'>;
type ExperimentPlan = {
  title: string; question: string; explanation: string;
} & (
  { experiment: 'knn'; parameters: KnnParameters } |
  { experiment: 'bridge'; parameters: BridgeParameters }
);
```

接口：`makeKnn(seed?: number): KnnConfig`、`makeBridge(): BridgeConfig`、`applyPlan(plan: ExperimentPlan, current: ExperimentConfig): ExperimentConfig`，以及 `experimentSchema`、`planSchema`。

坐标范围 [-5, 5]，样本 2—64 个，ID 唯一，k 为 1—15 且不超过样本数；scaleX/scaleY 为 0.1—10。默认样本 24 个，默认 k=5、欧氏距离、尺度 1；确定性种子用于生成样例。AI 改同一 KNN 实验时保留当前样本，跨实验时使用默认样本。

电桥应变范围 [-3000, 3000] 微应变，GF 为 1—4，电阻 50—1000 Ω，激励 1—12 V。默认 500 微应变、GF=2、120 Ω、5 V、四分之一桥、R1 受拉。计划标题不超过 80 字、问题不超过 200 字、说明不超过 1200 字；未知字段拒绝。

## 距离与 KNN

`src/lib/knn.ts` 导出：

```ts
type Neighbor = Sample & { distance: number };
type KnnResult = {
  label: 'A' | 'B'; neighbors: Neighbor[];
  votes: { A: number; B: number }; voteShare: number;
};
function distance(a: Vec2, b: Vec2, metric: Metric, scaleX: number, scaleY: number): number;
function classify(config: KnnConfig, query?: Vec2): KnnResult;
```

先对坐标差分别乘 scaleX/scaleY，再求距离；缩放影响计算，画布坐标保持不变。邻居按距离、ID 的确定性字符串顺序排序后取 k。投票同票时选择入选邻居中距离最近的类别；最近距离再相同则 A 优先。票数比例称“票数占比”，不称概率或置信度。

图形显示坐标网格、两类样本、查询点、邻居连线和决策区域。拖动样本或查询点会实时重算；方向键以 0.1 移动焦点点。重置有明确按钮；新样例使用不同种子，不影响导入快照的具体坐标。

## 应变电桥

`src/lib/bridge.ts` 导出：

```ts
type BridgeResult = {
  resistors: { r1: number; r2: number; r3: number; r4: number };
  leftVoltage: number; rightVoltage: number;
  outputVoltage: number; approxVoltage: number;
  deltaResistance: number;
};
function calculateBridge(config: BridgeConfig): BridgeResult;
```

R1/R2 为左上/左下，R3/R4 为右上/右下，上端激励、下端地；输出是左中点减右中点。令 δ=GF×strainMicro×10^-6。

- quarter：只改变 activeArm，电阻变化为 Rδ。
- half：activeArm 增加 Rδ，同侧另一桥臂减少 Rδ。
- full：在 half 基础上，右侧上、下桥臂变化与左侧相反。
- activeArm 为 r1 时小信号输出为 -Vex×δ×系数，否则为正；quarter/half/full 系数为 1/4、1/2、1。
- 精确分压使用 Vex×(R2/(R1+R2)-R4/(R3+R4))。模型忽略引线、温度和测量负载，电阻变化本身采用线性应变关系。

显示可识别的接线、各桥臂阻值、精确电压、小信号电压和偏差。零应变不产生除零或无穷大。默认四分之一桥应得到约 -1.249375 mV。

## 快照

`src/lib/snapshot.ts`：`serializeSnapshot(config: ExperimentConfig): string`、`parseSnapshot(text: string): ExperimentConfig`。格式为 `{version:1, savedAt: ISO时间, experiment: ExperimentConfig}`；导入文件不超过 64 KiB，拒绝未知版本、重复点 ID、非法数字及多余字段。失败不替换当前实验，成功后重算结果。仅保存实验数据，不保存 API 密钥。

## AI 配置与错误处理

`GET /api/experiment` 返回 `{configured:boolean}`。`POST` 接收 `{prompt:string,current:ExperimentConfig}`，prompt 长度 1—1000，正文上限 32 KiB；成功返回 `{plan:ExperimentPlan}`。服务端读取 `AI_API_KEY`、`AI_BASE_URL`、`AI_MODEL`，使用 OpenAI 兼容 Chat Completions 接口。默认 base URL 为 `https://api.openai.com/v1`、model 为 `gpt-4.1-mini`；模型可通过环境变量替换。

API key 不进入客户端或快照。请求超时 20 秒、输出不超过 1800 tokens；不运行模型生成的代码。完整 JSON 通过 planSchema 校验，合并后的实验再次通过 experimentSchema 校验才允许应用。说明作为纯文本显示。缺少密钥、上游错误、超时或非法输出均返回明确且不含上游敏感内容的错误。

首版使用进程内每分钟最多 12 次的全局额度，限制单实例请求开销；它不等于生产环境的身份验证或分布式限流。未部署公网，不承诺生产级访问控制。未配置模型时显示实际状态，示例实验明确标注为示例，不伪装成模型回复。

## 验证与记录

数值与信任边界测试覆盖距离、尺度、等距离、同票、电桥平衡与正负号、快照版本和非法配置、上游失败及模型非法 JSON。执行类型检查、完整测试、生产构建和桌面/窄屏交互验证。真实模型只有在存在用户提供的运行环境配置时才调用；模拟接口测试不冒充实测。

提交按计划、内核、可操作实验台、AI 接口及最终验证分阶段保留。迭代文档记录实际输入、发现和修复，明确它是整理记录而非原始会话导出；不补造原始 Prompt 链。公开推送和部署与本地开发分开处理。
