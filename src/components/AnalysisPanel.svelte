<script lang="ts">
  import { wb } from '../lib/wb.svelte.ts';
  import { fmt } from '../lib/engine/analyze';
  import type { Issue } from '../lib/engine/types';

  let tab = $state<'issues' | 'mna' | 'kcl' | 'power'>('issues');

  $effect(() => {
    if (wb.result.issues.some((i) => i.kind === 'error')) tab = 'issues';
  });

  const result = $derived(wb.result);
  const compName = (id: string) => wb.circuit.comps.find((c) => c.id === id)?.name;
  const nodeName = (id: string) => wb.circuit.nodes.find((n) => n.id === id)?.name;

  function hoverIssue(issue: Issue | null) {
    if (!issue) {
      wb.highlight = { compIds: [], nodeIds: [] };
      return;
    }
    const compIds = issue.refs.filter((id) => wb.circuit.comps.some((c) => c.id === id));
    const nodeIds = issue.refs.filter((id) => wb.circuit.nodes.some((n) => n.id === id));
    wb.highlight = { compIds, nodeIds };
  }

  function clickIssue(issue: Issue) {
    const comp = issue.refs.find((id) => wb.circuit.comps.some((c) => c.id === id));
    const node = issue.refs.find((id) => wb.circuit.nodes.some((n) => n.id === id));
    if (comp) wb.selection = { kind: 'comp', id: comp };
    else if (node) wb.selection = { kind: 'node', id: node };
  }

  // 矩阵单元格悬停溯源
  let activeCell = $state<{ r: number; c: number } | null>(null);
  $effect(() => {
    if (!activeCell || !result.trace) {
      if (!activeCell) wb.highlight = { compIds: [], nodeIds: [] };
      return;
    }
    const t = result.trace[activeCell.r]?.[activeCell.c];
    if (t) wb.highlight = { compIds: t.map((x) => x.compId), nodeIds: [] };
  });

  const errCount = $derived(result.issues.filter((i) => i.kind === 'error').length);
  const warnCount = $derived(result.issues.filter((i) => i.kind === 'warning').length);
</script>

<section class="panel">
  <nav class="tabs">
    <button class:active={tab === 'issues'} onclick={() => (tab = 'issues')}>
      诊断
      {#if errCount > 0}<span class="badge error">{errCount}</span>{/if}
      {#if warnCount > 0}<span class="badge warning">{warnCount}</span>{/if}
      {#if result.ok && errCount === 0 && warnCount === 0}<span class="badge ok">✓</span>{/if}
    </button>
    <button class:active={tab === 'mna'} onclick={() => (tab = 'mna')}>MNA 方程与溯源</button>
    <button class:active={tab === 'kcl'} onclick={() => (tab = 'kcl')}>节点 KCL</button>
    <button class:active={tab === 'power'} onclick={() => (tab = 'power')}>功率平衡</button>
  </nav>

  <div class="content scroll">
    {#if tab === 'issues'}
      <div class="issues">
        {#if result.issues.length === 0}
          <div class="ok-line">✓ 方程可解，未发现结构性问题（残差 {fmt(result.power?.relative ?? 0, 2)} 量级）</div>
        {/if}
        {#each result.issues as issue (issue.code + issue.message)}
          <div
            class="issue {issue.kind}"
            role="button"
            tabindex="0"
            onmouseenter={() => hoverIssue(issue)}
            onmouseleave={() => hoverIssue(null)}
            onclick={() => clickIssue(issue)}
            onkeydown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') clickIssue(issue);
            }}
          >
            <span class="badge {issue.kind}">{issue.kind === 'error' ? '错误' : '警告'}</span>
            <div class="issue-body">
              <div class="msg">{issue.message}</div>
              {#if issue.detail}<div class="detail">{issue.detail}</div>{/if}
              {#if issue.refs.length > 0}
                <div class="refs">
                  关联：
                  {#each issue.refs as ref, k (ref + k)}
                    <span class="ref">{compName(ref) ?? nodeName(ref) ?? ref}</span>
                  {/each}
                </div>
              {/if}
            </div>
          </div>
        {/each}
        {#if !result.ok}
          <div class="edit-note">电路未被修改，所有参数仍可继续编辑；修正后会立即重新求解（不会出现 NaN）。</div>
        {/if}
      </div>
    {:else if tab === 'mna'}
      {#if result.A}
        <div class="mna-wrap">
          <div class="eq-note">
            矩阵形式 <b class="mono">A · x = z</b>。悬停任意系数格可在原理图上高亮贡献该格的元件；每行右侧标注其物理来源。
          </div>
          <table class="matrix" onmouseleave={() => (activeCell = null)}>
            <thead>
              <tr>
                <th></th>
                {#each result.vars as v, j (v.id)}
                  <th class="mono">{v.label}</th>
                {/each}
                <th></th>
                <th></th>
                <th class="left">方程来源</th>
              </tr>
            </thead>
            <tbody>
              {#each result.A as row, i (i)}
                <tr>
                  <td class="rowlabel mono">{result.rows[i]?.label}</td>
                  {#each row as a, j (j)}
                    {@const traces = result.trace?.[i]?.[j]}
                    <td
                      class="cell mono"
                      class:zero={Math.abs(a) < 1e-12}
                      class:traced={!!traces}
                      onmouseenter={() => (activeCell = { r: i, c: j })}
                      title={traces ? traces.map((t) => `${compName(t.compId) ?? t.compId}: ${fmt(t.weight)}`).join('\n') : ''}
                    >
                      {Math.abs(a) < 1e-12 ? '·' : fmt(a)}
                    </td>
                  {/each}
                  <td class="eq mono">=</td>
                  <td class="rhs mono" title={result.rhsTrace?.[i]?.map((t) => `${compName(t.compId) ?? t.compId}: ${fmt(t.weight)}`).join('\n')}>
                    {fmt(result.z![i])}
                  </td>
                  <td class="source">
                    {#if result.rows[i]?.kind === 'kcl'}
                      KCL：所有接出该超节点的支路电流代数和 = 0
                    {:else}
                      电压约束：<b>{compName(result.rows[i]!.refId!)}</b> 两端电位差 = {fmt(result.z![i])} V
                    {/if}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
          <div class="legend">
            <span><i class="dot g"></i> 电导项 G=1/R（电阻）</span>
            <span><i class="dot v"></i> ±1（电压源电流变量/电压约束）</span>
            <span>z 列：电流源注入（KCL 行）或设定电压（约束行）</span>
          </div>
        </div>
      {:else}
        <div class="placeholder">方程未建立：请先解决“诊断”中的错误（电路与参数均保留可编辑）。</div>
      {/if}
    {:else if tab === 'kcl'}
      {#if result.ok}
        <table class="data">
          <thead>
            <tr><th>超节点（零阻收缩后）</th><th>电位 (V)</th><th>KCL 残差 ΣI流出 (A)</th><th>校验</th></tr>
          </thead>
          <tbody>
            {#each result.netKcls as k (k.netId)}
              <tr
                onmouseenter={() => wb.highlight = { compIds: [], nodeIds: k.nodeIds }}
                onmouseleave={() => (wb.highlight = { compIds: [], nodeIds: [] })}
              >
                <td>#{k.netId} {k.nodeIds.map(nodeName).join('=')}{k.netId === result.groundNet ? '（参考地）' : ''}</td>
                <td class="mono">{k.voltage === null ? '—' : fmt(k.voltage)}</td>
                <td class="mono">{k.indeterminate ? '含不唯一零阻电流' : fmt(k.residual)}</td>
                <td>{k.indeterminate ? '—' : Math.abs(k.residual) <= 1e-7 * Math.max(1, k.scale) ? '✓' : '✗'}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      {:else}
        <div class="placeholder">无解：先处理诊断中的约束矛盾。</div>
      {/if}
    {:else if tab === 'power'}
      {#if result.power}
        {@const p = result.power}
        <div class="power">
          <div class="power-sum">
            <div>
              <div class="muted">Σ 所有元件吸收功率（无源符号约定）</div>
              <div class="mono big" class:ok={p.relative < 1e-6} class:bad={p.relative >= 1e-6}>
                {fmt(p.residual)} W
              </div>
              <div class="muted small">相对残差 {p.relative.toExponential(2)}（理论值 0）</div>
            </div>
            <div class="cols">
              <div>
                <h4>发出功率（P吸收 &lt; 0）</h4>
                {#each p.delivered as d (d.compId)}
                  <div class="pow-row" role="presentation" onmouseenter={() => (wb.highlight = { compIds: [d.compId], nodeIds: [] })} onmouseleave={() => (wb.highlight = { compIds: [], nodeIds: [] })}>
                    <span>{d.name}</span><b class="mono neg">{fmt(d.watts)} W</b>
                  </div>
                {/each}
                <div class="pow-row total"><span>合计发出</span><b class="mono">{fmt(p.delivered.reduce((s, x) => s + x.watts, 0))} W</b></div>
              </div>
              <div>
                <h4>吸收功率（电阻等）</h4>
                {#each p.absorbed as d (d.compId)}
                  <div class="pow-row" role="presentation" onmouseenter={() => (wb.highlight = { compIds: [d.compId], nodeIds: [] })} onmouseleave={() => (wb.highlight = { compIds: [], nodeIds: [] })}>
                    <span>{d.name}</span><b class="mono pos">{fmt(d.watts)} W</b>
                  </div>
                {/each}
                <div class="pow-row total"><span>合计吸收</span><b class="mono">{fmt(p.absorbed.reduce((s, x) => s + x.watts, 0))} W</b></div>
              </div>
            </div>
          </div>
        </div>
      {:else}
        <div class="placeholder">无解：功率平衡在求解成功后给出。</div>
      {/if}
    {/if}
  </div>
</section>

<style>
  .panel {
    height: 250px;
    min-height: 180px;
    background: var(--panel);
    border-top: 1px solid var(--line);
    display: flex;
    flex-direction: column;
  }
  .tabs {
    display: flex;
    gap: 2px;
    padding: 6px 8px 0;
    border-bottom: 1px solid var(--line);
  }
  .tabs button {
    border-radius: 6px 6px 0 0;
    border-bottom: none;
    padding: 6px 12px;
    display: flex;
    gap: 6px;
    align-items: center;
  }
  .content {
    flex: 1;
    padding: 10px 12px;
    overflow: auto;
  }
  .issues {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .issue {
    display: flex;
    gap: 10px;
    padding: 8px 10px;
    border-radius: 8px;
    background: var(--panel-2);
    border-left: 3px solid var(--line);
    cursor: pointer;
  }
  .issue.error {
    border-left-color: var(--err);
  }
  .issue.warning {
    border-left-color: var(--warn);
  }
  .msg {
    font-weight: 600;
  }
  .detail {
    color: var(--muted);
    margin-top: 3px;
    line-height: 1.5;
  }
  .refs {
    margin-top: 5px;
    color: var(--muted);
    font-size: 11.5px;
  }
  .ref {
    background: #0f1c30;
    padding: 1px 7px;
    border-radius: 9px;
    margin-right: 4px;
    color: #bfdbfe;
  }
  .ok-line {
    color: var(--ok);
    font-weight: 600;
  }
  .edit-note {
    color: var(--muted);
    font-size: 11.5px;
    margin-top: 4px;
  }
  .mna-wrap {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .eq-note {
    color: var(--muted);
  }
  table.matrix {
    border-collapse: separate;
    border-spacing: 0;
  }
  .matrix th,
  .matrix td {
    padding: 3px 9px;
    text-align: center;
    min-width: 58px;
  }
  .matrix thead th {
    color: #7dd3fc;
    border-bottom: 1px solid var(--line);
  }
  .cell.traced {
    background: rgba(56, 189, 248, 0.08);
    border-radius: 4px;
    cursor: help;
  }
  .cell.traced:hover {
    background: rgba(244, 114, 182, 0.22);
  }
  .cell.zero {
    color: #475569;
  }
  .rowlabel {
    text-align: right !important;
    color: var(--muted);
    padding-right: 10px;
    white-space: nowrap;
  }
  .left {
    text-align: left !important;
  }
  .source {
    color: var(--muted);
    text-align: left;
    white-space: nowrap;
    padding-left: 14px;
  }
  .eq {
    color: var(--muted);
  }
  .rhs {
    color: #fcd34d;
  }
  .legend {
    display: flex;
    gap: 18px;
    color: var(--muted);
    font-size: 11.5px;
    margin-top: 4px;
  }
  .dot {
    display: inline-block;
    width: 9px;
    height: 9px;
    border-radius: 2px;
    margin-right: 4px;
  }
  .dot.g {
    background: #7dd3fc;
  }
  .dot.v {
    background: #f0abfc;
  }
  table.data {
    border-collapse: collapse;
  }
  table.data th,
  table.data td {
    border: 1px solid var(--line);
    padding: 5px 12px;
    text-align: left;
  }
  table.data tbody tr:hover {
    background: var(--panel-2);
  }
  .placeholder {
    color: var(--muted);
    padding: 8px;
  }
  .power-sum {
    display: flex;
    gap: 30px;
    align-items: flex-start;
  }
  .big {
    font-size: 22px;
  }
  .ok {
    color: var(--ok);
  }
  .bad {
    color: var(--err);
  }
  .cols {
    display: flex;
    gap: 40px;
  }
  .cols h4 {
    margin: 0 0 6px;
  }
  .pow-row {
    display: flex;
    justify-content: space-between;
    gap: 24px;
    padding: 2px 6px;
    border-radius: 5px;
  }
  .pow-row:hover {
    background: var(--panel-2);
  }
  .pow-row.total {
    border-top: 1px solid var(--line);
    margin-top: 4px;
    font-weight: 700;
  }
  .pos {
    color: var(--ok);
  }
  .neg {
    color: var(--err);
  }
  .muted {
    color: var(--muted);
  }
  .small {
    font-size: 11px;
  }
</style>
