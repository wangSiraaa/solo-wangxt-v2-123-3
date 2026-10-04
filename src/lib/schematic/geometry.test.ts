// @vitest-environment jsdom
// Konva 依赖真实 Canvas 2D 上下文（jsdom 未实现 getContext），
// 这里只验证不依赖画布的原理图几何/交叉逻辑；完整渲染在真实浏览器中验证。
import { describe, it, expect } from 'vitest';
import { exampleBridge, exampleConflict, exampleZero } from '../factory';
import { crossingsOf, allGeoms, hitBody } from '../geometry';
import { analyze } from '../engine/analyze';

describe('原理图几何（渲染无关部分）', () => {
  it('桥式网络：电压源引线与桥电阻引线恰有一处无接点几何交叉', () => {
    const c = exampleBridge();
    const cr = crossingsOf(c);
    expect(cr.size).toBe(1);
    const [compId, hits] = [...cr.entries()][0];
    expect(compId).toBe('c_Vs');
    expect(hits).toHaveLength(1);
    // 交叉两侧节点不同 → 确认没有被当成同一接点
    const vs = c.comps.find((x) => x.id === 'c_Vs')!;
    const r5 = c.comps.find((x) => x.name === 'R5')!;
    const endpoints = new Set([vs.a, vs.b, r5.a, r5.b]);
    expect(endpoints.size).toBe(4);
  });

  it('矛盾电路几何仍可用（渲染前数据完整，无 NaN）', () => {
    const c = exampleConflict();
    const geoms = allGeoms(c);
    expect(geoms.size).toBe(c.comps.length);
    const result = analyze(c);
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain('NaN');
  });

  it('命中测试：主体附近可选中，引线远处不可', () => {
    const c = exampleZero();
    const geoms = [...allGeoms(c).values()];
    const r1 = geoms.find((g) => g.comp.name === 'R1')!;
    expect(hitBody(r1, { x: r1.C.x, y: r1.C.y })).toBe(true);
    const far = { x: r1.C.x + 5000, y: r1.C.y + 5000 };
    expect(hitBody(r1, far)).toBe(false);
  });

  it('拖动元件改变 offset 不改变 a/b，且重新计算几何后端点不变', () => {
    const c = exampleBridge();
    const before = c.comps.map((x) => [x.id, x.a, x.b]);
    const r2 = c.comps.find((x) => x.name === 'R2')!;
    r2.offset = 80;
    r2.t = 0.3;
    allGeoms(c);
    expect(c.comps.map((x) => [x.id, x.a, x.b])).toEqual(before);
  });
});
