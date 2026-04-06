# 灭火器航天局 开发手册

本文档面向后续开发者，记录当前项目的实际实现、调参逻辑、发布流程和维护约定。

## 1. 项目概览

- 项目代号: `灭火器航天局`
- 类型: Three.js + Cannon-es 物理恶搞 3D 小游戏
- 技术栈:
  - 渲染: `three`
  - 物理: `cannon-es`
  - 语言: `TypeScript`
  - 构建: `Vite`
  - 部署: `Cloudflare Pages` + `GitHub Pages`

当前玩法特征:
- A 键驱动左灭火器
- D 键驱动右灭火器
- 单侧推进会带来失控滚转
- 双侧推进更适合长距离冲刺
- 椅子有额外底部配重，避免出生即翻车
- 火柴人宇航员通过松弛约束挂在椅子上
- 地图已经扩展为长纵深办公室赛道，不再是短房间

## 2. 目录结构

```txt
.
├─ .github/workflows/deploy-pages.yml   # GitHub Pages 自动部署
├─ DEVELOPMENT_MANUAL.md                # 本开发手册
├─ index.html                           # Vite 浏览器入口
├─ package.json                         # 脚本与依赖
├─ tsconfig.json                        # TypeScript 配置
├─ vite.config.ts                       # 双部署目标的 base 配置
└─ src/main.ts                          # 游戏主逻辑
```

说明:
- 当前所有运行时逻辑集中在 `src/main.ts`
- 这是刻意保留的单文件原型结构，便于快速试错
- 如果继续做系统化迭代，建议后续拆成 `entities`、`systems`、`ui`、`config`

## 3. 环境要求

- Node.js: `20+`
- npm: `10+`
- 可选部署工具:
  - `wrangler` 用于 Cloudflare Pages
  - `gh` 用于 GitHub 相关操作

检查命令:

```bash
node -v
npm -v
wrangler --version
gh --version
```

## 4. 常用命令

安装依赖:

```bash
npm install
```

本地开发:

```bash
npm run dev
```

Cloudflare 生产构建:

```bash
npm run build
```

GitHub Pages 构建:

```bash
npm run build:pages
```

本地预览:

```bash
npm run preview
```

## 5. 运行架构

`src/main.ts` 采用单文件游戏循环:

1. 创建 Three 场景、相机、渲染器和灯光
2. 创建 Cannon 世界与接触材质
3. 创建地板、墙体、障碍、老板门
4. 创建办公椅载具
5. 创建火柴人宇航员刚体与约束
6. 绑定输入、碰撞和 UI
7. 在 `requestAnimationFrame` 中执行固定物理步进和渲染

### 5.1 时间步进

- 固定物理步长: `FIXED_TIME_STEP = 1 / 60`
- 帧时间上限裁剪: `0.05`
- 使用 `accumulator` 消化掉多余帧时间

这样做的目的:
- 让物理不至于完全飘掉
- 保留一点失控和沙雕感
- 避免浏览器掉帧时直接炸穿

## 6. 世界设计

### 6.1 当前地图参数

当前实现中场地不是正方形，而是长赛道:

- `WORLD_WIDTH = 38`
- `WORLD_LENGTH = 136`
- 出生点位于地图后段靠近起点墙的位置
- 老板门位于地图尽头

实际效果:
- 游戏目标变成长距离办公楼冲刺
- 中段和后段都布有障碍
- 需要持续修正姿态，而不是短距离莽过去

### 6.2 场景元素

- 地板: 灰色长方体地面
- 墙体: 四面静态墙
- 办公桌: 多张长桌，作为高频碰撞障碍
- 饮水机: 圆柱视觉 + 盒体碰撞体
- 老板门: 红色终点门

碰撞标签通过 `body.userData.type` 识别:
- `floor`
- `wall`
- `desk`
- `cooler`
- `boss-door`
- `chair`

## 7. 载具设计

### 7.1 办公椅刚体

办公椅不是单一盒体，而是多形状拼出来的复合刚体:

- 坐垫
- 底座
- 靠背
- 隐藏配重块

当前关键参数:
- `mass = 14`
- `linearDamping = 0.3`
- `angularDamping = 0.58`

隐藏配重的作用:
- 增强初始稳定性
- 防止还没输入就前扑翻车
- 让推进的失败更多来自玩家操作，而不是出生抖动

### 7.2 推进系统

当前推进常量:

- `THRUST_UP_FORCE = 240`
- `THRUST_FORWARD_FORCE = 260`

当前施力点:

- 左侧: `(-0.96, 0.28, 0.2)`
- 右侧: `(0.96, 0.28, 0.2)`

设计目的:
- 仍然保留明显扭矩
- 但相较于初版，不会因为推力太弱而飞不起来
- 双喷时可以稳定推进长地图

## 8. 宇航员与约束

宇航员由 5 个长方体部件组成:

- 臀部
- 左臂
- 右臂
- 左腿
- 右腿

这些刚体通过 `PointToPointConstraint` 和椅子连接。

关键设计:
- 臀部约束较强，保证主躯干不完全脱离
- 四肢约束较松，保证甩动和喜剧感
- `collideConnected = false`

最后一项很重要:
- 如果约束连接的部件继续相互碰撞，椅子会在出生点附近被自撞掀翻
- 当前实现已经关闭这些自碰撞

## 9. 障碍与挑战设计

当前障碍不再只分布在前半段，而是贯穿整条赛道:

- 桌子按多段 `z` 轴区间分布
- 饮水机同时承担节奏切割和边线干扰
- 中后段仍有密集障碍，避免长地图变成无聊直线

当前挑战结构更接近:

1. 起步纠姿区
2. 中段障碍穿插区
3. 后段长距离稳定推进区
4. 终点门前的最后调整区

## 10. 粒子、镜头与 UI

### 10.1 粒子

- 按键时在扶手附近喷出白色干粉粒子
- 粒子会在短生命周期内放大并淡出
- 材质按实例释放，几何体共享，不重复销毁

### 10.2 镜头

- 跟随是松弛 `lerp`
- 同时叠加周期性抖动
- 高速时画面有额外轻微倾斜和滤镜变化

目标不是稳定观感，而是“晕乎乎但还能玩”。

### 10.3 UI

- 左上角固定展示标题和操作说明
- 中央横幅显示状态:
  - `RESIGNATION PENDING...`
  - `RESIGNATION REJECTED`
  - `YOU ARE FIRED (YOU WIN)`

## 11. 判定逻辑

### 11.1 失败提示

当以下条件同时满足时触发:

- 椅子发生 `collide`
- 对象类型是 `wall` 或 `desk`
- 冲击法向速度 `>= IMPACT_THRESHOLD`

当前阈值:

- `IMPACT_THRESHOLD = 9.5`

### 11.2 胜利

当椅子碰到 `boss-door`:

- 置 `isWin = true`
- 常驻显示胜利提示
- 其他短暂横幅不再覆盖胜利状态

## 12. 当前关键参数

最常改的参数分组如下。

地图:
- `WORLD_WIDTH`
- `WORLD_LENGTH`
- `obstacleSeeds`
- `makeWaterCooler(...)` 的坐标分布

手感:
- `THRUST_UP_FORCE`
- `THRUST_FORWARD_FORCE`
- `chairBody.mass`
- `linearDamping`
- `angularDamping`
- 推力作用点

判定:
- `IMPACT_THRESHOLD`

镜头:
- `camera.position.lerp(...)` 系数
- `wobble` 的振幅和频率

粒子:
- 喷射间隔阈值
- 生命周期
- 初速度扰动

## 13. 调参建议

推荐顺序:

1. 先定地图长度和障碍密度
2. 再定推进力和阻尼
3. 再修出生稳定性
4. 最后调镜头和视觉噪声

经验:
- 地图太短时，玩家感知不到推进系统的乐趣
- 地图太长但没障碍，会变成无聊直线冲刺
- 推力太高又没有阻尼，会变成随机翻车模拟器
- 约束不关自碰撞，会出现“还没玩就翻”的伪 bug

## 14. 构建与双部署

当前项目需要同时兼容两种托管:

- Cloudflare Pages
- GitHub Pages

### 14.1 Vite base 策略

`vite.config.ts` 根据 mode 切换:

- 默认 `build`: `base = '/'`
- `github-pages` 模式: `base = '/extinguisher-space-agency/'`

这点是必要的，因为:

- Cloudflare 项目域名走根路径
- GitHub Pages 项目页走子路径

### 14.2 npm scripts

`package.json` 当前脚本:

- `npm run build`
  - 供 Cloudflare 使用
- `npm run build:pages`
  - 供 GitHub Pages 使用

### 14.3 GitHub Pages

工作流文件:

- `.github/workflows/deploy-pages.yml`

工作流会在推送 `main` 时执行:

1. `npm ci`
2. `npm run build:pages`
3. 上传 `dist`
4. 发布到 GitHub Pages

线上地址:

- [GitHub Pages](https://buleegasy.github.io/extinguisher-space-agency/)

### 14.4 Cloudflare Pages

Cloudflare 采用直接上传 `dist` 的方式部署。

常用流程:

```bash
npm run build
wrangler pages deploy dist --project-name extinguisher-space-agency
```

如果工作区有未提交改动，可显式允许:

```bash
wrangler pages deploy dist --project-name extinguisher-space-agency --commit-dirty=true
```

稳定线上地址:

- [Cloudflare Pages](https://extinguisher-space-agency.pages.dev)

## 15. 故障排查

### 15.1 打开页面白屏

优先检查:

1. HTML 里引用的脚本路径是否和当前托管环境匹配
2. Cloudflare 是否错误拿到了 GitHub Pages 版产物
3. 浏览器控制台是否有模块 404 或运行时异常

已知案例:
- 如果 Cloudflare 部署了 `build:pages` 产物，脚本路径会变成 `/extinguisher-space-agency/assets/...`
- 在 Cloudflare 根域名下，这会直接导致白屏

### 15.2 出生点立刻翻车

检查:

1. 是否还保留隐藏配重
2. `angularDamping` 是否被调低过头
3. 约束的 `collideConnected` 是否被错误改回 `true`

### 15.3 长地图仍然无聊

不要只继续加 `WORLD_LENGTH`。

优先改:

1. 后半段障碍密度
2. 终点前的窄通道
3. 左右路线差异

### 15.4 构建失败

检查:

1. `npm install` 是否执行过
2. `@types/three` 是否存在
3. Node 版本是否过旧

## 16. 验收清单

每次改动后至少确认:

1. `npm run build` 通过
2. A/D 单键和双键喷射均可用
3. 出生后椅子不会无输入直接翻车
4. 中后段地图确实有障碍，不是空跑
5. 撞墙/撞桌会弹失败提示
6. 碰老板门会弹胜利提示
7. Cloudflare 地址能正常加载
8. GitHub Pages 地址能正常加载

## 17. 后续建议

优先级更高的下一步不是继续无脑加长度，而是加结构化难度:

1. 后段窄道
2. 蛇形桌阵
3. 可移动轻障碍
4. 计时与重开
5. 地图种子和关卡化

维护约定:
- 改动手感参数时，要同时记录受影响常量
- 改动部署流程时，要同步更新本手册
- 改动地图结构时，要同时检查 Cloudflare 和 GitHub Pages 两条发布链路
