# JavdBviewed 完整功能清单

> 本文档详细列出了 JavdBviewed 扩展的所有功能特性。

**图例说明**：✅ 已实现 | 🚧 开发中 | 📋 计划中 | 🔧 测试中 | ⚠️ 实验性

---

## 🎯 核心标记功能

<table>
  <thead>
    <tr>
      <th width="180">功能名称</th>
      <th>功能描述</th>
      <th width="80">状态</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td colspan="3"><strong>视频状态标记</strong></td>
    </tr>
    <tr>
      <td>已浏览标记</td>
      <td>自动记录访问过的视频详情页，在列表中显示灰色标记</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>已观看标记</td>
      <td>手动标记已观看的视频，显示绿色勾选标记</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>想看标记</td>
      <td>标记感兴趣但未观看的视频，显示黄色星标</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>优先级显示</td>
      <td>智能显示最重要的状态标记（想看 > 已观看 > 已浏览）</td>
      <td>✅</td>
    </tr>
    <tr>
      <td colspan="3"><strong>标记操作</strong></td>
    </tr>
    <tr>
      <td>详情页快速标记</td>
      <td>在视频详情页顶部显示快捷操作按钮</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>列表页快捷按钮</td>
      <td>在列表页影片卡片显示快捷操作按钮<br><span style="color:#f59e0b;">⚠️ 待优化：优化快捷按钮（已阅），已看、想看按钮可能不必要</span></td>
      <td>✅</td>
    </tr>
    <tr>
      <td>键盘快捷键</td>
      <td>支持快捷键快速标记（V=已观看, W=想看）</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>右键菜单</td>
      <td>右键点击视频项显示快捷操作菜单</td>
      <td>✅</td>
    </tr>
    <tr>
      <td colspan="3"><strong>视觉反馈</strong></td>
    </tr>
    <tr>
      <td>Favicon 状态</td>
      <td>根据视频状态动态更改浏览器标签图标</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>标题前缀</td>
      <td>在页面标题前添加状态标识（✓已看 / ★想看）</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>列表标记样式</td>
      <td>可自定义标记颜色和显示样式</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>状态同步</td>
      <td>实时同步标记状态到所有打开的页面</td>
      <td>✅</td>
    </tr>
  </tbody>
</table>

---

## 📚 数据管理

<table>
  <thead>
    <tr>
      <th width="180">功能名称</th>
      <th>功能描述</th>
      <th width="80">状态</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td colspan="3"><strong>番号库管理</strong></td>
    </tr>
    <tr>
      <td>番号记录查看</td>
      <td>查看所有已标记的视频番号列表</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>状态筛选</td>
      <td>按已观看、想看、已浏览状态筛选</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>搜索功能</td>
      <td>快速搜索特定番号或标题</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>批量操作</td>
      <td>批量删除、批量修改状态</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>清单管理</td>
      <td>为番号归属清单，支持多清单归属</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>清单筛选</td>
      <td>按清单筛选番号</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>清单同步</td>
      <td>同步JavDB的清单列表</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>想看按钮同步</td>
      <td>点击"想看"按钮自动更新番号库<br><span style="color:#f59e0b;">⚠️ 待验证：点击删除/看过按钮的状态更新</span></td>
      <td>✅</td>
    </tr>
    <tr>
      <td>详细信息</td>
      <td>显示标记时间、访问次数等元数据</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>导出记录</td>
      <td>导出番号列表为 JSON 或 CSV 格式，支持进度显示和筛选条件导出</td>
      <td>✅</td>
    </tr>
    <tr>
      <td colspan="3"><strong>演员库管理</strong></td>
    </tr>
    <tr>
      <td>演员信息管理</td>
      <td>管理收藏的演员信息</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>演员分类</td>
      <td>支持自定义标签分类（收藏、订阅、黑名单等）</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>演员搜索</td>
      <td>快速搜索演员名称</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>演员作品统计</td>
      <td>显示每个演员的作品数量</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>演员备注</td>
      <td>为演员添加自定义备注信息（年龄、身高、罩杯等）</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>演员Wiki链接</td>
      <td>自动生成演员Wikipedia和xslist链接</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>演员备注缓存</td>
      <td>缓存演员备注信息，可设置TTL</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>演员头像缓存</td>
      <td>自动缓存演员头像，提升加载速度</td>
      <td>✅</td>
    </tr>
    <tr>
      <td colspan="3"><strong>数据导入导出</strong></td>
    </tr>
    <tr>
      <td>JSON 格式导出</td>
      <td>导出完整数据为 JSON 格式</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>JSON 格式导入</td>
      <td>从 JSON 文件恢复数据</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>选择性导出</td>
      <td>可选择导出特定类型的数据</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>数据合并</td>
      <td>导入时智能合并现有数据</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>备份提醒</td>
      <td>定期提醒用户备份数据</td>
      <td>✅</td>
    </tr>
    <tr>
      <td colspan="3"><strong>统计信息</strong></td>
    </tr>
    <tr>
      <td>观看统计</td>
      <td>显示总观看数、本月观看数等</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>演员统计</td>
      <td>统计收藏演员数量</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>存储使用</td>
      <td>显示扩展数据占用空间</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>同步状态</td>
      <td>显示最后同步时间和状态</td>
      <td>✅</td>
    </tr>
  </tbody>
</table>

---

## ☁️ 云端同步

<table>
  <thead>
    <tr>
      <th width="180">功能名称</th>
      <th>功能描述</th>
      <th width="80">状态</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td colspan="3"><strong>WebDAV 同步</strong></td>
    </tr>
    <tr>
      <td>多服务支持</td>
      <td>支持坚果云、Nextcloud、TeraCloud、Yandex 等</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>自动同步</td>
      <td>可配置自动同步间隔（分钟级）<br><span style="color:#f59e0b;">⚠️ 已知问题：自动上传功能可能失效</span></td>
      <td>✅</td>
    </tr>
    <tr>
      <td>手动同步</td>
      <td>随时手动触发上传/下载</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>增量同步</td>
      <td>仅同步变更的数据，节省流量</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>冲突解决</td>
      <td>智能处理多设备间的数据冲突</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>版本管理</td>
      <td>保留多个历史版本备份</td>
      <td>✅</td>
    </tr>
    <tr>
      <td colspan="3"><strong>同步配置</strong></td>
    </tr>
    <tr>
      <td>连接测试</td>
      <td>测试 WebDAV 连接是否正常</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>连接诊断</td>
      <td>详细诊断连接问题</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>同步间隔设置</td>
      <td>自定义自动同步时间间隔</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>备份保留天数</td>
      <td>设置云端备份保留时长</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>预警阈值</td>
      <td>设置备份过期预警天数<br><span style="color:#f59e0b;">⚠️ 待完善：预警提示功能</span></td>
      <td>✅</td>
    </tr>
    <tr>
      <td colspan="3"><strong>数据范围选择</strong></td>
    </tr>
    <tr>
      <td>核心数据</td>
      <td>观看记录、用户资料</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>演员数据</td>
      <td>演员库、演员订阅</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>新作品数据</td>
      <td>新作品订阅和记录</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>系统配置</td>
      <td>扩展设置、域名配置、搜索引擎</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>日志数据</td>
      <td>操作日志（可选）</td>
      <td>✅</td>
    </tr>
    <tr>
      <td colspan="3"><strong>云端文件管理</strong></td>
    </tr>
    <tr>
      <td>文件列表查看</td>
      <td>查看云端所有备份文件</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>点击恢复</td>
      <td>点击云端文件即可恢复数据</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>文件删除</td>
      <td>删除过期的云端备份</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>文件信息</td>
      <td>显示文件大小、修改时间等</td>
      <td>✅</td>
    </tr>
  </tbody>
</table>

---

## 💾 115网盘集成

<table>
  <thead>
    <tr>
      <th width="180">功能名称</th>
      <th>功能描述</th>
      <th width="80">状态</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td colspan="3"><strong>磁力推送</strong></td>
    </tr>
    <tr>
      <td>一键推送</td>
      <td>在视频详情页直接推送磁力链接到115网盘</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>批量推送</td>
      <td>支持快速连续推送多个磁力链接</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>自动标记</td>
      <td>推送成功后自动标记视频为已观看</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>推送历史</td>
      <td>记录所有推送操作历史</td>
      <td>✅</td>
    </tr>
    <tr>
      <td colspan="3"><strong>智能验证</strong></td>
    </tr>
    <tr>
      <td>自动验证码处理</td>
      <td>自动处理115网盘的验证码流程</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>验证状态提示</td>
      <td>实时显示验证状态</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>重试机制</td>
      <td>验证失败自动重试</td>
      <td>✅</td>
    </tr>
    <tr>
      <td colspan="3"><strong>推送配置</strong></td>
    </tr>
    <tr>
      <td>下载目录设置</td>
      <td>自定义115网盘下载目录</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>自动标记开关</td>
      <td>控制推送后是否自动标记</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>推送通知</td>
      <td>推送成功/失败的通知提示</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>Cookie 管理</td>
      <td>自动管理115网盘登录状态<br><span style="color:#f59e0b;">⚠️ 待优化：refreshtoken 自动刷新机制</span></td>
      <td>✅</td>
    </tr>
    <tr>
      <td colspan="3"><strong>任务管理</strong></td>
    </tr>
    <tr>
      <td>任务列表</td>
      <td>查看所有推送任务状态</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>任务重试</td>
      <td>失败任务可重新推送</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>任务取消</td>
      <td>取消正在进行的推送任务</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>任务统计</td>
      <td>显示成功/失败任务数量</td>
      <td>✅</td>
    </tr>
  </tbody>
</table>

---

## 🎨 页面增强功能

<table>
  <thead>
    <tr>
      <th width="180">功能名称</th>
      <th>功能描述</th>
      <th width="80">状态</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td colspan="3"><strong>列表页增强</strong></td>
    </tr>
    <tr>
      <td>点击增强</td>
      <td>优化列表项点击体验</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>视频预览</td>
      <td>鼠标悬停显示视频预览</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>右键后台打开</td>
      <td>右键点击在后台标签页打开<br><span style="color:#f59e0b;">⚠️ 待支持：影片页的"你可能也喜歡"区域</span></td>
      <td>✅</td>
    </tr>
    <tr>
      <td>滚动分页</td>
      <td>自动加载下一页内容（实验性功能）</td>
      <td>⚠️</td>
    </tr>
    <tr>
      <td>演员水印</td>
      <td>在封面上显示演员订阅/黑名单状态水印</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>预览来源选择</td>
      <td>选择视频预览的优先来源（auto/javdb/javspyl/avpreview/vbgfl）<br><span style="color:#f59e0b;">⚠️ 待调整：预览来源的选择逻辑</span></td>
      <td>✅</td>
    </tr>
    <tr>
      <td colspan="3"><strong>详情页增强</strong></td>
    </tr>
    <tr>
      <td>快速复制</td>
      <td>一键复制番号、标题、链接等</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>磁力搜索</td>
      <td>自动搜索多个磁力源</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>高质量封面</td>
      <td>显示高质量封面图片</td>
      <td>🔧</td>
    </tr>
    <tr>
      <td>标题翻译</td>
      <td>定点翻译视频标题</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>评分聚合</td>
      <td>聚合多个来源的评分信息</td>
      <td>🔧</td>
    </tr>
    <tr>
      <td>演员信息增强</td>
      <td>显示演员详细信息（年龄、身高、罩杯等）</td>
      <td>🔧</td>
    </tr>
    <tr>
      <td>加载指示器</td>
      <td>显示内容加载进度指示器</td>
      <td>🔧</td>
    </tr>
    <tr>
      <td>破解评论区</td>
      <td>解除评论区访问限制<br><span style="color:#f59e0b;">⚠️ 已知问题：显示位置和样式需要适配，存在400报错</span></td>
      <td>🔧</td>
    </tr>
    <tr>
      <td>破解FC2拦截</td>
      <td>解除FC2内容访问拦截<br><span style="color:#f59e0b;">⚠️ 已知问题：功能无效，需要修复</span></td>
      <td>🔧</td>
    </tr>
    <tr>
      <td>想看同步</td>
      <td>点击"想看"时同步到本地番号库</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>115推送自动标记</td>
      <td>115推送成功后自动标记为"已看"</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>相关推荐</td>
      <td>显示相关视频推荐</td>
      <td>📋</td>
    </tr>
    <tr>
      <td colspan="3"><strong>显示优化</strong></td>
    </tr>
    <tr>
      <td>隐藏已观看</td>
      <td>自动隐藏已标记"看过"的影片（显示设置可开关，切换即时生效）</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>隐藏已浏览</td>
      <td>自动隐藏已浏览详情页的影片（显示设置可开关，切换即时生效）</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>隐藏VR影片</td>
      <td>自动隐藏所有VR影片（显示设置可开关，切换即时生效）</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>隐藏想看</td>
      <td>自动隐藏想看的影片（可选，显示设置可开关，切换即时生效）</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>自定义过滤</td>
      <td>基于关键词的自定义过滤规则</td>
      <td>✅</td>
    </tr>
    <tr>
      <td colspan="3"><strong>锚点优化</strong></td>
    </tr>
    <tr>
      <td>预览按钮</td>
      <td>在链接旁显示预览按钮</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>预览窗口</td>
      <td>悬停显示内容预览<br><span style="color:#f59e0b;">⚠️ 已知问题：略缩图跳转无效、跳转至网页中间位置</span></td>
      <td>✅</td>
    </tr>
    <tr>
      <td>按钮位置</td>
      <td>可自定义预览按钮位置</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>自定义按钮</td>
      <td>添加自定义快捷按钮</td>
      <td>✅</td>
    </tr>
  </tbody>
</table>

---

## 👥 演员管理

<table>
  <thead>
    <tr>
      <th width="180">功能名称</th>
      <th>功能描述</th>
      <th width="80">状态</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td colspan="3"><strong>演员库功能</strong></td>
    </tr>
    <tr>
      <td>演员收藏</td>
      <td>收藏喜欢的演员</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>演员订阅</td>
      <td>订阅演员新作品通知</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>演员黑名单</td>
      <td>屏蔽不感兴趣的演员</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>演员标签</td>
      <td>为演员添加自定义标签</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>演员备注</td>
      <td>记录演员的详细信息（年龄、身高、罩杯等）</td>
      <td>✅</td>
    </tr>
    <tr>
      <td colspan="3"><strong>演员过滤</strong></td>
    </tr>
    <tr>
      <td>列表过滤</td>
      <td>在列表页根据演员库过滤作品</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>隐藏黑名单演员</td>
      <td>自动隐藏黑名单演员的作品（列表增强设置可开关，切换即时生效）</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>仅显示收藏演员</td>
      <td>仅显示收藏演员的作品<br><span style="color:#f59e0b;">⚠️ 注意：演员页不生效（避免标题匹配误差影响数据显示）</span></td>
      <td>✅</td>
    </tr>
    <tr>
      <td>订阅视为收藏</td>
      <td>将订阅演员视为收藏演员</td>
      <td>✅</td>
    </tr>
    <tr>
      <td colspan="3"><strong>演员页增强</strong></td>
    </tr>
    <tr>
      <td>自动应用标签</td>
      <td>自动应用默认标签过滤<br><span style="color:#f59e0b;">⚠️ 已知问题：加载上次应用的标签未生效</span></td>
      <td>✅</td>
    </tr>
    <tr>
      <td>默认排序</td>
      <td>设置默认排序方式</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>影片分段显示</td>
      <td>按时间段分组显示演员作品（可设置月份阈值）</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>保存过滤器</td>
      <td>保存当前演员页的标签过滤器设置</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>快速筛选</td>
      <td>快速切换不同标签过滤</td>
      <td>✅</td>
    </tr>
    <tr>
      <td colspan="3"><strong>演员同步</strong></td>
    </tr>
    <tr>
      <td>从 JavDB 同步</td>
      <td>从 JavDB 同步收藏演员数据</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>自动同步</td>
      <td>定期自动同步演员数据</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>同步间隔设置</td>
      <td>自定义同步时间间隔</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>演员详情同步</td>
      <td>同步演员详细信息</td>
      <td>✅</td>
    </tr>
  </tbody>
</table>

---

## 🆕 新作品监控

<table>
  <thead>
    <tr>
      <th width="180">功能名称</th>
      <th>功能描述</th>
      <th width="80">状态</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td colspan="3"><strong>监控功能</strong></td>
    </tr>
    <tr>
      <td>新作品订阅</td>
      <td>订阅感兴趣的新发布内容</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>自动检测</td>
      <td>定期自动检测新作品<br><span style="color:#f59e0b;">⚠️ 待验证：需根据番号库重新过滤，仅获取不在库中的作品</span></td>
      <td>✅</td>
    </tr>
    <tr>
      <td>通知提醒</td>
      <td>有新作品时显示通知</td>
      <td>✅</td>
    </tr>
    <tr>
      <td colspan="3"><strong>智能过滤</strong></td>
    </tr>
    <tr>
      <td>演员库过滤</td>
      <td>根据演员库自动过滤新作品</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>标签过滤</td>
      <td>根据标签自动过滤<br><span style="color:#f59e0b;">⚠️ 待验证：排除标签功能（單體作品、含磁鏈）</span></td>
      <td>✅</td>
    </tr>
    <tr>
      <td>关键词过滤</td>
      <td>根据关键词过滤新作品</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>VR过滤</td>
      <td>自动过滤VR作品（可选）</td>
      <td>✅</td>
    </tr>
    <tr>
      <td colspan="3"><strong>批量操作</strong></td>
    </tr>
    <tr>
      <td>批量打开</td>
      <td>批量在新标签页打开新作品<br><span style="color:#f59e0b;">⚠️ 待验证：批量打开未读新作品功能</span></td>
      <td>✅</td>
    </tr>
    <tr>
      <td>批量标记</td>
      <td>批量标记新作品状态</td>
      <td>🚧</td>
    </tr>
    <tr>
      <td>批量推送</td>
      <td>批量推送到115网盘</td>
      <td>🚧</td>
    </tr>
    <tr>
      <td colspan="3"><strong>新作品管理</strong></td>
    </tr>
    <tr>
      <td>新作品列表</td>
      <td>查看所有检测到的新作品</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>标记已读</td>
      <td>标记新作品为已读<br><span style="color:#f59e0b;">⚠️ 待优化：已读作品的删除功能</span></td>
      <td>✅</td>
    </tr>
    <tr>
      <td>清空列表</td>
      <td>清空新作品列表</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>新作品统计</td>
      <td>显示新作品数量统计</td>
      <td>✅</td>
    </tr>
  </tbody>
</table>

---

## 🔍 搜索与磁力

<table>
  <thead>
    <tr>
      <th width="180">功能名称</th>
      <th>功能描述</th>
      <th width="80">状态</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td colspan="3"><strong>搜索引擎</strong></td>
    </tr>
    <tr>
      <td>自定义搜索引擎</td>
      <td>添加自定义搜索网站</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>多引擎支持</td>
      <td>支持多个搜索引擎</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>搜索引擎图标</td>
      <td>显示搜索引擎图标</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>快速切换</td>
      <td>快速切换不同搜索引擎</td>
      <td>✅</td>
    </tr>
    <tr>
      <td colspan="3"><strong>磁力搜索</strong></td>
    </tr>
    <tr>
      <td>多源搜索</td>
      <td>同时搜索多个磁力源</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>自动搜索</td>
      <td>打开详情页自动搜索磁力<br><span style="color:#f59e0b;">⚠️ 待优化：已看状态默认不加载，改为手动触发</span></td>
      <td>✅</td>
    </tr>
    <tr>
      <td>搜索结果展示</td>
      <td>在页面内展示搜索结果</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>浮动按钮</td>
      <td>显示浮动搜索按钮</td>
      <td>✅</td>
    </tr>
    <tr>
      <td colspan="3"><strong>磁力源配置</strong></td>
    </tr>
    <tr>
      <td>Sukebei</td>
      <td>支持 Sukebei 磁力源</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>BTDigg</td>
      <td>支持 BTDigg 磁力源</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>BTSOW</td>
      <td>支持 BTSOW 磁力源</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>Torrentz2</td>
      <td>支持 Torrentz2 磁力源</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>自定义源</td>
      <td>添加自定义磁力搜索源</td>
      <td>✅</td>
    </tr>
    <tr>
      <td colspan="3"><strong>搜索优化</strong></td>
    </tr>
    <tr>
      <td>并发控制</td>
      <td>控制同时搜索的源数量</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>超时设置</td>
      <td>设置搜索超时时间</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>结果数量限制</td>
      <td>限制显示的结果数量</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>结果排序</td>
      <td>按文件大小、时间等排序</td>
      <td>✅</td>
    </tr>
  </tbody>
</table>

---

## 🔒 隐私保护

<table>
  <thead>
    <tr>
      <th width="180">功能名称</th>
      <th>功能描述</th>
      <th width="80">状态</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td colspan="3"><strong>截图模式</strong></td>
    </tr>
    <tr>
      <td>一键模糊</td>
      <td>一键模糊所有敏感内容</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>自动模糊</td>
      <td>检测到截图工具自动模糊</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>快捷键触发</td>
      <td>使用快捷键快速切换模糊模式</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>模糊强度调节</td>
      <td>可调节模糊程度</td>
      <td>✅</td>
    </tr>
    <tr>
      <td colspan="3"><strong>元素保护</strong></td>
    </tr>
    <tr>
      <td>封面模糊</td>
      <td>模糊视频封面图片</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>标题模糊</td>
      <td>模糊视频标题文字</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>演员名模糊</td>
      <td>模糊演员名称</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>番号模糊</td>
      <td>模糊视频番号</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>自定义保护区域</td>
      <td>添加自定义需要保护的元素</td>
      <td>✅</td>
    </tr>
    <tr>
      <td colspan="3"><strong>隐私设置</strong></td>
    </tr>
    <tr>
      <td>默认模糊模式</td>
      <td>设置默认是否启用模糊</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>模糊区域配置</td>
      <td>配置需要模糊的页面区域</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>快捷键自定义</td>
      <td>自定义隐私保护快捷键</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>保护级别</td>
      <td>设置不同的保护级别（低/中/高）</td>
      <td>✅</td>
    </tr>
  </tbody>
</table>

---

## ⚡ 用户体验优化

<table>
  <thead>
    <tr>
      <th width="180">功能名称</th>
      <th>功能描述</th>
      <th width="80">状态</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td colspan="3"><strong>快速复制</strong></td>
    </tr>
    <tr>
      <td>番号复制</td>
      <td>一键复制视频番号</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>标题复制</td>
      <td>一键复制视频标题</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>链接复制</td>
      <td>一键复制视频链接</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>磁力复制</td>
      <td>一键复制磁力链接</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>演员名复制</td>
      <td>一键复制演员名称</td>
      <td>✅</td>
    </tr>
    <tr>
      <td colspan="3"><strong>键盘快捷键</strong></td>
    </tr>
    <tr>
      <td>全局快捷键</td>
      <td>支持全局快捷键操作</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>页面快捷键</td>
      <td>支持页面特定快捷键</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>快捷键帮助</td>
      <td>显示快捷键帮助面板</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>自定义快捷键</td>
      <td>自定义快捷键绑定</td>
      <td>✅</td>
    </tr>
    <tr>
      <td colspan="3"><strong>内容过滤</strong></td>
    </tr>
    <tr>
      <td>关键词过滤</td>
      <td>基于关键词过滤内容（隐藏动作有总开关，也可按规则单独关闭）<br><span style="color:#f59e0b;">⚠️ 待优化：增加发行日期字段过滤、Toast输出过滤统计</span></td>
      <td>✅</td>
    </tr>
    <tr>
      <td>正则表达式</td>
      <td>支持正则表达式过滤<br><span style="color:#f59e0b;">⚠️ 待优化：增加动态检测与提示</span></td>
      <td>✅</td>
    </tr>
    <tr>
      <td>过滤规则管理</td>
      <td>管理多个过滤规则</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>过滤统计</td>
      <td>显示过滤统计信息</td>
      <td>✅</td>
    </tr>
    <tr>
      <td colspan="3"><strong>界面优化</strong></td>
    </tr>
    <tr>
      <td>移除广告按钮</td>
      <td>移除官方App和Telegram按钮</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>响应式设计</td>
      <td>适配不同屏幕尺寸</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>暗色模式</td>
      <td>支持暗色主题（跟随系统）<br><span style="color:#f59e0b;">⚠️ 待优化：暗色主题样式优化</span></td>
      <td>✅</td>
    </tr>
    <tr>
      <td>自定义样式</td>
      <td>支持自定义CSS样式</td>
      <td>✅</td>
    </tr>
  </tbody>
</table>

---

## 📊 数据分析与报告

<table>
  <thead>
    <tr>
      <th width="180">功能名称</th>
      <th>功能描述</th>
      <th width="80">状态</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td colspan="3"><strong>数据采集</strong></td>
    </tr>
    <tr>
      <td>观看标签采集</td>
      <td>自动采集视频标签信息</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>观看时间记录</td>
      <td>记录观看时间和频率</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>演员偏好分析</td>
      <td>分析演员观看偏好</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>标签偏好分析</td>
      <td>分析标签偏好</td>
      <td>✅</td>
    </tr>
    <tr>
      <td colspan="3"><strong>报告生成</strong></td>
    </tr>
    <tr>
      <td>月度报告</td>
      <td>生成月度观看报告</td>
      <td>🔧</td>
    </tr>
    <tr>
      <td>自动生成</td>
      <td>定时自动生成报告</td>
      <td>🔧</td>
    </tr>
    <tr>
      <td>手动生成</td>
      <td>随时手动生成报告</td>
      <td>🔧</td>
    </tr>
    <tr>
      <td>报告导出</td>
      <td>导出报告为HTML文件</td>
      <td>🔧</td>
    </tr>
    <tr>
      <td colspan="3"><strong>数据可视化</strong></td>
    </tr>
    <tr>
      <td>图表展示</td>
      <td>使用 ECharts 展示数据</td>
      <td>🔧</td>
    </tr>
    <tr>
      <td>趋势分析</td>
      <td>显示观看趋势</td>
      <td>🔧</td>
    </tr>
    <tr>
      <td>分类统计</td>
      <td>按不同维度统计数据</td>
      <td>🔧</td>
    </tr>
    <tr>
      <td>交互式图表</td>
      <td>支持交互式数据探索</td>
      <td>🔧</td>
    </tr>
    <tr>
      <td colspan="3"><strong>报告配置</strong></td>
    </tr>
    <tr>
      <td>自动月报开关</td>
      <td>控制是否自动生成月报</td>
      <td>🔧</td>
    </tr>
    <tr>
      <td>生成时间设置</td>
      <td>设置报告生成时间</td>
      <td>🔧</td>
    </tr>
    <tr>
      <td>报告配置</td>
      <td>配置报告生成参数<br><span style="color:#f59e0b;">⚠️ 待优化：配置项过于专业化，需要更友好的界面和布局</span></td>
      <td>🔧</td>
    </tr>
    <tr>
      <td>报告模板</td>
      <td>自定义报告模板</td>
      <td>📋</td>
    </tr>
    <tr>
      <td>数据源模式</td>
      <td>选择报告数据来源（views/compare/auto）</td>
      <td>🔧</td>
    </tr>
    <tr>
      <td>统计状态口径</td>
      <td>设置统计包含的状态范围</td>
      <td>🔧</td>
    </tr>
    <tr>
      <td>提示词自定义</td>
      <td>自定义AI报告生成的提示词</td>
      <td>🔧</td>
    </tr>
    <tr>
      <td>人格模式</td>
      <td>选择AI报告的人格模式（doctor/default）</td>
      <td>🔧</td>
    </tr>
  </tbody>
</table>

---

## 🎬 Emby增强

<table>
  <thead>
    <tr>
      <th width="180">功能名称</th>
      <th>功能描述</th>
      <th width="80">状态</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td colspan="3"><strong>Emby集成</strong></td>
    </tr>
    <tr>
      <td>Emby服务器配置</td>
      <td>配置Emby服务器地址和API密钥</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>自动匹配</td>
      <td>自动匹配JavDB和Emby中的视频</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>快捷跳转</td>
      <td>从JavDB快速跳转到Emby播放</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>状态同步</td>
      <td>同步观看状态到Emby</td>
      <td>✅</td>
    </tr>
    <tr>
      <td colspan="3"><strong>Emby功能</strong></td>
    </tr>
    <tr>
      <td>右侧快捷按钮</td>
      <td>在Emby页面显示快捷操作按钮</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>视频信息增强</td>
      <td>增强Emby中的视频信息显示</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>播放控制</td>
      <td>增强的播放控制功能</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>媒体库管理</td>
      <td>管理Emby媒体库</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>番号识别</td>
      <td>识别Emby页面中的番号（包括评论区）<br><span style="color:#f59e0b;">⚠️ 待优化：符合Emby页面的番号识别功能</span></td>
      <td>✅</td>
    </tr>
    <tr>
      <td>高亮样式自定义</td>
      <td>自定义番号高亮显示样式</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>链接行为设置</td>
      <td>设置点击番号后的跳转行为（直接跳转/搜索）</td>
      <td>✅</td>
    </tr>
  </tbody>
</table>

---

## 🤖 AI功能

<table>
  <thead>
    <tr>
      <th width="180">功能名称</th>
      <th>功能描述</th>
      <th width="80">状态</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td colspan="3"><strong>AI翻译</strong></td>
    </tr>
    <tr>
      <td>标题翻译</td>
      <td>使用AI翻译视频标题</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>简介翻译</td>
      <td>使用AI翻译视频简介</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>标签翻译</td>
      <td>使用AI翻译视频标签</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>演员名翻译</td>
      <td>使用AI翻译演员名称</td>
      <td>✅</td>
    </tr>
    <tr>
      <td colspan="3"><strong>AI模型配置</strong></td>
    </tr>
    <tr>
      <td>模型选择</td>
      <td>选择不同的AI模型</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>API配置</td>
      <td>配置AI服务API</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>翻译质量</td>
      <td>调整翻译质量设置</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>缓存翻译</td>
      <td>缓存翻译结果</td>
      <td>✅</td>
    </tr>
    <tr>
      <td colspan="3"><strong>翻译提供商</strong></td>
    </tr>
    <tr>
      <td>传统翻译</td>
      <td>Google、DeepL等传统翻译服务</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>AI翻译</td>
      <td>OpenAI、Claude等AI翻译服务</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>混合模式</td>
      <td>结合传统和AI翻译</td>
      <td>📋</td>
    </tr>
    <tr>
      <td>自定义提供商</td>
      <td>添加自定义翻译服务</td>
      <td>📋</td>
    </tr>
    <tr>
      <td>翻译显示模式</td>
      <td>选择翻译结果的显示方式（追加/替换）</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>翻译目标选择</td>
      <td>选择需要翻译的页面元素</td>
      <td>✅</td>
    </tr>
  </tbody>
</table>

---

## ⚙️ 高级配置

<table>
  <thead>
    <tr>
      <th width="180">功能名称</th>
      <th>功能描述</th>
      <th width="80">状态</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td colspan="3"><strong>性能优化</strong></td>
    </tr>
    <tr>
      <td>图片缓存</td>
      <td>启用图片缓存功能<br><span style="color:#f59e0b;">⚠️ 待开启：缓存功能默认未开启</span></td>
      <td>✅</td>
    </tr>
    <tr>
      <td>缓存过期时间</td>
      <td>设置缓存过期时间</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>并发请求控制</td>
      <td>控制最大并发请求数</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>请求超时设置</td>
      <td>设置网络请求超时时间</td>
      <td>✅</td>
    </tr>
    <tr>
      <td colspan="3"><strong>网络配置</strong></td>
    </tr>
    <tr>
      <td>请求间隔</td>
      <td>设置请求间隔时间</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>重试次数</td>
      <td>设置请求失败重试次数</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>代理设置</td>
      <td>配置网络代理（如需要）</td>
      <td>📋</td>
    </tr>
    <tr>
      <td>DNS设置</td>
      <td>自定义DNS服务器</td>
      <td>📋</td>
    </tr>
    <tr>
      <td colspan="3"><strong>数据增强</strong></td>
    </tr>
    <tr>
      <td>多源数据聚合</td>
      <td>从多个来源聚合数据（BlogJav、JavLibrary等）<br><span style="color:#f59e0b;">⚠️ 待开启：聚合功能默认未开启</span></td>
      <td>✅</td>
    </tr>
    <tr>
      <td>并发请求控制</td>
      <td>控制页面和后台的并发请求数量</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>速率限制</td>
      <td>设置按域的请求速率限制</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>图片缓存</td>
      <td>启用图片缓存功能<br><span style="color:#f59e0b;">⚠️ 待开启：缓存功能默认未开启</span></td>
      <td>✅</td>
    </tr>
    <tr>
      <td>评分聚合</td>
      <td>聚合多个来源的评分</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>演员信息增强</td>
      <td>增强演员信息显示</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>翻译功能</td>
      <td>启用内容翻译功能</td>
      <td>✅</td>
    </tr>
    <tr>
      <td colspan="3"><strong>域名配置</strong></td>
    </tr>
    <tr>
      <td>自定义域名</td>
      <td>配置自定义访问域名</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>域名切换</td>
      <td>快速切换不同域名</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>域名测试</td>
      <td>测试域名可用性</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>自动切换</td>
      <td>域名不可用时自动切换</td>
      <td>📋</td>
    </tr>
  </tbody>
</table>

---

## 🔧 系统功能

<table>
  <thead>
    <tr>
      <th width="180">功能名称</th>
      <th>功能描述</th>
      <th width="80">状态</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td colspan="3"><strong>日志系统</strong></td>
    </tr>
    <tr>
      <td>操作日志</td>
      <td>记录所有操作日志</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>错误日志</td>
      <td>记录错误和异常信息</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>日志级别</td>
      <td>设置日志记录级别（DEBUG/INFO/WARN/ERROR）</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>日志导出</td>
      <td>导出日志文件</td>
      <td>✅</td>
    </tr>
    <tr>
      <td colspan="3"><strong>日志配置</strong></td>
    </tr>
    <tr>
      <td>控制台显示</td>
      <td>控制台日志显示设置</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>时间戳格式</td>
      <td>自定义时间戳格式</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>时区设置</td>
      <td>设置日志时区</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>日志模块</td>
      <td>启用/禁用特定模块的日志（core/orchestrator/storage/actor/magnet/sync等）<br><span style="color:#f59e0b;">⚠️ 待检查：所有功能增强是否有独立标签</span></td>
      <td>✅</td>
    </tr>
    <tr>
      <td>日志保留策略</td>
      <td>设置日志按天数自动清理</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>详细日志模式</td>
      <td>启用详细日志记录模式</td>
      <td>✅</td>
    </tr>
    <tr>
      <td colspan="3"><strong>更新检查</strong></td>
    </tr>
    <tr>
      <td>自动检查更新</td>
      <td>自动检查扩展更新</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>更新通知</td>
      <td>有新版本时显示通知</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>版本历史</td>
      <td>查看版本更新历史</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>手动检查</td>
      <td>手动检查是否有新版本</td>
      <td>✅</td>
    </tr>
    <tr>
      <td colspan="3"><strong>全局操作</strong></td>
    </tr>
    <tr>
      <td>清空所有数据</td>
      <td>清空扩展所有数据</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>重置设置</td>
      <td>重置为默认设置</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>导出配置</td>
      <td>导出扩展配置</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>导入配置</td>
      <td>导入扩展配置</td>
      <td>✅</td>
    </tr>
    <tr>
      <td colspan="3"><strong>网络测试</strong></td>
    </tr>
    <tr>
      <td>连接测试</td>
      <td>测试网络连接状态</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>延迟测试</td>
      <td>测试网络延迟</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>速度测试</td>
      <td>测试网络速度</td>
      <td>📋</td>
    </tr>
    <tr>
      <td>诊断工具</td>
      <td>网络问题诊断工具</td>
      <td>✅</td>
    </tr>
    <tr>
      <td colspan="3"><strong>视图设置</strong></td>
    </tr>
    <tr>
      <td>番号库视图模式</td>
      <td>切换列表/卡片视图模式</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>番号库封面显示</td>
      <td>控制是否在列表中显示封面</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>每页记录数</td>
      <td>设置每页显示的记录数量</td>
      <td>✅</td>
    </tr>
    <tr>
      <td colspan="3"><strong>更新管理</strong></td>
    </tr>
    <tr>
      <td>更新检查间隔</td>
      <td>设置自动检查更新的时间间隔</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>包含预发布版本</td>
      <td>检查更新时是否包含预发布版本</td>
      <td>✅</td>
    </tr>
  </tbody>
</table>

---

## 📝 相关文档

- [README](README.md) - 项目简介和快速开始
- [安装指南](README.md#-安装方式) - 详细安装步骤
- [使用说明](README.md#-使用说明) - 基本使用方法
- [开发指南](README.md#-二次开发指南) - 二次开发文档
- [常见问题](README.md#常见问题) - 常见问题解答
- [开发计划](todo/todo.md) - 功能开发计划

---

## 💬 反馈与建议

如果您有任何功能建议或发现问题，欢迎：
- 💬 提交 [Issue](https://github.com/JavdBviewed/JavdBviewed/issues)
- 🗨️ 发起 [Discussion](https://github.com/JavdBviewed/JavdBviewed/discussions)

---

<div align="center">

**最后更新**: 2025-02-13

</div>
