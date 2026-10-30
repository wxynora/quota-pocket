# 额度口袋 · Quota Pocket

把多个 New API 站点放进一个小账本：查看余额、用量、调用日志、模型、价格和站方近期成功率，搜索模型跨站比价，也能一键跳转充值。电脑和手机都能用，可添加到主屏幕。

**源码已经包含完整前端和查询服务。** 下载安装到自己的电脑即可使用；也可以部署在自己的 VPS，接到已有的 Nginx 和 HTTPS 网站上，手机打开网址即可使用。刷新余额、日志和价格需要联网；离线时可打开界面并查看上次保存的余额。

## 三件事先看这里

- **每个人用自己的站点账号。** 填站点地址、用户 ID 和系统访问令牌；这不是调用模型使用的 API Key。预置站点只是示例，不需要的可以删除，也可以添加其他 New API 站点。
- **令牌存在使用者自己设备的浏览器／网页应用中。** 目前是本地明文存储，不会随源码或“导出配置”分享；换设备或清除网站数据后需要重新填写。查询时，令牌经 HTTPS 发给自己部署的服务，再由服务转给对应站点；服务代码不把令牌存盘或打印日志，但服务器管理者能够接触经过的内容。请只使用自己信任的设备和服务器。
- **部署密码与站点令牌是两回事。** 部署密码保护额度口袋网页；站点令牌用于查询站点账号。每个设备的站点配置相互独立，不会自动同步。

## 连接站点

1. 登录你的 New API 站点，在站点个人资料中找到**用户 ID**。不同站点的界面名称可能略有不同。
2. 点站点头像 → **安全与访问** → **创建访问令牌**，把所有带“查看”的读取权限勾选，创建后复制令牌。通常资料查看和用量查看分别对应 `profile:read`、`usage:read`。部分站点没有权限选择，直接复制该站的系统访问令牌即可；有问题以站点实际界面为准。
3. 回到额度口袋，点对应卡片的“连接”，或点“添加站点”；填写站点首页地址、用户 ID 和刚复制的令牌，保存后刷新。不同站的令牌不能混用。
4. 可选填写余额提醒和充值页地址。充值按钮只打开页面，不会付款。默认预置大肘子、ekan8 和小鸡农场；不需要的站点可点卡片右上角的 × 并确认移除。
5. 模型列表和比价结果会显示站方提供的近 1 小时成功率及查询时间，每次打开时读取；站点无数据或未提供接口时显示无记录或状态未知。这是站方的近期汇总，不是实时试调用；统计时间可能不足一小时，不同分组及密钥权限也可能不同。
6. 模型比价会按人民币从低到高排列，按量与按次分开。兑换比例留空按 **1:1** 计算；实际比例不同时，在该站设置填写“每 1 站内显示单位实际花费多少人民币”。也可在充值比例小计算中输入实际花费和到账站内单位，例如花 ¥50 得到 100 站内单位，会自动填入 `0.5`；保存站点设置后生效。

## 常用功能

- 点卡片上的**自检**，分别检查账户余额、用量统计、调用日志和模型价格；价格可能是站点公开报价。检查只读取信息，不发起模型调用。
- 在**模型比价**输入常用模型名称或关键词，点“收藏”；之后在首页点对应名称可直接打开比价与站方近期成功率。收藏保存在本机，也会包含在不含令牌的配置导出中。
- 点**用量账单**，选择已连接站点和日期范围后查询；结果可按模型筛选，并按站点、日期和模型汇总消费。金额使用各站的充值比例折算人民币，未填写时按 1:1 计算。账单只统计站点返回的消费日志，不含退款；未连接、读取不完整或单位未知的站点会标出，站点日志保留范围和权限可能限制结果。查询使用本机时间，日志只在页面内临时处理，不作为账单存盘。
- **调用日志**可筛选消费和错误记录，错误详情以站点实际返回的内容为准。

返回 `403` 且提示缺少权限时，在该站令牌设置中补充对应查看权限；提示令牌无效时，检查是否复制了该站当前的**系统访问令牌**、是否失效，以及用户 ID 是否正确。各站可能修改接口或启用额外安全验证，无法保证所有分支都兼容。

## 在自己的电脑上运行

1. 安装 [Node.js 20 或更新版本](https://nodejs.org/)。
2. macOS 双击 `打开额度口袋.command`；Windows 双击 `打开额度口袋.bat`。也可以在源码目录运行 `npm start`。
3. 浏览器打开 `http://127.0.0.1:18741/`。保持启动窗口打开；关闭窗口就会停止服务。

这个地址只能在运行服务的电脑上打开，不能直接用来让手机远程访问。电脑本机运行不启用网页密码，不要把 18741 端口直接开放到公网。

## 部署给手机和电脑使用（已有 Nginx）

可把本节或仓库的 [AGENTS.md](AGENTS.md) 直接交给你的部署 Agent。示例以 Debian/Ubuntu、systemd、已运行的 Nginx 和 `www-data` 用户为例；适配自己的服务器即可。**不要覆盖已有 Nginx 站点、证书、其他服务或密码文件。**

### 1. 准备和检查

- 一台自己控制的服务器，已安装 Node.js 20+、Nginx（支持 `auth_request`）、`openssl` 和 `htpasswd`（Debian/Ubuntu 通常由 `apache2-utils` 提供）。确认 `node --version`、`command -v node`、`nginx -V`。
- 一个已指向该服务器、已有有效 HTTPS 的域名。下面用 `https://pocket.example.com` 举例，换成自己的完整来源（若对外使用非默认端口，来源中也要带端口）。
- 检查 18741、18743 是否空闲，确认 `/quota-pocket/`、`/quota-pocket-login/` 等示例路径，以及 systemd 服务名和将要使用的文件路径没有冲突。已有服务占用时，先选其他端口／路径，并在服务、Nginx 和登录页跳转中一致调整；不要停止或覆盖其他服务腾位置。
- 检查现有反向代理、登录方式及日志配置；只将额度口袋接入选定的 HTTPS `server` 块。若已有可信的访问保护，也可以沿用已有保护，但必须同时保护页面、静态资源和查询接口。

### 2. 放置源码和创建密码

把源码包上传并解压到服务器。下面从解压后的源码目录执行；如果 `/opt/quota-pocket` 已存在，先确认它属于本项目并按自己的更新方式备份，**不要直接覆盖不明目录**：

```sh
if sudo test -e /opt/quota-pocket; then
  echo '目录已存在，请先检查并备份，不自动覆盖。'
else
  sudo install -d -m 755 /opt/quota-pocket
  sudo cp -R public pocket-auth /opt/quota-pocket/
  sudo install -m 644 server.mjs /opt/quota-pocket/server.mjs
fi
```

创建**额度口袋专用**的登录密码文件：

```sh
sudo install -d -o root -g www-data -m 750 /etc/quota-pocket
sudo htpasswd -cm /etc/quota-pocket/htpasswd pocket
sudo chown root:www-data /etc/quota-pocket/htpasswd
sudo chmod 640 /etc/quota-pocket/htpasswd
sudo -u www-data test -r /etc/quota-pocket/htpasswd && echo '密码文件可读'
```

`htpasswd` 会交互式要求输入密码，不要把密码写进命令、源码、聊天或日志。`-c` 会覆盖文件，**只在首次创建时使用**；如果文件已存在，先检查并备份，不要重复执行该创建命令。此登录页只要求输入密码，不要求输入用户名；它只支持 `$apr1$` 格式。可参考 [登录页说明](pocket-auth/README.md)。

### 3. 配置并启动服务

确认 `/etc/systemd/system/quota-pocket.service` 和 `/etc/systemd/system/quota-pocket-auth.service` 都不存在；如果已存在，先检查其归属并备份，不要覆盖其他服务。复制两个示例文件，按自己的环境修改后启用：

```sh
sudo cp deploy/quota-pocket.service.example /etc/systemd/system/quota-pocket.service
sudo cp deploy/quota-pocket-auth.service.example /etc/systemd/system/quota-pocket-auth.service
sudoedit /etc/systemd/system/quota-pocket.service
sudoedit /etc/systemd/system/quota-pocket-auth.service
```

在两个文件里把 `https://pocket.example.com` 改成实际的浏览器访问来源；按 `command -v node` 修改 Node 路径，如不是 Debian/Ubuntu 则修改运行用户和密码文件权限。路径改动需在 `WorkingDirectory`、`ExecStart` 和 `POCKET_AUTH_HTPASSWD` 中保持一致。若默认端口被占用，分别在对应服务增加 `Environment=QUOTA_POCKET_PORT=新端口` 和 `Environment=POCKET_AUTH_PORT=新端口`，并同步修改 Nginx 模板中的端口及 `Host` 请求头。

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now quota-pocket.service quota-pocket-auth.service
sudo systemctl status --no-pager quota-pocket.service quota-pocket-auth.service
```

额度口袋默认只监听 `127.0.0.1:18741`，登录服务默认只监听 `127.0.0.1:18743`。`QUOTA_POCKET_PUBLIC_ORIGIN` 和 `POCKET_AUTH_ORIGIN` 必须与浏览器访问的 HTTPS 来源一致，只填来源，不加 `/quota-pocket/` 等路径。

### 4. 接入已有 Nginx

先检查现有配置与路径冲突；将 [deploy/nginx-locations.conf.example](deploy/nginx-locations.conf.example) 的内容加入选定的**已有 HTTPS `server { ... }` 内**，或将它安装为 snippet 后在该 `server` 块中 `include`。它只提供额度口袋和密码页的 location，不定义域名、监听端口或证书。涉及端口和路径时按第 1、3 步同步修改。

例如在确认 `/etc/nginx/snippets/quota-pocket.conf` 不存在后安装 snippet；如果已存在，先检查归属和内容，不要直接覆盖：

```sh
sudo install -m 644 deploy/nginx-locations.conf.example /etc/nginx/snippets/quota-pocket.conf
# 在已有 HTTPS server { ... } 内添加：
# include /etc/nginx/snippets/quota-pocket.conf;
sudo nginx -t
sudo systemctl reload nginx
```

只有 `nginx -t` 通过才执行 reload；失败时恢复刚改的配置，不重启其他服务。检查受保护的页面、静态文件和查询接口未登录时均跳转到 `/quota-pocket-login/`；登录后页面可打开，并用自己的测试站点确认查询。不要将 18741 或 18743 直接暴露给公网。

最后在手机浏览器打开 `https://你的域名/quota-pocket/`。iPhone 在 Safari 分享菜单选择“添加到主屏幕”；Android 在浏览器菜单安装或添加到主屏幕。安装 PWA 后首次使用仍需登录并在该设备添加站点。

### 更新和排错

- 更新前备份将要覆盖的额度口袋文件和相关配置；更新源码、重启**额度口袋自身的服务**后检查状态。若修改了 Nginx，先 `nginx -t` 再 reload；不要动其他应用的数据。
- 直接出现 401、不能登录：检查 `auth_request`、命名 location 和 `error_page` 是否都放在同一个 HTTPS `server`；同时检查浏览器是否允许 Cookie。
- 返回 502：检查两个 systemd 服务是否运行、端口与 Nginx 是否一致，以及 `www-data` 是否能读取密码文件。
- 站点显示“请求来源不正确”：检查两个服务的 HTTPS 来源是否与地址栏的域名和端口完全一致，且没有路径或末尾斜杠。
- 手机打不开或无法安装：检查域名解析、HTTPS 证书和既有防火墙；`127.0.0.1` 是服务器本机地址，不是手机访问地址。
- 站点返回 403、验证页或令牌无效：先看卡片上的站点实际错误，再检查该站权限、安全验证和令牌，不要把令牌粘到公开日志里。

## 隐私和功能边界

- 站点令牌及可选转发口令未加密地保存在当前浏览器中；同一来源下能运行脚本的其他页面也可能读取它们。部署者可更新网页代码，只使用自己控制或信任的域名和服务器。
- 导出配置**不含令牌或转发口令**。导入后需要重新填写令牌。调用日志按需读取，不保存在离线余额快照中。
- 服务发起只读的余额、日志、报价、模型近期成功率和站点状态 GET 请求，不跟随站点跳转。成功率直接读取站方统计，不发起模型试调用、不会因此消耗模型额度。登录页和后端也不要单独暴露到公网。
- 用量来自站点消费日志，按当前设备的本地时间计算；日志保留和访问权限由站点决定。模型报价不等于某个密钥一定有该模型的实际调用权限。
- 比价按站点模型倍率、输出倍率、分组倍率、额度单位和显示汇率换算，再按自己填写的充值比例折算人民币。简单的单层 `tier(...)` 表达式可识别；复杂条件、阶梯、特殊计费或缺少参数时不猜测单一价格。缓存、图像、音频及其他附加费用以站点为准。
- 页面右上角“高级连接”只用于另行托管静态网页并使用自建转发服务；按上述方式部署时无需设置。如需使用 Worker，见 `proxy/`，并只连接自己控制或信任的服务。

## 开发与验证

项目不需要安装运行时依赖。Node.js 20+ 下运行 `npm test`，测试使用虚构数据和本地模拟接口，不需要真实站点凭据。

## 许可证

[MIT](LICENSE)
