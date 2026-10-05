// 工程 JSON 导入/导出：在两台浏览器之间交换完整电路工程。
//
// 导出内容：接点（编号/名称/坐标/参考地）、元件（编号/类型/名称/数值/图形位置）、
// 连接关系（元件 a/b 端点对接点编号的引用）。
// 明确不包含 IndexedDB 内部键：工程记录键 id 与 updatedAt 不出现在文件中；
// 即使文件里被人为夹带了这些字段，导入也会忽略——导入总是生成全新记录键，
// 因此导入绝不覆盖、也不修改任何已有工程。

import type { Circuit, Comp, CompType, Node } from './engine/types';
import { checkValues } from './engine/util';
import { uid } from './factory';

export const PROJECT_FORMAT = 'dc-workbench-project';
export const PROJECT_VERSION = 1;

/** 导出文件结构（数据版本 1）：只有电路本体，无任何存储层字段 */
export interface ProjectFile {
  format: typeof PROJECT_FORMAT;
  version: number;
  title: string;
  nodes: Node[];
  comps: Comp[];
}

/** 校验通过、等待用户确认后物化的工程数据（不含 IndexedDB 记录键） */
export interface ImportedProject {
  title: string;
  nodes: Node[];
  comps: Comp[];
}

export type ImportProblemCode =
  | 'NOT_JSON' // 文件不是合法 JSON
  | 'NOT_PROJECT' // 不是本工作台的工程文件
  | 'VERSION' // 数据版本不兼容
  | 'STRUCTURE' // 字段缺失 / 类型错误
  | 'DUP_NODE' // 接点编号重复
  | 'DUP_COMP' // 元件编号重复
  | 'BAD_REF' // 端点引用了不存在的接点
  | 'BAD_VALUE' // 元件数值非法
  | 'MULTI_GROUND'; // 重复参考地

export interface ImportProblem {
  code: ImportProblemCode;
  message: string;
  /** 问题对应的元件/接点编号（界面据此指出具体对象） */
  refs: string[];
}

export type ParseResult = { ok: true; project: ImportedProject } | { ok: false; problems: ImportProblem[] };

const COMP_TYPES: readonly CompType[] = ['R', 'V', 'I', 'wire'];

function fail(problems: ImportProblem[]): ParseResult {
  return { ok: false, problems };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const isFiniteNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** 序列化工程为 JSON 文本。Circuit 可能是 Svelte $state 代理，这里逐字段拷贝为纯对象。 */
export function exportProject(circuit: Circuit): string {
  const file: ProjectFile = {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    title: circuit.title,
    nodes: circuit.nodes.map((n) => ({ id: n.id, name: n.name, x: n.x, y: n.y, ground: n.ground })),
    comps: circuit.comps.map((c) => ({
      id: c.id,
      type: c.type,
      name: c.name,
      a: c.a,
      b: c.b,
      value: c.value,
      t: c.t,
      offset: c.offset,
    })),
  };
  return JSON.stringify(file, null, 2);
}

/** 下载文件名：`<标题>.dcw.json`，过滤文件系统非法字符 */
export function exportFileName(title: string): string {
  const safe = title.trim().replace(/[\\/:*?"<>|\s]+/g, '_');
  return `${safe || 'circuit'}.dcw.json`;
}

/**
 * 解析并校验工程文件。校验全部通过才返回 ok:true；
 * 任何问题都返回完整问题列表（带关联元件/接点编号），调用方不得部分导入。
 */
export function parseProject(text: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return fail([{ code: 'NOT_JSON', message: `文件不是合法的 JSON：${(e as Error).message}`, refs: [] }]);
  }
  if (!isRecord(raw)) {
    return fail([{ code: 'NOT_PROJECT', message: '文件内容不是一个工程对象', refs: [] }]);
  }
  if (raw.format !== PROJECT_FORMAT) {
    return fail([
      {
        code: 'NOT_PROJECT',
        message: `不是本工作台导出的工程文件（缺少 format: "${PROJECT_FORMAT}"）`,
        refs: [],
      },
    ]);
  }
  // 数据版本：只接受整数 1..PROJECT_VERSION；更高版本说明文件来自更新的工作台
  if (typeof raw.version !== 'number' || !Number.isInteger(raw.version) || raw.version < 1 || raw.version > PROJECT_VERSION) {
    return fail([
      {
        code: 'VERSION',
        message: `数据版本不兼容：文件版本为 ${JSON.stringify(raw.version) ?? '缺失'}，本工作台支持版本 ${PROJECT_VERSION}`,
        refs: [],
      },
    ]);
  }

  const rawNodes = raw.nodes;
  const rawComps = raw.comps;
  if (!Array.isArray(rawNodes) || !Array.isArray(rawComps)) {
    const problems: ImportProblem[] = [];
    if (!Array.isArray(rawNodes)) problems.push({ code: 'STRUCTURE', message: '缺少 nodes 数组（接点列表）', refs: [] });
    if (!Array.isArray(rawComps)) problems.push({ code: 'STRUCTURE', message: '缺少 comps 数组（元件列表）', refs: [] });
    return fail(problems);
  }

  const problems: ImportProblem[] = [];

  // ---------- 接点 ----------
  const nodes: Node[] = [];
  const nodeIds = new Set<string>();
  const nodeLabel = new Map<string, string>();
  rawNodes.forEach((rn: unknown, i: number) => {
    const where = `第 ${i + 1} 个接点`;
    if (!isRecord(rn)) {
      problems.push({ code: 'STRUCTURE', message: `${where}不是对象`, refs: [] });
      return;
    }
    if (typeof rn.id !== 'string' || rn.id === '') {
      problems.push({ code: 'STRUCTURE', message: `${where}缺少有效的编号 id`, refs: [] });
      return;
    }
    const id = rn.id;
    const label = typeof rn.name === 'string' && rn.name ? `${rn.name}（${id}）` : id;
    if (nodeIds.has(id)) {
      problems.push({ code: 'DUP_NODE', message: `接点编号重复：${label}`, refs: [id] });
      return;
    }
    if (!isFiniteNum(rn.x) || !isFiniteNum(rn.y)) {
      problems.push({ code: 'STRUCTURE', message: `接点 ${label} 的坐标 (x, y) 必须是有限数值`, refs: [id] });
      return;
    }
    if (rn.name !== undefined && typeof rn.name !== 'string') {
      problems.push({ code: 'STRUCTURE', message: `接点 ${label} 的名称必须是字符串`, refs: [id] });
      return;
    }
    if (rn.ground !== undefined && typeof rn.ground !== 'boolean') {
      problems.push({ code: 'STRUCTURE', message: `接点 ${label} 的参考地标记 ground 必须是布尔值`, refs: [id] });
      return;
    }
    nodeIds.add(id);
    nodeLabel.set(id, label);
    nodes.push({ id, name: (rn.name as string | undefined) ?? '', x: rn.x, y: rn.y, ground: rn.ground === true });
  });

  // ---------- 元件 ----------
  const comps: Comp[] = [];
  const compIds = new Set<string>();
  rawComps.forEach((rc: unknown, i: number) => {
    const where = `第 ${i + 1} 个元件`;
    if (!isRecord(rc)) {
      problems.push({ code: 'STRUCTURE', message: `${where}不是对象`, refs: [] });
      return;
    }
    if (typeof rc.id !== 'string' || rc.id === '') {
      problems.push({ code: 'STRUCTURE', message: `${where}缺少有效的编号 id`, refs: [] });
      return;
    }
    const id = rc.id;
    const label = typeof rc.name === 'string' && rc.name ? `${rc.name}（${id}）` : id;
    if (compIds.has(id)) {
      problems.push({ code: 'DUP_COMP', message: `元件编号重复：${label}`, refs: [id] });
      return;
    }
    if (typeof rc.type !== 'string' || !COMP_TYPES.includes(rc.type as CompType)) {
      problems.push({ code: 'STRUCTURE', message: `元件 ${label} 的类型必须是 R / V / I / wire 之一`, refs: [id] });
      return;
    }
    if (rc.name !== undefined && typeof rc.name !== 'string') {
      problems.push({ code: 'STRUCTURE', message: `元件 ${label} 的名称必须是字符串`, refs: [id] });
      return;
    }
    if (typeof rc.a !== 'string' || rc.a === '' || typeof rc.b !== 'string' || rc.b === '') {
      problems.push({ code: 'STRUCTURE', message: `元件 ${label} 缺少端点 a/b 对接点编号的引用`, refs: [id] });
      return;
    }
    // 图形位置 t/offset 可选（缺省 0.5 / 0），出现则必须是有限数值
    if ((rc.t !== undefined && !isFiniteNum(rc.t)) || (rc.offset !== undefined && !isFiniteNum(rc.offset))) {
      problems.push({ code: 'STRUCTURE', message: `元件 ${label} 的图形位置 t/offset 必须是有限数值`, refs: [id] });
      return;
    }
    const comp: Comp = {
      id,
      type: rc.type as CompType,
      name: (rc.name as string | undefined) ?? '',
      a: rc.a,
      b: rc.b,
      value: typeof rc.value === 'number' ? rc.value : NaN,
      t: (rc.t as number | undefined) ?? 0.5,
      offset: (rc.offset as number | undefined) ?? 0,
    };
    // 元件值校验：与求解引擎 checkValues 同一套规则（有限数值、电阻不为负）
    if (checkValues(comp) !== null) {
      const why =
        typeof rc.value !== 'number'
          ? '缺少数值或数值不是数字'
          : !Number.isFinite(comp.value)
            ? `数值必须是有限数值，得到 ${String(comp.value)}`
            : `电阻值不能为负（${comp.value} Ω）`;
      problems.push({ code: 'BAD_VALUE', message: `元件 ${label} 的${why}`, refs: [id] });
      return;
    }
    // 端点引用校验：a/b 必须指向已声明的接点
    let refOk = true;
    for (const [which, ref] of [
      ['a', rc.a],
      ['b', rc.b],
    ] as const) {
      if (!nodeIds.has(ref)) {
        problems.push({
          code: 'BAD_REF',
          message: `元件 ${label} 的端点 ${which} 引用了不存在的接点 "${ref}"`,
          refs: [id, ref],
        });
        refOk = false;
      }
    }
    if (!refOk) return;
    compIds.add(id);
    comps.push(comp);
  });

  // ---------- 参考地唯一性 ----------
  const grounds = nodes.filter((n) => n.ground);
  if (grounds.length > 1) {
    problems.push({
      code: 'MULTI_GROUND',
      message: `参考地不唯一：${grounds.map((n) => nodeLabel.get(n.id) ?? n.id).join('、')} 都被设为参考地（全电路至多一个）`,
      refs: grounds.map((n) => n.id),
    });
  }

  if (problems.length) return fail(problems);
  const title = typeof raw.title === 'string' && raw.title.trim() !== '' ? raw.title : '未命名工程';
  return { ok: true, project: { title, nodes, comps } };
}

/**
 * 把校验通过的导入数据物化为新工程：分配全新的 IndexedDB 记录键与更新时间，
 * 忽略文件中可能夹带的任何 id/updatedAt——导入同一文件多次会得到多个互不影响的工程。
 */
export function buildImportedCircuit(p: ImportedProject): Circuit {
  return {
    id: uid('prj'),
    title: p.title,
    nodes: p.nodes.map((n) => ({ ...n })),
    comps: p.comps.map((c) => ({ ...c })),
    updatedAt: Date.now(),
  };
}
