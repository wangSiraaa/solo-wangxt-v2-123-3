import type { Circuit, Comp } from './engine/types';

export interface Pt {
  x: number;
  y: number;
}

export interface CompGeom {
  comp: Comp;
  A: Pt;
  B: Pt;
  C: Pt; // 主体中心
  angle: number; // a→b 方向角（元件局部 +x）
  u: Pt;
  n: Pt;
  L: number;
  halfW: number;
  halfH: number;
  bodyA: Pt; // 主体 a 侧端子
  bodyB: Pt;
  leads: [Pt, Pt][]; // 引线线段（A→bodyA, bodyB→B），交叉检测只看引线
}

const BODY_W: Record<Comp['type'], number> = { R: 48, V: 52, I: 52, wire: 0 };
const BODY_HALFH: Record<Comp['type'], number> = { R: 12, V: 19, I: 19, wire: 0 };
export const BODY_SIZE = { w: BODY_W, halfH: BODY_HALFH };

export function compGeom(comp: Comp, A: Pt, B: Pt): CompGeom {
  const dx = B.x - A.x;
  const dy = B.y - A.y;
  const L = Math.hypot(dx, dy) || 1;
  const u = { x: dx / L, y: dy / L };
  const n = { x: -u.y, y: u.x };
  const t = Math.min(0.92, Math.max(0.08, comp.t));
  const C = { x: A.x + u.x * t * L + n.x * comp.offset, y: A.y + u.y * t * L + n.y * comp.offset };
  const halfW = BODY_W[comp.type] / 2;
  const halfH = BODY_HALFH[comp.type];
  const bodyA = { x: C.x - u.x * halfW, y: C.y - u.y * halfW };
  const bodyB = { x: C.x + u.x * halfW, y: C.y + u.y * halfW };
  return {
    comp,
    A,
    B,
    C,
    angle: Math.atan2(dy, dx),
    u,
    n,
    L,
    halfW,
    halfH,
    bodyA,
    bodyB,
    leads:
      comp.type === 'wire'
        ? [[A, B]]
        : [
            [A, bodyA],
            [bodyB, B],
          ],
  };
}

export function allGeoms(circuit: Circuit): Map<string, CompGeom> {
  const nodePt = new Map(circuit.nodes.map((nd) => [nd.id, { x: nd.x, y: nd.y }]));
  const m = new Map<string, CompGeom>();
  for (const c of circuit.comps) {
    const A = nodePt.get(c.a);
    const B = nodePt.get(c.b);
    if (A && B) m.set(c.id, compGeom(c, A, B));
  }
  return m;
}

export function segIntersect(a: Pt, b: Pt, c: Pt, d: Pt): Pt | null {
  const den = (b.x - a.x) * (d.y - c.y) - (b.y - a.y) * (d.x - c.x);
  if (Math.abs(den) < 1e-9) return null;
  const tt = ((c.x - a.x) * (d.y - c.y) - (c.y - a.y) * (d.x - c.x)) / den;
  const uu = ((c.x - a.x) * (b.y - a.y) - (c.y - a.y) * (b.x - a.x)) / den;
  if (tt > 0.05 && tt < 0.95 && uu > 0.05 && uu < 0.95) {
    return { x: a.x + tt * (b.x - a.x), y: a.y + tt * (b.y - a.y) };
  }
  return null;
}

const near = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y) < 12;

/**
 * 交叉不导通：两条无公共接点的引线相交时，在其中一侧画跳线弧。
 * 返回 compId → 该元件引线上需要跳线的交点（弧线沿引线法向隆起）。
 */
export function crossingsOf(circuit: Circuit): Map<string, { point: Pt; normal: Pt }[]> {
  const geoms = [...allGeoms(circuit).values()];
  const result = new Map<string, { point: Pt; normal: Pt }[]>();
  const add = (id: string, point: Pt, normal: Pt) => {
    const list = result.get(id) ?? [];
    if (!list.some((h) => near(h.point, point))) list.push({ point, normal });
    result.set(id, list);
  };
  for (let i = 0; i < geoms.length; i++) {
    for (let j = i + 1; j < geoms.length; j++) {
      const g1 = geoms[i];
      const g2 = geoms[j];
      // 共享端点（同一接点）不算交叉
      const shared =
        near(g1.A, g2.A) || near(g1.A, g2.B) || near(g1.B, g2.A) || near(g1.B, g2.B);
      if (shared) continue;
      for (const [p, q] of g1.leads) {
        for (const [r, s] of g2.leads) {
          const hit = segIntersect(p, q, r, s);
          if (!hit) continue;
          add(g1.comp.id, hit, g1.n); // 固定在 g1 一侧画跳线
        }
      }
    }
  }
  return result;
}

/** 命中测试：点是否落在主体附近（用于选中/拖动） */
export function hitBody(g: CompGeom, p: Pt, pad = 8): boolean {
  if (g.comp.type === 'wire') return false;
  const dx = p.x - g.C.x;
  const dy = p.y - g.C.y;
  const along = Math.abs(dx * g.u.x + dy * g.u.y);
  const perp = Math.abs(dx * g.n.x + dy * g.n.y);
  return along <= g.halfW + pad && perp <= g.halfH + pad;
}
