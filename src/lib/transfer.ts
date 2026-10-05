// 工程 JSON 导入 / 导出
//
// 导出文件只包含电路本体：接点、元件、连接（a/b 端点引用）、图元位置（x/y/t/offset）
// 与参考地设置；不包含 IndexedDB 内部键（工程 id、updatedAt）——导入时总是生成新键，
// 因此导入永远创建新工程，不会覆盖或修改 IndexedDB 中的已有工程。

import type { Circuit, Comp, CompType, Node } from './engine/types';
import { uid } from './factory';

export const FORMAT = 'dc-workbench/project';
export const FORMAT_VERSION = 1;

/** 导出文件的规范形状（字段逐个挑选，杜绝内部键泄漏） */
export interface ProjectFile {
  format: typeof FORMAT;
  version: number;
  title: string;
  nodes: Node[];
  comps: Comp[];
}

export interface ProblemRef {
  kind: 'node' | 'comp';
  id: string;
  name: string;
}

export interface ImportProblem {
  code: 'FORMAT' | 'VERSION' | 'STRUCTURE' | 'REF' | 'VALUE' | 'GROUND';
  message: string;
  /** 问题对应的元件 / 接点，导入对话框据此向用户指出位置 */
  refs: ProblemRef[];
}

export type ParseResult = { ok: true; file: ProjectFile } | { ok: false; problems: ImportProblem[] };

const COMP_TYPES: CompType[] = ['R', 'V', 'I', 'wire'];

/** 序列化当前工程为可下载的 JSON 文本 */
export function exportProject(circuit: Circuit): string {
  const file: ProjectFile = {
    format: FORMAT,
    version: FORMAT_VERSION,
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

/** 解析 + 校验导入文本；任何问题都拒绝导入（返回全部问题，便于一次性展示） */
export function parseProject(text: string): ParseResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    return {
      ok: false,
      problems: [
        { code: 'FORMAT', message: `文件不是有效的 JSON：${e instanceof Error ? e.message : String(e)}`, refs: [] },
      ],
    };
  }
  const problems = validateProject(data);
  if (problems.length > 0) return { ok: false, problems };
  return { ok: true, file: data as ProjectFile };
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * 校验未知数据是否为合法工程文件。
 * 校验顺序：数据版本 → 结构 → 编号引用 → 元件值 → 重复地；
 * 收集全部问题（不快速失败），每个问题都带上对应的元件/接点引用。
 */
export function validateProject(data: unknown): ImportProblem[] {
  const problems: ImportProblem[] = [];
  const push = (code: ImportProblem['code'], message: string, refs: ProblemRef[] = []) =>
    problems.push({ code, message, refs });

  if (!isObj(data)) {
    push('FORMAT', '文件内容不是一个工程对象');
    return problems;
  }

  // ---------- 数据版本 ----------
  if (data.format !== FORMAT) {
    push('FORMAT', `缺少工程标识（应为 "${FORMAT}"），该文件可能不是本工作台导出的工程`);
  }
  const version = data.version;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    push('VERSION', `数据版本号缺失或无效：${JSON.stringify(version) ?? '（无 version 字段）'}`);
  } else if (version > FORMAT_VERSION) {
    push('VERSION', `数据版本 v${version} 高于本工作台支持的 v${FORMAT_VERSION}，请用新版本工作台导出`);
  }
  if (problems.length > 0) return problems; // 格式/版本不符时不再深入，避免连锁误报

  // ---------- 结构 ----------
  if (typeof data.title !== 'string') push('STRUCTURE', '缺少工程标题（title 应为字符串）');
  if (!Array.isArray(data.nodes) || !Array.isArray(data.comps)) {
    push('STRUCTURE', '缺少接点数组 nodes 或元件数组 comps');
    return problems;
  }
  const rawNodes = data.nodes as unknown[];
  const rawComps = data.comps as unknown[];

  const nodeIds = new Set<string>();
  const nodeRefs = new Map<string, ProblemRef>();
  rawNodes.forEach((nd, i) => {
    const at = `nodes[${i}]`;
    if (!isObj(nd)) {
      push('STRUCTURE', `接点 ${at} 不是对象`);
      return;
    }
    const self: ProblemRef = {
      kind: 'node',
      id: typeof nd.id === 'string' ? nd.id : `#${i}`,
      name: typeof nd.name === 'string' && nd.name ? nd.name : `（第 ${i + 1} 个接点）`,
    };
    if (typeof nd.id !== 'string' || nd.id === '') {
      push('STRUCTURE', `接点 ${at} 缺少编号 id`, [self]);
    } else if (nodeIds.has(nd.id)) {
      push('STRUCTURE', `接点编号 "${nd.id}" 重复`, [self]);
    } else {
      nodeIds.add(nd.id);
      nodeRefs.set(nd.id, self);
    }
    if (nd.name !== undefined && typeof nd.name !== 'string')
      push('STRUCTURE', `接点 ${self.name} 的名称不是字符串`, [self]);
    if (!isNum(nd.x) || !isNum(nd.y)) push('STRUCTURE', `接点 ${self.name} 的坐标 x/y 不是有限数值`, [self]);
    if (nd.ground !== undefined && typeof nd.ground !== 'boolean')
      push('STRUCTURE', `接点 ${self.name} 的 ground 标记不是布尔值`, [self]);
  });

  const compIds = new Set<string>();
  rawComps.forEach((cp, i) => {
    const at = `comps[${i}]`;
    if (!isObj(cp)) {
      push('STRUCTURE', `元件 ${at} 不是对象`);
      return;
    }
    const self: ProblemRef = {
      kind: 'comp',
      id: typeof cp.id === 'string' ? cp.id : `#${i}`,
      name: typeof cp.name === 'string' && cp.name ? cp.name : `（第 ${i + 1} 个元件）`,
    };
    if (typeof cp.id !== 'string' || cp.id === '') {
      push('STRUCTURE', `元件 ${at} 缺少编号 id`, [self]);
    } else if (compIds.has(cp.id)) {
      push('STRUCTURE', `元件编号 "${cp.id}" 重复`, [self]);
    } else {
      compIds.add(cp.id);
    }
    if (typeof cp.name !== 'undefined' && typeof cp.name !== 'string')
      push('STRUCTURE', `元件 ${self.name} 的名称不是字符串`, [self]);
    if (typeof cp.type !== 'string' || !COMP_TYPES.includes(cp.type as CompType)) {
      push('STRUCTURE', `元件 ${self.name} 的类型无效（应为 R / V / I / wire 之一）：${JSON.stringify(cp.type)}`, [self]);
    }

    // ---------- 编号引用：a/b 端点必须指向已声明的接点 ----------
    for (const end of ['a', 'b'] as const) {
      const ref = cp[end];
      if (typeof ref !== 'string' || ref === '') {
        push('REF', `元件 ${self.name} 的端点 ${end} 缺少接点编号`, [self]);
      } else if (!nodeIds.has(ref)) {
        push('REF', `元件 ${self.name} 的端点 ${end} 引用了不存在的接点 "${ref}"`, [self]);
      }
    }

    // ---------- 元件值 ----------
    if (!isNum(cp.value)) {
      push('VALUE', `元件 ${self.name} 的数值缺失或不是有限数值：${JSON.stringify(cp.value)}`, [self]);
    } else if (cp.type === 'R' && cp.value < 0) {
      push('VALUE', `电阻 ${self.name} 的阻值为负（${cp.value} Ω）`, [self]);
    }
    if (cp.t !== undefined && !isNum(cp.t)) push('STRUCTURE', `元件 ${self.name} 的位置参数 t 不是数值`, [self]);
    if (cp.offset !== undefined && !isNum(cp.offset))
      push('STRUCTURE', `元件 ${self.name} 的位置参数 offset 不是数值`, [self]);
  });

  // ---------- 重复地：参考地全电路至多一个 ----------
  const grounds = rawNodes.filter((nd): nd is Record<string, unknown> => isObj(nd) && nd.ground === true);
  if (grounds.length > 1) {
    push(
      'GROUND',
      `存在 ${grounds.length} 个参考地接点：同一电路只能有一个参考地`,
      grounds.map((nd) => nodeRefs.get(nd.id as string) ?? { kind: 'node', id: String(nd.id), name: String(nd.name ?? nd.id) }),
    );
  }

  return problems;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/**
 * 由校验通过的工程文件构建电路。
 * 分配全新的工程 id 与 updatedAt（IndexedDB 内部键不随文件走），
 * 接点 / 元件编号原样保留，保证往返后连接与求解结果完全一致。
 */
export function buildCircuit(file: ProjectFile): Circuit {
  return {
    id: uid('prj'),
    title: file.title,
    updatedAt: Date.now(),
    nodes: file.nodes.map((n) => ({
      id: n.id,
      name: typeof n.name === 'string' ? n.name : '',
      x: n.x,
      y: n.y,
      ground: n.ground === true,
    })),
    comps: file.comps.map((c) => ({
      id: c.id,
      type: c.type,
      name: typeof c.name === 'string' ? c.name : '',
      a: c.a,
      b: c.b,
      value: c.value,
      t: typeof c.t === 'number' ? clamp01(c.t) : 0.5,
      offset: typeof c.offset === 'number' ? c.offset : 0,
    })),
  };
}

/** 导入确认对话框用的概要信息 */
export function summarize(file: ProjectFile): { title: string; nodes: number; comps: number; ground: string | null } {
  const g = file.nodes.find((n) => n.ground === true);
  return {
    title: file.title,
    nodes: file.nodes.length,
    comps: file.comps.length,
    ground: g ? g.name || g.id : null,
  };
}
