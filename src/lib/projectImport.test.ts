// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { createWorkbench } from './store.svelte';
import { storage } from './storage';
import { exportProject, parseProject } from './projectIO';
import { exampleZero } from './factory';

describe('工程导入（不破坏已有工程）', () => {
  beforeEach(async () => {
    const all = await storage.list();
    for (const c of all) await storage.remove(c.id);
    localStorage.clear();
  });

  it('同名工程导入后，原工程与新工程都能分别打开', async () => {
    const wb = createWorkbench();
    const original = exampleZero();
    original.title = '实验A';
    wb.load(original);
    await wb.saveNow();
    const originalId = wb.circuit.id;
    const originalComps = JSON.parse(JSON.stringify((await storage.get(originalId))!.comps));

    // 模拟文件流转到另一台浏览器再回来：导出 → 解析校验 → 用户确认创建新工程
    const parsed = parseProject(exportProject(wb.circuit));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const imported = await wb.importProject(parsed.project);

    // 新工程有全新记录键，并成为当前工程
    expect(imported.id).not.toBe(originalId);
    expect(wb.circuit.id).toBe(imported.id);

    // IndexedDB 中两个同名工程并存
    const sameTitle = (await storage.list()).filter((c) => c.title === '实验A');
    expect(sameTitle.map((c) => c.id).sort()).toEqual([originalId, imported.id].sort());

    // 原工程内容没有被导入改动
    expect((await storage.get(originalId))!.comps).toEqual(originalComps);

    // 两个工程都能分别打开，且都能正常求解
    wb.load((await storage.get(originalId))!);
    expect(wb.circuit.id).toBe(originalId);
    expect(wb.result.ok).toBe(true);
    wb.load((await storage.get(imported.id))!);
    expect(wb.circuit.id).toBe(imported.id);
    expect(wb.result.ok).toBe(true);
    // 打开后的求解行为一致
    const r1 = wb.result.branches;
    wb.load((await storage.get(originalId))!);
    expect(wb.result.branches).toEqual(r1);
  });

  it('损坏的端点引用被校验拒绝：不产生新工程，当前工程不受影响', async () => {
    const wb = createWorkbench();
    wb.load(exampleZero());
    await wb.saveNow();
    const currentId = wb.circuit.id;
    const before = (await storage.list()).length;

    const obj = JSON.parse(exportProject(wb.circuit)) as { comps: { b: string }[] };
    obj.comps[0].b = 'n_ghost';
    const parsed = parseProject(JSON.stringify(obj));
    expect(parsed.ok).toBe(false);
    // 校验失败时界面上没有“创建新工程”可走：importProject 不会被调用
    expect((await storage.list()).length).toBe(before);
    expect(wb.circuit.id).toBe(currentId);
    expect(wb.result.ok).toBe(true);
  });
});
