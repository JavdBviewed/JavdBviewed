# 隐私政策 / Privacy Policy

**最后更新日期 / Last Updated**: 2025年1月19日 / January 19, 2025

---

## 中文版

### 1. 概述

Jav 助手（以下简称"本扩展"）尊重并保护用户的隐私。本隐私政策说明了本扩展如何收集、使用、存储和保护您的信息。

### 2. 开发者信息

- **扩展名称**: Jav 助手
- **开发者**: lmixture
- **联系方式**: [GitHub Issues](https://github.com/JavdBviewed/JavdBviewed/issues)

### 3. 数据收集

本扩展**不会**收集、传输或分享任何可识别个人身份的信息。本扩展仅在您的本地浏览器中存储以下数据：

#### 3.1 本地存储的数据
- **视频标记数据**: 您标记为"已浏览"、"已观看"或"想看"的视频番号
- **演员信息**: 您添加到演员库的演员名称和相关信息
- **用户设置**: 扩展的配置选项，如显示样式、同步设置等
- **WebDAV 配置**: 如果您启用了 WebDAV 同步功能，会存储服务器地址、用户名和密码（加密存储）
- **115网盘配置**: 如果您启用了115网盘功能，会存储相关的配置信息
- **操作日志**: 扩展的操作记录，用于调试和问题排查

所有这些数据都存储在您的浏览器本地存储（Chrome Storage API）中，**不会**上传到任何第三方服务器。

### 4. 数据使用

本扩展使用收集的数据仅用于以下目的：

- **功能实现**: 在 JavDB 网站上显示视频的观看状态标记
- **数据管理**: 提供番号库、演员库的管理功能
- **云端同步**: 如果您启用了 WebDAV 同步，数据会同步到您自己配置的 WebDAV 服务器
- **115网盘集成**: 如果您启用了115网盘功能，会与115网盘服务进行交互以推送磁力链接

### 5. 数据共享

本扩展**不会**与任何第三方共享您的数据，除非：

- **WebDAV 同步**: 如果您主动启用了 WebDAV 同步功能，数据会上传到您自己配置的 WebDAV 服务器（如坚果云、TeraCloud、Yandex 等）。这是您主动选择的行为，数据传输到您自己控制的服务器。
- **115网盘服务**: 如果您启用了115网盘功能，扩展会与115.com的服务器通信以实现磁力链接推送功能。

### 6. 第三方服务

本扩展可能会访问以下第三方服务（仅在您启用相关功能时）：

- **JavDB.com**: 扩展的主要工作网站，用于显示视频标记
- **WebDAV 服务**: 如坚果云、TeraCloud、Yandex、Nextcloud、OwnCloud 等（仅在您配置并启用同步功能时）
- **115.com**: 115网盘服务（仅在您启用115网盘功能时）
- **磁力搜索网站**: 如 sukebei.nyaa.si、btdig.com、btsow.com、torrentz2.eu 等（仅在您使用磁力搜索功能时）

这些第三方服务有各自的隐私政策，本扩展不对这些服务的隐私实践负责。

### 7. 数据安全

本扩展采取以下措施保护您的数据：

- **本地存储**: 所有数据默认存储在浏览器本地，不上传到任何服务器
- **加密传输**: 与 WebDAV 服务器和115网盘的通信使用 HTTPS 加密
- **权限最小化**: 扩展仅请求必要的浏览器权限
- **开源透明**: 本扩展的源代码在 GitHub 上公开，任何人都可以审查

### 8. 数据控制

您对自己的数据拥有完全控制权：

- **查看数据**: 在扩展的设置面板中查看所有存储的数据
- **导出数据**: 随时导出您的数据为 JSON 文件
- **删除数据**: 在设置面板中清除所有数据，或卸载扩展以删除所有本地数据
- **禁用功能**: 可以随时禁用 WebDAV 同步或115网盘功能

### 9. 权限说明

本扩展请求以下浏览器权限：

- **storage**: 在本地存储您的标记数据和设置
- **tabs**: 检测当前标签页的 URL，以便在正确的页面上工作
- **alarms**: 用于定时自动同步功能
- **scripting**: 在网页中注入脚本以显示标记
- **notifications**: 显示操作结果通知
- **unlimitedStorage**: 存储大量的视频标记数据
- **declarativeNetRequest**: 优化网络请求
- **host_permissions**: 访问 JavDB、WebDAV 服务器、115网盘等网站

这些权限仅用于实现扩展的核心功能，不会用于其他目的。

### 10. 儿童隐私

本扩展不适用于18岁以下的用户。我们不会故意收集儿童的个人信息。

### 11. 隐私政策更新

我们可能会不时更新本隐私政策。更新后的政策将在 GitHub 仓库中发布，并在扩展更新时通知用户。

### 12. 联系我们

如果您对本隐私政策有任何疑问或建议，请通过以下方式联系我们：

- **GitHub Issues**: https://github.com/JavdBviewed/JavdBviewed/issues
- **GitHub Discussions**: https://github.com/JavdBviewed/JavdBviewed/discussions

---

## English Version

### 1. Overview

Jav Assistant (hereinafter referred to as "this extension") respects and protects user privacy. This privacy policy explains how this extension collects, uses, stores, and protects your information.

### 2. Developer Information

- **Extension Name**: Jav Assistant
- **Developer**: lmixture
- **Contact**: [GitHub Issues](https://github.com/JavdBviewed/JavdBviewed/issues)

### 3. Data Collection

This extension **does not** collect, transmit, or share any personally identifiable information. The extension only stores the following data locally in your browser:

#### 3.1 Locally Stored Data
- **Video Marking Data**: Video IDs you marked as "browsed", "watched", or "want to watch"
- **Actor Information**: Actor names and related information you added to the actor library
- **User Settings**: Extension configuration options, such as display styles, sync settings, etc.
- **WebDAV Configuration**: If you enable WebDAV sync, server address, username, and password (encrypted storage)
- **115 Cloud Configuration**: If you enable 115 cloud features, related configuration information
- **Operation Logs**: Extension operation records for debugging and troubleshooting

All this data is stored in your browser's local storage (Chrome Storage API) and is **not** uploaded to any third-party servers.

### 4. Data Usage

This extension uses collected data only for the following purposes:

- **Feature Implementation**: Display video watch status marks on JavDB website
- **Data Management**: Provide video library and actor library management features
- **Cloud Sync**: If you enable WebDAV sync, data will be synced to your configured WebDAV server
- **115 Cloud Integration**: If you enable 115 cloud features, interact with 115 cloud service to push magnet links

### 5. Data Sharing

This extension **does not** share your data with any third parties, except:

- **WebDAV Sync**: If you actively enable WebDAV sync, data will be uploaded to your configured WebDAV server (such as Jianguoyun, TeraCloud, Yandex, etc.). This is your voluntary action, and data is transmitted to servers you control.
- **115 Cloud Service**: If you enable 115 cloud features, the extension will communicate with 115.com servers to implement magnet link push functionality.

### 6. Third-Party Services

This extension may access the following third-party services (only when you enable related features):

- **JavDB.com**: The main working website of the extension, used to display video marks
- **WebDAV Services**: Such as Jianguoyun, TeraCloud, Yandex, Nextcloud, OwnCloud, etc. (only when you configure and enable sync)
- **115.com**: 115 cloud service (only when you enable 115 cloud features)
- **Magnet Search Sites**: Such as sukebei.nyaa.si, btdig.com, btsow.com, torrentz2.eu, etc. (only when you use magnet search)

These third-party services have their own privacy policies, and this extension is not responsible for their privacy practices.

### 7. Data Security

This extension takes the following measures to protect your data:

- **Local Storage**: All data is stored locally in the browser by default, not uploaded to any server
- **Encrypted Transmission**: Communication with WebDAV servers and 115 cloud uses HTTPS encryption
- **Minimal Permissions**: The extension only requests necessary browser permissions
- **Open Source Transparency**: The extension's source code is publicly available on GitHub for anyone to review

### 8. Data Control

You have complete control over your data:

- **View Data**: View all stored data in the extension's settings panel
- **Export Data**: Export your data as a JSON file at any time
- **Delete Data**: Clear all data in the settings panel, or uninstall the extension to delete all local data
- **Disable Features**: You can disable WebDAV sync or 115 cloud features at any time

### 9. Permission Explanation

This extension requests the following browser permissions:

- **storage**: Store your marking data and settings locally
- **tabs**: Detect the current tab's URL to work on the correct page
- **alarms**: Used for scheduled automatic sync
- **scripting**: Inject scripts into web pages to display marks
- **notifications**: Display operation result notifications
- **unlimitedStorage**: Store large amounts of video marking data
- **declarativeNetRequest**: Optimize network requests
- **host_permissions**: Access JavDB, WebDAV servers, 115 cloud, and other websites

These permissions are only used to implement the extension's core features and will not be used for other purposes.

### 10. Children's Privacy

This extension is not intended for users under 18 years old. We do not knowingly collect personal information from children.

### 11. Privacy Policy Updates

We may update this privacy policy from time to time. Updated policies will be published in the GitHub repository and users will be notified when the extension is updated.

### 12. Contact Us

If you have any questions or suggestions about this privacy policy, please contact us through:

- **GitHub Issues**: https://github.com/JavdBviewed/JavdBviewed/issues
- **GitHub Discussions**: https://github.com/JavdBviewed/JavdBviewed/discussions

---

**注意 / Note**: 本隐私政策适用于 Jav 助手浏览器扩展。使用本扩展即表示您同意本隐私政策的条款。

**Note**: This privacy policy applies to the Jav Assistant browser extension. By using this extension, you agree to the terms of this privacy policy.
