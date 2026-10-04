import type { Circuit, Comp, CompType, Node } from './engine/types';

export function uid(prefix: string): string {
  return `${prefix}${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-3)}`;
}

export function makeNode(x: number, y: number, name?: string, ground = false): Node {
  return { id: uid('n'), name: name ?? '', x, y, ground };
}

export function makeComp(type: CompType, a: string, b: string, value: number, t = 0.5, offset = 0): Comp {
  const prefix = type === 'wire' ? 'W' : type;
  return { id: uid('c'), type, name: '', a, b, value, t, offset };
}

export const UNIT: Record<CompType, string> = { R: 'Ω', V: 'V', I: 'A', wire: '' };
export const TYPE_LABEL: Record<CompType, string> = {
  R: '电阻',
  V: '电压源',
  I: '电流源',
  wire: '理想导线',
};

/** 给未命名元件/节点补默认编号（按类型计数） */
export function autofillNames(circuit: Circuit) {
  const rc = { R: 0, V: 0, I: 0, wire: 0 };
  for (const c of circuit.comps) {
    if (!c.name) {
      rc[c.type]++;
      c.name = `${c.type === 'wire' ? 'W' : c.type}${rc[c.type]}`;
    }
  }
  let ni = 0;
  for (const n of circuit.nodes) {
    if (!n.name && !n.ground) {
      ni++;
      n.name = `n${ni}`;
    }
    if (n.ground) n.name = 'GND';
  }
}

export function newCircuit(title = '未命名工程'): Circuit {
  return { id: uid('prj'), title, nodes: [], comps: [], updatedAt: Date.now() };
}

function comp(
  type: CompType,
  name: string,
  a: string,
  b: string,
  value: number,
  t = 0.5,
  offset = 0,
): Comp {
  return { id: `c_${name}`, type, name, a, b, value, t, offset };
}
function node(id: string, name: string, x: number, y: number, ground = false): Node {
  return { id: `n_${id}`, name: ground ? 'GND' : name, x, y, ground };
}

// 用 n_ / c_ 固定 id 便于示例间阅读
function base(title: string, nodes: Node[], comps: Comp[]): Circuit {
  return { id: uid('prj'), title, nodes, comps, updatedAt: Date.now() };
}

/** 示例 1：平衡桥式网络
 *  菱形四臂 + 桥电阻 R5；电压源沿 top→g 的引线下行，在几何上与 R5 交叉，
 *  交叉处没有接点（图上画跳线弧），电气上不导通。 */
export function exampleBridge(): Circuit {
  const nodes = [
    node('g', 'GND', 400, 480, true),
    node('top', '1', 400, 80),
    node('l', '2', 200, 280),
    node('r', '3', 600, 280),
  ];
  const comps = [
    comp('V', 'Vs', 'n_top', 'n_g', 12, 0.72, -150),
    comp('R', 'R1', 'n_top', 'n_l', 100),
    comp('R', 'R2', 'n_top', 'n_r', 200),
    comp('R', 'R3', 'n_l', 'n_g', 100),
    comp('R', 'R4', 'n_r', 'n_g', 200),
    comp('R', 'R5', 'n_l', 'n_r', 50),
  ];
  return base('桥式网络（验证 KCL 与功率平衡）', nodes, comps);
}

/** 示例 2：串联电压源（同向/反向可切换极性观察） */
export function exampleSeries(opposing = false): Circuit {
  const nodes = [
    node('g', 'GND', 560, 380, true),
    node('a', 'a', 240, 180),
    node('b', 'b', 400, 380),
  ];
  const comps = [
    comp('V', 'V1', 'n_a', 'n_b', 12),
    opposing
      ? comp('V', 'V2', 'n_g', 'n_b', 5) // 反向：b 为 +
      : comp('V', 'V2', 'n_b', 'n_g', 5), // 同向
    comp('R', 'R', 'n_a', 'n_g', 100),
  ];
  return base(opposing ? '串联电源（反向 12V−5V）' : '串联电源（同向 12V+5V）', nodes, comps);
}

/** 示例 3：矛盾——两理想电压源并联 */
export function exampleConflict(): Circuit {
  const nodes = [node('g', 'GND', 400, 360, true), node('p', 'p', 400, 160)];
  const comps = [
    comp('V', 'V1', 'n_p', 'n_g', 12, 0.3, -60),
    comp('V', 'V2', 'n_p', 'n_g', 5, 0.7, 60),
    comp('R', 'R1', 'n_p', 'n_g', 100, 0.5, 140),
  ];
  return base('矛盾并联电压源（应指出约束而非 NaN）', nodes, comps);
}

/** 示例 4：浮空子网
 *  g-p 为已接地的工作回路；f1-f2 自成一个仅含电阻的子网，
 *  与地之间没有任何 R/V 通路 → 整体电位（共模）无定义。 */
export function exampleFloating(): Circuit {
  const nodes = [
    node('g', 'GND', 200, 380, true),
    node('p', 'p', 200, 160),
    node('f1', 'f1', 540, 180),
    node('f2', 'f2', 700, 320),
  ];
  const comps = [
    comp('V', 'Vs', 'n_p', 'n_g', 12),
    comp('R', 'R0', 'n_p', 'n_g', 220),
    comp('R', 'Rf1', 'n_f1', 'n_f2', 100),
    comp('R', 'Rf2', 'n_f2', 'n_f1', 330),
  ];
  return base('浮空子网（与参考地无 R/V 通路）', nodes, comps);
}

/** 示例 5：孤立节点 */
export function exampleIsolated(): Circuit {
  const nodes = [
    node('g', 'GND', 400, 360, true),
    node('p', 'p', 400, 160),
    node('z', 'z', 660, 120),
  ];
  const comps = [comp('V', 'Vs', 'n_p', 'n_g', 9), comp('R', 'R1', 'n_p', 'n_g', 90)];
  return base('孤立节点', nodes, comps);
}

/** 示例 6：零电阻边界（0Ω 电阻与理想导线都收缩为同一超节点，不短路电压源） */
export function exampleZero(): Circuit {
  const nodes = [
    node('g', 'GND', 560, 400, true),
    node('p', 'p', 200, 160),
    node('m', 'm', 380, 280),
    node('q', 'q', 560, 200),
  ];
  const comps = [
    comp('V', 'Vs', 'n_p', 'n_g', 10),
    comp('R', 'R1', 'n_p', 'n_m', 10),
    comp('R', 'R0', 'n_m', 'n_q', 0), // 0Ω：m 与 q 等电位
    comp('wire', 'W1', 'n_q', 'n_g', 0, 0.55, 80), // 理想导线：q 与 g 等电位
    comp('R', 'R2', 'n_m', 'n_g', 30, 0.5, -90),
  ];
  return base('零电阻边界（0Ω / 理想导线收缩为超节点）', nodes, comps);
}

/** 示例 7：电流源串联冲突 */
export function exampleICut(): Circuit {
  const nodes = [
    node('g', 'GND', 520, 380, true),
    node('m', 'm', 320, 260),
    node('p', 'p', 200, 140),
  ];
  const comps = [
    comp('I', 'I1', 'n_g', 'n_m', 1),
    comp('I', 'I2', 'n_m', 'n_p', 2),
    comp('R', 'R', 'n_p', 'n_g', 100, 0.5, 90),
  ];
  return base('电流源串联（割集 KCL 冲突）', nodes, comps);
}

export const EXAMPLES: { key: string; title: string; build: () => Circuit }[] = [
  { key: 'bridge', title: '桥式网络', build: exampleBridge },
  { key: 'series', title: '串联电源（同向）', build: () => exampleSeries(false) },
  { key: 'series-opp', title: '串联电源（反向）', build: () => exampleSeries(true) },
  { key: 'conflict', title: '矛盾并联电压源', build: exampleConflict },
  { key: 'floating', title: '浮空子网', build: exampleFloating },
  { key: 'isolated', title: '孤立节点', build: exampleIsolated },
  { key: 'zero', title: '零电阻边界', build: exampleZero },
  { key: 'icut', title: '电流源串联冲突', build: exampleICut },
];
