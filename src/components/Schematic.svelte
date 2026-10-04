<script lang="ts">
  import { onMount } from 'svelte';
  import { wb } from '../lib/wb.svelte.ts';
  import { SchematicRenderer, type RenderOpts } from '../lib/schematic/renderer';

  let containerEl: HTMLDivElement;
  let renderer: SchematicRenderer | null = null;

  const handleClick: RenderOpts['onCanvasClick'] = (world, target, ev) => {
    const tool = wb.tool;
    if (tool === 'select') {
      if (target?.kind === 'node') {
        wb.selection = { kind: 'node', id: target.id };
        if (ev.dblclick) {
          const n = wb.circuit.nodes.find((x) => x.id === target!.id);
          wb.setGround(n?.ground ? null : target.id);
        }
      } else if (target?.kind === 'comp') {
        wb.selection = { kind: 'comp', id: target.id };
        if (ev.dblclick) wb.flipComp(target.id);
      } else {
        wb.selection = null;
      }
      return;
    }

    if (tool === 'node') {
      if (!target) wb.addNode(world.x, world.y);
      else if (target.kind === 'node') wb.selection = { kind: 'node', id: target.id };
      return;
    }

    // 元件/导线工具：依次点选两个接点，交叉点不是接点
    if (target?.kind !== 'node') {
      wb.pendingNode = null;
      return;
    }
    if (!wb.pendingNode) {
      wb.pendingNode = target.id;
      wb.selection = { kind: 'node', id: target.id };
    } else if (wb.pendingNode === target.id) {
      wb.pendingNode = null;
    } else {
      wb.connect(wb.pendingNode, target.id);
    }
  };

  onMount(() => {
    renderer = new SchematicRenderer(containerEl);
    if (import.meta.env.DEV) {
      (window as unknown as { __renderer?: unknown }).__renderer = renderer;
    }
    const ro = new ResizeObserver(() => renderer?.resize());
    ro.observe(containerEl);

    const onKey = (e: KeyboardEvent) => {
      const tag = (document.activeElement?.tagName ?? '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      if (e.key === 'Escape') {
        wb.pendingNode = null;
        wb.tool = 'select';
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && wb.selection) {
        wb.deleteSelection();
      } else if (e.key.toLowerCase() === 'f' && wb.selection?.kind === 'comp') {
        wb.flipComp(wb.selection.id);
      } else if (e.key.toLowerCase() === 'g' && wb.selection?.kind === 'node') {
        const n = wb.selectedNode;
        wb.setGround(n?.ground ? null : wb.selection.id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      ro.disconnect();
      if (import.meta.env.DEV) delete (window as unknown as { __renderer?: unknown }).__renderer;
      renderer?.destroy();
      renderer = null;
    };
  });

  $effect(() => {
    if (!renderer) return;
    const circuit = wb.circuit;
    // 深订阅：节点位置、元件 t/offset/数值等
    void JSON.stringify(circuit.nodes.map((n) => [n.x, n.y, n.ground, n.name, n.id]));
    void JSON.stringify(circuit.comps.map((c) => [c.id, c.t, c.offset, c.value, c.a, c.b, c.name, c.type]));
    void wb.selection;
    void wb.highlight;
    void wb.pendingNode;
    void wb.tool;
    void wb.result;
    renderer.render(circuit, {
      selection: wb.selection,
      highlight: wb.highlight,
      pendingNodeId: wb.pendingNode,
      result: wb.result,
      tool: wb.tool,
      onCanvasClick: handleClick,
      onNodeDrag: (id, p) => wb.moveNode(id, p.x, p.y),
      onCompDrag: (id, p) => wb.moveComp(id, p.x, p.y),
    });
  });
</script>

<div class="canvas-wrap" bind:this={containerEl}></div>

<style>
  .canvas-wrap {
    width: 100%;
    height: 100%;
    background: radial-gradient(circle, #1c2b45 1px, transparent 1px);
    background-size: 24px 24px;
    background-color: #0f172a;
    overflow: hidden;
  }
</style>
