import type {
  AnalysisResult,
  BranchResult,
  Circuit,
  Comp,
  Issue,
  NetKcl,
  RowInfo,
  Trace,
  VarInfo,
} from './types';
import { DSU, checkValues, isConductive } from './util';
import { solveSystem } from './solver';

const TOL = 1e-9;
const DISP_TOL = 1e-7;

/** 两个元件引用集合是否相同（顺序无关） */
function sameRefSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sb = new Set(b);
  return a.every((x) => sb.has(x));
}

function emptyResult(issues: Issue[]): AnalysisResult {
  return {
    ok: !issues.some((i) => i.kind === 'error'),
    issues,
    x: null,
    vars: [],
    rows: [],
    A: null,
    z: null,
    trace: null,
    rhsTrace: null,
    netOf: null,
    netNodeIds: null,
    groundNet: null,
    branches: [],
    netKcls: [],
    power: null,
  };
}

export function analyze(circuit: Circuit): AnalysisResult {
  const issues: Issue[] = [];
  const compById = new Map<string, Comp>();
  for (const c of circuit.comps) compById.set(c.id, c);
  const nameOf = (id: string) => compById.get(id)?.name ?? circuit.nodes.find((n) => n.id === id)?.name ?? id;

  // ---------- 0. 空电路 ----------
  if (circuit.comps.length === 0 && circuit.nodes.length === 0) {
    return emptyResult([
      { kind: 'error', code: 'EMPTY', message: '电路为空：请先放置接点与元件', refs: [] },
    ]);
  }

  // ---------- 1. 结构与数值校验 ----------
  const nodeIds = new Set(circuit.nodes.map((n) => n.id));
  const dangling: string[] = [];
  for (const c of circuit.comps) {
    if (!nodeIds.has(c.a) || !nodeIds.has(c.b)) dangling.push(c.id);
  }
  const badValue = circuit.comps.filter((c) => checkValues(c) !== null).map((c) => c.id);
  const grounds = circuit.nodes.filter((n) => n.ground);

  const errors: Issue[] = [];
  if (dangling.length)
    errors.push({
      kind: 'error',
      code: 'DANGLING',
      message: '存在悬空元件：端点没有连接到任何接点',
      detail: dangling.map(nameOf).join('、'),
      refs: dangling,
    });
  if (badValue.length)
    errors.push({
      kind: 'error',
      code: 'BAD_VALUE',
      message: '元件数值无效（需为有限非负数，电阻不可为负）',
      detail: badValue.map(nameOf).join('、'),
      refs: badValue,
    });
  if (grounds.length === 0)
    errors.push({
      kind: 'error',
      code: 'NO_GROUND',
      message: '未设置参考地：请在某接点上明确设置参考地（0 V），否则节点电位无基准',
      refs: [],
    });
  if (grounds.length > 1)
    errors.push({
      kind: 'error',
      code: 'MULTI_GROUND',
      message: '存在多个参考地节点：同一网络只能有一个明确参考点',
      detail: grounds.map((n) => n.name).join('、'),
      refs: grounds.map((n) => n.id),
    });
  if (errors.length) return emptyResult(errors);

  const groundId = grounds[0].id;

  // ---------- 2. 收缩零电阻支路（理想导线 / 0Ω）为 net ----------
  const dsu = new DSU();
  circuit.nodes.forEach((n) => dsu.add(n.id));
  const zeroEdges: Comp[] = [];
  const nonzeroEdges: Comp[] = [];
  for (const c of circuit.comps) {
    if (c.type === 'wire' || (c.type === 'R' && c.value === 0)) {
      dsu.union(c.a, c.b);
      zeroEdges.push(c);
    } else {
      nonzeroEdges.push(c);
    }
  }

  const rootToNet = new Map<string, number>();
  const netNodeIds: string[][] = [];
  const netOf: { [k: string]: number } = {};
  for (const nid of nodeIds) {
    const root = dsu.find(nid);
    let net = rootToNet.get(root);
    if (net === undefined) {
      net = netNodeIds.length;
      rootToNet.set(root, net);
      netNodeIds.push([]);
    }
    netNodeIds[net].push(nid);
    netOf[nid] = net;
  }
  netNodeIds.forEach((arr) => arr.sort());
  const N = netNodeIds.length;
  const groundNet = netOf[groundId];

  // 电压源自环（同一 net 上的非零理想电压源）——最直接的矛盾约束
  const selfLoops = nonzeroEdges.filter((c) => c.type === 'V' && netOf[c.a] === netOf[c.b] && Math.abs(c.value) > TOL);
  if (selfLoops.length) {
    return emptyResult([
      {
        kind: 'error',
        code: 'VSOURCE_LOOP',
        message: `理想电压源被零电阻短路：两端等电位却要求 ${selfLoops
          .map((c) => `${c.name}=${fmt(c.value)}V`)
          .join('，')}——该电压约束无法满足`,
        detail:
          '这正是“两个矛盾的理想电压源接在一起”的情形：同一闭合路径上理想电压约束的代数和必须为零。',
        refs: selfLoops.map((c) => c.id).concat(zeroEdges.filter((w) => {
          const n = netOf[w.a];
          return selfLoops.some((s) => netOf[s.a] === n);
        }).map((w) => w.id)),
      },
    ]);
  }

  // ---------- 3. 超节点（R+V 连通）分组：查浮空子网、孤立节点、电流源割集 ----------
  const sup = new DSU();
  for (let i = 0; i < N; i++) sup.add(String(i));
  for (const c of nonzeroEdges) {
    if (isConductive(c)) sup.union(String(netOf[c.a]), String(netOf[c.b]));
  }
  const supRoots = new Map<string, number>();
  const supNets: number[][] = [];
  for (let i = 0; i < N; i++) {
    const r = sup.find(String(i));
    let g = supRoots.get(r);
    if (g === undefined) {
      g = supNets.length;
      supRoots.set(r, g);
      supNets.push([]);
    }
    supNets[g].push(i);
  }

  const netComps = new Map<number, Comp[]>();
  for (const c of nonzeroEdges) {
    for (const net of [netOf[c.a], netOf[c.b]]) {
      if (!netComps.has(net)) netComps.set(net, []);
      netComps.get(net)!.push(c);
    }
  }

  const hardErrors: Issue[] = [];
  const warningIssues: Issue[] = [];
  const icutCandidates: { key: string; isGround: boolean; issue: Issue }[] = [];

  for (const nets of supNets) {
    const isGround = nets.includes(groundNet);
    const attached = new Map<string, Comp>();
    const netSet = new Set(nets);
    let internalCount = 0;
    for (const net of nets) {
      for (const c of netComps.get(net) ?? []) {
        const cross = netSet.has(netOf[c.a]) !== netSet.has(netOf[c.b]) || !netSet.has(netOf[c.a]);
        if (cross) attached.set(c.id, c);
        else internalCount++;
      }
    }
    // 孤立节点：收缩后没有任何非零元件连接
    const noEdges = nets.every((net) => (netComps.get(net) ?? []).length === 0);
    const nodeRefs = nets.flatMap((net) => netNodeIds[net]);
    if (noEdges && !isGround) {
      hardErrors.push({
        kind: 'error',
        code: 'ISOLATED',
        message: `孤立节点 ${nodeRefs.map(nameOf).join('、')}：没有任何元件连接，电位完全无定义`,
        refs: nodeRefs,
      });
      continue;
    }
    // 电流源割集：超节点外部只能经电流源交换电流，Σ注入必须为零
    let injection = 0;
    const cutRefs: string[] = [];
    for (const c of attached.values()) {
      if (c.type === 'I') {
        const sign = netSet.has(netOf[c.a]) ? 1 : -1; // a→b：超节点在 a 侧则电流流出
        injection -= sign * c.value; // KCL 注入
        cutRefs.push(c.id);
      }
    }
    const cutsetOnly = cutRefs.length > 0 && [...attached.values()].every((c) => c.type === 'I');
    if (cutsetOnly && Math.abs(injection) > DISP_TOL) {
      // 同一组电流源对割开的两个超节点给出等价的两条 KCL，暂存后去重
      icutCandidates.push({
        key: [...cutRefs].sort().join('|'),
        isGround,
        issue: {
          kind: 'error',
          code: 'ICUTSET' as const,
          message: `电流源割集约束冲突：包围节点 ${nodeRefs
            .map(nameOf)
            .join('、')} 的闭合面只穿过电流源 ${cutRefs
            .map(nameOf)
            .join('、')}，而其电流代数和为 ${fmt(injection)}A ≠ 0，KCL 无法满足`,
          detail: '典型情形：不同电流的理想电流源串联（如 1A 与 2A 首尾相接）。',
          refs: cutRefs,
        },
      });
    }
    // 浮空子网：与参考地之间没有任何电阻/电压源通路，节点共模电压不可定
    if (!isGround) {
      const via: string[] = [];
      for (const c of nonzeroEdges) {
        const inA = netSet.has(netOf[c.a]);
        const inB = netSet.has(netOf[c.b]);
        if (inA !== inB && isConductive(c)) via.push(c.id);
      }
      hardErrors.push({
        kind: 'error',
        code: 'FLOATING',
        message: `浮空子网：节点 ${nodeRefs
          .map(nameOf)
          .join('、')} 与参考地之间没有电阻/电压源通路，其整体电位没有任何约束`,
        detail: via.length
          ? undefined
          : cutsetOnly
            ? `且经电流源 ${cutRefs.map(nameOf).join('、')} 注入电流和不为零（见割集冲突）。`
            : '理想电流源不能为子网提供电位参考（即使能提供电流）。',
        refs: nodeRefs,
      });
    }
    void internalCount;
  }

  // 同一割集元件集合可能同时命中地侧/非地侧超节点：每组只保留非地侧那条
  icutCandidates.sort((a, b) => Number(a.isGround) - Number(b.isGround));
  for (const cand of icutCandidates) {
    if (!hardErrors.some((e) => e.code === 'ICUTSET' && sameRefSet(e.refs, cand.issue.refs))) {
      hardErrors.push(cand.issue);
    }
  }

  // ---------- 4. 仅含电压源的回路：KVL 一致性 ----------
  const vEdges = nonzeroEdges.filter((c) => c.type === 'V');
  const { cycles, redundant } = findVCycles(vEdges, netOf, N);
  for (const cyc of cycles) {
    if (Math.abs(cyc.emf) > DISP_TOL) {
      hardErrors.push({
        kind: 'error',
        code: 'VSOURCE_LOOP',
        message: `理想电压源回路矛盾：回路 ${cyc.comps
          .map((s) => `${s.sign > 0 ? '+' : '−'}${nameOf(s.compId)}`)
          .join(' ')} 中电压升之和为 ${fmt(cyc.emf)}V ≠ 0，KVL 无法满足`,
        detail:
          cyc.comps.length > 1
            ? '两个（或多个）理想电压源直接并联/构成零电阻环时，它们对同一对节点施加的电位差必须一致。'
            : undefined,
        refs: cyc.comps.map((s) => s.compId),
      });
    }
  }

  if (hardErrors.length) {
    // 求解前发现的硬矛盾：保留电路，继续可编辑
    return emptyResult([...hardErrors, ...warningIssues]);
  }

  // 冗余零和电压源回路 → 源电流不唯一（warning，仍可求电位）
  for (const cyc of redundant) {
    warningIssues.push({
      kind: 'warning',
      code: 'REDUNDANT_VLOOP',
      message: `冗余电压源回路 ${cyc.comps
        .map((s) => `${s.sign > 0 ? '+' : '−'}${nameOf(s.compId)}`)
        .join(' ')}（电压和为 0）：节点电位可定，但回路内各电压源电流分配不唯一`,
      refs: cyc.comps.map((s) => s.compId),
    });
  }

  // ---------- 5. 建立修正节点分析（MNA）方程 ----------
  const nodeNets = [...Array(N).keys()].filter((k) => k !== groundNet);
  const nv = nodeNets.length;
  const netCol = new Map<number, number>();
  nodeNets.forEach((net, j) => netCol.set(net, j));
  const vList = vEdges;
  const nV = vList.length;
  const n = nv + nV;

  const vars: VarInfo[] = [
    ...nodeNets.map((net) => ({
      id: `V:${net}`,
      label: `V(${netNodeIds[net].map(nameOf).join('=')})`,
      kind: 'node' as const,
      refId: `net:${net}`,
    })),
    ...vList.map((c) => ({ id: `I:${c.id}`, label: `I(${c.name})`, kind: 'vsource' as const, refId: c.id })),
  ];

  const rows: RowInfo[] = [
    ...nodeNets.map((net) => ({
      id: `KCL:${net}`,
      kind: 'kcl' as const,
      label: `KCL @ ${netNodeIds[net].map(nameOf).join('=')}`,
      refId: `net:${net}`,
    })),
    ...vList.map((c) => ({
      id: `VE:${c.id}`,
      kind: 'vsource' as const,
      refId: c.id,
      label: `${c.name} 电压约束：V(${nameOf(c.a)}) − V(${nameOf(c.b)}) = ${fmt(c.value)}V`,
    })),
  ];

  const A: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  const z = new Array(n).fill(0);
  const trace: Trace = {};
  const rhsTrace: { [r: number]: { compId: string; weight: number }[] } = {};
  const addTrace = (r: number, col: number, compId: string, w: number) => {
    (trace[r] ??= {})[col] ??= [];
    trace[r][col].push({ compId, weight: w });
  };
  const addRhs = (r: number, compId: string, w: number) => {
    (rhsTrace[r] ??= []).push({ compId, weight: w });
  };

  // 电阻：G 印在节点导纳块
  for (const c of nonzeroEdges) {
    if (c.type !== 'R') continue;
    const g = 1 / c.value;
    const na = netCol.get(netOf[c.a]);
    const nb = netCol.get(netOf[c.b]);
    if (na !== undefined) {
      A[na][na] += g;
      addTrace(na, na, c.id, g);
    }
    if (nb !== undefined) {
      A[nb][nb] += g;
      addTrace(nb, nb, c.id, g);
    }
    if (na !== undefined && nb !== undefined) {
      A[na][nb] -= g;
      A[nb][na] -= g;
      addTrace(na, nb, c.id, -g);
      addTrace(nb, na, c.id, -g);
    }
  }

  // 电流源（参考方向 a→b）：KCL 右端注入：b 行 += I，a 行 -= I
  for (const c of nonzeroEdges) {
    if (c.type !== 'I') continue;
    const na = netCol.get(netOf[c.a]);
    const nb = netCol.get(netOf[c.b]);
    if (na !== undefined) {
      z[na] -= c.value;
      addRhs(na, c.id, -1);
    }
    if (nb !== undefined) {
      z[nb] += c.value;
      addRhs(nb, c.id, +1);
    }
  }

  // 电压源：电流变量列 + 电压约束行
  vList.forEach((c, k) => {
    const col = nv + k;
    const na = netCol.get(netOf[c.a]);
    const nb = netCol.get(netOf[c.b]);
    if (na !== undefined) {
      A[na][col] += 1;
      addTrace(na, col, c.id, 1);
    }
    if (nb !== undefined) {
      A[nb][col] -= 1;
      addTrace(nb, col, c.id, -1);
    }
    const row = nv + k;
    if (na !== undefined) {
      A[row][na] += 1;
      addTrace(row, na, c.id, 1);
    }
    if (nb !== undefined) {
      A[row][nb] -= 1;
      addTrace(row, nb, c.id, -1);
    }
    z[row] = c.value;
    addRhs(row, c.id, 1);
  });

  // ---------- 6. 求解 ----------
  const sol = solveSystem(A, z, n);

  for (const bad of sol.inconsistent) {
    const compRefs = new Set<string>();
    const nodeRefs = new Set<string>();
    for (const ro of bad.origins) {
      const ri = rows[ro];
      if (ri?.kind === 'vsource' && ri.refId) compRefs.add(ri.refId);
      if (ri?.kind === 'kcl' && ri.refId) {
        const net = Number(ri.refId.split(':')[1]);
        netNodeIds[net].forEach((id) => nodeRefs.add(id));
      }
      // 收集该行出现过的全部元件
      for (const colList of Object.values(trace[ro] ?? {})) for (const t of colList) compRefs.add(t.compId);
      for (const t of rhsTrace[ro] ?? []) compRefs.add(t.compId);
    }
    hardErrors.push({
      kind: 'error',
      code: 'VSOURCE_LOOP',
      message: `约束矛盾：方程 “${bad.origins.map((o) => rows[o]?.label ?? `行${o}`).join('” 与 “')}” 无法同时成立（消元后得到 0 = ${fmt(bad.rhs)}）`,
      detail: '请检查该闭合路径上的理想电压源极性与数值，或参考地设置。',
      refs: [...compRefs, ...nodeRefs],
    });
  }
  if (hardErrors.length) {
    // 即便结构性预检漏掉，数值消元也定位到了具体矛盾行：不返回 NaN
    return emptyResult([...hardErrors, ...warningIssues]);
  }

  const scale = Math.max(1, ...z.map(Math.abs), ...sol.x.map(Math.abs));
  if (sol.residual > 1e-6 * scale) {
    return emptyResult([
      ...warningIssues,
      {
        kind: 'error',
        code: 'RESIDUAL',
        message: `方程残差过大（${sol.residual.toExponential(2)}），解不可信，请检查参数`,
        refs: [],
      },
    ]);
  }

  // 自由变量提示（冗余 V 回路等）
  for (const fc of sol.freeCols) {
    const v = vars[fc];
    if (!v) continue;
    if (v.kind === 'vsource') {
      if (!warningIssues.some((w) => w.code === 'REDUNDANT_VLOOP'))
        warningIssues.push({
          kind: 'warning',
          code: 'REDUNDANT_VLOOP',
          message: `${v.label} 不唯一：该电压源处于冗余回路中，其电流取决于不可建模的细节`,
          refs: [v.refId],
        });
    } else {
      hardErrors.push({
        kind: 'error',
        code: 'SINGULAR',
        message: `${v.label} 无法确定：该节点缺少到参考地的电位约束`,
        refs: netNodeIds[Number(v.id.split(':')[1])],
      });
    }
  }
  if (hardErrors.length) return emptyResult([...hardErrors, ...warningIssues]);

  const x = sol.x;
  const vOf = (net: number) => (net === groundNet ? 0 : x[netCol.get(net)!]);
  const vSourceCurrent = new Map<string, number>();
  vList.forEach((c, k) => vSourceCurrent.set(c.id, x[nv + k]));

  // ---------- 7. 支路结果（电压极性 / 电流方向全程一致：a→b 为正） ----------
  const branches: BranchResult[] = circuit.comps.map((c) => {
    const na = netOf[c.a];
    const nb = netOf[c.b];
    const va = vOf(na);
    const vb = vOf(nb);
    const v = va - vb;
    if (c.type === 'wire' || (c.type === 'R' && c.value === 0)) {
      return { compId: c.id, va, vb, v, i: null, absorbed: 0, note: '零电阻支路：压降为 0，电流由网络分配（可由 KCL 推算）' };
    }
    let i: number;
    if (c.type === 'R') i = v / c.value;
    else if (c.type === 'V') i = vSourceCurrent.get(c.id)!;
    else i = c.value;
    const absorbed = v * i; // 无源符号约定：>0 吸收，<0 发出
    return { compId: c.id, va, vb, v, i, absorbed };
  });

  // 零阻支路电流：沿“同一 net 内部”用 KCL 局部推算（仅在唯一可定时给出）
  fillZeroCurrents(circuit, branches, netOf);

  // ---------- 8. 每个 net 的 KCL 残差 ----------
  const netKcls: NetKcl[] = [];
  for (let net = 0; net < N; net++) {
    let sum = 0;
    let kScale = 1e-12;
    let indeterminate = false;
    for (const c of circuit.comps) {
      if (netOf[c.a] !== net && netOf[c.b] !== net) continue;
      const br = branches.find((b) => b.compId === c.id)!;
      if (br.i === null) {
        // 零阻环内电流不唯一：该超节点的逐支路 KCL 无法完整核对
        if (netOf[c.a] === net && netOf[c.b] === net) indeterminate = true;
        continue;
      }
      if (netOf[c.a] === net) {
        sum += br.i; // 以 a→b 为正：a 在本 net → 流出
        kScale = Math.max(kScale, Math.abs(br.i));
      }
      if (netOf[c.b] === net) sum -= br.i;
    }
    netKcls.push({
      netId: net,
      nodeIds: netNodeIds[net],
      voltage: Math.abs(vOf(net)) < 1e-12 ? 0 : vOf(net),
      residual: indeterminate ? 0 : sum,
      scale: kScale,
      indeterminate,
    });
  }

  // ---------- 9. 功率平衡 ----------
  const delivered: { compId: string; name: string; watts: number }[] = [];
  const absorbedList: { compId: string; name: string; watts: number }[] = [];
  let totalAbsorbed = 0;
  for (const b of branches) {
    if (b.absorbed === null) continue;
    const c = compById.get(b.compId)!;
    totalAbsorbed += b.absorbed;
    if (b.absorbed >= 0) absorbedList.push({ compId: b.compId, name: c.name, watts: b.absorbed });
    else delivered.push({ compId: b.compId, name: c.name, watts: -b.absorbed });
  }
  delivered.sort((p, q) => q.watts - p.watts);
  absorbedList.sort((p, q) => q.watts - p.watts);
  const powerScale = Math.max(1e-12, ...[...delivered, ...absorbedList].map((p) => Math.abs(p.watts)));
  const power = {
    totalAbsorbed,
    delivered,
    absorbed: absorbedList,
    residual: totalAbsorbed,
    relative: Math.abs(totalAbsorbed) / powerScale,
  };
  if (power.relative > 1e-6) {
    warningIssues.push({
      kind: 'warning',
      code: 'POWER',
      message: `功率不平衡：Σ吸收功率 = ${fmt(totalAbsorbed)}W（相对残差 ${power.relative.toExponential(1)}）`,
      refs: [],
    });
  }

  issues.push(...warningIssues);
  return {
    ok: true,
    issues,
    x,
    vars,
    rows,
    A,
    z,
    trace,
    rhsTrace,
    netOf,
    netNodeIds,
    groundNet,
    branches,
    netKcls,
    power,
  };
}

/** 电压源基本回路检测（net 级无向多重图，DFS 生成树 + 弦）
 *  无向 DFS 中每条弦都连接“祖先—后代”，沿父链回溯即可取出基本回路。 */
function findVCycles(
  vEdges: Comp[],
  netOf: { [k: string]: number },
  N: number,
): { cycles: { comps: { compId: string; sign: number }[]; emf: number }[]; redundant: typeof cycles } {
  const adj = new Map<number, { to: number; comp: Comp }[]>();
  for (let i = 0; i < N; i++) adj.set(i, []);
  for (const c of vEdges) {
    const u = netOf[c.a];
    const v = netOf[c.b];
    if (u === v) continue;
    adj.get(u)!.push({ to: v, comp: c });
    adj.get(v)!.push({ to: u, comp: c });
  }
  const valueOf = new Map(vEdges.map((c) => [c.id, c.value]));
  const cycles: { comps: { compId: string; sign: number }[]; emf: number }[] = [];
  const depth = new Map<number, number>();
  const parentComp = new Map<number, Comp>(); // net → 与父节点之间的树边

  for (let root = 0; root < N; root++) {
    if (depth.has(root)) continue;
    depth.set(root, 0);
    const stack: number[] = [root];
    while (stack.length) {
      const u = stack.pop()!;
      for (const e of adj.get(u)!) {
        const v = e.to;
        const isParentEdge = parentComp.get(u)?.id === e.comp.id;
        if (isParentEdge) continue;
        if (!depth.has(v)) {
          // 树边：发现新节点
          parentComp.set(v, e.comp);
          depth.set(v, (depth.get(u) ?? 0) + 1);
          stack.push(v);
          continue;
        }
        // 已访问 → 弦；只在较深端点处理一次，并保证沿祖先方向回溯
        if ((depth.get(v) ?? 0) >= (depth.get(u) ?? 0)) continue;
        // 回路：先沿弦 u（深）→ v（浅/祖先），再沿树路径 v → u 反向闭合
        const comps: { compId: string; sign: number }[] = [];
        // 弦上行进 u→v 与元件 a→b 一致当且仅当 a 端在 u（同向记 +压降）
        comps.push({ compId: e.comp.id, sign: netOf[e.comp.a] === u ? 1 : -1 });
        let x = u;
        let guard = 0;
        while (x !== v && guard++ <= N) {
          const pe = parentComp.get(x);
          if (!pe) break;
          // 闭合段实际沿“父 → x”行进（与收集到的 x→父树边反向，故取负）
          const downTowardX = netOf[pe.a] === x ? 1 : -1; // x→父 与 a→b 是否同向
          comps.push({ compId: pe.id, sign: -downTowardX });
          x = netOf[pe.a] === x ? netOf[pe.b] : netOf[pe.a];
        }
        const emf = comps.reduce((s, t) => s + t.sign * (valueOf.get(t.compId) ?? 0), 0);
        cycles.push({ comps, emf });
      }
    }
  }

  const seenKey = new Set<string>();
  const uniq = cycles.filter((c) => {
    const k = c.comps.map((t) => t.compId).sort().join('|');
    if (seenKey.has(k)) return false;
    seenKey.add(k);
    return true;
  });
  return { cycles: uniq.filter((c) => Math.abs(c.emf) > DISP_TOL), redundant: uniq.filter((c) => Math.abs(c.emf) <= DISP_TOL) };
}

/** 零阻支路电流：把零阻边当作图的边逐个考察；
 *  去掉该边后，其一端所在的零阻连通片若与另一端仍连通（存在并联零阻环），
 *  则该支路电流不唯一，保持 null；否则对该连通片做 KCL 唯一确定。 */
function fillZeroCurrents(circuit: Circuit, branches: BranchResult[], netOf: { [k: string]: number }) {
  const zero = circuit.comps.filter((c) => c.type === 'wire' || (c.type === 'R' && c.value === 0));
  const others = circuit.comps.filter((c) => !(c.type === 'wire' || (c.type === 'R' && c.value === 0)));
  const brMap = new Map(branches.map((b) => [b.compId, b]));

  for (const w of zero) {
    // 去掉 w 后，全部零阻边在节点层面上做并查集
    const dsu = new DSU();
    for (const nid of Object.keys(netOf)) dsu.add(nid);
    for (const w2 of zero) {
      if (w2.id === w.id) continue;
      dsu.union(w2.a, w2.b);
    }
    const rootA = dsu.find(w.a);
    const rootB = dsu.find(w.b);
    if (rootA === rootB) continue; // 去掉后 a、b 仍连通 → 零阻环，分流不唯一

    // a 侧零阻连通片（可能含多个收缩 net）
    const side = new Set<string>();
    for (const nid of Object.keys(netOf)) {
      if (dsu.find(nid) === rootA) side.add(nid);
    }
    let out = 0;
    for (const c of others) {
      const inA = side.has(c.a);
      const inB = side.has(c.b);
      if (inA === inB) continue;
      const br = brMap.get(c.id)!;
      if (br.i === null) continue;
      out += inA ? br.i : -br.i; // 参考方向 a→b：a 在侧内 → 流出
    }
    const br = brMap.get(w.id)!;
    const iw = -out; // 侧内 KCL：非零支路流出 + w 流出 = 0
    br.i = iw;
    br.absorbed = br.v * iw;
    br.note = '零电阻支路：电流由连接点 KCL 唯一确定';
  }
}

export function fmt(x: number, digits = 4): string {
  if (!Number.isFinite(x)) return String(x);
  if (Math.abs(x) < 1e-12) return '0';
  const ax = Math.abs(x);
  if (ax >= 1e5 || ax < 1e-3) return x.toExponential(digits - 1).replace(/\.?0+e/, 'e');
  return String(Number(x.toPrecision(digits)));
}
