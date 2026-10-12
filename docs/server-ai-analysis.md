# 服务器转录与本机 Codex 分析

账号研究第一版支持抖音：输入主页链接，查询近90天、最多3页60条作品，使用批量统计接口获得播放量，按已采集作品播放量取前10条。未知播放不按0排名。查询缓存24小时，与工作台每天采集共用TikHub总额度。只有选择一条作品时才追加详情请求并下载转录；粘贴逐字稿可跳过详情和转录。

处理路径：工作台任务 → 服务器 FFmpeg/Whisper 转录 → 私有 SSH 传输 → 已配置的本机已登录的 Codex CLI → 结果经 SSH 写回工作台。账号 AI 周复盘也继续使用这个本机服务。服务器不调用 Codex，不复制本机登录凭证，也不开放公开AI接口。

自动转录限制10分钟、200 MiB，服务器单任务执行。使用Whisper small 中文转写，临时媒体成功或失败都清理。分析基于逐字稿，不能识别画面、表情、运镜或留存；报告须注明依据局限，原文引用会校验。AI不会自动创建需求、替代审核或更改奖金。

## 服务器转录服务

专用用户运行 `scripts/server-analysis-worker.mjs`，`SERVER_ANALYSIS_CONFIG` 指向JSON，字段为 `dbFile`、`ffmpegPath`、`whisperPath`、`modelPath`、`tmpDir`（均绝对路径）。无需 `codexPath`。

构建 `npm run build:review-worker`，部署上述服务、`scripts/transcribe-video.mjs` 和生成的 `.account-review-worker` 到专用目录。用户需要SQLite数据库、WAL/SHM及目录读写权限；新增文件也应保留工作台应用用户读写权限。建议systemd限制CPU、内存和可写目录，不需要开放端口。

任务状态：queued → transcribing → ready → running → done。粘贴文字的任务从queued直接被本机领取。两个服务领取互斥、使用不同租约；超时或旧租约不能回填。服务器只处理转录，本机只处理AI。

## 本机分析服务

安装 `org.contentworkbench.account-review` LaunchAgent，`scripts/install-account-review-worker.mjs` 更新脚本和模块。本机需保持开机、联网、Codex已登录并能SSH访问你自己的服务器。配置 `transport: ssh`、`host`、`identityFile`、`codexPath`；密钥不写入仓库。

任务及结果仅经现有SSH/docker私有传输。Codex进程使用只读、临时会话、结构化输出，禁用工具和联网搜索，不传入工作台密钥。断网/休眠时任务等待；连接恢复后继续，过期任务可重新生成。

参考：[TikHub官方目录](https://github.com/TikHub/TikHub-API-Python-SDK/blob/main/docs/reference.md)、[Whisper.cpp](https://github.com/ggml-org/whisper.cpp)、[Codex登录说明](https://learn.chatgpt.com/docs/auth)。

## 工作流 AI 辅助

- 创意库每条创意可生成需求草稿，结果带入新需求单后仍需编辑并提交；自动保存键包含AI报告ID，避免旧草稿覆盖新建议。
- 视频详情可粘贴脚本正文，系统自动带入需求和必拍镜头供检查；不读取外部文档，不代替人工审核。
- 有打回记录的视频可整理最新审核意见，保留原分类、评论和结论，不调整计件或奖金；仅相关编导、审核人、剪辑和老板可用。
- 账号复盘显示最新完整周的规则异常，缺失数据单独提示；平均播放下降需要双方至少3条完整成熟作品、匹配平台、下降至少50%。产出下降只比较完整周，上周至少3条。同账号、同周、同类型通知去重，由负责编导处理。AI解读按需发起，不自动为每个账号调用模型。

所有AI辅助与爆款拆解共用每天30项任务上限，相同用户和输入缓存24小时。输出引用须匹配提交数据；无工具权限，也不会自动改动需求、审核或财务记录。生成结果只对发起人可见，账号/视频权限变更后重新检查访问权限。
