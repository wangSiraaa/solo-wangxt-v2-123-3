<script lang="ts">
  import { wb } from '../lib/wb.svelte.ts';
  import { storage } from '../lib/storage';
  import {
    exportProject,
    parseProject,
    buildCircuit,
    summarize,
    type ImportProblem,
    type ProjectFile,
  } from '../lib/transfer';

  type Dialog =
    | { kind: 'confirm'; file: ProjectFile; fileName: string; dupTitle: boolean }
    | { kind: 'problems'; problems: ImportProblem[]; fileName: string };

  let fileInput: HTMLInputElement | undefined = $state();
  let dialog = $state<Dialog | null>(null);
  let importing = $state(false);

  function doExport() {
    const title = wb.circuit.title.trim() || 'circuit';
    const blob = new Blob([exportProject(wb.circuit)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function onFile(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const f = input.files?.[0];
    input.value = ''; // 允许再次选择同一文件
    if (!f) return;
    const text = await f.text();
    const res = parseProject(text);
    if (!res.ok) {
      dialog = { kind: 'problems', problems: res.problems, fileName: f.name };
      return;
    }
    // 仅用于提示“已存在同名工程”；导入本身永远创建新工程，不碰已有记录
    let dupTitle = false;
    try {
      dupTitle = (await storage.list()).some((c) => c.title === res.file.title);
    } catch {
      /* 提示失败不阻塞导入 */
    }
    dialog = { kind: 'confirm', file: res.file, fileName: f.name, dupTitle };
  }

  async function confirmImport() {
    if (dialog?.kind !== 'confirm' || importing) return;
    importing = true;
    try {
      // buildCircuit 分配全新工程键：已有工程（包括同名工程）不受影响
      wb.load(buildCircuit(dialog.file));
      await wb.saveNow();
      dialog = null;
    } finally {
      importing = false;
    }
  }

  const summary = $derived(dialog?.kind === 'confirm' ? summarize(dialog.file) : null);
</script>

<button onclick={doExport} title="把当前工程导出为 JSON 文件（含接点/元件/连接/位置/参考地，不含内部存储键）">
  导出
</button>
<button onclick={() => fileInput?.click()} title="从 JSON 文件导入工程：先校验，再创建新工程，不影响已有工程">
  导入
</button>
<input
  bind:this={fileInput}
  class="file-hidden"
  type="file"
  accept=".json,application/json"
  data-testid="import-file"
  onchange={onFile}
/>

{#if dialog}
  <div class="mask" role="presentation">
    <div class="dlg" role="dialog" aria-modal="true">
      {#if dialog.kind === 'confirm' && summary}
        <h3>导入工程</h3>
        <div class="meta">来自文件：<span class="mono">{dialog.fileName}</span></div>
        <div class="sum">
          <div><span class="muted">标题</span><b>{summary.title}</b></div>
          <div><span class="muted">接点</span><b class="mono">{summary.nodes}</b></div>
          <div><span class="muted">元件</span><b class="mono">{summary.comps}</b></div>
          <div><span class="muted">参考地</span><b>{summary.ground ?? '未设置'}</b></div>
        </div>
        <p class="note">
          校验通过。导入将<b>创建新工程</b>（分配新的内部键），不会覆盖或修改任何已有工程。
          {#if dialog.dupTitle}
            <span class="warn">已存在同名工程「{summary.title}」：导入后两者会并存，可分别打开。</span>
          {/if}
        </p>
        <div class="actions">
          <button class="primary" disabled={importing} onclick={confirmImport}>
            {importing ? '导入中…' : '创建新工程'}
          </button>
          <button onclick={() => (dialog = null)}>取消</button>
        </div>
      {:else if dialog.kind === 'problems'}
        <h3 class="bad">无法导入：文件未通过校验</h3>
        <div class="meta">来自文件：<span class="mono">{dialog.fileName}</span>（未做任何改动，已有工程不受影响）</div>
        <ul class="problems scroll">
          {#each dialog.problems as p, i (i)}
            <li>
              <span class="badge error">{p.code}</span>
              <span class="pmsg">{p.message}</span>
              {#if p.refs.length > 0}
                <span class="prefs">
                  {#each p.refs as r (r.kind + r.id)}
                    <span class="pref">{r.kind === 'comp' ? '元件' : '接点'} {r.name}</span>
                  {/each}
                </span>
              {/if}
            </li>
          {/each}
        </ul>
        <div class="actions">
          <button onclick={() => (dialog = null)}>关闭</button>
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .file-hidden {
    display: none;
  }
  .mask {
    position: fixed;
    inset: 0;
    background: rgba(2, 6, 23, 0.66);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 90;
  }
  .dlg {
    width: 520px;
    max-width: 92vw;
    max-height: 80vh;
    overflow-y: auto;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 12px;
    padding: 18px 20px;
    box-shadow: 0 20px 50px rgba(0, 0, 0, 0.5);
  }
  h3 {
    margin: 0 0 8px;
    color: var(--accent);
  }
  h3.bad {
    color: var(--err);
  }
  .meta {
    color: var(--muted);
    font-size: 11.5px;
    margin-bottom: 10px;
  }
  .sum {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px 18px;
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 10px 12px;
    background: var(--panel-2);
  }
  .sum div {
    display: flex;
    justify-content: space-between;
    gap: 12px;
  }
  .note {
    color: var(--muted);
    line-height: 1.6;
  }
  .warn {
    color: var(--warn);
  }
  .actions {
    display: flex;
    gap: 10px;
    margin-top: 12px;
  }
  .primary {
    background: #0c4a6e;
    border-color: var(--accent);
    font-weight: 700;
  }
  .problems {
    list-style: none;
    margin: 0;
    padding: 0;
    max-height: 40vh;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .problems li {
    background: var(--panel-2);
    border-left: 3px solid var(--err);
    border-radius: 6px;
    padding: 7px 10px;
    line-height: 1.55;
  }
  .pmsg {
    margin-left: 8px;
  }
  .prefs {
    display: block;
    margin-top: 4px;
  }
  .pref {
    display: inline-block;
    background: #0f1c30;
    color: #bfdbfe;
    padding: 1px 8px;
    border-radius: 9px;
    font-size: 11.5px;
    margin: 2px 4px 0 0;
  }
  .muted {
    color: var(--muted);
  }
</style>
