<script lang="ts">
  import { wb, type Tool } from '../lib/wb.svelte.ts';
  import { EXAMPLES } from '../lib/factory';
  import type { Circuit } from '../lib/engine/types';
  import { storage } from '../lib/storage';
  import ProjectIO from './ProjectIO.svelte';

  const tools: { key: Tool; label: string; hint: string }[] = [
    { key: 'select', label: '选择/拖动', hint: 'S' },
    { key: 'node', label: '接点', hint: 'N' },
    { key: 'wire', label: '导线', hint: 'W' },
    { key: 'R', label: '电阻 R', hint: 'R' },
    { key: 'V', label: '电压源', hint: 'V' },
    { key: 'I', label: '电流源', hint: 'I' },
  ];

  const keyMap: Record<string, Tool> = { s: 'select', n: 'node', w: 'wire', r: 'R', v: 'V', i: 'I' };
  function onWindowKey(e: KeyboardEvent) {
    const tag = (document.activeElement?.tagName ?? '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
    const t = keyMap[e.key.toLowerCase()];
    if (t && wb.tool !== t) wb.tool = t;
  }
  $effect(() => {
    window.addEventListener('keydown', onWindowKey);
    return () => window.removeEventListener('keydown', onWindowKey);
  });

  let showExamples = $state(false);
  let showProjects = $state(false);
  let projects = $state<Circuit[]>([]);

  async function refreshProjects() {
    
    projects = await storage.list();
  }

  async function newProject() {
    await wb.createProject();
    showProjects = false;
  }
  async function removeProject(id: string, e: Event) {
    e.stopPropagation();
    
    await storage.remove(id);
    await refreshProjects();
  }
</script>

<header class="toolbar">
  <div class="brand">⚡ 直流电阻网络工作台</div>
  <input class="title" value={wb.circuit.title} oninput={(e) => wb.setTitle(e.currentTarget.value)} />

  <div class="tools">
    {#each tools as t (t.key)}
      <button
        class:active={wb.tool === t.key}
        title={`快捷键 ${t.hint}`}
        onclick={() => {
          wb.tool = t.key;
          wb.pendingNode = null;
        }}
      >
        {t.label}
        <kbd>{t.hint}</kbd>
      </button>
    {/each}
  </div>

  <div class="spacer"></div>

  <div class="dropdown">
    <button onclick={() => { showExamples = !showExamples; }}>载入示例 ▾</button>
    {#if showExamples}
      <div class="menu">
        {#each EXAMPLES as ex (ex.key)}
          <button
            onclick={() => {
              wb.load(ex.build());
              showExamples = false;
            }}>{ex.title}</button
          >
        {/each}
      </div>
    {/if}
  </div>

  <div class="dropdown">
    <button
      onclick={() => {
        showProjects = !showProjects;
        if (showProjects) void refreshProjects();
      }}>工程 ▾</button
    >
    {#if showProjects}
      <div class="menu wide">
        <button onclick={newProject}>＋ 新建工程</button>
        <div class="sep"></div>
        {#if projects.length === 0}
          <div class="empty">IndexedDB 中暂无工程</div>
        {/if}
        {#each projects as p (p.id)}
          <div
            class:current={p.id === wb.circuit.id}
            class="project-row"
            role="button"
            tabindex="0"
            onclick={() => {
              wb.load(p);
              showProjects = false;
            }}
            onkeydown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                wb.load(p);
                showProjects = false;
              }
            }}
          >
            <div class="p-title">{p.title}</div>
            <div class="p-date">{new Date(p.updatedAt).toLocaleString('zh-CN')}</div>
            <button class="danger del" title="删除" onclick={(e) => removeProject(p.id, e)}>✕</button>
          </div>
        {/each}
      </div>
    {/if}
  </div>

  <ProjectIO />

  <button onclick={() => void wb.saveNow()}>保存</button>
  <span class="save-state" data-state={wb.saveState}>
    {wb.saveState === 'saving' ? '保存中…' : wb.saveState === 'saved' ? '已存入 IndexedDB' : wb.saveState === 'error' ? '保存失败' : ''}
  </span>
</header>

<style>
  .toolbar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 7px 12px;
    background: var(--panel);
    border-bottom: 1px solid var(--line);
    z-index: 10;
  }
  .brand {
    font-weight: 700;
    color: var(--accent);
    white-space: nowrap;
  }
  .title {
    width: 180px;
  }
  .tools {
    display: flex;
    gap: 4px;
  }
  kbd {
    font-size: 10px;
    opacity: 0.55;
    margin-left: 4px;
    border: 1px solid currentColor;
    border-radius: 3px;
    padding: 0 3px;
  }
  .spacer {
    flex: 1;
  }
  .save-state {
    font-size: 11px;
    color: var(--muted);
    min-width: 110px;
  }
  .save-state[data-state='saved'] {
    color: var(--ok);
  }
  .save-state[data-state='error'] {
    color: var(--err);
  }
  .dropdown {
    position: relative;
  }
  .menu {
    position: absolute;
    right: 0;
    top: 100%;
    margin-top: 6px;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 6px;
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 190px;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.45);
    z-index: 30;
  }
  .menu.wide {
    min-width: 280px;
    max-height: 60vh;
    overflow-y: auto;
  }
  .menu button {
    text-align: left;
    border: none;
  }
  .sep {
    height: 1px;
    background: var(--line);
    margin: 4px 0;
  }
  .empty {
    color: var(--muted);
    padding: 6px 8px;
  }
  .project-row {
    display: grid;
    grid-template-columns: 1fr auto;
    grid-template-rows: auto auto;
    padding: 6px 8px;
    border-radius: 6px;
    cursor: pointer;
    position: relative;
  }
  .project-row:hover {
    background: var(--panel-2);
  }
  .project-row.current {
    outline: 1px solid var(--accent);
  }
  .p-title {
    font-weight: 600;
  }
  .p-date {
    font-size: 10.5px;
    color: var(--muted);
  }
  .del {
    grid-row: 1 / 3;
    grid-column: 2;
    align-self: center;
    padding: 2px 7px;
  }
</style>
