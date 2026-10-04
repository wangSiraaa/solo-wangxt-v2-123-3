import { describe, it, expect } from 'vitest';
import { analyze } from './analyze';
import type { Circuit, Comp } from './types';
const mk = (
  defs: { type: Comp['type']; a: string; b: string; value?: number; name?: string }[],
  ground = 'g',
  extraNodes: string[] = [],
): Circuit => {
  const ids = new Set<string>([ground, ...extraNodes]);
  defs.forEach((d) => {
    ids.add(d.a);
    ids.add(d.b);
  });
  const pos: Record<string, [number, number]> = {};
  [...ids].forEach((id, i) => (pos[id] = [(i % 4) * 120, Math.floor(i / 4) * 120]));
  return {
    id: 'test',
    title: 'test',
    updatedAt: 0,
    nodes: [...ids].map((id) => ({ id, name: id, x: pos[id][0], y: pos[id][1], ground: id === ground })),
    comps: defs.map((d, i) => ({
      id: `c${i}`,
      type: d.type,
      name: d.name ?? `${d.type}${i + 1}`,
      a: d.a,
      b: d.b,
      value: d.value ?? (d.type === 'R' ? 100 : 1),
      t: 0.5,
      offset: 0,
    })),
  };
};

describe('基础电路', () => {
  it('5V/10Ω 单回路：电流 0.5A，功率平衡', () => {
    const c = mk([
      { type: 'V', a: 'p', b: 'g', value: 5, name: 'V1' },
      { type: 'R', a: 'p', b: 'g', value: 10, name: 'R1' },
    ]);
    // 给 comp 显式 id 与名字对齐
    c.comps[0].id = 'V1';
    c.comps[1].id = 'R1';
    const r = analyze(c);
    expect(r.ok).toBe(true);
    expect(r.branches.find((b) => b.compId === 'V1')!.i).toBeCloseTo(-0.5, 9);
    expect(r.branches.find((b) => b.compId === 'R1')!.i).toBeCloseTo(0.5, 9);
    expect(r.power!.residual).toBeCloseTo(0, 9);
  });

  it('电流源 2A 并联 5Ω：V=10V，电流源发出 20W', () => {
    const c = mk([
      { type: 'I', a: 'g', b: 'p', value: 2, name: 'I1' },
      { type: 'R', a: 'p', b: 'g', value: 5, name: 'R1' },
    ]);
    c.comps[0].id = 'I1';
    c.comps[1].id = 'R1';
    const r = analyze(c);
    expect(r.ok).toBe(true);
    const netP = r.netOf!['p'];
    expect(r.netKcls.find((k) => k.netId === netP)!.voltage).toBeCloseTo(10, 9);
    const ib = r.branches.find((b) => b.compId === 'I1')!;
    // a=g(0), b=p(10)：V=Va−Vb=-10V，I=+2A → P=-20W（发出）
    expect(ib.v).toBeCloseTo(-10, 9);
    expect(ib.i).toBeCloseTo(2, 9);
    expect(ib.absorbed).toBeCloseTo(-20, 9);
    // 电阻吸收 20W
    const rb = r.branches.find((b) => b.compId === 'R1')!;
    expect(rb.absorbed).toBeCloseTo(20, 9);
    expect(r.power!.residual).toBeCloseTo(0, 9);
    expect(r.power!.delivered.find((d) => d.compId === 'I1')!.watts).toBeCloseTo(20, 9);
  });

  it('分压器 2k/3k @10V', () => {
    const c = mk(
      [
        { type: 'V', a: 'p', b: 'g', value: 10, name: 'V1' },
        { type: 'R', a: 'p', b: 'm', value: 2000, name: 'R1' },
        { type: 'R', a: 'm', b: 'g', value: 3000, name: 'R2' },
      ],
      'g',
    );
    c.comps[0].id = 'V1';
    const r = analyze(c);
    expect(r.ok).toBe(true);
    expect(r.netKcls.find((k) => k.nodeIds.includes('m'))!.voltage).toBeCloseTo(6, 9);
  });
});

describe('桥式网络', () => {
  // 平衡电桥：左上/左下 100Ω，右上/右下 200Ω，桥 50Ω；12V
  const bridge = () => {
    const c = mk(
      [
        { type: 'V', a: 'top', b: 'g', value: 12, name: 'Vs' },
        { type: 'R', a: 'top', b: 'l', value: 100, name: 'R1' },
        { type: 'R', a: 'top', b: 'r', value: 200, name: 'R2' },
        { type: 'R', a: 'l', b: 'g', value: 100, name: 'R3' },
        { type: 'R', a: 'r', b: 'g', value: 200, name: 'R4' },
        { type: 'R', a: 'l', b: 'r', value: 50, name: 'R5' },
      ],
      'g',
    );
    c.comps[0].id = 'Vs';
    return c;
  };

  it('平衡时桥支路电流为 0（线交叉不导通：l-r 仅经 R5）', () => {
    const r = analyze(bridge());
    expect(r.ok).toBe(true);
    const r5 = r.branches.find((b) => b.compId === 'c5')!;
    expect(r5.i).toBeCloseTo(0, 9);
    // l=6V, r=6V
    expect(r.netKcls.find((k) => k.nodeIds.includes('l'))!.voltage).toBeCloseTo(6, 9);
    expect(r.netKcls.find((k) => k.nodeIds.includes('r'))!.voltage).toBeCloseTo(6, 9);
    expect(Math.abs(r.power!.residual)).toBeLessThan(1e-9);
  });

  it('失衡时桥有电流且功率/KCL 仍平衡', () => {
    const c = bridge();
    c.comps[2].value = 100; // R2: 200 -> 100
    const r = analyze(c);
    expect(r.ok).toBe(true);
    const r5 = r.branches.find((b) => b.compId === 'c5')!;
    expect(Math.abs(r5.i!)).toBeGreaterThan(1e-4);
    for (const k of r.netKcls) expect(Math.abs(k.residual)).toBeLessThan(1e-8 * Math.max(1, k.scale));
    expect(Math.abs(r.power!.residual)).toBeLessThan(1e-9);
  });

  it('几何上交叉但无接点的两条支路电气独立', () => {
    // V1-R1 串联 与 R2 支路在几何上无关；这里用两个独立回路验证不被自动连到同一 net
    const c = mk(
      [
        { type: 'V', a: 'p', b: 'g', value: 9, name: 'V1' },
        { type: 'R', a: 'p', b: 'g', value: 9, name: 'R1' },
      ],
      'g',
      ['q'],
    );
    c.nodes.push({ id: 's', name: 's', x: 999, y: 999, ground: false });
    const r = analyze(c);
    expect(r.issues.some((i) => i.code === 'ISOLATED' && i.refs.includes('s'))).toBe(true);
  });
});

describe('串联电源对照', () => {
  const series = (v2: number, flip: boolean) =>
    mk(
      [
        { type: 'V', a: 'a', b: 'b', value: 12, name: 'V1' },
        { type: 'V', a: flip ? 'g' : 'b', b: flip ? 'b' : 'g', value: v2, name: 'V2' },
        { type: 'R', a: 'a', b: 'g', value: 100, name: 'R' },
      ],
      'g',
    );

  it('同向 12V+5V：I=0.17A，总发出=电阻吸收', () => {
    const c = series(5, false);
    const r = analyze(c);
    expect(r.ok).toBe(true);
    expect(r.branches[2].i).toBeCloseTo(0.17, 10);
    expect(r.power!.residual).toBeCloseTo(0, 9);
  });

  it('反向 12V−5V：I=0.07A，极性/方向约定自洽', () => {
    const c = series(5, true);
    const r = analyze(c);
    expect(r.ok).toBe(true);
    expect(r.branches[2].i).toBeCloseTo(0.07, 10);
    expect(r.branches[0].i).toBeCloseTo(-0.07, 10); // V1 中电流从 + 流出
    expect(r.power!.residual).toBeCloseTo(0, 9);
  });
});

describe('矛盾与边界（不得出 NaN，电路保留可编辑）', () => {
  it('两个矛盾理想电压源并联 → 明确指出 VSOURCE_LOOP', () => {
    const c = mk(
      [
        { type: 'V', a: 'p', b: 'g', value: 12, name: 'V1' },
        { type: 'V', a: 'p', b: 'g', value: 5, name: 'V2' },
      ],
      'g',
    );
    const r = analyze(c);
    expect(r.ok).toBe(false);
    expect(r.x).toBeNull();
    const err = r.issues.find((i) => i.kind === 'error' && i.code === 'VSOURCE_LOOP');
    expect(err).toBeTruthy();
    // 回路必须同时涉及两个源（不能误报为单个元件的假回路）
    expect(err!.refs).toContain('c0');
    expect(err!.refs).toContain('c1');
    expect(err!.message).toContain('V1');
    expect(err!.message).toContain('V2');
    expect(JSON.stringify(r)).not.toContain('NaN');
  });

  it('三个平行电压源（多重图）：只报真正的两源回路，不出现单源假回路', () => {
    const c = mk(
      [
        { type: 'V', a: 'p', b: 'g', value: 12, name: 'V1' },
        { type: 'V', a: 'p', b: 'g', value: 12, name: 'V2' },
        { type: 'V', a: 'g', b: 'p', value: 5, name: 'V3' },
        { type: 'R', a: 'p', b: 'g', value: 100, name: 'R1' },
      ],
      'g',
    );
    const r = analyze(c);
    expect(r.ok).toBe(false);
    for (const iss of r.issues) {
      if (iss.code !== 'VSOURCE_LOOP') continue;
      // 每条矛盾回路都必须包含至少两个元件
      const compRefs = iss.refs.filter((id) => id.startsWith('c'));
      expect(compRefs.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('电压源被理想导线短路 → 明确指出被违反的电压约束', () => {
    const c = mk(
      [
        { type: 'V', a: 'p', b: 'g', value: 9, name: 'V1' },
        { type: 'wire', a: 'p', b: 'g', value: 0, name: 'W1' },
        { type: 'R', a: 'p', b: 'g', value: 100, name: 'R1' },
      ],
      'g',
    );
    const r = analyze(c);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === 'VSOURCE_LOOP' && i.refs.includes('c0'))).toBe(true);
  });

  it('浮空子网：只经电流源接参考地', () => {
    const c = mk(
      [
        { type: 'V', a: 'p', b: 'g', value: 12, name: 'V1' },
        { type: 'R', a: 'p', b: 'g', value: 100, name: 'R0' },
        { type: 'I', a: 'f1', b: 'g', value: 1, name: 'I1' },
        { type: 'R', a: 'f1', b: 'f2', value: 50, name: 'Rf' },
      ],
      'g',
    );
    const r = analyze(c);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === 'FLOATING' && i.refs.includes('f1'))).toBe(true);
  });

  it('孤立节点报错', () => {
    const c = mk(
      [
        { type: 'V', a: 'p', b: 'g', value: 5, name: 'V1' },
        { type: 'R', a: 'p', b: 'g', value: 10, name: 'R1' },
      ],
      'g',
      ['lonely'],
    );
    const r = analyze(c);
    expect(r.issues.some((i) => i.code === 'ISOLATED' && i.refs.includes('lonely'))).toBe(true);
  });

  it('零电阻边界：0Ω 收缩为同 net，电流仍可解、功率平衡', () => {
    const c = mk(
      [
        { type: 'V', a: 'p', b: 'g', value: 10, name: 'V1' },
        { type: 'R', a: 'p', b: 'm', value: 0, name: 'W' },
        { type: 'R', a: 'm', b: 'g', value: 10, name: 'R1' },
      ],
      'g',
    );
    const r = analyze(c);
    expect(r.ok).toBe(true);
    expect(r.netOf!['p']).toBe(r.netOf!['m']);
    expect(r.branches.find((b) => b.compId === 'c1')!.i).toBeCloseTo(1, 9);
    expect(r.power!.residual).toBeCloseTo(0, 9);
  });

  it('零阻导线连接两段：电流由一侧 KCL 唯一确定（10V/10Ω）', () => {
    const c = mk(
      [
        { type: 'V', a: 'p', b: 'g', value: 10, name: 'V1' },
        { type: 'R', a: 'p', b: 'x', value: 10, name: 'R1' },
        { type: 'wire', a: 'x', b: 'y', value: 0, name: 'L1' },
        { type: 'R', a: 'y', b: 'g', value: 0, name: 'Z0' },
      ],
      'g',
    );
    const r = analyze(c);
    expect(r.ok).toBe(true);
    expect(r.branches.find((b) => b.compId === 'c2')!.i).toBeCloseTo(1, 9);
  });

  it('并联零阻导线构成零阻环：各支路电流不唯一（null），节点电位仍可解', () => {
    const c = mk(
      [
        { type: 'V', a: 'p', b: 'g', value: 10, name: 'V1' },
        { type: 'R', a: 'p', b: 'x', value: 10, name: 'R1' },
        { type: 'wire', a: 'x', b: 'y', value: 0, name: 'W1' },
        { type: 'wire', a: 'x', b: 'y', value: 0, name: 'W2' },
        { type: 'R', a: 'y', b: 'g', value: 10, name: 'R2' },
      ],
      'g',
    );
    const r = analyze(c);
    expect(r.ok).toBe(true);
    expect(r.netOf!['x']).toBe(r.netOf!['y']);
    expect(r.branches.find((b) => b.compId === 'c2')!.i).toBeNull();
    expect(r.branches.find((b) => b.compId === 'c3')!.i).toBeNull();
    expect(r.power!.residual).toBeCloseTo(0, 9);
    expect(JSON.stringify(r)).not.toMatch(/NaN/);
  });

  it('不同电流的理想电流源串联 → ICUTSET 割集冲突', () => {
    const c = mk(
      [
        { type: 'I', a: 'g', b: 'm', value: 1, name: 'I1' },
        { type: 'I', a: 'm', b: 'p', value: 2, name: 'I2' },
        { type: 'R', a: 'p', b: 'g', value: 100, name: 'R' },
      ],
      'g',
    );
    const r = analyze(c);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === 'ICUTSET')).toBe(true);
  });

  it('无参考地报错而非出现任意解', () => {
    const c = mk(
      [
        { type: 'V', a: 'p', b: 'q', value: 5, name: 'V1' },
        { type: 'R', a: 'p', b: 'q', value: 10, name: 'R1' },
      ],
      'q',
    );
    // 手工去掉接地标记
    c.nodes.forEach((n) => (n.ground = false));
    const r = analyze(c);
    expect(r.issues.some((i) => i.code === 'NO_GROUND')).toBe(true);
  });

  it('输出不含 NaN/Infinity（任何错误路径）', () => {
    const cases = [
      mk([{ type: 'V', a: 'p', b: 'g', value: 1 }, { type: 'V', a: 'p', b: 'g', value: 2 }]),
      mk([{ type: 'R', a: 'p', b: 'g', value: 0 }]),
    ];
    for (const c of cases) {
      const s = JSON.stringify(analyze(c));
      expect(s).not.toMatch(/NaN|-?Infinity/);
    }
  });
});
