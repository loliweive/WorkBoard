# WorkBoard — 开发状态

> 最后更新：2026-10-13

## 项目定位
个人任务看板 + 设备流转台账，本地运行，JSON 文件存储。

## 技术栈
- 后端：Flask (Python)，`server.py`
- 前端：Vanilla JS (`static/app.js`) + CSS (`static/style.css`)
- 桌面：pywebview (`desktop.pyw`)，透明悬浮窗口
- 数据：`data/tasks.json`、`data/devices.json`、`data/countdowns.json`、`data/notes/<id>.json`

## 当前已实现功能
| 功能 | 状态 | 关键文件 |
|------|------|---------|
| Kanban 三列看板（拖拽、状态流转）| ✅ | app.js `renderAll` / `makeCard` |
| 子任务（勾选自动推进父任务）| ✅ | app.js `makeCard` |
| 标签、截止日期、关联文件夹 | ✅ | server.py + app.js |
| 优先级（主任务 + 子任务，内联点击切换，列内排序）| ✅ | `prioVal` / `priorityBadge` / `prioDot` |
| 笔记系统（图片粘贴/上传，懒加载）| ✅ | app.js notes 区块 |
| 设备流转台账 | ✅ | `/api/devices` + `renderDevices` |
| 月度总结（可选月份）| ✅ | `/api/monthly_summary` |
| 法定假日倒计时（可折叠）| ✅ | `loadHolidays` |
| 自定义倒计时 | ✅ | `loadCountdowns` |
| 全局搜索 | ✅ | `applySearch` |
| 使用说明弹窗（？按钮）| ✅ | `modal-help` |
| GitHub 仓库 | ✅ | github.com/loliweive/WorkBoard |

## 待开发（见 README.md）
- 任务归档管理
- 标签管理页
- 截止日期提醒（系统托盘）
- 时间追踪
- 任务模板
- 设备台账导出 Excel

## 已知问题 / 注意事项
- `data/notes/` 存储 base64 图片，已加入 `.gitignore`，不推送
- 法定假日硬编码在 `server.py` HOLIDAYS 列表，需要手动更新（目前到 2027 年）
- 桌面窗口透明度通过 WinAPI 实现，非 Windows 系统无法使用 `desktop.pyw`

## 启动方式
```
双击 任务看板启动.bat   # 桌面模式
双击 启动.bat           # 浏览器模式
```
