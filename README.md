# 直流电阻网络工作台（DC Workbench）

纯浏览器运行的直流电阻网络实验台。学生把两个矛盾的理想电压源接在一起时，
实验台会**指出是哪一条约束无法满足**（而不是吐出一组 NaN），并保留电路供继续编辑。

## 能力

- **元件**：电阻 R、独立电压源 V、独立电流源 I、理想导线（零电阻）
- **接点与参考地由用户显式设置**：全电路至多一个参考地；不设地无法求解
- **线交叉不自动导通**：两条引线在无公共接点处相交时画跳线弧，电气上彼此独立
- **修正节点分析（MNA）**：mathjs 的 LU 分解求解；奇异时自动回退到带**行溯源**的
  Gauss–Jordan 消元——出现 `0 = 非零` 时能指出是哪些元件约束互相矛盾
- **每一行节点方程都能追到元件**：底部“MNA 方程”表格中悬停任意系数，
  原理图上高亮贡献该系数的元件（电导项来自电阻、±1 来自电压源、RHS 来自电流源/设定电压）
- **极性/方向全程一致**：统一以元件 a→b 为电流正方向，电压源 a 端为 `+`；
  `V = Va − Vb`，吸收功率 `P = V·I`（无源符号约定，<0 表示发出）
- **拖动图形不改变连接**：拖元件只改变它相对两端接点的图形参数 `(t, offset)`，
  `a/b` 连接关系不动；拖接点移动整网几何
- **工程存 IndexedDB**：编辑后防抖自动保存，支持多工程切换/删除
- **工程 JSON 导入/导出**：导出文件含接点、元件、连接、位置与参考地（不含 IndexedDB
  内部键），可跨浏览器交换；导入先校验数据版本、编号引用、元件值与重复地并列出问题
  对应的元件/接点，确认后总是创建新工程，绝不覆盖已有工程（同名工程可并存）
- 零电阻（0Ω 电阻与理想导线）先做并查集**超节点收缩**再列方程
- 结构预检：浮空子网、孤立节点、电流源割集冲突、纯电压源回路 KVL 一致性

## 技术栈

| 层 | 技术 |
| --- | --- |
| 交互 | Svelte 5（runes：`$state` / `$derived` / `$effect`）+ TypeScript |
| 原理图 | Konva（Canvas：符号、极性 ±、电流箭头、电位、跳线弧、缩放/平移） |
| 求解 | mathjs `lusolve` + 自研溯源 Gauss–Jordan 回退 |
| 持久化 | IndexedDB（`src/lib/storage.ts`），最近工程 id 存 localStorage |
| 构建 | Vite 6 |

## 开发

```bash
npm install
npm run dev       # 开发服务器
npm run build     # 类型无关的生产构建
npm run check     # svelte-check 类型检查（0 error）
npm run test      # vitest：引擎/状态/几何/SSR/持久化/导入导出单元测试（49 例）
npm run e2e       # Playwright + Chromium 端到端冒烟（33 例）
```

> e2e 需要可用的 Chromium：`npx playwright install chromium`。
> 无 root 的 Linux 沙箱若缺系统库（libnspr4/libnss3 等），`e2e/run.sh` 会自动加载
> `/tmp/chromelibs/extracted` 下手动解压的 arm64 deb 库；可用 `CHROME_PATH`
> 环境变量覆盖浏览器可执行文件路径。

## 目录

```
src/
  lib/
    engine/
      types.ts       电路与分析结果数据模型
      util.ts        并查集 DSU、数值校验
      solver.ts      mathjs LU + 溯源 Gauss-Jordan
      analyze.ts     MNA 组装、结构预检、支路量/KCL/功率、诊断信息
      analyze.test.ts
    geometry.ts      引线几何、交叉（跳线）检测、命中测试
    schematic/renderer.ts  Konva 渲染器
    factory.ts       内置示例（桥式/串联/矛盾/浮空/孤立/零电阻/割集）
    storage.ts       IndexedDB 封装
    transfer.ts      工程 JSON 导出 / 导入校验 / 新工程构建
    store.svelte.ts  工作台状态与编辑动作（runes）
    wb.svelte.ts     全局单例
  components/        Toolbar / Schematic / Inspector / AnalysisPanel / Transfer
```

## 操作

- 工具栏（或快捷键 S/N/W/R/V/I）选择模式
- **接点**：空白处单击；**元件/导线**：依次点两个接点
- 双击接点（或 G）设/撤参考地；双击元件（或 F）翻转极性
- 滚轮缩放、拖空白平移；Delete 删除选中
- 底部四个页签：诊断 / MNA 方程与溯源 / 节点 KCL / 功率平衡

## 诊断码

| code | 含义 |
| --- | --- |
| `NO_GROUND` / `MULTI_GROUND` | 未设参考地 / 多个参考地 |
| `DANGLING` / `BAD_VALUE` | 元件悬空 / 数值非法（含负数电阻、Infinity、NaN） |
| `VSOURCE_LOOP` | 理想电压约束矛盾：并联电压源不一致、被零电阻短路、纯电压源回路 KVL≠0 |
| `ICUTSET` | 电流源割集：闭合面只穿过电流源且电流代数和不为零（如异值电流源串联） |
| `FLOATING` | 子网与参考地之间无电阻/电压源通路，共模电位无定义 |
| `ISOLATED` | 孤立节点，无任何元件连接 |
| `REDUNDANT_VLOOP` | 零和冗余电压源回路（警告）：电位可定，源电流分配不唯一 |
| `RESIDUAL` / `SINGULAR` | 数值残差过大 / 剩余自由变量 |
