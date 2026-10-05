import { describe, it, expect } from 'vitest';
import {
  exportProject,
  exportFileName,
  parseProject,
  buildImportedCircuit,
  PROJECT_FORMAT,
  PROJECT_VERSION,
  type ImportedProject,
} from './projectIO';
import { analyze } from './engine/analyze';
import { crossingsOf } from './geometry';
import { exampleBridge, exampleZero } from './factory';
import type { Circuit } from './engine/types';

/**
 * 验收夹具：同时带跳线交叉与零电阻的工程。
 *  Vs 的引线与 R0（0Ω）的引线在几何上交叉但无公共接点（跳线弧）；
 *  R0=0Ω 与 W1 理想导线分别把 l/r、m/g 收缩为超节点。
 */
function crossingZeroCircuit(): Circuit {
  return {
    id: 'prj_fixture',
    title: '跳线交叉 + 零电阻',
    updatedAt: 0,
    nodes: [
      { id: 'n_g', name: 'GND', x: 400, y: 460, ground: true },
      { id: 'n_p', name: 'p', x: 400, y: 60, ground: false },
      { id: 'n_l', name: 'l', x: 160, y: 260, ground: false },
      { id: 'n_r', name: 'r', x: 640, y: 260, ground: false },
      { id: 'n_m', name: 'm', x: 400, y: 260, ground: false },
    ],
    comps: [
      { id: 'c_Vs', type: 'V', name: 'Vs', a: 'n_p', b: 'n_g', value: 12, t: 0.7, offset: -140 },
      { id: 'c_R1', type: 'R', name: 'R1', a: 'n_p', b: 'n_l', value: 100, t: 0.5, offset: 0 },
      { id: 'c_R2', type: 'R', name: 'R2', a: 'n_p', b: 'n_r', value: 200, t: 0.5, offset: 0 },
      { id: 'c_R3', type: 'R', name: 'R3', a: 'n_l', b: 'n_g', value: 100, t: 0.5, offset: 0 },
      { id: 'c_R4', type: 'R', name: 'R4', a: 'n_r', b: 'n_g', value: 200, t: 0.5, offset: 0 },
      { id: 'c_R0', type: 'R', name: 'R0', a: 'n_l', b: 'n_r', value: 0, t: 0.5, offset: 0 },
      { id: 'c_W1', type: 'wire', name: 'W1', a: 'n_m', b: 'n_g', value: 0, t: 0.5, offset: 0 },
    ],
  };
}

function roundTrip(c: Circuit): Circuit {
  const res = parseProject(exportProject(c));
  if (!res.ok) throw new Error('往返解析失败: ' + JSON.stringify(res.problems));
  return buildImportedCircuit(res.project);
}

/** 求解结果中与电路行为相关的部分（用于往返对比） */
function behaviorOf(c: Circuit) {
  const r = analyze(c);
  return {
    ok: r.ok,
    issues: r.issues.map((i) => ({ kind: i.kind, code: i.code })),
    branches: r.branches,
    netKcls: r.netKcls,
    netOf: r.netOf,
    power: r.power,
  };
}

describe('工程导出', () => {
  it('导出文件包含接点/元件/连接/位置/参考地，但不含 IndexedDB 内部键', () => {
    const obj = JSON.parse(exportProject(crossingZeroCircuit()));
    expect(obj.format).toBe(PROJECT_FORMAT);
    expect(obj.version).toBe(PROJECT_VERSION);
    expect(obj.title).toBe('跳线交叉 + 零电阻');
    // 不含存储层字段（IndexedDB 记录键与更新时间）
    expect(obj).not.toHaveProperty('id');
    expect(obj).not.toHaveProperty('updatedAt');
    // 接点：编号/名称/坐标/参考地
    for (const n of obj.nodes) {
      expect(Object.keys(n).sort()).toEqual(['ground', 'id', 'name', 'x', 'y']);
    }
    expect(obj.nodes.filter((n: { ground: boolean }) => n.ground)).toHaveLength(1);
    // 元件：编号/类型/名称/连接(a/b)/数值/图形位置(t/offset)
    for (const c of obj.comps) {
      expect(Object.keys(c).sort()).toEqual(['a', 'b', 'id', 'name', 'offset', 't', 'type', 'value']);
    }
  });

  it('导出文件名过滤非法字符', () => {
    expect(exportFileName('桥式 网络/测试:1')).toBe('桥式_网络_测试_1.dcw.json');
    expect(exportFileName('   ')).toBe('circuit.dcw.json');
  });
});

describe('往返：跳线交叉 + 零电阻工程', () => {
  it('连接、位置、参考地完全保留（仅工程记录键是新的）', () => {
    const src = crossingZeroCircuit();
    const dst = roundTrip(src);
    expect(dst.id).not.toBe(src.id); // 新 IndexedDB 记录键
    expect(dst.title).toBe(src.title);
    expect(dst.nodes).toEqual(src.nodes);
    expect(dst.comps).toEqual(src.comps);
  });

  it('跳线交叉检测结果不变', () => {
    const src = crossingZeroCircuit();
    const before = crossingsOf(src);
    expect(before.size).toBeGreaterThan(0); // 夹具确实存在跳线交叉
    expect(crossingsOf(roundTrip(src))).toEqual(before);
  });

  it('求解结果（支路量/超节点电位/KCL/功率）不变', () => {
    const src = crossingZeroCircuit();
    const behavior = behaviorOf(src);
    expect(behavior.ok).toBe(true); // 夹具可求解
    expect(behaviorOf(roundTrip(src))).toEqual(behavior);
  });

  it('内置示例（桥式交叉 / 零电阻边界）往返后行为不变', () => {
    for (const build of [exampleBridge, exampleZero]) {
      const src = build();
      expect(crossingsOf(roundTrip(src))).toEqual(crossingsOf(src));
      expect(behaviorOf(roundTrip(src))).toEqual(behaviorOf(src));
    }
  });

  it('再次导出得到逐字节相同的文件（可继续传给下一台浏览器）', () => {
    const src = crossingZeroCircuit();
    expect(exportProject(roundTrip(src))).toBe(exportProject(src));
  });
});

describe('导入校验', () => {
  const valid = () => JSON.parse(exportProject(crossingZeroCircuit())) as Record<string, unknown>;
  const parse = (obj: unknown) => parseProject(JSON.stringify(obj));

  it('损坏的端点引用被拒绝，并指出对应元件与缺失接点', () => {
    const obj = valid();
    (obj.comps as { a: string; id: string }[])[0].a = 'n_ghost';
    const res = parse(obj);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    const p = res.problems.find((x) => x.code === 'BAD_REF');
    expect(p).toBeTruthy();
    expect(p!.refs).toContain('c_Vs'); // 问题对应的元件
    expect(p!.refs).toContain('n_ghost'); // 缺失的接点编号
    expect(p!.message).toContain('Vs');
  });

  it('重复参考地被拒绝，并列出所有接地接点', () => {
    const obj = valid();
    (obj.nodes as { ground: boolean }[])[1].ground = true;
    const res = parse(obj);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    const p = res.problems.find((x) => x.code === 'MULTI_GROUND');
    expect(p).toBeTruthy();
    expect(p!.refs).toEqual(['n_g', 'n_p']);
  });

  it('非法元件值被拒绝：负电阻 / 非数字 / 缺失', () => {
    const cases: [unknown, string][] = [
      [-3, 'c_R1'], // 负电阻
      ['abc', 'c_R1'], // 非数字
      [undefined, 'c_R1'], // 缺失
      [null, 'c_R1'], // JSON 中的 null（NaN/Infinity 序列化后也是 null）
    ];
    for (const [value, ref] of cases) {
      const obj = valid();
      const comps = obj.comps as { id: string; value?: unknown }[];
      const c = comps.find((x) => x.id === ref)!;
      if (value === undefined) delete c.value;
      else c.value = value;
      const res = parse(obj);
      expect(res.ok).toBe(false);
      if (res.ok) continue;
      expect(res.problems.some((x) => x.code === 'BAD_VALUE' && x.refs.includes(ref))).toBe(true);
    }
    // 负电压是合法极性，不应被拒绝
    const obj = valid();
    (obj.comps as { id: string; value: number }[]).find((x) => x.id === 'c_Vs')!.value = -12;
    expect(parse(obj).ok).toBe(true);
  });

  it('数据版本不兼容被拒绝', () => {
    for (const v of [0, 2, 99, '1', null]) {
      const obj = valid();
      obj.version = v;
      const res = parse(obj);
      expect(res.ok).toBe(false);
      if (res.ok) continue;
      expect(res.problems[0].code).toBe('VERSION');
    }
    const noVersion = valid();
    delete noVersion.version;
    const res = parse(noVersion);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.problems[0].code).toBe('VERSION');
  });

  it('非 JSON / 非工程文件被拒绝', () => {
    const notJson = parseProject('{oops');
    expect(notJson.ok).toBe(false);
    if (!notJson.ok) expect(notJson.problems[0].code).toBe('NOT_JSON');
    for (const bad of [[], null, 42, {}, { format: 'other-tool', version: 1 }]) {
      const res = parse(bad);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.problems[0].code).toBe('NOT_PROJECT');
    }
  });

  it('编号重复被拒绝（接点 / 元件）', () => {
    const dupNode = valid();
    (dupNode.nodes as unknown[]).push({ ...(dupNode.nodes as object[])[0] });
    let res = parse(dupNode);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.problems.some((p) => p.code === 'DUP_NODE')).toBe(true);

    const dupComp = valid();
    (dupComp.comps as unknown[]).push({ ...(dupComp.comps as object[])[0] });
    res = parse(dupComp);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.problems.some((p) => p.code === 'DUP_COMP')).toBe(true);
  });

  it('结构损坏被拒绝：缺坐标 / 未知元件类型 / 缺端点 / 缺数组', () => {
    const noX = valid();
    delete (noX.nodes as { x?: number }[])[0].x;
    expect(parse(noX).ok).toBe(false);

    const badType = valid();
    (badType.comps as { type: string }[])[0].type = 'Q';
    expect(parse(badType).ok).toBe(false);

    const noA = valid();
    delete (noA.comps as { a?: string }[])[0].a;
    expect(parse(noA).ok).toBe(false);

    const noNodes = valid();
    delete noNodes.nodes;
    expect(parse(noNodes).ok).toBe(false);
  });

  it('一次报告全部问题（不是只报第一个）', () => {
    const obj = valid();
    (obj.comps as { a: string }[])[0].a = 'n_ghost';
    (obj.comps as { b: string }[])[1].b = 'n_void';
    (obj.nodes as { ground: boolean }[])[1].ground = true;
    const res = parse(obj);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.problems.filter((p) => p.code === 'BAD_REF')).toHaveLength(2);
    expect(res.problems.some((p) => p.code === 'MULTI_GROUND')).toBe(true);
  });

  it('文件中夹带的 IndexedDB 内部键被忽略：导入总是生成新记录键', () => {
    const obj = valid();
    obj.id = 'prj_existing'; // 人为夹带已有工程的记录键
    obj.updatedAt = 1;
    const res = parse(obj);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const c = buildImportedCircuit(res.project);
    expect(c.id).not.toBe('prj_existing');
    expect(c.updatedAt).not.toBe(1);
  });
});

describe('物化为新工程', () => {
  it('同一文件导入两次得到两个互不影响的工程', () => {
    const res = parseProject(exportProject(crossingZeroCircuit()));
    if (!res.ok) throw new Error('parse failed');
    const project: ImportedProject = res.project;
    const a = buildImportedCircuit(project);
    const b = buildImportedCircuit(project);
    expect(a.id).not.toBe(b.id);
    expect(a.nodes).toEqual(b.nodes);
    expect(a.comps).toEqual(b.comps);
    // 深拷贝：修改一个不影响另一个，也不影响解析结果
    a.nodes[0].x = -999;
    a.comps[0].value = -999;
    expect(b.nodes[0].x).not.toBe(-999);
    expect(project.comps[0].value).not.toBe(-999);
  });
});
