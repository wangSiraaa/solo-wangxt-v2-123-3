<script lang="ts">
  import Toolbar from './components/Toolbar.svelte';
  import Schematic from './components/Schematic.svelte';
  import Inspector from './components/Inspector.svelte';
  import AnalysisPanel from './components/AnalysisPanel.svelte';
  import { wb } from './lib/wb.svelte.ts';
  import { exampleBridge } from './lib/factory';
  import { storage } from './lib/storage';

  let booted = $state(false);
  let welcomeOpen = $state(true);

  $effect(() => {
    void (async () => {
      const restored = await wb.restoreLast();
      if (!restored) {
        try {
          const all = await storage.list();
          if (all.length > 0) {
            wb.load(all[0]);
          } else {
            // 首次使用：载入桥式网络作为演示工程并存入 IndexedDB
            wb.load(exampleBridge());
            await wb.saveNow();
          }
        } catch {
          wb.load(exampleBridge());
        }
      }
      booted = true;
    })();
  });

  const pending = $derived(wb.pendingNode !== null);
</script>

<div class="app">
  <Toolbar />
  <div class="main">
    <div class="stage-col">
      <div class="statusline">
        {#if wb.tool === 'node'}
          模式：放置接点 —— 在空白处单击创建接点；接点必须显式放置，线的交叉不形成接点
        {:else if pending}
          模式：放置{wb.tool === 'wire' ? '理想导线' : wb.tool === 'R' ? '电阻' : wb.tool === 'V' ? '电压源' : '电流源'}
          —— 已选起点（黄色虚线圈），再点第二个接点完成；点同一接点取消，Esc 退出
        {:else if wb.tool !== 'select'}
          模式：放置{wb.tool === 'wire' ? '理想导线' : wb.tool === 'R' ? '电阻' : wb.tool === 'V' ? '电压源' : '电流源'}
          —— 依次点击两个接点
        {:else}
          选择/拖动模式：拖接点改几何、拖元件只移动符号（连接不变）；双击元件翻转极性，双击节点设/撤地
        {/if}
      </div>
      <div class="stage-box">
        <Schematic />
      </div>
      <AnalysisPanel />
    </div>
    <Inspector />
  </div>

  {#if welcomeOpen && booted}
    <div
      class="welcome-mask"
      role="presentation"
      onclick={() => (welcomeOpen = false)}
      onkeydown={(e) => {
        if (e.key === 'Escape' || e.key === 'Enter') welcomeOpen = false;
      }}
    >
      <div
        class="welcome"
        role="dialog"
        aria-modal="true"
        tabindex="-1"
        onclick={(e) => e.stopPropagation()}
        onkeydown={(e) => e.stopPropagation()}
      >
        <h2>直流电阻网络工作台</h2>
        <p>纯浏览器运行：原理图用 Konva 绘制，修正节点分析（MNA）由 mathjs 求解，工程自动存入 IndexedDB。</p>
        <ul>
          <li><b>接点与参考地显式设置</b>：导线交叉处没有接点就不导通（跳线弧标记），参考地由你指定。</li>
          <li><b>每行方程可追溯</b>：底栏“MNA 方程”里悬停矩阵系数可高亮贡献它的元件。</li>
          <li><b>极性一致</b>：所有元件以 a→b 为电流正方向，电压源 a 端为 +；红箭头表示正向电流、蓝箭头表示反向。</li>
          <li><b>拖动不改连接</b>：拖元件只移动图形；连接关系只由两端接点决定。</li>
          <li><b>矛盾不出 NaN</b>：如两个理想电压源并联冲突，会明确指出无法满足的那条约束，电路保留、继续可编辑。</li>
        </ul>
        <p class="muted">已为你载入“桥式网络”示例，可用“载入示例”对照 KCL 与功率平衡，或查看矛盾并联、浮空子网、孤立节点与零电阻边界。</p>
        <button class="primary" onclick={() => (welcomeOpen = false)}>开始实验</button>
      </div>
    </div>
  {/if}
</div>

<style>
  .app {
    height: 100%;
    display: flex;
    flex-direction: column;
  }
  .main {
    flex: 1;
    display: flex;
    min-height: 0;
  }
  .stage-col {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .stage-box {
    flex: 1;
    min-height: 0;
    position: relative;
  }
  .statusline {
    background: #16223a;
    color: #bae6fd;
    padding: 5px 12px;
    font-size: 11.5px;
    border-bottom: 1px solid var(--line);
  }
  .welcome-mask {
    position: fixed;
    inset: 0;
    background: rgba(2, 6, 23, 0.72);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
  }
  .welcome {
    width: 620px;
    max-width: 92vw;
    max-height: 88vh;
    overflow-y: auto;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 14px;
    padding: 22px 26px;
    box-shadow: 0 24px 60px rgba(0, 0, 0, 0.55);
  }
  .welcome h2 {
    margin-top: 0;
    color: var(--accent);
  }
  .welcome li {
    line-height: 1.85;
  }
  .primary {
    margin-top: 10px;
    background: #0369a1;
    border-color: var(--accent);
    padding: 8px 18px;
    font-weight: 700;
  }
  .muted {
    color: var(--muted);
  }
</style>
