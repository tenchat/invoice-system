# Vercel 代理后端间歇性 502：排障记录

## 问题现象

- 前端域名：`https://invoice.zhong2.fun`
- 前端部署在 Vercel，后端运行在阿里云 ECS：`47.103.113.70:3001`
- `web/vercel.json` 将 `/api/:path*` 外部重写到 `http://47.103.113.70:3001/api/:path*`
- 页面中的发票列表请求 `GET /api/invoices?page=1&size=20` 经常返回 502；用户观察约 10% 快速成功，约 90% 等待约 45 秒或无响应。
- 曾见 Vercel 响应头 `X-Vercel-Error: ROUTER_EXTERNAL_TARGET_CONNECTION_ERROR`，请求等待约 30 秒后返回 502。

## 已确认事实

1. **后端本机健康检查正常**
   - `http://127.0.0.1:3001/api/health` 返回 `200` 和 `{"ok":true,...}`。
   - 从 Windows 直连 `http://47.103.113.70:3001/api/health` 曾返回 `200`，TTFB 约 `0.08s`。

2. **Vercel 到后端有时能够完整往返**
   - `https://invoice.zhong2.fun/api/health` 曾返回 `200`。
   - 同一次请求的服务器抓包看到来源 `54.179.117.123`，请求带有 `X-Vercel-Id: sin1::9plvf-1794592648641-df9f3f7336e9`，路径为 `GET /api/health`。
   - 后端约 3 ms 后发出 `HTTP/1.1 200 OK`，Vercel 对响应数据发回 TCP ACK；Windows 收到同一 `X-Vercel-Id` 的健康检查 JSON。
   - 更早一次成功抓包来源为 `54.179.128.151`。成功样例不止一个来源 IP。

3. **安全组和主机防火墙配置看起来已放行**
   - 阿里云安全组截图显示 IPv4、自定义 TCP、端口 `3001/3001`、来源 `0.0.0.0/0`、授权策略“允许”。
   - UFW 已有 `3001/tcp ALLOW Anywhere`。
   - Node 曾确认监听 `*:3001`。
   - 服务器网卡 `eth0` 使用私网地址 `172.24.16.5/20`，公网地址 `47.103.113.70` 由云平台映射。

4. **失败请求发生时的抓包没有包到达主机**
   - 失败时同时运行 `tcpdump -nn -tttt -i any 'tcp port 3001'`，抓包无输出。
   - `journalctl -fu invoice-system` 同时无输出。应用当前未配置逐请求访问日志，因此 journal 无输出本身不能单独证明请求未到；主机抓包无包是更直接的证据。

5. **失败页面请求与健康检查不同**
   - 浏览器 Network 截图中，`GET /api/invoices?page=1&size=20` 返回 `502 Bad Gateway`，耗时约 45 秒，浏览器连的是 Vercel 地址 `64.29.17.1:443`。
   - `/api/health` 不需要登录、不查询 SQLite；发票列表需要 JWT 鉴权并执行 SQLite 查询。因此健康检查成功不能单独证明列表接口的处理过程正常。

6. **接口代码的初步检查**
   - `server/src/routes/invoices.js` 的列表路由调用 `invoiceService.listInvoices()`。
   - `listInvoices()` 执行总数查询和按页查询，没有 OCR 或远程服务调用。
   - 未带令牌直连 `/api/invoices` 返回快速 `401`，但这会在鉴权处提前结束，**没有执行发票列表查询**，不能据此排除已认证列表查询或数据库问题。

## 当前疑点（尚未证实）

### A. 云主机前置网络路径间歇性丢包或拦截

失败时包未到达 ECS 网卡，说明失败连接可能在 Vercel 到 ECS 的路由途中，或在云主机网卡之前被丢弃。安全组虽已允许 `0.0.0.0/0`，仍需确认：

- 该安全组是否确实绑定到当前 ECS 实例。
- 阿里云云防火墙、交换机网络 ACL、DDoS/访问控制或其他云侧网络策略是否会丢弃部分连接。
- Vercel `sin1` 外部重写出口到该阿里云公网 IP/3001 的链路是否间歇性异常。
- 失败和成功请求的 Vercel 外部源 IP 是否不同。已有成功样例来源是两个不同的 `54.179.*` 地址，但尚无与失败 502 同时对应的源 IP/流量记录。

### B. 失败抓包与实际 502 请求是否精确对应

成功的 `/api/health` 抓包有完整时间、请求 ID 和响应；失败样例的抓包没有包。需要在下一次**确切的发票列表 502**期间同时抓包，并记录浏览器/Vercel 的请求 ID，以排除测试不同请求或时间窗口错位。

### C. 仅在请求到达 ECS 后才考虑应用/数据库

若后续失败样例抓到 `/api/invoices` 的入站连接，则要进一步判断：

- TCP 握手和请求数据是否到达；
- Node 是否及时写回 HTTP 响应；
- 是否出现 SQLite 锁等待、磁盘 IO/CPU/内存压力或应用异常；
- Vercel 是否收到后端响应却仍返回 502。

目前失败期间无主机侧数据，因此尚无证据支持把列表 SQL 当作首要原因。

## 建议的下一步验证

1. 发票列表页面复现 502 时，在服务器执行：

   ```bash
   sudo tcpdump -nn -tttt -i any 'tcp port 3001'
   ```

   不加 `-A`，避免抓出请求中的 `Authorization` 令牌。记录失败请求时间、服务器是否出现 SYN/请求数据/响应，以及来源 IP。

2. 在浏览器 DevTools → Network → 失败请求的 Response Headers 中记录：
   - `X-Vercel-Error`
   - `X-Vercel-Id`
   - HTTP 状态码和耗时

3. 将上述时间与阿里云云防火墙、网络 ACL 或安全组流日志核对，确认云平台是否看到了被丢弃的连接。

4. 若失败时有入站包，再检查：

   ```bash
   sudo journalctl -u invoice-system --since "5 minutes ago" --no-pager -l
   ```

   并考虑增加只记录方法、路径、状态码和耗时的临时 HTTP 访问日志（不要记录 Authorization/Cookie）。

## 安全事项

- 一张浏览器 Network 截图曾暴露 `Authorization: Bearer ...` 登录令牌。这里没有复制令牌值；应修改对应用户密码使旧令牌失效，然后重新登录。
- 不要把 JWT、Cookie、密码或包含这些字段的完整请求头粘贴到排障记录或公共工单。

## 参考

- [Vercel：ROUTER_EXTERNAL_TARGET_CONNECTION_ERROR](https://vercel.com/docs/errors/router_external_target_connection_error)
- [Vercel：External rewrites](https://vercel.com/docs/routing/rewrites)
