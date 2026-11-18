# 云途Agent（zh-CN 中文版）同步维护指南

本仓库 fork 自上游 `BaaRai/ARTEX`（原始作者 Autumn-27 的仓库已转私有，BaaRai 为社区维护线）。

## 分支结构

| 分支 | 内容 | 用途 |
|---|---|---|
| `main` | 纯上游代码，跟踪 `upstream/main`，不含自定义改动 | 同步上游的基准 |
| `zh-cn` | `main` + 中文化与「云途Agent」品牌 commit（`481c932`） | **日常部署/构建用的分支** |

上游远程已配置为 `upstream → https://github.com/BaaRai/ARTEX`。

## 上游更新后的同步流程

上游有新提交时，按以下顺序执行：

```bash
# 1) main 快进合并上游（此分支不引入自定义改动，永不冲突）
git fetch upstream
git checkout main
git merge --ff-only upstream/main
git push origin main

# 2) 把中文化 commit 挪到新的 main 上（冲突集中在此步解决）
git checkout zh-cn
git rebase main
git push --force-with-lease origin zh-cn
```

GitHub 网页上的 **Sync fork → Update branch** 等价于第 1 步，可直接点；第 2 步仍需在命令行完成。

## 冲突说明

中文化 commit 修改了 `web/src` 下约 100 个文件。上游更新时：

- 上游没动 `web/src` → rebase 干净无冲突；
- 上游改了 `web/src` 的个别文案/组件 → rebase 时仅冲突对应的行，按上下文手工选择；
- 上游大规模重构前端 → 冲突量较大，建议先评估上游 diff 再决定 rebase 或重做翻译。

解决 rebase 冲突后继续：

```bash
# 编辑冲突文件 → 标记已解决 → 继续
git add <冲突文件>
git rebase --continue

# 中途放弃
git rebase --abort
```

## 部署

构建/部署请基于 `zh-cn` 分支：

```bash
git checkout zh-cn
cp .env.example .env        # 改 POSTGRES_PASSWORD，填 LLM key
docker compose up -d --build
```

前端为静态导出 + `go:embed` 打包进单二进制；`web/` 为 Next.js，`cd web && npm install && npm run build:static` 可单独验证前端构建，`tsc --noEmit` 做类型检查。

## 中文化约定（维护翻译时保持术语一致）

- 术语：Task→任务、Intent→意图、Finding→漏洞、Goal→目标、Asset→资产、Planner→规划器、Worker→执行器、Intercept→拦截、Approval→审批、Coverage→覆盖、Category→分类、Uncategorized→未分类、Archive→归档。
- 状态：created→已创建、queued→排队中、running→运行中、paused→已暂停、done→已完成、failed→已失败、timeout→已超时。
- 不翻译：枚举/状态值（参与逻辑比较）、`localStorage` 键、API 路径/URL、技术名词（LLM、MCP、nmap、nuclei 等）、后端返回的原始内容。
- 登录用户名接受 `云途Agent` 与 `ARTEX`（`server/auth.go`），JWT subject 内部仍为 `ARTEX`。
