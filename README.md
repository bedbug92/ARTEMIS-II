# Artemis II — Orion Integrity Free-Return Trajectory Visualizer

> NASA/JPL HORIZONS 任务数据驱动的阿尔忒弥斯二号自由返回轨道三维可视化工具

## 项目概述

本项目基于 **Three.js + Vite** 构建，使用 **NASA JPL Horizons 星历数据**实时渲染阿尔忒弥斯二号（Artemis II）任务的完整自由返回轨道。你可以在三维空间中旋转、缩放、平移观察地球、月球与猎户座飞船的相对运动，并通过 HUD 面板查看实时遥测数据、任务阶段和动态图表。

![Tech Stack](https://img.shields.io/badge/Three.js-0.184.0-00d4ff?logo=three.js)
![Vite](https://img.shields.io/badge/Vite-8.0.14-646cff?logo=vite)
![License](https://img.shields.io/badge/License-MIT-green)

---

## 功能特性

### 3D WebGL 场景
- **地球** — 程序化生成的科幻风格纹理 + 轴向倾斜 23.44°（黄赤交角）+ 全息大气层辉光着色器
- **月球** — 程序化环形山纹理 + 轨道周期自转
- **猎户座飞船** — STL 三维模型加载（带锥形后备模型）+ 脉冲信标光晕 Sprite
- **星场背景** — 15000 颗星空粒子系统，叠加混合渲染
- **参考网格** — 渐隐式黄道面网格地板

### 真实轨道力学
- **数据来源**：JPL Horizons 星历（地球中心黄道 J2000 坐标系）
- **数据规模**：1284 个采样点 × 10 分钟间隔 × 9 天任务周期
- **插值算法**：Hermite 三次样条插值，位置与速度同步平滑
- **天体自转**：地球 GMST 自转、月球 27.3 天周期自转

### 交互控制
- **轨道控制器**：鼠标旋转 / 缩放 / 平移（阻尼平滑过渡）
- **视角切换**：总览 / 跟随猎户座 / 地球焦点 / 月球焦点
- **播放控制**：播放 / 暂停 / 重置 / 速度调节（1× ~ 10K×）
- **时间线拖拽**：任意跳转至任务任意时刻
- **刻度切换**：真实比例 / 视觉优化比例（天体放大 + 距离压缩）

### HUD 面板
- **遥测面板** — MET 任务计时、UTC 时间、地球距离、月球距离、当前阶段
- **事件面板** — 当前任务阶段描述（TLI、月球 SOI 进入、近月点等）
- **动态图表** — 速度曲线、地球距离曲线、月球距离曲线（渐变填充 + 游标指示）
- **任务队列** — 8 个关键事件时间线（点击跳转）
- **2D 共转地图** — 地月共转坐标系 SVG 轨道投影

### 可见性开关
- 出站弧段 / 入站弧段
- 三维标签
- 轨道尾迹
- 地月连线 + 参考网格

---

## 技术架构

```
src/
├── main.js                   # 主入口：动画循环、HUD 更新、UI 事件
├── style.css                 # 玻璃拟态科幻 HUD 样式
├── webgl/
│   └── scene.js              # Three.js 场景初始化、天体网格、程序化纹理
├── data/
│   └── trajectory.js         # JPL Horizons 星历数据 (1284 pts × 2)
└── math/
    └── interpolator.js       # Hermite 插值器、坐标系转换、速度场计算
```

| 技术点 | 实现 |
|--------|------|
| 渲染引擎 | Three.js WebGL + ACESFilmicToneMapping |
| 线条渲染 | Line2 / LineGeometry 宽线渲染管线 |
| 坐标系 | J2000 黄道 → Three.js (x, z, -y) |
| 插值 | Hermite 三次样条（位置 + 速度） |
| 共转投影 | 地月旋转坐标系 → SVG 二维映射 |
| 视觉缩放 | 非线性地月距离压缩 + 垂直分量放大 |

---

## 快速开始

### 环境要求
- **Node.js** ≥ 18
- **npm** ≥ 9

### 安装运行

```bash
# 克隆项目
git clone <repo-url>
cd "阿尔忒弥斯任务模拟"

# 安装依赖
npm install

# 启动开发服务器
npm run dev

# 构建生产版本
npm run build

# 预览生产构建
npm run preview
```

开发服务器默认运行在 `http://localhost:5173`。

---

## 任务阶段时间线

| 事件 | MET | 任务日 |
|------|-----|--------|
| Orion/ICPS 分离 | T+0/03:24:18 | 0.14 |
| 地月转移点火 (TLI) | T+1/01:13:48 | 1.05 |
| 出站修正点火 (OTC-1) | T+4/04:28:05 | 4.19 |
| 月球 SOI 进入 | T+4/07:03:32 | 4.29 |
| 近月点 (6545 km) | T+5/00:25:48 | 5.02 |
| 最大地心距 (413,146 km) | T+5/00:29:48 | 5.02 |
| 返回修正点火 (RTC-1) | T+6/12:00:00 | 6.50 |
| 大气层再入 / 溅落 | T+9/01:32:00 | 9.05 |

---

## 轨道数据说明

轨迹数据来源于 **NASA JPL Horizons System**：

- **坐标系**：地球中心黄道 J2000（Earth-centered Ecliptic J2000）
- **时间范围**：2026-04-02 01:58:32 UTC → 2026-04-10 23:48:32 UTC
- **采样间隔**：10 分钟（600 秒）
- **覆盖阶段**：从 ICPS 分离 → 自由返回 → 大气层再入

速度场采用**中心差分法**从位置数据计算，边界点使用前向/后向差分。

---

## 操作指南

| 操作 | 方式 |
|------|------|
| 旋转视角 | 鼠标左键拖拽 |
| 缩放视角 | 鼠标滚轮 |
| 平移视角 | 鼠标右键拖拽 |
| 播放/暂停 | 底部 Play/Pause 按钮 |
| 速度切换 | 底部 1× / 1K× / 5K× / 10K× |
| 任务跳转 | 拖拽时间线滑块 或 点击任务队列事件 |
| 视角切换 | 底部下拉菜单 |
| 真实比例 | 勾选 "True scale" 复选框 |
| 可见性控制 | 底部 5 个复选框开关 |

---

## 许可证

MIT License

---

## 数据致谢

- **JPL Horizons On-Line Ephemeris System** — NASA Jet Propulsion Laboratory
- **Artemis II Trajectory Data** — NASA Exploration Systems Development Mission Directorate
