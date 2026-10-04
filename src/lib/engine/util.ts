import type { Circuit, Comp } from './types';

/** 并查集：用于把零电阻支路（理想导线 / 0Ω 电阻）收缩成超节点 net */
export class DSU {
  private parent = new Map<string, string>();

  add(x: string) {
    if (!this.parent.has(x)) this.parent.set(x, x);
  }

  find(x: string): string {
    let r = x;
    while (this.parent.get(r) !== r) r = this.parent.get(r)!;
    let cur = x;
    while (this.parent.get(cur) !== cur) {
      const next = this.parent.get(cur)!;
      this.parent.set(cur, r);
      cur = next;
    }
    return r;
  }

  union(a: string, b: string) {
    this.add(a);
    this.add(b);
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(rb, ra);
  }
}

export const isConductive = (c: Comp) => c.type === 'R' || c.type === 'V';

/** 校验数值合法性：非有限值（NaN/Infinity）或负数电阻 */
export function checkValues(c: Comp): string | null {
  if (!Number.isFinite(c.value)) return c.id;
  if (c.type === 'R' && c.value < 0) return c.id;
  return null;
}
