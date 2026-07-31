Title: Release 1.20.3

Body:

**Build Type:** patch release
**Version:** 1.20.3
**Build:** 123
**Release Date:** 2026-07-03

### ⚠️ 重要提示

本版本为补丁版本更新 (Patch Release)，主要包含错误修复和小幅优化。建议及时更新以获得更好的使用体验。

如果您跨多个版本更新，建议查看中间版本的变更说明。

Compare: [v1.20.2...v1.20.3](https://github.com/JavdBviewed/JavdBviewed/compare/v1.20.2...v1.20.3)

### Features
- feat: 实现回收站功能，添加软删除与恢复机制 - by Adsryen on 2026-07-03 ([a493f09f](https://github.com/JavdBviewed/JavdBviewed/commit/a493f09ff3804d24a295720ec85e0326cadd9246))
- feat(records/export): add numeric-dash番号支持与选中记录导出功能 - by Adsryen on 2026-07-03 ([5826ef39](https://github.com/JavdBviewed/JavdBviewed/commit/5826ef394a885789a8e4e559dc4e5bd5096faf05))
- feat(webdav): 实现带进度反馈的WebDAV统一恢复功能 - by Adsryen on 2026-06-29 ([98d920ba](https://github.com/JavdBviewed/JavdBviewed/commit/98d920baedb488b1e5f0edc6dad2bb529b084f3b))
- feat(webdav): 实现按类别选择恢复策略的功能 - by Adsryen on 2026-06-29 ([59819bd1](https://github.com/JavdBviewed/JavdBviewed/commit/59819bd1d85ccf8253a988c7bfdbed8ba2e9a23a))
- feat(webdav): 新增清单/系列/番号的WebDAV备份和恢复功能 - by Adsryen on 2026-06-25 ([de2a8baf](https://github.com/JavdBviewed/JavdBviewed/commit/de2a8baf1502d707b9cbec3879c8b5bfe3f395b8))
- feat(webdav): 实现WebDAV备份文件按设备筛选和清理功能 - by Adsryen on 2026-06-17 ([88e92505](https://github.com/JavdBviewed/JavdBviewed/commit/88e925056e849c0679888e35e8bca27ebd42848b))
- feat(settings-search): 增强设置搜索功能并优化高亮显示 - by Adsryen on 2026-06-10 ([9c54d618](https://github.com/JavdBviewed/JavdBviewed/commit/9c54d6183006b3ae7ae66567da855871479f2d75))
- feat(emby): 重构媒体服务器匹配逻辑，支持自动识别已配置服务器地址 - by Anderson-Ryen on 2026-06-07 ([dbdbcb74](https://github.com/JavdBviewed/JavdBviewed/commit/dbdbcb7468847cc4b9c83bbd2b3abcd830fbb634))
- feat(actor): 改进演员元数据刷新功能，增加维基数据获取失败诊断 - by Adsryen on 2026-06-05 ([8544fdd6](https://github.com/JavdBviewed/JavdBviewed/commit/8544fdd6f4e61d532ff1a4842b07ea0d60da4427))
- feat(records): 番号库优化 IndexedDB 记录持久化 - by Adsryen on 2026-06-04 ([d3d7a049](https://github.com/JavdBviewed/JavdBviewed/commit/d3d7a0497941355a91c9c401e33736eced6b2377))
- feat(settings): 添加列表页状态快捷标识功能 - by Adsryen on 2026-06-04 ([b33aa514](https://github.com/JavdBviewed/JavdBviewed/commit/b33aa5140a6781e6da5e34d85ed0f2533653646f))
- feat(emby): 添加 Emby/Jellyfin 媒体库入库状态显示功能 - by Adsryen on 2026-06-03 ([a4d2ff74](https://github.com/JavdBviewed/JavdBviewed/commit/a4d2ff741668441a6f1baed1a407ffb93856da85))
- feat(telemetry): 重构扩展功能指标 - by Adsryen on 2026-06-03 ([76ddcfd8](https://github.com/JavdBviewed/JavdBviewed/commit/76ddcfd80c2d243540a42ab1cb1c30906339201f))
- feat: 优化错误事件上报 - by Adsryen on 2026-06-03 ([a79186f4](https://github.com/JavdBviewed/JavdBviewed/commit/a79186f48b299e73bbf5e5f5f334599ad15100ce))
- feat(insights): 优化报告月份标签生成逻辑 - by Adsryen on 2026-06-02 ([822baa30](https://github.com/JavdBviewed/JavdBviewed/commit/822baa301e35e1d381d0773ef5dfcdadb6500043))
- feat(detail): 增加详情页外部搜索和字幕搜索 - by Adsryen on 2026-05-29 ([3f618a41](https://github.com/JavdBviewed/JavdBviewed/commit/3f618a41e4121add9682c220126db4e6ca712134))

### Fixes
- fix(network): 修复请求调度器中fetch调用的上下文问题 - by Adsryen on 2026-06-03 ([b2f3cda4](https://github.com/JavdBviewed/JavdBviewed/commit/b2f3cda4e36a794c6e7dd4181b6fcdf8656598a8))
- fix(magnets): 合并多源磁力结果并优化状态标签 - by Adsryen on 2026-05-29 ([9f23c31e](https://github.com/JavdBviewed/JavdBviewed/commit/9f23c31e569f5b2c445445540b8a1fa0e71b49a1))

### Other Changes
- chore: 添加 tmp/ 到 .gitignore - by Adsryen on 2026-07-03 ([8f97e18f](https://github.com/JavdBviewed/JavdBviewed/commit/8f97e18fcf0c0a83c71dc9516173a8a76934f113))
- docs: 创建代码注释完善计划文档 - by Adsryen on 2026-06-30 ([dedb20ab](https://github.com/JavdBviewed/JavdBviewed/commit/dedb20abdbfcbf693a0e7e5e8297ca0ef7424cdf))
- build(test): 调整测试超时并完善WebDAV恢复功能 - by Adsryen on 2026-06-29 ([2c473863](https://github.com/JavdBviewed/JavdBviewed/commit/2c473863ebef648e96b3fc6b47820b62abdc7af6))
- chore: 新增更新日志并完善构建脚本 - by Adsryen on 2026-06-25 ([222ff158](https://github.com/JavdBviewed/JavdBviewed/commit/222ff15854e653d65583038c46009bd56bf380c1))
- refactor(log): 重构日志设置中的控制台输出抑制选项样式 - by Adsryen on 2026-06-09 ([c9a9b445](https://github.com/JavdBviewed/JavdBviewed/commit/c9a9b4451aa19dbb360e317dc855e5aea7e45e1b))
- refactor(webdav): 重构WebDAV同步功能并优化记录清理逻辑 - by Adsryen on 2026-06-04 ([f521e653](https://github.com/JavdBviewed/JavdBviewed/commit/f521e65393c57b1e84ae8404c5b2b803ce8d7129))
- refactor(dashboard): 重构 dashboard 初始化逻辑并提取功能模块 - by Adsryen on 2026-06-03 ([1eff22a4](https://github.com/JavdBviewed/JavdBviewed/commit/1eff22a492ccc559b74530325f78b265e82c3e38))
- refactor(newWorks): 重构新作品标签页代码结构 - by Adsryen on 2026-06-03 ([7cbbd89b](https://github.com/JavdBviewed/JavdBviewed/commit/7cbbd89b31b4bda816b07c12a410b907417a8a93))
- refactor(dashboard): 重构演员标签页为模块化架构 - by Adsryen on 2026-06-03 ([a63906fc](https://github.com/JavdBviewed/JavdBviewed/commit/a63906fcac97cda1facdfe06c434884709146f51))
- refactor(tests): 重构测试代码结构和依赖导入 - by Adsryen on 2026-06-02 ([89991eb3](https://github.com/JavdBviewed/JavdBviewed/commit/89991eb349af2889d33fafd87498b00f70783234))
- test(ai): 添加新API客户端测试并修复非流式聊天完成的thinking设置 - by Adsryen on 2026-06-02 ([ea8c947f](https://github.com/JavdBviewed/JavdBviewed/commit/ea8c947fdbac395b2372665593ce1cedf1c99db2))
- refactor(dashboard): 拆分 insights 模块为独立组件 - by Adsryen on 2026-06-02 ([e5eb5465](https://github.com/JavdBviewed/JavdBviewed/commit/e5eb5465d2b99e0f13a54043a67ce1477ebc0c86))
- refactor(records): 重构记录页面组件结构并提升构建版本号 - by Adsryen on 2026-06-02 ([4fff87fd](https://github.com/JavdBviewed/JavdBviewed/commit/4fff87fd64a8b9283983e7b7bed66ebaaebfbe8f))
- refactor(dashboard): 拆分 WebDAV 恢复页 - by Adsryen on 2026-06-01 ([4363c56f](https://github.com/JavdBviewed/JavdBviewed/commit/4363c56fc482247757e2fcd088161d7e740df8a0))
- refactor(dashboard): 收拢 WebDAV 分析预览 UI 状态 - by Adsryen on 2026-06-01 ([25f06d36](https://github.com/JavdBviewed/JavdBviewed/commit/25f06d36a6e5707ca3c611a415754e693cd8d30c))
- refactor(dashboard): 收拢 WebDAV 云端预览 UI 状态 - by Adsryen on 2026-06-01 ([4368e7a4](https://github.com/JavdBviewed/JavdBviewed/commit/4368e7a48a610772ec2befe8bdb92ea04b63b2b7))
- refactor(dashboard): 拆分 WebDAV 恢复弹窗状态模型 - by Adsryen on 2026-06-01 ([a891a9ce](https://github.com/JavdBviewed/JavdBviewed/commit/a891a9ceb8be53bd40ec33c954b010475a508567))
- refactor(dashboard): 清理 WebDAV 旧恢复保存残留 - by Adsryen on 2026-06-01 ([4804f641](https://github.com/JavdBviewed/JavdBviewed/commit/4804f641df5b2085346d6753c4a1836cb4194843))
- refactor(dashboard): 收拢 WebDAV 恢复 storage key 映射 - by Adsryen on 2026-06-01 ([46b4aa3f](https://github.com/JavdBviewed/JavdBviewed/commit/46b4aa3fc993df6677246f9f17ac32d8614ffa7d))
- refactor(dashboard): 复用 WebDAV 回滚写入计划模型 - by Adsryen on 2026-06-01 ([f4e472cc](https://github.com/JavdBviewed/JavdBviewed/commit/f4e472cc0f21a5fbf6a66158fd8a87d9abba5c79))
- refactor(dashboard): 拆分 WebDAV 恢复写入计划模型 - by Adsryen on 2026-06-01 ([7ac9b879](https://github.com/JavdBviewed/JavdBviewed/commit/7ac9b879b167daf6f13a8e711346178235dc00bf))
- refactor(dashboard): 扩展 WebDAV 恢复备份选择模型 - by Adsryen on 2026-06-01 ([133e5af7](https://github.com/JavdBviewed/JavdBviewed/commit/133e5af7e38e41a1d49eb126b0dda41d250d9f0f))
- refactor(dashboard): 拆分 WebDAV 恢复前备份模型 - by Adsryen on 2026-06-01 ([dc2edeba](https://github.com/JavdBviewed/JavdBviewed/commit/dc2edeba7648494b2cd490d3da5c8b03e7b07ae7))
- refactor(dashboard): 拆分 WebDAV 恢复数据校验模型 - by Adsryen on 2026-06-01 ([78270a77](https://github.com/JavdBviewed/JavdBviewed/commit/78270a77b0fbc2119a0ed11370a2a3fd92e669ac))
- docs: 更新 WebDAV 恢复执行拆分清单 - by Adsryen on 2026-05-31 ([e4d96754](https://github.com/JavdBviewed/JavdBviewed/commit/e4d96754b8143c4d5f9c1b9e1f49ade296236d4d))
- refactor(dashboard): 拆分 WebDAV 恢复结果页 UI 状态 - by Adsryen on 2026-05-31 ([8933f630](https://github.com/JavdBviewed/JavdBviewed/commit/8933f63059f79993c22d20f8a7105e1d80422c10))
- refactor(dashboard): 拆分 WebDAV 恢复类别选择模型 - by Adsryen on 2026-05-31 ([d3ef74aa](https://github.com/JavdBviewed/JavdBviewed/commit/d3ef74aabe7228d713790da82a55f3b09c0ac127))
- docs: 更新 WebDAV 冲突处理拆分清单 - by Adsryen on 2026-05-31 ([9a12bc9c](https://github.com/JavdBviewed/JavdBviewed/commit/9a12bc9ce0f64c748ea239e5ab92a9b13ce3ac27))
- refactor(dashboard): 收拢 WebDAV 冲突进度样式模型 - by Adsryen on 2026-05-31 ([2dff6134](https://github.com/JavdBviewed/JavdBviewed/commit/2dff6134f968d862336767416400c586159092d3))
- refactor(dashboard): 拆分 WebDAV 冲突显示状态模型 - by Adsryen on 2026-05-31 ([a08171c6](https://github.com/JavdBviewed/JavdBviewed/commit/a08171c60e6126d121fc9b089648c6c177f8963c))
- docs: 更新 WebDAV 恢复页拆分清单 - by Adsryen on 2026-05-31 ([709c7ad3](https://github.com/JavdBviewed/JavdBviewed/commit/709c7ad3b0ba7a8263466e748f3f898efd7e909e))
- refactor(dashboard): 拆分 WebDAV 快捷恢复确认模型 - by Adsryen on 2026-05-31 ([1a0c838a](https://github.com/JavdBviewed/JavdBviewed/commit/1a0c838afbd48dd6298672a152d1db082ac566cf))
- refactor(dashboard): 拆分 WebDAV 恢复模式统计模型 - by Adsryen on 2026-05-31 ([85786142](https://github.com/JavdBviewed/JavdBviewed/commit/85786142cb8e4abedd9547ef78071b6b4e63cf5e))
- refactor(dashboard): 拆分 WebDAV 云端预览统计模型 - by Adsryen on 2026-05-31 ([3a08dc69](https://github.com/JavdBviewed/JavdBviewed/commit/3a08dc6982b1c8cf30e511411f8eb3ffadf3f83c))
- refactor(dashboard): 拆分 WebDAV 文件列表渲染模型 - by Adsryen on 2026-05-31 ([ec4bf9b3](https://github.com/JavdBviewed/JavdBviewed/commit/ec4bf9b3d0b961e8e8019d95c639bff3edb93711))
- refactor(dashboard): 扩展 WebDAV 冲突详情渲染模型 - by Adsryen on 2026-05-31 ([f624fef0](https://github.com/JavdBviewed/JavdBviewed/commit/f624fef04ede3480f5550ce00b87502f278e8fe5))
- refactor(dashboard): 拆分 WebDAV 冲突导航状态模型 - by Adsryen on 2026-05-31 ([6c744c2d](https://github.com/JavdBviewed/JavdBviewed/commit/6c744c2d30faab6362acd099f377ea6b56d92520))
- refactor(dashboard): 拆分 WebDAV 向导状态模型 - by Adsryen on 2026-05-31 ([5a480cfe](https://github.com/JavdBviewed/JavdBviewed/commit/5a480cfec4ca7b61dd6831c7881482bd9c2a7707))
- refactor(dashboard): 拆分 WebDAV 恢复执行确认模型 - by Adsryen on 2026-05-31 ([f228e220](https://github.com/JavdBviewed/JavdBviewed/commit/f228e220a89800f874d344167673b2d54b1c09d4))
- refactor(dashboard): 拆分 WebDAV 向导确认摘要模型 - by Adsryen on 2026-05-31 ([562716d7](https://github.com/JavdBviewed/JavdBviewed/commit/562716d78345dbf2259eb2854c6c0538ec06ce92))
- refactor(dashboard): 扩展 WebDAV 恢复结果页模型 - by Adsryen on 2026-05-31 ([c02de9b0](https://github.com/JavdBviewed/JavdBviewed/commit/c02de9b04a4ef7addfc08f88f1a1ce8291c6f4c1))
- refactor(dashboard): 拆分 WebDAV 恢复进度模型 - by Adsryen on 2026-05-31 ([89e4987b](https://github.com/JavdBviewed/JavdBviewed/commit/89e4987b2af3971b1a071b3107f07c9508a87833))
- refactor(dashboard): 拆分 WebDAV 设置差异弹窗模型 - by Adsryen on 2026-05-31 ([fec1f55d](https://github.com/JavdBviewed/JavdBviewed/commit/fec1f55d67220557afd3ea7d786d9d6c081ed256))
- refactor(dashboard): 拆分 WebDAV 操作摘要模型 - by Adsryen on 2026-05-31 ([ef0a9d23](https://github.com/JavdBviewed/JavdBviewed/commit/ef0a9d23978a44bbf5acd475faa9c12b670ca98e))
- refactor(dashboard): 拆分 WebDAV 向导策略预览模型 - by Adsryen on 2026-05-31 ([d26a828a](https://github.com/JavdBviewed/JavdBviewed/commit/d26a828aac49ec607b89c2778704051c517e25f9))
- refactor(dashboard): 拆分 WebDAV 恢复结果列表模型 - by Adsryen on 2026-05-31 ([0c173073](https://github.com/JavdBviewed/JavdBviewed/commit/0c1730736d7ee42fc7d21a45e7a59e12469a77cb))
- refactor(dashboard): 拆分 WebDAV 冲突详情展示模型 - by Adsryen on 2026-05-31 ([7c09b10c](https://github.com/JavdBviewed/JavdBviewed/commit/7c09b10cb7e4e2b294887fb45ac3722ddda6a8e7))
- refactor(dashboard): 清理 WebDAV 恢复页废弃专家差异分析 - by Adsryen on 2026-05-31 ([4b23c749](https://github.com/JavdBviewed/JavdBviewed/commit/4b23c749191c581f2c0494d914a8610fd307eb15))
- refactor(dashboard): 拆分 WebDAV 恢复选项模型 - by Adsryen on 2026-05-31 ([0edbbeaf](https://github.com/JavdBviewed/JavdBviewed/commit/0edbbeaf3bf01f5fa9acc48da07e91ff53e47355))
- refactor(dashboard): 拆分 WebDAV 恢复页基础模型 - by Adsryen on 2026-05-31 ([d7c22511](https://github.com/JavdBviewed/JavdBviewed/commit/d7c225112695009640214400a946069548467b31))
- build: 更新构建编号 - by Adsryen on 2026-05-31 ([2adb32ff](https://github.com/JavdBviewed/JavdBviewed/commit/2adb32ff6f5746043594edadc7342d69b3144263))
- test(regression): 加强源码架构迁移约束 - by Adsryen on 2026-05-31 ([518b4323](https://github.com/JavdBviewed/JavdBviewed/commit/518b4323e5c382a4f5a7d33ca87fc31d3f91c936))
- refactor(imports): 对齐新源码目录引用 - by Adsryen on 2026-05-31 ([8ccecc70](https://github.com/JavdBviewed/JavdBviewed/commit/8ccecc70d11c7471fa277bef74b7afd441972d72))
- refactor(orchestrator): 拆分内容脚本初始化编排器 - by Adsryen on 2026-05-31 ([32764c60](https://github.com/JavdBviewed/JavdBviewed/commit/32764c60d4c36569fbb8a982bfd1741b51cd131f))
- refactor(features): 归位线路、网络测试与 WebDAV 工具 - by Adsryen on 2026-05-31 ([7de381ac](https://github.com/JavdBviewed/JavdBviewed/commit/7de381acd74f9bba136a7c6df1f272f58efed69f))
- refactor(content): 将内容脚本能力迁入功能域 - by Adsryen on 2026-05-31 ([d96b3c72](https://github.com/JavdBviewed/JavdBviewed/commit/d96b3c72870cea45e430f732ba1bc30a2fc39651))
- refactor(platform): 归位浏览器与运行时基础设施 - by Adsryen on 2026-05-31 ([d9f3a8f1](https://github.com/JavdBviewed/JavdBviewed/commit/d9f3a8f1eda2d0c179fd700025c39509c0f5c094))
- refactor(background): 拆分后台消息处理器模块 - by Adsryen on 2026-05-31 ([b78eeba7](https://github.com/JavdBviewed/JavdBviewed/commit/b78eeba766e3685afebc135baa07fca9f4980e4e))
- refactor(architecture): 重构webdav、115架构并拆分解耦功能模块 - by Adsryen on 2026-05-30 ([53c8ac2d](https://github.com/JavdBviewed/JavdBviewed/commit/53c8ac2d7c672fa28de422e9a5ad5cc99c8e1505))
- refactor(webdav): 迁移WebDAV功能到新模块架构 - by Adsryen on 2026-05-30 ([01b4fe28](https://github.com/JavdBviewed/JavdBviewed/commit/01b4fe283db4b4e614de80120477637645edb2bd))
- refactor(background): 拆分背景服务装配层并优化模块结构 - by Adsryen on 2026-05-30 ([2e08085a](https://github.com/JavdBviewed/JavdBviewed/commit/2e08085a1a7ec4355e7a2820f97b880bd425d078))
- refactor(arch): 迁移功能模块并更新导入路径 - by Adsryen on 2026-05-30 ([1160d3b1](https://github.com/JavdBviewed/JavdBviewed/commit/1160d3b184cbf2ad56a020851d7832cedc18003b))
- refactor(popup): 迁移弹窗启动入口 - by Adsryen on 2026-05-30 ([2b79f48e](https://github.com/JavdBviewed/JavdBviewed/commit/2b79f48e420d3e24c4f89e64b93f5d4458a255de))
- refactor(dashboard): 迁移管理面板启动入口 - by Adsryen on 2026-05-30 ([6bb6a354](https://github.com/JavdBviewed/JavdBviewed/commit/6bb6a354ec545bc51a5f75c60d2a0ad9a35864b1))
- refactor(content): 迁移 115 内容脚本入口 - by Adsryen on 2026-05-30 ([0582f105](https://github.com/JavdBviewed/JavdBviewed/commit/0582f10515c96d98ad2d67933ae22dd01aa68f4b))
- refactor(content): 迁移主内容脚本启动入口 - by Adsryen on 2026-05-30 ([3c81079b](https://github.com/JavdBviewed/JavdBviewed/commit/3c81079b0ce52c45efed39ad37b5315bde06b428))
- refactor(background): 迁移 service worker 启动入口 - by Adsryen on 2026-05-30 ([ae67a34c](https://github.com/JavdBviewed/JavdBviewed/commit/ae67a34ca40d9593a10a26efb9e0f9d6752fb36e))
- refactor(privacy): 收口隐私工具目录 - by Adsryen on 2026-05-30 ([8b26267e](https://github.com/JavdBviewed/JavdBviewed/commit/8b26267e4b66ea56c2a2743209d89825629a597d))
- refactor(drive115): 迁移 115 功能域 - by Adsryen on 2026-05-29 ([fd68f0e5](https://github.com/JavdBviewed/JavdBviewed/commit/fd68f0e56d1e29014319f8cc0244709734cbf662))
- refactor(privacy): 迁移隐私保护功能域 - by Adsryen on 2026-05-29 ([4f4d85a6](https://github.com/JavdBviewed/JavdBviewed/commit/4f4d85a650d1c23e1aa960ac5cc9f2e069726a25))
- refactor(ai): 迁移 AI 服务功能域 - by Adsryen on 2026-05-29 ([722394e7](https://github.com/JavdBviewed/JavdBviewed/commit/722394e74df89576218cc8e876589e2ce0ab8537))
- refactor(update): 迁移更新检查功能域 - by Adsryen on 2026-05-29 ([4aae09e5](https://github.com/JavdBviewed/JavdBviewed/commit/4aae09e5c5c3f269ee428971f9fe735453067d86))
- chore(release): 同步 1.20.3 版本号 - by Adsryen on 2026-05-29 ([3f77f1e4](https://github.com/JavdBviewed/JavdBviewed/commit/3f77f1e4e1f526266e9c5a724e67023902ceac25))
- test(architecture): 增加源目录架构回归约束 - by Adsryen on 2026-05-29 ([492ddbef](https://github.com/JavdBviewed/JavdBviewed/commit/492ddbef72ad047a8aa3e978bd2bbbd4d5de3e1a))
- refactor(insights): 迁移报告统计功能域 - by Adsryen on 2026-05-29 ([27884b2d](https://github.com/JavdBviewed/JavdBviewed/commit/27884b2dea01d9c03dc2e4b52cb407f5c24701e2))
- refactor(feature-domains): 迁移演员、新作品和内容增强功能域 - by Adsryen on 2026-05-29 ([425a32b1](https://github.com/JavdBviewed/JavdBviewed/commit/425a32b12895380eb6d0ae82d927116e518d8f8e))
- refactor(platform): 抽出扩展基础设施层 - by Adsryen on 2026-05-29 ([bf60eed9](https://github.com/JavdBviewed/JavdBviewed/commit/bf60eed990657b99da20fa77da1ce6f3758c259d))
- chore(reference): 更新参考油猴脚本快照 - by Adsryen on 2026-05-29 ([545fdaa8](https://github.com/JavdBviewed/JavdBviewed/commit/545fdaa8458a8e3ebf52fe5324e3523abdcd9034))

### Artifacts
- javdb-extension-v1.20.3-build-123.zip
  - SHA256: E632236B650D9934729F6A91443B49E218A3F8D1418B61B1998B477FD26770F8
