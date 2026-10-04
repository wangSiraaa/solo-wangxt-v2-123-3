// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { createWorkbench } from './store.svelte';

describe('工作台交互与响应式求解', () => {
  let wb: ReturnType<typeof createWorkbench>;
  /** 从 runes 代理后的电路中取元件（不能用 connect 返回的裸对象） */
  const compById = (id: string) => wb.circuit.comps.find((c) => c.id === id)!;
  const lastComp = () => wb.circuit.comps[wb.circuit.comps.length - 1];

  beforeEach(() => {
    wb = createWorkbench();
  });

  it('放置接点→设地→放置元件，result 随编辑即时更新', () => {
    expect(wb.result.issues.some((i) => i.code === 'EMPTY')).toBe(true);
    const g = wb.addNode(0, 0);
    const p = wb.addNode(100, 0);
    wb.setGround(g.id);
    // p 未接地且无连接 → ISOLATED
    expect(wb.result.issues.some((i) => i.code === 'ISOLATED')).toBe(true);

    wb.tool = 'V';
    const v = wb.connect(p.id, g.id)!;
    wb.tool = 'R';
    const r = wb.connect(p.id, g.id)!;
    wb.updateComp(v.id, { value: 6 });
    wb.updateComp(r.id, { value: 12 });

    expect(wb.result.ok).toBe(true);
    const rv = wb.result.branches.find((b) => b.compId === r.id)!;
    expect(rv.i).toBeCloseTo(0.5, 9);
    expect(wb.result.power!.residual).toBeCloseTo(0, 9);
  });

  it('拖动元件只改 t/offset，绝不改 a/b 连接', () => {
    const a = wb.addNode(0, 0);
    const b = wb.addNode(200, 0);
    wb.setGround(a.id);
    wb.tool = 'V';
    const v = wb.connect(a.id, b.id)!;
    wb.tool = 'R';
    wb.connect(b.id, a.id);
    expect(wb.result.ok).toBe(true);
    const before = { a: v.a, b: v.b };
    wb.moveComp(v.id, 100, 60);
    const live = compById(v.id);
    expect(live.a).toBe(before.a);
    expect(live.b).toBe(before.b);
    expect(live.offset).toBe(60);
    expect(live.t).toBe(0.5);
  });

  it('翻转元件交换 a/b 与极性，求解符号相应改变', () => {
    const g = wb.addNode(0, 0);
    const p = wb.addNode(0, 100);
    wb.setGround(g.id);
    wb.tool = 'V';
    const v = wb.connect(p.id, g.id)!;
    wb.tool = 'R';
    const r = wb.connect(p.id, g.id)!;
    wb.updateComp(v.id, { value: 9 });
    wb.updateComp(r.id, { value: 9 });
    expect(wb.result.branches.find((x) => x.compId === v.id)!.i).toBeCloseTo(-1, 9);
    wb.flipComp(v.id);
    const live = compById(v.id);
    // 翻转后 a 端在 g（0V），b 端在 p（9V）；MNA 源电流变量沿 a→b 为 -1A
    // （真实电流仍从 + 端 p 流出，极性约定反转后变量符号相应为负）
    expect(live.a).toBe(g.id);
    expect(live.b).toBe(p.id);
    expect(wb.result.branches.find((x) => x.compId === v.id)!.i).toBeCloseTo(-1, 9);
  });

  it('矛盾并联时保留电路且可继续编辑修复', () => {
    const g = wb.addNode(0, 0);
    const p = wb.addNode(100, 0);
    wb.setGround(g.id);
    wb.tool = 'V';
    const v1 = wb.connect(p.id, g.id)!;
    wb.updateComp(v1.id, { value: 12 });
    const v2 = wb.connect(p.id, g.id)!;
    wb.updateComp(v2.id, { value: 5 });
    expect(wb.result.ok).toBe(false);
    expect(wb.result.issues.some((i) => i.code === 'VSOURCE_LOOP')).toBe(true);
    expect(JSON.stringify(wb.result)).not.toContain('NaN');
    expect(wb.circuit.comps).toHaveLength(2); // 电路保留

    // 把第二个源改成与第一个一致 → 冗余零和回路（警告），电位仍可解
    wb.updateComp(v2.id, { value: 12 });
    expect(wb.result.ok).toBe(true);
    expect(wb.result.issues.some((i) => i.code === 'REDUNDANT_VLOOP')).toBe(true);
  });

  it('删除接点会一并删除其元件', () => {
    const g = wb.addNode(0, 0);
    const p = wb.addNode(100, 0);
    wb.setGround(g.id);
    wb.tool = 'R';
    wb.connect(p.id, g.id);
    expect(wb.circuit.comps).toHaveLength(1);
    wb.selection = { kind: 'node', id: p.id };
    wb.deleteSelection();
    expect(wb.circuit.nodes).toHaveLength(1);
    expect(wb.circuit.comps).toHaveLength(0);
  });

  it('非法/负数电阻值不进入求解', () => {
    const g = wb.addNode(0, 0);
    const p = wb.addNode(100, 0);
    wb.setGround(g.id);
    wb.tool = 'V';
    wb.connect(p.id, g.id);
    wb.tool = 'R';
    const r = wb.connect(p.id, g.id)!;
    wb.updateComp(r.id, { value: -5 });
    expect(wb.result.ok).toBe(false);
    expect(wb.result.issues.some((i) => i.code === 'BAD_VALUE')).toBe(true);
  });

  it('参考地只能显式设置：未设地时不求解', () => {
    wb.addNode(0, 0);
    wb.addNode(100, 0);
    wb.tool = 'R';
    wb.connect(wb.circuit.nodes[0].id, wb.circuit.nodes[1].id);
    expect(wb.result.issues.some((i) => i.code === 'NO_GROUND')).toBe(true);
  });

  it('lastComp 冒烟（工具默认电阻类型）', () => {
    const a = wb.addNode(0, 0);
    const b = wb.addNode(10, 10);
    wb.tool = 'wire';
    wb.connect(a.id, b.id);
    expect(lastComp().type).toBe('wire');
  });
});
