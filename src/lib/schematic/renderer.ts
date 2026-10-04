import Konva from 'konva';
import type { AnalysisResult, BranchResult, Circuit, Node } from '../engine/types';
import { BODY_SIZE, allGeoms, crossingsOf, hitBody, type CompGeom, type Pt } from '../geometry';
import { fmt } from '../engine/analyze';

export interface RenderOpts {
  selection: { kind: 'node' | 'comp'; id: string } | null;
  highlight: { compIds: string[]; nodeIds: string[] };
  pendingNodeId: string | null;
  result: AnalysisResult;
  tool: string;
  onCanvasClick: (world: Pt, target: { kind: 'node' | 'comp'; id: string } | null, evt: { dblclick: boolean }) => void;
  onNodeDrag: (id: string, world: Pt, ended: boolean) => void;
  onCompDrag: (id: string, worldCenter: Pt, ended: boolean) => void;
}

const COL = {
  lead: '#cbd5e1',
  wire: '#e2e8f0',
  body: '#f1f5f9',
  node: '#f8fafc',
  ground: '#fbbf24',
  sel: '#f59e0b',
  hl: '#f472b6',
  pending: '#fbbf24',
  currentPos: '#ef4444',
  currentNeg: '#60a5fa',
  vlabel: '#4ade80',
  arcMask: '#0f172a',
};

export class SchematicRenderer {
  stage: Konva.Stage;
  private leadLayer = new Konva.Layer();
  private crossLayer = new Konva.Layer();
  private bodyLayer = new Konva.Layer();
  private nodeLayer = new Konva.Layer();
  private labelLayer = new Konva.Layer();
  private overlayLayer = new Konva.Layer();
  private nodeById = new Map<string, Konva.Group>();
  private bodyById = new Map<string, Konva.Group>();
  dragging: { kind: 'node' | 'comp'; id: string } | null = null;
  private opts: RenderOpts | null = null;
  private circuit: Circuit | null = null;
  private downPos: Pt | null = null;
  private stageMoved = false;

  constructor(container: HTMLDivElement) {
    this.stage = new Konva.Stage({
      container,
      width: container.clientWidth,
      height: container.clientHeight,
      draggable: true,
    });
    this.stage.add(this.leadLayer, this.crossLayer, this.bodyLayer, this.nodeLayer, this.labelLayer, this.overlayLayer);

    // 空白平移后单击不触发放置
    this.stage.on('mousedown.evt', () => {
      this.downPos = this.worldFromPointer();
      this.stageMoved = false;
    });
    this.stage.on('dragmove.evt', () => {
      if (this.downPos) {
        const w = this.worldFromPointer();
        if (Math.hypot(w.x - this.downPos.x, w.y - this.downPos.y) > 4) this.stageMoved = true;
      }
    });
    this.stage.on('click.evt', (e) => {
      if (e.target === this.stage && !this.stageMoved) {
        this.opts?.onCanvasClick(this.worldFromPointer(), null, { dblclick: false });
      }
    });
    this.stage.on('dblclick.evt', (e) => {
      if (e.target === this.stage && !this.stageMoved) {
        this.opts?.onCanvasClick(this.worldFromPointer(), null, { dblclick: true });
      }
    });
    this.stage.on('wheel', (e) => {
      e.evt.preventDefault();
      const scaleBy = 1.12;
      const old = this.stage.scaleX();
      const pointer = this.stage.getPointerPosition();
      if (!pointer) return;
      const before = { x: pointer.x / old - this.stage.x() / old, y: pointer.y / old - this.stage.y() / old };
      const s = Math.min(2.4, Math.max(0.35, e.evt.deltaY < 0 ? old * scaleBy : old / scaleBy));
      this.stage.scale({ x: s, y: s });
      this.stage.position({ x: pointer.x - before.x * s, y: pointer.y - before.y * s });
      this.stage.batchDraw();
    });
  }

  resize() {
    const el = this.stage.container();
    this.stage.width(el.clientWidth);
    this.stage.height(el.clientHeight);
    this.stage.batchDraw();
  }

  private worldFromPointer(): Pt {
    const p = this.stage.getPointerPosition() ?? { x: 0, y: 0 };
    const s = this.stage.scaleX();
    return { x: (p.x - this.stage.x()) / s, y: (p.y - this.stage.y()) / s };
  }

  /** 统一渲染入口；拖动中只做增量刷新（引线/跳线/叠加层） */
  render(circuit: Circuit, opts: RenderOpts) {
    this.opts = opts;
    this.circuit = circuit;
    if (this.dragging) this.syncDrag(circuit);
    else this.fullRender(circuit, opts);
  }

  private syncDrag(circuit: Circuit) {
    this.leadLayer.destroyChildren();
    const geoms = allGeoms(circuit);
    for (const [, g] of geoms) {
      for (const [p, q] of g.leads) {
        this.leadLayer.add(
          new Konva.Line({
            points: [p.x, p.y, q.x, q.y],
            stroke: g.comp.type === 'wire' ? COL.wire : COL.lead,
            strokeWidth: 2.2,
            listening: false,
          }),
        );
      }
    }
    // 节点拖动时，让非拖动中的元件主体跟随几何，避免引线拉伸/松手跳变
    if (this.dragging?.kind === 'node') {
      for (const [id, g] of geoms) {
        const grp = this.bodyById.get(id);
        if (grp) {
          grp.x(g.C.x);
          grp.y(g.C.y);
          grp.rotation((g.angle * 180) / Math.PI);
        }
      }
    }
    this.rebuildCrossings(geoms);
    this.rebuildOverlays(circuit, geoms);
    this.leadLayer.batchDraw();
    this.bodyLayer.batchDraw();
    this.crossLayer.batchDraw();
    this.overlayLayer.batchDraw();
  }

  private fullRender(circuit: Circuit, opts: RenderOpts) {
    for (const layer of [this.leadLayer, this.crossLayer, this.bodyLayer, this.nodeLayer, this.labelLayer, this.overlayLayer]) {
      layer.destroyChildren();
    }
    this.nodeById.clear();
    this.bodyById.clear();

    const geoms = allGeoms(circuit);
    for (const [, g] of geoms) {
      for (const [p, q] of g.leads) {
        this.leadLayer.add(
          new Konva.Line({
            points: [p.x, p.y, q.x, q.y],
            stroke: g.comp.type === 'wire' ? COL.wire : COL.lead,
            strokeWidth: g.comp.type === 'wire' ? 2 : 2.2,
          }),
        );
      }
    }
    this.rebuildCrossings(geoms);

    for (const [, g] of geoms) {
      const grp = this.makeBody(g, opts);
      this.bodyLayer.add(grp);
      this.bodyById.set(g.comp.id, grp);
    }

    for (const nd of circuit.nodes) {
      const grp = new Konva.Group({ x: nd.x, y: nd.y, draggable: true });
      const dot = new Konva.Circle({ radius: 6, fill: COL.node, stroke: '#0f172a', strokeWidth: 1.5 });
      grp.add(dot);
      if (nd.ground) {
        for (const [w, dy] of [
          [22, 11],
          [15, 16],
          [8, 21],
        ]) {
          grp.add(new Konva.Line({ points: [-w / 2, dy, w / 2, dy], stroke: COL.ground, strokeWidth: 2.4, listening: false }));
        }
      }
      grp.add(new Konva.Circle({ radius: 14 })); // 透明命中区
      grp.on('click dblclick', (e) => {
        e.cancelBubble = true;
        opts.onCanvasClick({ x: nd.x, y: nd.y }, { kind: 'node', id: nd.id }, { dblclick: e.type === 'dblclick' });
      });
      grp.on('dragstart', () => {
        this.dragging = { kind: 'node', id: nd.id };
      });
      grp.on('dragmove', () => opts.onNodeDrag(nd.id, { x: grp.x(), y: grp.y() }, false));
      grp.on('dragend', () => {
        opts.onNodeDrag(nd.id, { x: grp.x(), y: grp.y() }, true);
        this.dragging = null;
        if (this.circuit) this.fullRender(this.circuit, opts);
      });
      this.nodeLayer.add(grp);
      this.nodeById.set(nd.id, grp);
    }

    // 元件名值标签（屏幕水平方向）
    for (const [, g] of geoms) {
      if (g.comp.type === 'wire') continue;
      const unit = g.comp.type === 'R' ? 'Ω' : g.comp.type === 'V' ? 'V' : 'A';
      const label = `${g.comp.name}  ${fmt(g.comp.value)}${unit}`;
      const up = g.comp.offset >= 0 ? 1 : -1;
      this.labelLayer.add(
        new Konva.Text({
          x: g.C.x - 50,
          y: g.C.y + (up > 0 ? g.halfH + 4 : -g.halfH - 16),
          width: 100,
          align: 'center',
          text: label,
          fontSize: 11.5,
          fontStyle: 'bold',
          fill: '#cbd5e1',
          listening: false,
        }),
      );
      // 元件端点名（a/b 极性提示）
      this.labelLayer.add(
        new Konva.Text({
          x: g.bodyA.x - 16,
          y: g.bodyA.y - 22,
          width: 14,
          align: 'center',
          text: g.comp.type === 'V' ? '+' : '',
          fontSize: 13,
          fontStyle: 'bold',
          fill: '#fde68a',
          listening: false,
        }),
        new Konva.Text({
          x: g.bodyB.x + 2,
          y: g.bodyB.y - 22,
          width: 14,
          align: 'center',
          text: g.comp.type === 'V' ? '−' : '',
          fontSize: 13,
          fontStyle: 'bold',
          fill: '#fde68a',
          listening: false,
        }),
      );
    }
    for (const nd of circuit.nodes) {
      if (nd.ground) continue;
      this.labelLayer.add(
        new Konva.Text({
          x: nd.x - 40,
          y: nd.y - 30,
          width: 80,
          align: 'center',
          text: nd.name,
          fontSize: 12,
          fontStyle: 'bold',
          fill: '#93c5fd',
          listening: false,
        }),
      );
    }

    this.rebuildOverlays(circuit, geoms);
    this.applySelection(opts);
    for (const layer of [this.leadLayer, this.crossLayer, this.bodyLayer, this.nodeLayer, this.labelLayer, this.overlayLayer]) {
      layer.batchDraw();
    }
  }

  private rebuildCrossings(geoms: Map<string, CompGeom>) {
    this.crossLayer.destroyChildren();
    const circuit = this.circuit!;
    const crossings = crossingsOf(circuit);
    for (const [compId, hits] of crossings) {
      const g = geoms.get(compId);
      if (!g) continue;
      for (const h of hits) {
        let dir: Pt = g.u;
        for (const [p, q] of g.leads) {
          const v = { x: q.x - p.x, y: q.y - p.y };
          const L = Math.hypot(v.x, v.y);
          const tp = ((h.point.x - p.x) * v.x + (h.point.y - p.y) * v.y) / (L * L);
          if (tp > 0.05 && tp < 0.95) {
            dir = { x: v.x / L, y: v.y / L };
            break;
          }
        }
        const nrm = { x: -dir.y, y: dir.x };
        const R = 13;
        const amp = 9;
        const pts: number[] = [];
        for (let k = 0; k <= 18; k++) {
          const t = -R + (2 * R * k) / 18;
          const bump = amp * (1 - (t / R) ** 2);
          pts.push(h.point.x + dir.x * t + nrm.x * bump, h.point.y + dir.y * t + nrm.y * bump);
        }
        this.crossLayer.add(
          new Konva.Line({ points: pts, stroke: COL.arcMask, strokeWidth: 7, lineCap: 'round', listening: false }),
          new Konva.Line({
            points: pts,
            stroke: g.comp.type === 'wire' ? COL.wire : COL.lead,
            strokeWidth: 2.2,
            lineCap: 'round',
            listening: false,
          }),
        );
      }
    }
    this.crossLayer.batchDraw();
  }

  private rebuildOverlays(circuit: Circuit, geoms: Map<string, CompGeom>) {
    const opts = this.opts!;
    this.overlayLayer.destroyChildren();
    const brOf = new Map<string, BranchResult>(opts.result.branches.map((b): [string, BranchResult] => [b.compId, b]));

    // 电流方向：约定 a→b 为正。i>0 时电流从 a 端流出（画在 a 侧引线，背离主体指向 a）；
    // i<0 时画在 b 侧指向 b。红=参考正方向，蓝=反向
    for (const [, g] of geoms) {
      if (g.comp.type === 'wire') continue;
      const br = brOf.get(g.comp.id);
      if (!br || br.i === null || Math.abs(br.i) < 1e-9) continue;
      const bodyEnd = br.i > 0 ? g.bodyA : g.bodyB;
      const nodeEnd = br.i > 0 ? g.A : g.B;
      const v = { x: nodeEnd.x - bodyEnd.x, y: nodeEnd.y - bodyEnd.y };
      const L = Math.hypot(v.x, v.y);
      if (L < 22) continue;
      const u = { x: v.x / L, y: v.y / L };
      const d = Math.min(24, L * 0.42);
      const mx = bodyEnd.x + u.x * d;
      const my = bodyEnd.y + u.y * d;
      const color = br.i > 0 ? COL.currentPos : COL.currentNeg;
      this.overlayLayer.add(
        new Konva.Arrow({
          points: [mx - u.x * 8, my - u.y * 8, mx + u.x * 9, my + u.y * 9],
          pointerLength: 9,
          pointerWidth: 8,
          fill: color,
          stroke: color,
          strokeWidth: 2.4,
          listening: false,
        }),
      );
    }

    // 节点电位
    for (const nd of circuit.nodes) {
      const net = opts.result.netOf?.[nd.id];
      if (net === undefined || net === null || nd.ground) continue;
      const kcl = opts.result.netKcls.find((k: { netId: number }) => k.netId === net);
      if (!kcl || kcl.voltage === null) continue;
      this.overlayLayer.add(
        new Konva.Text({
          x: nd.x + 11,
          y: nd.y - 7,
          text: `${fmt(kcl.voltage)}V`,
          fontSize: 11.5,
          fill: COL.vlabel,
          fontStyle: 'bold',
          listening: false,
        }),
      );
    }

    if (opts.pendingNodeId) {
      const nd = circuit.nodes.find((n) => n.id === opts.pendingNodeId);
      if (nd) {
        this.overlayLayer.add(
          new Konva.Ring({
            x: nd.x,
            y: nd.y,
            innerRadius: 10,
            outerRadius: 15,
            stroke: COL.pending,
            strokeWidth: 2,
            dash: [4, 3],
            listening: false,
          }),
        );
      }
    }

    for (const id of opts.highlight.nodeIds) {
      const nd: Node | undefined = circuit.nodes.find((n: Node) => n.id === id);
      if (nd) {
        this.overlayLayer.add(
          new Konva.Circle({ x: nd.x, y: nd.y, radius: 13, stroke: COL.hl, strokeWidth: 2.5, listening: false }),
        );
      }
    }
    for (const id of opts.highlight.compIds) {
      const g = geoms.get(id);
      if (!g) continue;
      const w = g.halfW * 2 + 12;
      const h = g.halfH * 2 + 12;
      this.overlayLayer.add(
        new Konva.Rect({
          x: g.C.x,
          y: g.C.y,
          width: w,
          height: h,
          offset: { x: w / 2, y: h / 2 },
          rotation: (g.angle * 180) / Math.PI,
          stroke: COL.hl,
          strokeWidth: 2,
          cornerRadius: 4,
          listening: false,
        }),
      );
    }
    this.overlayLayer.batchDraw();
  }

  private makeBody(g: CompGeom, opts: RenderOpts): Konva.Group {
    const grp = new Konva.Group({ x: g.C.x, y: g.C.y, rotation: (g.angle * 180) / Math.PI, draggable: true });
    const c = g.comp;
    if (c.type === 'R') {
      if (c.value === 0) {
        grp.add(
          new Konva.Rect({
            x: -g.halfW,
            y: -g.halfH,
            width: g.halfW * 2,
            height: g.halfH * 2,
            stroke: COL.body,
            strokeWidth: 2,
            dash: [5, 3],
          }),
          new Konva.Text({ x: -7, y: -8, text: '0', fontSize: 12, fill: COL.body, listening: false }),
        );
      } else {
        const zig: number[] = [];
        const steps = 8;
        for (let k = 0; k <= steps; k++) {
          const x = -g.halfW + (2 * g.halfW * k) / steps;
          const y = k === 0 || k === steps ? 0 : k % 2 ? g.halfH - 2 : -(g.halfH - 2);
          zig.push(x, y);
        }
        grp.add(new Konva.Line({ points: zig, stroke: COL.body, strokeWidth: 2.2, lineJoin: 'round' }));
      }
    } else if (c.type === 'V' || c.type === 'I') {
      const r = c.type === 'V' ? BODY_SIZE.halfH.V : BODY_SIZE.halfH.I;
      grp.add(new Konva.Circle({ radius: r, stroke: COL.body, strokeWidth: 2.2 }));
      if (c.type === 'V') {
        grp.add(
          new Konva.Text({ x: -r + 5, y: -8, text: '+', fontSize: 15, fontStyle: 'bold', fill: COL.body, listening: false }),
          new Konva.Text({ x: r - 13, y: -8, text: '−', fontSize: 15, fontStyle: 'bold', fill: COL.body, listening: false }),
        );
      } else {
        grp.add(
          new Konva.Arrow({
            points: [-r + 6, 0, r - 6, 0],
            pointerLength: 8,
            pointerWidth: 8,
            fill: COL.body,
            stroke: COL.body,
            strokeWidth: 2,
            listening: false,
          }),
        );
      }
    }
    grp.on('mouseenter', () => (this.stage.container().style.cursor = 'move'));
    grp.on('mouseleave', () => (this.stage.container().style.cursor = 'default'));
    grp.on('click dblclick', (e) => {
      e.cancelBubble = true;
      opts.onCanvasClick(g.C, { kind: 'comp', id: c.id }, { dblclick: e.type === 'dblclick' });
    });
    grp.on('dragstart', () => {
      this.dragging = { kind: 'comp', id: c.id };
    });
    grp.on('dragmove', () => {
      // group 位于缩放后的 stage 中，但 x()/y() 是其父级（世界）坐标
      opts.onCompDrag(c.id, { x: grp.x(), y: grp.y() }, false);
    });
    grp.on('dragend', () => {
      opts.onCompDrag(c.id, { x: grp.x(), y: grp.y() }, true);
      this.dragging = null;
      if (this.circuit) this.fullRender(this.circuit, opts);
    });
    return grp;
  }

  private applySelection(opts: RenderOpts) {
    for (const [id, grp] of this.nodeById) {
      const dot = grp.children[0] as Konva.Circle;
      const selected = opts.selection?.kind === 'node' && opts.selection.id === id;
      const highlighted = opts.highlight.nodeIds.includes(id);
      dot.stroke(selected ? COL.sel : highlighted ? COL.hl : '#0f172a');
      dot.strokeWidth(selected || highlighted ? 3 : 1.5);
    }
    for (const [id, grp] of this.bodyById) {
      const selected = opts.selection?.kind === 'comp' && opts.selection.id === id;
      const highlighted = opts.highlight.compIds.includes(id);
      const color = selected ? COL.sel : highlighted ? COL.hl : COL.body;
      grp.find('Circle,Line,Rect,Arrow').forEach((shape) => {
        if ((shape as Konva.Shape).stroke) (shape as Konva.Shape).stroke(color);
      });
    }
  }

  /** 供外部（选择工具）做命中 */
  pick(circuit: Circuit, world: Pt): { kind: 'node' | 'comp'; id: string } | null {
    for (const n of circuit.nodes) {
      if (Math.hypot(n.x - world.x, n.y - world.y) < 12) return { kind: 'node', id: n.id };
    }
    for (const [, g] of allGeoms(circuit)) {
      if (hitBody(g, world)) return { kind: 'comp', id: g.comp.id };
    }
    return null;
  }

  destroy() {
    this.stage.destroy();
  }
}
