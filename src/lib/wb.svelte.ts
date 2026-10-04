import { createWorkbench, type Tool, type Selection, type Workbench } from './store.svelte.ts';

/** 全局唯一工作台实例（.svelte.ts 模块保证 runes 转换生效） */
export const wb = createWorkbench();
export type { Tool, Selection, Workbench };
