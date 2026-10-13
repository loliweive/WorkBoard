# WorkBoard — 开发日志

---

## 2026-10-09 ~ 2026-10-13｜初始开发会话

### 背景
项目已有基础版本（Kanban 看板、笔记、倒计时），本次会话在此基础上增加多项功能。

---

### 优先级功能（主任务 + 子任务）

**需求**：主任务和子任务各自独立优先级，支持内联点击修改，列内按优先级排序。

**实现**：
- `server.py`：`create_task` 加 `priority` 字段（默认 `medium`），`update_task` 支持更新；子任务 `priority` 随 `subtasks` 数组整体同步
- `app.js`：新增 `prioVal` / `priorityBadge` / `prioDot` 辅助函数；`renderAll` 列内排序；`makeCard` 子任务排序 + 圆点；action handler 处理 `priority` / `subtask-prio` 内联点击
- `index.html`：任务弹窗加优先级三按钮选择器
- `style.css`：badge、圆点、按钮组样式

**坑**：`.hidden` 无全局规则，需为每个 `display:flex` 容器单独加 `.xxx.hidden { display:none }`（后来修了 `.countdown-list.hidden`）。

---

### 使用说明弹窗

**需求**：在 UI 内展示任务结构原则（标签/主任务/子任务的区分标准）。

**实现**：
- Header 加"？"圆形按钮 → 打开 `modal-help`
- 内容：结构原则表格、三句话总结、正误示例、优先级说明

---

### 设备流转台账

**需求**：登记设备、记录借出/归还、保留完整流转历史、可划掉退役设备。侧边栏展示。

**数据结构**：
```json
{
  "id": "uuid", "name": "...", "serial": "...",
  "retired": false, "created": "2026-10-09",
  "records": [{"id":"uuid","action":"借出","person":"张三","date":"2026-10-09"}]
}
```

**实现**：
- `data/devices.json`（新文件）
- `server.py`：4 个端点 `GET/POST /api/devices`，`POST /api/devices/<id>/record`，`PUT /api/devices/<id>`
- `app.js`：`loadDevices` / `renderDevices`，设备卡片含状态徽章、流转历史折叠、借出/归还/划掉/恢复按钮
- 侧边栏 `</aside>` 前加新区块；新增 2 个弹窗（新增设备、借出记录）

---

### 月度总结月份选择

**问题**：原"本月总结"按钮硬编码当月，无法生成历史月份总结。

**发现**：`server.py` 已支持传 `month` 参数（如 `"2026-09"`），只是前端没暴露。

**修复**：按钮改为先弹月份选择弹窗（`<input type="month">` 默认当前月），再调接口。

---

### 法定假日折叠

**需求**：默认折叠，点击展开。

**实现**：标题加 `▶/▼` 箭头 + click handler 切换 `hidden`；style.css 补 `.countdown-list.hidden { display: none }`（之前漏掉的全局 hidden 规则）。

---

### GitHub 推送

- 仓库：`github.com/loliweive/WorkBoard`
- `.gitignore` 排除：`__pycache__/`、`.claude/`、`data/notes/`
- 提交身份使用 `loliweive <loliweive@users.noreply.github.com>`（已将原始工作邮箱从记录中移除，force push 覆盖）

---

### README

创建 `README.md`，包含：环境要求、启动方式、功能介绍、任务结构建议、数据文件说明、待加入功能列表。
