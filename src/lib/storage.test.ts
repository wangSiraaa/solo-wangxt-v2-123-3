// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { storage } from './storage';
import type { Circuit } from './engine/types';

// 回归：Svelte $state 产生的代理对象无法被 IndexedDB 结构化克隆，
// storage.put 必须先把它转成纯对象。
function proxiedCircuit(id: string): Circuit {
  const raw: Circuit = {
    id,
    title: '代理电路',
    updatedAt: 0,
    nodes: [{ id: 'n1', name: 'n1', x: 0, y: 0, ground: true }],
    comps: [],
  };
  // 模拟 runes $state 的 Proxy 包装（嵌套对象也代理）
  const wrap = <T extends object>(o: T): T =>
    new Proxy(o, {
      get(t, k) {
        const v = Reflect.get(t, k);
        return v && typeof v === 'object' ? wrap(v) : v;
      },
    });
  return wrap(raw);
}

describe('IndexedDB 持久化（代理对象回归）', () => {
  beforeEach(async () => {
    const all = await storage.list();
    for (const c of all) await storage.remove(c.id);
  });

  it('代理化的电路可成功存入并读回', async () => {
    const c = proxiedCircuit('p1');
    await expect(storage.put(c)).resolves.toBeUndefined();
    const back = await storage.get('p1');
    expect(back).toBeTruthy();
    expect(back!.title).toBe('代理电路');
    expect(back!.nodes[0].ground).toBe(true);
  });

  it('list 返回按更新时间倒序的纯对象', async () => {
    await storage.put(proxiedCircuit('a'));
    await new Promise((r) => setTimeout(r, 5));
    await storage.put(proxiedCircuit('b'));
    const list = await storage.list();
    expect(list.map((c) => c.id)).toEqual(['b', 'a']);
    // 读回的应是普通对象（不是代理）
    expect(Object.getPrototypeOf(list[0])).toBe(Object.prototype);
  });
});
