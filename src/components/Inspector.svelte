<script lang="ts">
  import { wb } from '../lib/wb.svelte.ts';
  import { TYPE_LABEL, UNIT } from '../lib/factory';
  import { fmt } from '../lib/engine/analyze';

  const c = $derived(wb.selectedComp);
  const n = $derived(wb.selectedNode);
  const nodeName = (id: string) => wb.circuit.nodes.find((x) => x.id === id)?.name ?? '?';
  const branchOf = (id: string) => wb.result.branches.find((b) => b.compId === id);

  let valueDraft = $state('');
  $effect(() => {
    if (c) valueDraft = String(c.value);
  });

  function commitValue() {
    if (!c) return;
    const v = Number(valueDraft);
    if (Number.isFinite(v)) {
      const val = c.type === 'R' && v < 0 ? 0 : v;
      wb.updateComp(c.id, { value: val });
    } else {
      valueDraft = String(c.value);
    }
  }
</script>

<aside class="inspector">
  {#if c}
    <h3>{TYPE_LABEL[c.type]} <span class="muted">{c.name}</span></h3>

    <label class="field">
      <span>名称</span>
      <input value={c.name} oninput={(e) => wb.updateComp(c.id, { name: e.currentTarget.value })} />
    </label>

    {#if c.type !== 'wire'}
      <label class="field">
        <span>{c.type === 'R' ? '电阻 (Ω)' : c.type === 'V' ? '电压 (V)' : '电流 (A)'}</span>
        <input value={valueDraft} oninput={(e) => (valueDraft = e.currentTarget.value)} onchange={commitValue} />
      </label>
    {/if}

    <div class="polarity">
      <div>
        <div class="muted small">参考方向约定（全程一致）</div>
        <div class="mono dir">
          {nodeName(c.a)}
          {#if c.type === 'V'}<span class="plus">(+)</span>{/if}
          →
          {nodeName(c.b)}
          {#if c.type === 'V'}<span class="minus">(−)</span>{/if}
        </div>
        <div class="small muted">
          {c.type === 'V'
            ? '电压 V = Va − Vb；电流正方向 a→b（从 + 端流出时源在发出功率）'
            : c.type === 'I'
              ? `电流 a→b 为正方向（箭头），值为 ${fmt(c.value)} A`
              : '电流正方向 a→b；欧姆定律 I = (Va − Vb) / R'}
        </div>
      </div>
      <button title="反转极性 / 参考方向（快捷键 F）" onclick={() => wb.flipComp(c.id)}>⇄ 翻转极性</button>
    </div>

    {@const br = branchOf(c.id)}
    {#if br && wb.result.ok}
      <div class="results box">
        <div><span class="muted">Va</span><b class="mono">{fmt(br.va)} V</b></div>
        <div><span class="muted">Vb</span><b class="mono">{fmt(br.vb)} V</b></div>
        <div><span class="muted">V = Va−Vb</span><b class="mono">{fmt(br.v)} V</b></div>
        <div>
          <span class="muted">I (a→b)</span>
          {#if br.i === null}
            <b class="mono warn">不唯一</b>
          {:else}
            <b class="mono" style:color={br.i > 0 ? 'var(--current-red,#f87171)' : '#60a5fa'}>{fmt(br.i)} A</b>
          {/if}
        </div>
        <div>
          <span class="muted">吸收功率</span>
          {#if br.absorbed === null}
            <b class="mono warn">—</b>
          {:else}
            <b class="mono" class:pos={br.absorbed >= 0} class:neg={br.absorbed < 0}>
              {fmt(br.absorbed)} W {br.absorbed < 0 ? '（发出）' : '（吸收）'}
            </b>
          {/if}
        </div>
        {#if br.note}<div class="small muted">{br.note}</div>{/if}
      </div>
    {/if}

    <button class="danger" onclick={() => wb.deleteSelection()}>删除元件</button>
  {:else if n}
    <h3>接点 <span class="muted">{n.ground ? 'GND' : n.name}</span></h3>
    <label class="field">
      <span>名称</span>
      <input value={n.name} oninput={(e) => wb.updateNode(n.id, { name: e.currentTarget.value })} />
    </label>
    <label class="ground-row">
      <input type="checkbox" checked={n.ground} onchange={() => wb.setGround(n.ground ? null : n.id)} />
      <span>设为参考地（0 V，全电路唯一）</span>
    </label>
    <div class="small muted">双击接点或按 G 键可切换接地。参考地必须由用户明确设置。</div>
    {#if wb.result.ok}
      {@const net = wb.result.netOf?.[n.id]}
      {@const kcl = net !== undefined ? wb.result.netKcls.find((k) => k.netId === net) : null}
      <div class="box results">
        <div><span class="muted">收缩网络 #{net}</span></div>
        <div>
          <span class="muted">电位</span>
          <b class="mono">{n.ground ? '0 V' : kcl && kcl.voltage !== null ? `${fmt(kcl.voltage)} V` : '—'}</b>
        </div>
        <div>
          <span class="muted">KCL 残差</span>
          <b class="mono" style:color={Math.abs(kcl?.residual ?? 0) > 1e-7 * Math.max(1, kcl?.scale ?? 1) ? 'var(--err)' : 'var(--ok)'}>
            {fmt(kcl?.residual ?? 0)} A
          </b>
        </div>
        {#if (wb.result.netNodeIds?.[net ?? -1]?.length ?? 0) > 1}
          <div class="small muted">
            等电位接点：{wb.result.netNodeIds![net!].map(nodeName).join('、')}（零电阻收缩）
          </div>
        {/if}
      </div>
    {/if}
    <button class="danger" onclick={() => wb.deleteSelection()}>删除接点（连同其元件）</button>
  {:else}
    <div class="hint">
      <h3>检查器</h3>
      <p>未选中对象。用工具栏放置元件，或在画布中点选元件 / 接点查看参数与求解量。</p>
      <ul>
        <li><b>接点</b>：N 或“接点”工具，在空白处单击</li>
        <li><b>元件</b>：选 R/V/I/导线工具后，依次点两个接点（交叉不产生接点）</li>
        <li><b>参考地</b>：选中接点勾选，或双击 / 按 G</li>
        <li><b>拖动</b>：拖动元件图形只移动符号位置，不改连接；拖接点移动整网几何</li>
        <li><b>极性</b>：双击元件或选中后按 F 翻转</li>
        <li><b>缩放/平移</b>：滚轮缩放，拖空白处平移</li>
      </ul>
    </div>
  {/if}
</aside>

<style>
  .inspector {
    width: 300px;
    min-width: 300px;
    background: var(--panel);
    border-left: 1px solid var(--line);
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    overflow-y: auto;
  }
  h3 {
    margin: 0 0 2px;
    font-size: 14px;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .field span {
    color: var(--muted);
    font-size: 11.5px;
  }
  .ground-row {
    display: flex;
    gap: 8px;
    align-items: center;
  }
  .ground-row input {
    width: auto;
  }
  .polarity {
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 9px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    background: var(--panel-2);
  }
  .dir {
    margin: 4px 0;
    font-size: 13px;
  }
  .plus {
    color: var(--warn);
  }
  .minus {
    color: #60a5fa;
  }
  .box {
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 9px;
    background: #172133;
  }
  .results {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }
  .results div {
    display: flex;
    justify-content: space-between;
  }
  .pos {
    color: var(--ok);
  }
  .neg {
    color: var(--err);
  }
  .warn {
    color: var(--warn);
  }
  .muted {
    color: var(--muted);
  }
  .small {
    font-size: 11px;
    line-height: 1.5;
  }
  .hint ul {
    padding-left: 16px;
    line-height: 1.9;
    color: var(--muted);
  }
  .danger {
    margin-top: auto;
  }
</style>
