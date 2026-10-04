import { lusolve } from 'mathjs';

export interface SolveOutcome {
  x: number[];
  /** 自由列（变量不唯一，取 0 特解） */
  freeCols: number[];
  /** 矛盾行：0 = 非零，附该行涉及的所有原始行号（溯源） */
  inconsistent: { row: number; rhs: number; origins: number[] }[];
  residual: number;
  usedFallback: boolean;
}

const maxAbs = (v: number[]) => v.reduce((m, x) => Math.max(m, Math.abs(x)), 0);

/** 首选 mathjs LU；奇异/NaN 时回退到带行溯源的 Gauss-Jordan */
export function solveSystem(A: number[][], z: number[], n: number): SolveOutcome {
  // 1) mathjs LU
  try {
    const sol = lusolve(A, z) as unknown as number[][];
    const x = sol.map((r) => (Array.isArray(r) ? Number(r[0]) : Number(r)));
    if (x.length === n && x.every((v) => Number.isFinite(v))) {
      const res = maxAbs(matVec(A, x).map((v, i) => v - z[i]));
      const scale = Math.max(1, maxAbs(z), maxAbs(x));
      if (res <= 1e-8 * scale) return { x, freeCols: [], inconsistent: [], residual: res, usedFallback: false };
    }
  } catch {
    /* fall through */
  }
  return gaussJordan(A, z, n);
}

export function matVec(A: number[][], x: number[]): number[] {
  return A.map((row) => row.reduce((s, a, j) => s + a * x[j], 0));
}

/**
 * Gauss-Jordan 消元（列主元）。
 * 每一行记录 origins：它由哪些原始矩阵行线性组合而来——
 * 出现 0 = 非零 的矛盾行时，即可指出是哪些元件约束互相冲突。
 */
export function gaussJordan(A: number[][], z: number[], n: number): SolveOutcome {
  const m = A.length;
  const M = A.map((row, i) => [...row.map(Number), z[i]]);
  const origins: Set<number>[] = [];
  for (let i = 0; i < m; i++) origins.push(new Set([i]));
  const pivotRow = new Array(n).fill(-1);
  const freeCols: number[] = [];
  let r = 0;

  for (let col = 0; col < n && r < m; col++) {
    let piv = r;
    for (let k = r + 1; k < m; k++) if (Math.abs(M[k][col]) > Math.abs(M[piv][col])) piv = k;
    if (Math.abs(M[piv][col]) < 1e-11) {
      freeCols.push(col);
      continue;
    }
    [M[r], M[piv]] = [M[piv], M[r]];
    [origins[r], origins[piv]] = [origins[piv], origins[r]];
    const d = M[r][col];
    for (let j = 0; j <= n; j++) M[r][j] /= d;
    for (let k = 0; k < m; k++) {
      if (k === r) continue;
      const f = M[k][col];
      if (Math.abs(f) < 1e-13) continue;
      for (let j = 0; j <= n; j++) M[k][j] -= f * M[r][j];
      for (const o of origins[r]) origins[k].add(o);
    }
    pivotRow[col] = r;
    r++;
  }

  const x = new Array(n).fill(0);
  for (let col = 0; col < n; col++) {
    if (pivotRow[col] >= 0) x[col] = M[pivotRow[col]][n];
  }

  const inconsistent: { row: number; rhs: number; origins: number[] }[] = [];
  for (let k = r; k < m; k++) {
    const coefMax = maxAbs(M[k].slice(0, n));
    if (coefMax < 1e-9 && Math.abs(M[k][n]) > 1e-9) {
      inconsistent.push({ row: k, rhs: M[k][n], origins: [...origins[k]].sort((a, b) => a - b) });
    }
  }

  const res = maxAbs(matVec(A, x).map((v, i) => v - z[i]));
  return { x, freeCols, inconsistent, residual: res, usedFallback: true };
}
