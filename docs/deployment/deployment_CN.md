# 三机部署

本文档描述当前仓库实现下的三机部署与运行流程。

涉及三台机器：

- `分享者电脑`
  分享者所在机器。运行本地 `host-controller` 和本地 `ffmpeg`，并持有源视频文件。
- `云服务器`
  运行 `SRS`、`room-service` 和 `viewer-web`。
- `被分享者电脑`
  接收方所在机器。通过浏览器打开 viewer 页面，并通过 WebRTC 或 HLS 观看视频。

本文档描述的是当前代码仓库可落地的部署方式，不代表最终产品形态。

## 当前现实

当前仓库还没有提供 host 侧网页或桌面文件选择器。

分享者选择视频文件的方式，是在本机通过命令行运行 host controller，并传入本地文件路径：

```powershell
node services/host-controller/src/index.js --input "D:\path\to\movie.mp4"
```

当前媒体链路与控制链路分别如下：

```text
分享者电脑上的本地视频文件
  -> host-controller
  -> 本地 ffmpeg
  -> 推送 RTMP 到云服务器上的 SRS
  -> WebRTC 主播放 / HLS 回退
  -> 被分享者电脑上的 viewer 网页

分享者操作
  -> HTTP 到 room-service
  -> room-service 维护权威房间状态
  -> 通过 WebSocket 将状态同步给观众
```

## 网络拓扑

```text
+------------------+         +------------------------+         +------------------+
| 分享者电脑       |         | 云服务器               |         | 被分享者电脑     |
|                  |         |                        |         |                  |
| 本地视频文件     |         | SRS                    |         | 浏览器           |
| host-controller  | ----->  | room-service           | ----->  | viewer-web       |
| ffmpeg           |         | viewer-web             |         | WebRTC/HLS 播放  |
+------------------+         +------------------------+         +------------------+
       |                                ^    ^
       |                                |    |
       +---------- HTTP + RTMP ---------+    +------ HTTP + WebSocket + WebRTC/HLS
```

## 端口要求

当前 `docker-compose.yml` 在云服务器上暴露以下端口：

- `3000`
  `room-service` 的 HTTP API 和 WebSocket 入口
- `1935`
  SRS 的 RTMP 推流入口，供分享者电脑推流
- `8080`
  SRS 的 HTTP 输出，主要用于 HLS 播放或调试
- `1985`
  SRS 的 HTTP API 入口，当前用于 WHEP/WebRTC
- `8000/udp`
  SRS 的 RTC UDP 流量
- `5173`
  viewer 网页

最小连通要求：

- 分享者电脑必须能访问云服务器的 `3000` 和 `1935`
- 被分享者电脑必须能访问云服务器的 `5173`、`3000`、`1985`、`8080` 和 `8000/udp`

如果 viewer 播放跨公网，WebRTC 后续很可能仍然需要额外的 STUN/TURN 规划。当前仓库还没有解决这一点。

## 云服务器部署

### 1. 准备环境变量

在云服务器上，根据示例创建 `.env`：

```powershell
Copy-Item .env.example .env
```

将 `PUBLIC_HOST` 设置为分享者电脑和被分享者电脑都能访问到的公网 IP 或域名。

示例：

```text
PUBLIC_HOST=203.0.113.10
```

注意：

- 三机部署时不要保留 `PUBLIC_HOST=localhost`
- `room-service` 会使用 `PUBLIC_HOST` 生成 RTMP、WHEP 和 HLS 地址
- 如果 `PUBLIC_HOST` 配错，建房可能成功，但播放地址会错误，导致观看失败

### 2. 启动服务

执行：

```powershell
docker compose up --build -d
```

这会启动：

- `SRS`
- `room-service`
- `viewer-web`

### 3. 验证服务

至少在云服务器上验证以下地址：

```text
http://<PUBLIC_HOST>:3000/health
http://<PUBLIC_HOST>:8080/
http://<PUBLIC_HOST>:1985/rtc/v1/
http://<PUBLIC_HOST>:5173/
```

## 分享者电脑流程

分享者电脑不需要运行完整服务端栈。

它只需要：

- Node.js 20+
- `ffmpeg` 已加入 `PATH`
- 能访问本地视频文件
- 能连通云服务器

### 1. 准备项目代码

由于当前 host 逻辑是本地 Node 脚本，分享者电脑需要有这份仓库代码：

```powershell
node services/host-controller/src/index.js `
  --room-service-url http://<PUBLIC_HOST>:3000 `
  --input "D:\path\to\movie.mp4"
```

可选参数：

- `--host-user-id host_1`
- `--no-autoplay`

### 2. 这个命令会做什么

当前 host controller 会按以下步骤执行：

1. 向 `room-service` 发送 `POST /rooms`
2. 获取返回值：
   `roomId`、`hostSessionId`、`publishUrl`、`whepUrl`、`hlsUrl`
3. 启动本地 `ffmpeg`
4. 将所选本地视频文件推送到返回的 RTMP `publishUrl`
5. 调用 `POST /rooms/<ROOM_ID>/stream-ready` 标记流已就绪
6. 可选调用 `POST /rooms/<ROOM_ID>/playback` 并发送 `play`

### 3. 分享者需要发给对方什么

host controller 启动后会打印生成的 `roomId`。

分享者可以发送以下任一信息给被分享者：

- viewer 页面地址加 `roomId`
- 或者直接发送预填好的链接，例如：

```text
http://<PUBLIC_HOST>:5173/?roomId=<ROOM_ID>&roomServiceUrl=http://<PUBLIC_HOST>:3000
```

## 被分享者电脑流程

被分享者电脑只需要浏览器，以及到云服务器的网络连通性。

### 1. 打开 viewer 页面

打开：

```text
http://<PUBLIC_HOST>:5173/
```

### 2. 加入房间

输入：

- `Room ID`
- 可选 viewer 名称
- `Room Service URL`
  `http://<PUBLIC_HOST>:3000`

然后点击 `Join Room`。

### 3. 播放行为

加入后：

- 页面会调用 `POST /rooms/<ROOM_ID>/join`
- 页面会连接 `ws://<PUBLIC_HOST>:3000/ws`
- 页面会接收房间状态更新
- 当 stream status 变为 `ready` 时，页面会尝试通过 WHEP 建立 WebRTC 播放
- 如果 WebRTC 不可用，HLS 链接仍然会作为回退/调试入口展示出来

当前限制：

- WebRTC 客户端逻辑仍然比较基础，尚未做重连加固
- HLS 只在浏览器原生支持时才能直接播放
- 浏览器可能会阻止带声音的自动播放

## 端到端时序

```text
1. 云服务器启动 SRS + room-service + viewer-web
2. 分享者使用本地文件路径运行 host-controller
3. room-service 创建房间并返回推流地址
4. 分享者本地 ffmpeg 向 SRS 推送 RTMP
5. host controller 将房间标记为 stream ready
6. 被分享者打开 viewer-web 并加入房间
7. 被分享者通过 WebSocket 收到房间状态
8. viewer 页面尝试从 SRS 建立 WebRTC 播放
9. 被分享者通过 WebRTC 观看，或在可能时使用 HLS
```

## 运维排查清单

当三机流程无法跑通时，优先检查以下项目：

- `PUBLIC_HOST` 是否已设置为真实可访问的服务器 IP 或域名
- 云服务器防火墙是否已放行 `3000`、`1935`、`5173`、`1985`、`8080` 和 `8000/udp`
- 分享者电脑是否能访问 `http://<PUBLIC_HOST>:3000/health`
- 分享者电脑是否能向 `rtmp://<PUBLIC_HOST>:1935` 推流
- 被分享者电脑是否能打开 `http://<PUBLIC_HOST>:5173/`
- 是否先成功建房，再启动 `ffmpeg`
- `room-service` 生成的 SRS 地址是否对外可达

## 本文档不覆盖的内容

本文档不表示当前代码仓库已经具备以下能力：

- host 侧文件选择 UI
- 生产级鉴权或 token 校验
- 健壮的媒体暂停/跳转语义
- TURN 部署
- 完整的重连与故障恢复机制

本文档只用于说明当前仓库在分享者、云服务器、被分享者三台机器上的部署与运行方式。
