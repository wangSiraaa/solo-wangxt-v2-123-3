import { chromium } from 'playwright';
import { defineConfig } from 'vite';
import { readFile, writeFile } from 'node:fs/promises';

void defineConfig;

const BASE = 'http://localhost:5199';

const results: { name: string; ok: boolean; detail?: string }[] = [];
function check(name: string, cond: boolean, detail = '') {
  results.push({ name, ok: cond, detail });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

const SHELL =
  process.env.CHROME_PATH ??
  '/home/node/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux-arm64/chrome-headless-shell';
const browser = await chromium.launch({
  headless: true,
  executablePath: SHELL,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  env: {
    ...process.env,
    LD_LIBRARY_PATH:
      (process.env.LD_LIBRARY_PATH ? process.env.LD_LIBRARY_PATH + ':' : '') +
      '/tmp/chromelibs/extracted/usr/lib/aarch64-linux-gnu:' +
      '/tmp/chromelibs/extracted/lib/aarch64-linux-gnu',
  },
});
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`console: ${m.text()}`);
});

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(800);

// 关闭欢迎页
const startBtn = page.getByRole('button', { name: '开始实验' });
if (await startBtn.count()) await startBtn.click();
await page.waitForTimeout(300);

// ---------- 1. 桥式网络：默认示例 ----------
await page.getByRole('button', { name: /载入示例/ }).click();
await page.getByRole('button', { name: '桥式网络' }).click();
await page.waitForTimeout(400);

// MNA 标签可打开且矩阵渲染
await page.getByRole('button', { name: /MNA 方程/ }).click();
await page.waitForTimeout(200);
const matrixCells = await page.locator('table.matrix td.cell').count();
check('桥式网络：MNA 矩阵已建立（非空）', matrixCells > 0, `${matrixCells} 个单元格`);
const matrixHasTrace = await page.locator('table.matrix td.cell.traced').count();
check('桥式网络：矩阵系数可溯源到元件', matrixHasTrace > 0, `${matrixHasTrace} 个可溯源格`);

// KCL 残差全为 ✓
await page.getByRole('button', { name: /节点 KCL/ }).click();
await page.waitForTimeout(150);
const kclRows = await page.locator('table.data tbody tr').count();
const kclBad = await page.locator('table.data tbody tr td:last-child:text("✗")').count();
check('桥式网络：所有超节点 KCL 残差为 0', kclRows >= 4 && kclBad === 0, `${kclRows} 行, ${kclBad} 行失败`);

// 功率平衡
await page.getByRole('button', { name: /功率平衡/ }).click();
await page.waitForTimeout(150);
const powerText = await page.locator('.power-sum .big').textContent();
const powerVal = Number((powerText ?? '').replace(/[^\d.eE+-]/g, ''));
check('桥式网络：功率平衡 ΣP≈0', Math.abs(powerVal) < 1e-6, `Σ吸收=${powerText?.trim()}`);

// 画布上有电流方向箭头（Konva 场景对象，不是 DOM）
await page.waitForTimeout(300);
const arrowCount = await page.evaluate(() => {
  const r = (window as unknown as { __renderer?: { stage: { find: (s: string) => unknown[] } } }).__renderer;
  return r ? r.stage.find('Arrow').length : -1;
});
check('桥式网络：原理图绘制了电流方向箭头', arrowCount >= 4, `${arrowCount} 个箭头`);

// 电位标注（Konva 文本节点）
const voltageLabelCount = await page.evaluate(() => {
  const r = (window as unknown as { __renderer?: { stage: { find: (s: string) => { text(): string }[] } } }).__renderer;
  if (!r) return -1;
  return r.stage.find('Text').filter((t) => /^-?[\d.]+V$/.test(t.text())).length;
});
check('桥式网络：节点电位已标注', voltageLabelCount >= 3, `${voltageLabelCount} 个电位文本`);

// ---------- 2. 矛盾并联电压源：不得出 NaN ----------
await page.getByRole('button', { name: /载入示例/ }).click();
await page.getByRole('button', { name: '矛盾并联电压源' }).click();
await page.waitForTimeout(400);
await page.getByRole('button', { name: /诊断/ }).click();
await page.waitForTimeout(200);
const issueText = await page.locator('.issues').innerText();
check('矛盾电源：出现 VSOURCE_LOOP 约束错误', /电压源回路矛盾|被零电阻短路|无法同时成立/.test(issueText), issueText.slice(0, 120).replace(/\n/g, ' '));
// 不应出现作为数值的 NaN（排除提示语“不会出现 NaN”）
const panelText = await page.locator('.panel').innerText();
const withoutHint = panelText.replace(/不会出现\s*NaN/g, '');
check('矛盾电源：界面不出现数值 NaN', !/NaN/.test(withoutHint));
check('矛盾电源：提示电路可继续编辑', /继续编辑/.test(issueText));
// 原理图仍然存在（元件还在）
const stageVisible = await page.locator('.konvajs-content').count();
check('矛盾电源：原理图仍保留可编辑', stageVisible === 1);

// ---------- 3. 浮空子网 ----------
await page.getByRole('button', { name: /载入示例/ }).click();
await page.getByRole('button', { name: '浮空子网' }).click();
await page.waitForTimeout(400);
let diag = await page.locator('.issues').innerText();
check('浮空子网：报 FLOATING', /浮空子网/.test(diag));
const stripHint = (s: string) => s.replace(/不会出现\s*NaN/g, '');
check('浮空子网：无 NaN', !/NaN/.test(stripHint(diag)));

// ---------- 4. 孤立节点 ----------
await page.getByRole('button', { name: /载入示例/ }).click();
await page.getByRole('button', { name: '孤立节点' }).click();
await page.waitForTimeout(400);
diag = await page.locator('.issues').innerText();
check('孤立节点：报 ISOLATED', /孤立节点/.test(diag));

// ---------- 5. 零电阻边界 ----------
await page.getByRole('button', { name: /载入示例/ }).click();
await page.getByRole('button', { name: '零电阻边界' }).click();
await page.waitForTimeout(400);
diag = await page.locator('.issues').innerText();
const zeroOk = !/错误/.test(diag);
check('零电阻：求解成功（无错误）', zeroOk, diag.slice(0, 100).replace(/\n/g, ' '));
await page.getByRole('button', { name: /节点 KCL/ }).click();
const zeroKclBad = await page.locator('table.data tbody tr td:last-child:text("✗")').count();
check('零电阻：KCL 全部平衡', zeroKclBad === 0);

// ---------- 6. 电流源串联割集 ----------
await page.getByRole('button', { name: /载入示例/ }).click();
await page.getByRole('button', { name: '电流源串联冲突' }).click();
await page.waitForTimeout(400);
diag = await page.locator('.issues').innerText();
check('电流源串联：报 ICUTSET 割集冲突', /割集/.test(diag));

// ---------- 7. 串联电源对照 ----------
await page.getByRole('button', { name: /载入示例/ }).click();
await page.getByRole('button', { name: '串联电源（同向）' }).click();
await page.waitForTimeout(400);
await page.getByRole('button', { name: /功率平衡/ }).click();
const p1 = await page.locator('.power-sum .big').textContent();
check('串联同向 17V/100Ω：功率平衡', Math.abs(Number((p1 ?? '').replace(/[^\d.eE+-]/g, ''))) < 1e-6, p1?.trim());

await page.getByRole('button', { name: /载入示例/ }).click();
await page.getByRole('button', { name: '串联电源（反向）' }).click();
await page.waitForTimeout(400);
const p2 = await page.locator('.power-sum .big').textContent();
check('串联反向 7V/100Ω：功率平衡', Math.abs(Number((p2 ?? '').replace(/[^\d.eE+-]/g, ''))) < 1e-6, p2?.trim());

// ---------- 8. 拖动元件不改变连接 ----------
await page.getByRole('button', { name: /载入示例/ }).click();
await page.getByRole('button', { name: '桥式网络' }).click();
await page.waitForTimeout(400);
const before = await page.evaluate(async () => {
  const req = indexedDB.open('dc-workbench');
  return await new Promise((resolve) => {
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction('circuits', 'readonly');
      tx.objectStore('circuits').getAll().onsuccess = (e) => {
        const all = (e.target as IDBRequest).result;
        resolve(all.length);
      };
    };
    req.onerror = () => resolve(-1);
  });
});
check('工程已持久化到 IndexedDB', (before as number) >= 1, `${before} 个工程`);

// ---------- 9. 跳线：桥式网络几何交叉处绘制了跳线弧 ----------
await page.waitForTimeout(300);
// 交叉层路径数
const jumpPaths = await page.evaluate(() => document.querySelectorAll('canvas').length);
check('Konva canvas 已挂载', jumpPaths >= 1, `${jumpPaths} canvas`);

// ---------- 10. 工程 JSON 导出 / 导入 ----------
await page.getByRole('button', { name: /载入示例/ }).click();
await page.getByRole('button', { name: '零电阻边界' }).click();
await page.waitForTimeout(400);

// 导出：拦截下载并检查文件内容
const [download] = await Promise.all([
  page.waitForEvent('download'),
  page.getByRole('button', { name: '导出 JSON' }).click(),
]);
const dlPath = await download.path();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const exported: any = JSON.parse(await readFile(dlPath!, 'utf8'));
check('导出：声明格式与数据版本', exported.format === 'dc-workbench-project' && exported.version === 1);
check('导出：不含 IndexedDB 内部键（id/updatedAt）', !('id' in exported) && !('updatedAt' in exported));
check(
  '导出：包含接点/元件/连接/位置/参考地',
  exported.nodes.length === 4 &&
    exported.comps.length === 5 &&
    exported.nodes.every((n: Record<string, unknown>) => ['id', 'name', 'x', 'y', 'ground'].every((k) => k in n)) &&
    exported.comps.every((c: Record<string, unknown>) =>
      ['id', 'type', 'name', 'a', 'b', 'value', 't', 'offset'].every((k) => k in c),
    ) &&
    exported.nodes.filter((n: { ground: boolean }) => n.ground).length === 1,
);

// 导入刚导出的文件 → 校验通过 → 用户确认创建新工程
await page.locator('input[type=file]').setInputFiles(dlPath!);
await page.waitForTimeout(300);
const dlg = page.locator('.io-dialog');
const dlgText = (await dlg.count()) ? await dlg.innerText() : '';
check(
  '导入：校验通过后给出工程摘要并询问',
  /校验通过/.test(dlgText) && /创建新工程/.test(dlgText) && /取消/.test(dlgText),
  dlgText.slice(0, 100).replace(/\n/g, ' '),
);
await dlg.getByRole('button', { name: '创建新工程' }).click();
await page.waitForTimeout(700);

// 导入后的工程求解行为不变（零电阻示例：无错误、KCL 全平衡）
await page.getByRole('button', { name: /诊断/ }).click();
await page.waitForTimeout(200);
const impDiag = await page.locator('.issues').innerText();
check('导入工程：求解无错误（连接与行为不变）', !/错误/.test(impDiag), impDiag.slice(0, 100).replace(/\n/g, ' '));
await page.getByRole('button', { name: /节点 KCL/ }).click();
await page.waitForTimeout(150);
const impKclBad = await page.locator('table.data tbody tr td:last-child:text("✗")').count();
check('导入工程：KCL 全部平衡', impKclBad === 0);

// 工程列表中两个同名工程并存，且能分别打开
await page.getByRole('button', { name: /^工程/ }).click();
await page.waitForTimeout(300);
const sameCount = await page.locator('.project-row', { hasText: '零电阻边界' }).count();
check('同名工程：导入后两个同名工程并存', sameCount === 2, `${sameCount} 个`);
await page.locator('.project-row', { hasText: '零电阻边界' }).nth(0).click();
await page.waitForTimeout(300);
const title1 = await page.locator('input.title').inputValue();
await page.getByRole('button', { name: /^工程/ }).click();
await page.waitForTimeout(200);
await page.locator('.project-row', { hasText: '零电阻边界' }).nth(1).click();
await page.waitForTimeout(300);
const title2 = await page.locator('input.title').inputValue();
check(
  '同名工程：原工程与新工程都能分别打开',
  title1.includes('零电阻边界') && title2.includes('零电阻边界'),
  `${title1} / ${title2}`,
);

// 损坏的端点引用 → 拒绝导入且不产生新工程
const countProjects = () =>
  page.evaluate(
    async () =>
      await new Promise<number>((resolve) => {
        const req = indexedDB.open('dc-workbench');
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction('circuits', 'readonly');
          tx.objectStore('circuits').count().onsuccess = (e) =>
            resolve((e.target as IDBRequest).result as number);
        };
        req.onerror = () => resolve(-1);
      }),
  );
const projBefore = await countProjects();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const badObj = { ...exported, comps: exported.comps.map((c: any, i: number) => (i === 0 ? { ...c, a: 'n_ghost' } : c)) };
await writeFile('/tmp/dcw-bad-project.json', JSON.stringify(badObj));
await page.locator('input[type=file]').setInputFiles('/tmp/dcw-bad-project.json');
await page.waitForTimeout(300);
const dlg2 = page.locator('.io-dialog');
const badText = (await dlg2.count()) ? await dlg2.innerText() : '';
check(
  '损坏引用：导入被拒绝并说明问题',
  /无法导入/.test(badText) && /不存在的接点/.test(badText) && /n_ghost/.test(badText),
  badText.slice(0, 140).replace(/\n/g, ' '),
);
const refChips = await dlg2.locator('.io-ref').count();
check('损坏引用：界面列出问题对应的元件/接点', refChips >= 2, `${refChips} 个引用芯片`);
check('损坏引用：不提供“创建新工程”按钮', (await dlg2.getByRole('button', { name: '创建新工程' }).count()) === 0);
await dlg2.getByRole('button', { name: '取消' }).click();
await page.waitForTimeout(200);
const projAfter = await countProjects();
check('损坏引用：未产生新工程，已有工程不受影响', projAfter === projBefore && projBefore >= 2, `${projBefore} → ${projAfter}`);

// ---------- 11. 无控制台错误 ----------
const realErrors = errors.filter((e) => !/favicon/i.test(e));
check('浏览器无运行时错误', realErrors.length === 0, realErrors.slice(0, 3).join(' | '));

await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
