// SSR 冒烟：组件树可编译、首次渲染不抛异常（Konva/IndexedDB 为浏览器 API，此处仅验证 Svelte 逻辑层）
import { render } from 'svelte/server';
import { describe, it, expect } from 'vitest';
import App from './App.svelte';

describe('App SSR 冒烟', () => {
  it('组件树渲染出关键 UI（工具栏、四个分析页签、空电路诊断而不是崩溃）', () => {
    const { body } = render(App, { context: new Map() });
    expect(body).toContain('直流电阻网络工作台');
    expect(body).toContain('MNA 方程与溯源');
    expect(body).toContain('节点 KCL');
    expect(body).toContain('功率平衡');
    expect(body).toContain('参考地');
    expect(body).toContain('交叉不产生接点');
    // 空电路走诊断分支，而非渲染出 NaN 数值
    expect(body).toContain('电路为空');
    expect(body).not.toMatch(/>\s*NaN\s*</);
  });
});
