<script lang="ts">
  import { wb } from '../lib/wb.svelte.ts';
  import {
    exportProject,
    exportFileName,
    parseProject,
    type ParseResult,
  } from '../lib/projectIO';

  let fileInput: HTMLInputElement;
  let dialog = $state<{ fileName: string; result: ParseResult } | null>(null);
  let busy = $state(false);

  function doExport() {
    const blob = new Blob([exportProject(wb.circuit)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = exportFileName(wb.circuit.title);
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function onFile(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ''; // 允许连续选择同一文件
    if (!file) return;
    const text = await file.text();
    dialog = { fileName: file.name, result: parseProject(text) };
  }

  async function confirmImport() {
    if (!dialog || !dialog.result.ok) return;
    busy = true;
    try {
      await wb.importProject(dialog.result.project);
      dialog = null;
    } finally {
      busy = false;
    }
  }

  const summary = $derived(
    dialog?.result.ok
      ? {
          title: dialog.result.project.title,
          nodes: dialog.result.project.nodes.length,
          comps: dialog.result.project.comps.length,
          ground: dialog.result.project.nodes.find((n) => n.ground)?.name ?? null,
        }
      : null,
  );
</script>

<button
  class="io-btn"
  title="把当前工程导出为 JSON 文件（接点/元件/连接/位置/参考地；不含 IndexedDB 内部键），可在另一台浏览器导入"
  onclick={doExport}>导出 JSON</button
>
<button
  class="io-btn"
  title="从 JSON 文件导入工程：先校验编号引用、元件值、参考地与数据版本，确认后创建新工程，不影响已有工程"
  onclick={() => fileInput.click()}>导入 JSON</button
>
<input bind:this={fileInput} type="file" accept=".json,application/json" class="file-hidden" onchange={onFile} />

{#if dialog}
  <div
    class="io-mask"
    role="presentation"
    onclick={() => (dialog = null)}
    onkeydown={(e) => {
      if (e.key === 'Escape') dialog = null;
    }}
  >
    <div
      class="io-dialog"
      role="dialog"
      aria-modal="true"
      tabindex="-1"
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => e.stopPropagation()}
    >
      {#if dialog.result.ok && summary}
        <h3>导入工程</h3>
        <p class="muted">文件 <b>{dialog.fileName}</b> 校验通过：</p>
        <div class="io-summary">
          <div><span class="muted">工程标题</span><b>{summary.title}</b></div>
          <div><span class="muted">接点 / 元件</span><b>{summary.nodes} 个接点 · {summary.comps} 个元件</b></div>
          <div>
            <span class="muted">参考地</span>
            <b>{summary.ground ? summary.ground : '未设置（导入后需手动设置）'}</b>
          </div>
        </div>
        <p class="muted small">将作为<b>新工程</b>加入工程列表（即使同名也互不影响），不会覆盖或修改任何已有工程。</p>
        <div class="io-actions">
          <button class="primary" disabled={busy} onclick={() => void confirmImport()}>
            {busy ? '正在创建…' : '创建新工程'}
          </button>
          <button disabled={busy} onclick={() => (dialog = null)}>取消</button>
        </div>
      {:else if !dialog.result.ok}
        <h3 class="err-title">无法导入：文件校验未通过</h3>
        <p class="muted">文件 <b>{dialog.fileName}</b> 存在 {dialog.result.problems.length} 个问题，未做任何改动：</p>
        <ul class="io-problems">
          {#each dialog.result.problems as p, i (i)}
            <li>
              <div class="io-problem-head">
                <span class="io-code">{p.code}</span>
                <span>{p.message}</span>
              </div>
              {#if p.refs.length}
                <div class="io-refs">
                  相关对象：
                  {#each p.refs as r (r)}<span class="io-ref">{r}</span>{/each}
                </div>
              {/if}
            </li>
          {/each}
        </ul>
        <div class="io-actions">
          <button onclick={() => (dialog = null)}>取消</button>
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .file-hidden {
    display: none;
  }
  .io-mask {
    position: fixed;
    inset: 0;
    background: rgba(2, 6, 23, 0.72);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 120;
  }
  .io-dialog {
    width: 560px;
    max-width: 92vw;
    max-height: 84vh;
    overflow-y: auto;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 14px;
    padding: 20px 24px;
    box-shadow: 0 24px 60px rgba(0, 0, 0, 0.55);
  }
  .io-dialog h3 {
    margin: 0 0 8px;
    color: var(--accent);
  }
  .io-dialog h3.err-title {
    color: var(--err);
  }
  .io-summary {
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 10px 12px;
    background: var(--panel-2);
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin: 8px 0;
  }
  .io-summary div {
    display: flex;
    justify-content: space-between;
    gap: 12px;
  }
  .io-problems {
    list-style: none;
    margin: 8px 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .io-problems li {
    border: 1px solid var(--line);
    border-left: 3px solid var(--err);
    border-radius: 6px;
    padding: 8px 10px;
    background: var(--panel-2);
  }
  .io-problem-head {
    display: flex;
    gap: 8px;
    align-items: baseline;
    line-height: 1.5;
  }
  .io-code {
    flex: none;
    font-family: ui-monospace, monospace;
    font-size: 10.5px;
    color: var(--err);
    border: 1px solid currentColor;
    border-radius: 4px;
    padding: 0 5px;
  }
  .io-refs {
    margin-top: 5px;
    font-size: 11px;
    color: var(--muted);
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    align-items: center;
  }
  .io-ref {
    font-family: ui-monospace, monospace;
    background: #0f172a;
    border: 1px solid var(--line);
    border-radius: 4px;
    padding: 0 5px;
    color: #bae6fd;
  }
  .io-actions {
    display: flex;
    gap: 10px;
    margin-top: 14px;
  }
  .primary {
    background: #0369a1;
    border-color: var(--accent);
    font-weight: 700;
  }
  .muted {
    color: var(--muted);
  }
  .small {
    font-size: 11.5px;
    line-height: 1.6;
  }
</style>
