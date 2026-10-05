// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  exportProject,
  parseProject,
  validateProject,
  buildCircuit,
  summarize,
  FORMAT,
  FORMAT_VERSION,
  type ProjectFile,
} from './transfer';
import { exampleBridge, exampleZero, exampleSeries } from './factory';
import { analyze } from './engine/analyze';
import { storage } from './storage';
import type { Circuit } from './engine/types';

/** 导出 → 解析校验 → 构建新工程（导入确认后执行的路径） */
function roundTrip(c: Circuit): Circuit {
  const res = parseProject(exportProject(c));
  if (!res.ok) throw new Error('往返解析失败: ' + JSON.stringify(res.problems));
  return buildCircuit(res.file);
}

/** 电路本体签名：接点/元件/连接/位置/参考地（忽略工程内部键与 updatedAt） */
function signature(c: Circuit) {
  return {
    title: c.title,
    nodes: c.nodes.map((n) => [n.id, n.name, n.x, n.y, n.ground]),
    comps: c.comps.map((x) => [x.id, x.type, x.name, x.a, x.b, x.value, x.t, x.offset]),
  };
}

/** 求解结果签名：连接与行为是否一致的判据 */
function solveSignature(c: Circuit) {
  const r = analyze(c);
  return {
    ok: r.ok,
    issues: r.issues.map((i) => [i.kind, i.code]),
    branches: r.branches.map((b) => [b.compId, b.va, b.vb, b.v, b.i, b.absorbed]),
    netVoltages: r.netKcls.map((k) => [k.netId, k.voltage, k.residual]),
    power: r.power ? [r.power.totalAbsorbed, r.power.relative] : null,
  };
}

function exported(c: Circuit): ProjectFile {
  return JSON.parse(exportProject(c)) as ProjectFile;
}

describe('工程导出', () => {
  it('导出文件包含接点/元件/连接/位置/参考地，但不含 IndexedDB 内部键', () => {
    const raw = JSON.parse(exportProject(exampleBridge())) as Record<string, unknown>;
    expect(raw.format).toBe(FORMAT);
    expect(raw.version).toBe(FORMAT_VERSION);
    expect(typeof raw.title).toBe('string');
    expect(Array.isArray(raw.nodes)).toBe(true);
    expect(Array.isArray(raw.comps)).toBe(true);
    // 工程级内部键（IndexedDB keyPath 与保存时间戳）不得出现在文件中
    expect(raw).not.toHaveProperty('id');
    expect(raw).not.toHaveProperty('updatedAt');
    // 连接与参考地确实被携带
    const comp = (raw.comps as Record<string, unknown>[])[0];
    expect(typeof comp.a).toBe('string');
    expect(typeof comp.b).toBe('string');
    expect((raw.nodes as { ground: boolean }[]).filter((n) => n.ground)).toHaveLength(1);
  });
});

describe('导入校验', () => {
  it('损坏的端点引用被拒绝，且问题指向对应元件', () => {
    const file = exported(exampleBridge());
    const broken = file.comps[1]; // R1
    broken.a = 'n_not_exist';
    const res = parseProject(JSON.stringify(file));
    expect(res.ok).toBe(false);
    if (res.ok) return;
    const p = res.problems.find((x) => x.code === 'REF');
    expect(p).toBeTruthy();
    expect(p!.message).toContain('n_not_exist');
    expect(p!.refs).toEqual([{ kind: 'comp', id: broken.id, name: broken.name }]);
  });

  it('重复参考地被拒绝，且问题列出全部接地接点', () => {
    const file = exported(exampleBridge());
    file.nodes[1].ground = true; // 第二个地
    const res = parseProject(JSON.stringify(file));
    expect(res.ok).toBe(false);
    if (res.ok) return;
    const p = res.problems.find((x) => x.code === 'GROUND');
    expect(p).toBeTruthy();
    expect(p!.refs).toHaveLength(2);
    expect(p!.refs.every((r) => r.kind === 'node')).toBe(true);
  });

  it('非法元件值被拒绝：负电阻 / 非数值 / 非有限值', () => {
    const neg = exported(exampleBridge());
    neg.comps.find((c) => c.type === 'R')!.value = -5;
    const r1 = parseProject(JSON.stringify(neg));
    expect(r1.ok).toBe(false);
    if (!r1.ok) {
      expect(r1.problems.some((p) => p.code === 'VALUE')).toBe(true);
      const p = r1.problems.find((x) => x.code === 'VALUE')!;
      expect(p.refs[0].kind).toBe('comp');
    }

    const notNum = exported(exampleBridge());
    (notNum.comps[0] as unknown as Record<string, unknown>).value = '12V';
    expect(parseProject(JSON.stringify(notNum)).ok).toBe(false);

    // NaN 经 JSON 变为 null，同样必须被拒绝
    const nan = exported(exampleBridge());
    (nan.comps[0] as unknown as Record<string, unknown>).value = NaN;
    const text = JSON.stringify(nan);
    expect(text).toContain('null');
    expect(parseProject(text).ok).toBe(false);
  });

  it('数据版本问题被拒绝：版本过新 / 缺失 / 非本工程格式', () => {
    const tooNew = exported(exampleBridge());
    tooNew.version = FORMAT_VERSION + 1;
    const r1 = parseProject(JSON.stringify(tooNew));
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.problems[0].code).toBe('VERSION');

    const noVersion = exported(exampleBridge()) as unknown as Record<string, unknown>;
    delete noVersion.version;
    const r2 = parseProject(JSON.stringify(noVersion));
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.problems.some((p) => p.code === 'VERSION')).toBe(true);

    const alien = exported(exampleBridge());
    (alien as unknown as Record<string, unknown>).format = 'other-tool';
    const r3 = parseProject(JSON.stringify(alien));
    expect(r3.ok).toBe(false);
    if (!r3.ok) expect(r3.problems.some((p) => p.code === 'FORMAT')).toBe(true);
  });

  it('非 JSON / 非对象 / 缺数组都被拒绝', () => {
    expect(parseProject('{oops').ok).toBe(false);
    expect(parseProject('42').ok).toBe(false);
    expect(parseProject('{"format":"dc-workbench/project","version":1}').ok).toBe(false);
  });

  it('重复编号被拒绝（接点与元件）', () => {
    const dupNode = exported(exampleBridge());
    dupNode.nodes[1].id = dupNode.nodes[0].id;
    const r1 = parseProject(JSON.stringify(dupNode));
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.problems.some((p) => p.code === 'STRUCTURE' && p.message.includes('重复'))).toBe(true);

    const dupComp = exported(exampleBridge());
    dupComp.comps[1].id = dupComp.comps[0].id;
    expect(parseProject(JSON.stringify(dupComp)).ok).toBe(false);
  });

  it('无参考地不是导入错误（由求解诊断提示），未知类型元件被拒绝', () => {
    const noGround = exported(exampleSeries(false));
    for (const n of noGround.nodes) n.ground = false;
    expect(parseProject(JSON.stringify(noGround)).ok).toBe(true);

    const badType = exported(exampleBridge());
    (badType.comps[0] as unknown as Record<string, unknown>).type = 'C';
    expect(parseProject(JSON.stringify(badType)).ok).toBe(false);
  });

  it('validateProject 直接拒绝非对象输入', () => {
    expect(validateProject(null).length).toBeGreaterThan(0);
    expect(validateProject([1, 2]).length).toBeGreaterThan(0);
    expect(validateProject('x').length).toBeGreaterThan(0);
  });
});

describe('往返一致性（验收：跳线交叉 + 零电阻）', () => {
  it('带跳线交叉的桥式网络：往返后连接与求解结果不变', () => {
    const orig = exampleBridge(); // Vs 引线与 R5 几何交叉（跳线弧），电气不导通
    const back = roundTrip(orig);
    expect(signature(back)).toEqual(signature(orig));
    expect(solveSignature(back)).toEqual(solveSignature(orig));
    expect(analyze(back).ok).toBe(true);
  });

  it('含 0Ω 电阻与理想导线的工程：往返后连接与求解结果不变', () => {
    const orig = exampleZero(); // 0Ω 电阻 + 理想导线收缩为超节点
    const back = roundTrip(orig);
    expect(signature(back)).toEqual(signature(orig));
    expect(solveSignature(back)).toEqual(solveSignature(orig));
    expect(analyze(back).ok).toBe(true);
  });

  it('导入生成新的工程键，接点/元件编号保持不变', () => {
    const orig = exampleBridge();
    const back = roundTrip(orig);
    expect(back.id).not.toBe(orig.id);
    expect(back.nodes.map((n) => n.id)).toEqual(orig.nodes.map((n) => n.id));
    expect(back.comps.map((c) => c.id)).toEqual(orig.comps.map((c) => c.id));
  });

  it('导出 → 再导入 → 再导出：文本逐字节相同（幂等）', () => {
    const once = exportProject(exampleZero());
    const twice = exportProject(roundTrip(exampleZero()));
    // updatedAt 不参与导出，两次文本应完全一致
    expect(twice).toBe(once);
  });
});

describe('同名工程导入（验收：原工程与新工程可分别打开）', () => {
  beforeEach(async () => {
    for (const c of await storage.list()) await storage.remove(c.id);
  });

  it('导入不覆盖已有工程：两条记录并存，各自可打开', async () => {
    const orig = exampleBridge();
    await storage.put(orig);

    const back = roundTrip(orig); // 同名、同电路，但工程键不同
    expect(back.title).toBe(orig.title);
    expect(back.id).not.toBe(orig.id);
    await storage.put(back);

    const list = await storage.list();
    expect(list).toHaveLength(2);
    expect(new Set(list.map((c) => c.id)).size).toBe(2);

    const origBack = await storage.get(orig.id);
    const newBack = await storage.get(back.id);
    expect(origBack).toBeTruthy();
    expect(newBack).toBeTruthy();
    // 原工程未被导入破坏
    expect(origBack!.comps.map((c) => c.id)).toEqual(orig.comps.map((c) => c.id));
    expect(solveSignature(origBack!)).toEqual(solveSignature(orig));
    expect(solveSignature(newBack!)).toEqual(solveSignature(orig));
  });
});

describe('导入概要', () => {
  it('summarize 给出标题、规模与参考地', () => {
    const res = parseProject(exportProject(exampleBridge()));
    if (!res.ok) throw new Error('should parse');
    const s = summarize(res.file);
    expect(s.title).toContain('桥式');
    expect(s.nodes).toBe(4);
    expect(s.comps).toBe(6);
    expect(s.ground).toBe('GND');
  });
});
