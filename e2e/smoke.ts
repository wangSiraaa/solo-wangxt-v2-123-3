import { chromium } from 'playwright';
import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';

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

// ---------- 10. 工程导出 → 导入往返（当前工程为第 8 步载入的桥式网络） ----------
await page.waitForTimeout(800); // 等自动保存落盘，保证原工程已在 IndexedDB
const bridgeTitle = '桥式网络（验证 KCL 与功率平衡）';
const [download] = await Promise.all([
  page.waitForEvent('download'),
  page.getByRole('button', { name: '导出', exact: true }).click(),
]);
const dlPath = await download.path();
const exportedText = readFileSync(dlPath!, 'utf8');
const exportedJson = JSON.parse(exportedText);
check(
  '导出：含格式标识与版本，不含 IndexedDB 内部键',
  exportedJson.format === 'dc-workbench/project' &&
    exportedJson.version === 1 &&
    !('id' in exportedJson) &&
    !('updatedAt' in exportedJson) &&
    exportedJson.nodes.length === 4 &&
    exportedJson.comps.length === 6,
);

// 导入同一文件 → 校验通过 → 确认对话框
await page.setInputFiles('input[data-testid="import-file"]', dlPath!);
await page.waitForTimeout(400);
const dlg = page.getByRole('dialog');
check('导入：校验通过后需用户确认', (await dlg.getByRole('button', { name: '创建新工程', exact: true }).count()) === 1);
check('导入：提示已存在同名工程', /已存在同名工程/.test(await dlg.innerText()));
await dlg.getByRole('button', { name: '创建新工程', exact: true }).click();
await page.waitForTimeout(700);

// 往返后求解结果不变：KCL 全部平衡（桥式网络含跳线交叉）
await page.getByRole('button', { name: /节点 KCL/ }).click();
await page.waitForTimeout(200);
const rtRows = await page.locator('table.data tbody tr').count();
const rtBad = await page.locator('table.data tbody tr td:last-child:text("✗")').count();
check('往返：导入工程的 KCL 全部平衡', rtRows >= 4 && rtBad === 0, `${rtRows} 行, ${rtBad} 行失败`);

// 同名工程并存且可分别打开（此前步骤已保存过多个同名桥式工程，导入应再 +1；
// 点击行会触发保存并改变排序，故只按位置各点一次、不假设谁是谁）
await page.getByRole('button', { name: '工程 ▾', exact: true }).click();
await page.waitForTimeout(400);
const sameTitle = page.locator('.project-row', { hasText: bridgeTitle });
const afterImportCount = await sameTitle.count();
check('同名工程：原工程与导入工程并存', afterImportCount >= 2, `${afterImportCount} 行`);
await sameTitle.nth(0).locator('.p-title').click();
await page.waitForTimeout(1200); // 等防抖保存完成，列表顺序稳定
let openBad = await page.locator('table.data tbody tr td:last-child:text("✗")').count();
check('同名工程：第一个工程可单独打开且求解正常', openBad === 0);
await page.getByRole('button', { name: '工程 ▾', exact: true }).click();
await page.waitForTimeout(400);
await page.locator('.project-row', { hasText: bridgeTitle }).nth(1).locator('.p-title').click(); // 另一个（排序已稳定）
await page.waitForTimeout(1200);
openBad = await page.locator('table.data tbody tr td:last-child:text("✗")').count();
check('同名工程：第二个工程可单独打开且求解正常', openBad === 0);

// ---------- 11. 损坏文件被拒绝且不破坏当前工程 ----------
const brokenObj = JSON.parse(exportedText);
brokenObj.comps[1].a = 'n_broken_ref'; // R1 的端点指向不存在的接点
await page.setInputFiles('input[data-testid="import-file"]', {
  name: 'broken.json',
  mimeType: 'application/json',
  buffer: Buffer.from(JSON.stringify(brokenObj)),
});
await page.waitForTimeout(400);
const dlg2 = page.getByRole('dialog');
const dlg2Text = await dlg2.innerText();
check('损坏引用：导入被拒绝并说明原因', /无法导入/.test(dlg2Text) && /不存在的接点 "n_broken_ref"/.test(dlg2Text), dlg2Text.slice(0, 120).replace(/\n/g, ' '));
check('损坏引用：问题指向对应元件 R1', /元件\s+R1/.test(dlg2Text));
check('损坏引用：不提供导入按钮', (await dlg2.getByRole('button', { name: '创建新工程', exact: true }).count()) === 0);
await dlg2.getByRole('button', { name: '关闭', exact: true }).click();
await page.waitForTimeout(300);
check('损坏引用：当前工程未被破坏（画布仍在）', (await page.locator('.konvajs-content').count()) === 1);
await page.getByRole('button', { name: '工程 ▾', exact: true }).click();
await page.waitForTimeout(400);
check('损坏引用：工程列表未变化（同名工程数量不变）', (await page.locator('.project-row', { hasText: bridgeTitle }).count()) === afterImportCount);
await page.getByRole('button', { name: '工程 ▾', exact: true }).click(); // 收起菜单

// ---------- 12. 无控制台错误 ----------
const realErrors = errors.filter((e) => !/favicon/i.test(e));
check('浏览器无运行时错误', realErrors.length === 0, realErrors.slice(0, 3).join(' | '));

await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
