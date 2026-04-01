# Remote Cinema

Remote Cinema 是一个面向超小规模私密群组的低延迟远程一起看片系统。

目标使用场景：

```text
1 个 host + 1 到 4 个 viewer
本地视频文件作为源
尽量少的准备步骤
接近实时的同步观看体验
```

产品目标不是规模化，而是为一个小型私密房间提供更好的共同观影体验。

---

## 这个项目是什么

Remote Cinema 围绕一个简单流程设计：

### Host

```text
打开应用 -> 选择本地视频 -> 创建房间 -> 开始观看
```

### Viewer

```text
打开链接或输入房间码 -> 加入房间 -> 尽量少操作地开始观看
```

系统应当隐藏：

- FFmpeg 复杂性
- stream key 管理
- 手动播放器配置
- 手动播放同步步骤

---

## 这个项目不是什么

这个项目不打算成为：

- 公共直播平台
- 视频托管平台
- CDN 系统
- DRM/内容保护系统
- 高并发广播架构

硬性范围限制：

```text
每个房间 1 到 4 个 viewer
```

这个约束是有意设计的。它让架构能聚焦在：

- 播放质量
- 低延迟
- 同步精度
- 运维简单性

---

## 产品优先级

优先级顺序：

```text
体验 > 规模
简单性 > 功能数量
质量 > 广泛兼容性
同步稳定性 > 花哨控制
```

核心目标：

- 目标画质 1080p
- WebRTC 优先播放路径
- HLS 回退路径
- host 权威的房间控制
- 低延迟同步观看

---

## 高层架构

```text
[Host Client]
   ->
[Room Service]
   ->
[FFmpeg Supervisor]
   ->
[SRS Media Server]
   ->
[WebRTC Primary] / [HLS Fallback]
   ->
[Viewer Client]
```

架构拆分：

- 媒体面：本地文件 -> FFmpeg -> SRS -> WebRTC/HLS
- 控制面：room service -> WebSocket -> host/viewers

核心组件：

- Host Client
- Room Service
- FFmpeg Supervisor
- SRS Media Server
- Viewer Client

---

## 当前 Bootstrap

当前仓库已经包含一个最小可运行的后端启动骨架：

- `docker-compose.yml`
  启动 `SRS` 和 `room-service`
- `services/room-service`
  最小 Node.js room service 骨架
- `services/host-controller`
  最小本地 host 侧控制器，可创建房间并拉起 FFmpeg
- `services/viewer-web`
  最小浏览器客户端，可加入房间并观察实时房间状态
- `.env.example`
  本地开发用的运行时 host/port 默认值

当前已实现：

- SRS 容器接线，支持 RTMP ingest 和 WebRTC 输出
- 房间创建 API
- viewer 加入 API
- 基础房间状态查询 API
- 房间 WebSocket 端点
- host 权威的播放事件广播
- 基于 room ID 的流地址/播放地址生成
- 本地 host 进程，可创建房间并用 FFmpeg 推送本地文件
- 最小浏览器页面，可加入房间并订阅实时状态

当前未实现：

- host 桌面 UI
- 完整 viewer 播放栈
- 健壮的 FFmpeg supervisor 行为
- 持久化存储
- token 校验和真实鉴权
- 来自 SRS 的 stream health 回调

---

## 快速开始

1. 复制环境变量默认值。

```powershell
Copy-Item .env.example .env
```

2. 设置 `PUBLIC_HOST`。

可使用：

- `localhost` 用于同机演示
- 你的局域网 IP 用于局域网 viewer
- 公网 IP 或域名用于 Internet 访问

3. 启动后端栈。

```powershell
docker compose up --build
```

4. 验证服务。

```text
Room service 健康检查: http://localhost:3000/health
SRS HTTP player 根地址: http://localhost:8080/
SRS WebRTC API 基地址: http://localhost:1985/rtc/v1/
```

重要：

- 对于 WebRTC，`PUBLIC_HOST` 必须能被 viewer 访问到
- 如果 `PUBLIC_HOST` 配置错误，RTMP ingest 可能仍然成功，但 viewer 播放会失败

5. 运行本地 host controller。

前置条件：

- Node.js 20+
- `ffmpeg` 已在 `PATH` 中可用
- 一份本地视频文件

命令：

```powershell
node services/host-controller/src/index.js --input "D:\path\to\movie.mp4"
```

可选参数：

- `--room-service-url http://localhost:3000`
- `--host-user-id host_1`
- `--no-autoplay`

它会执行：

- 通过 `room-service` 创建房间
- 打印房间与播放 URL
- 启动本地 FFmpeg
- 当 FFmpeg 开始推流后，将房间标记为 stream ready
- 可选发送初始 `play`

6. 打开 viewer web 应用。

```text
http://localhost:5173
```

Viewer 流程：

- 输入 `roomId`
- 可选输入显示名称
- 加入房间
- 实时观察房间状态和传输 URL 更新
- viewer-web 现在会尝试通过 SRS 的 WHEP 端点进行 WebRTC 播放
- 如果 WebRTC 失败，HLS 仍会作为回退/调试路径暴露出来

当前限制：

- WebRTC 目前实现为最小直接 WHEP 客户端，还没有重连加固
- HLS 播放仍然依赖浏览器原生支持
- 在不支持原生 HLS 的浏览器中，页面仍会显示实时房间状态和传输 URL

---

## 最小 API 流程

创建房间：

```powershell
Invoke-RestMethod -Method Post `
  -Uri "http://localhost:3000/rooms" `
  -ContentType "application/json" `
  -Body '{"hostUserId":"host_1"}'
```

加入房间：

```powershell
Invoke-RestMethod -Method Post `
  -Uri "http://localhost:3000/rooms/<ROOM_ID>/join" `
  -ContentType "application/json" `
  -Body '{"userId":"viewer_1"}'
```

标记流已就绪：

```powershell
Invoke-RestMethod -Method Post `
  -Uri "http://localhost:3000/rooms/<ROOM_ID>/stream-ready"
```

通过 HTTP 发送播放状态变化：

```powershell
Invoke-RestMethod -Method Post `
  -Uri "http://localhost:3000/rooms/<ROOM_ID>/playback" `
  -ContentType "application/json" `
  -Body '{"action":"play","time":0}'
```

WebSocket 端点：

```text
ws://localhost:3000/ws?roomId=<ROOM_ID>&sessionId=<SESSION_ID>
```

host controller 会打印：

- `roomId`
- `hostSessionId`
- `publishUrl`
- `whepUrl`
- `hlsUrl`

---

## 交付策略

项目有两条交付路线。

### 路线 A: MVP 验证

```text
FFmpeg -> SRS -> HLS -> Browser
```

用它验证：

- 本地文件 ingest
- FFmpeg 启动
- SRS ingest
- 基础浏览器播放

权衡：

- 实现简单
- 延迟较高
- 实时同步能力较弱

### 路线 B: 推荐产品路径

```text
FFmpeg -> SRS -> WebRTC -> Viewer
              ^
              |
        WebSocket Room Service
```

用它实现真正的产品体验：

- 更低延迟
- 更好的同步
- 更好的群组互动体验

权衡：

- 实现复杂度更高
- 对 WebRTC/网络环境要求更强

---

## 当前设计文档

当前项目指导内容拆分在四份文档中。

### 轻量级的常驻约束

[AGENTS.md](D:\VibeCoding\RemoteCinema\AGENTS.md)

内容包括：

- 硬范围约束
- 产品身份
- 默认技术选型
- 始终相关的现实约束

### 产品与系统规格

[docs/product/system-spec.md](D:\VibeCoding\RemoteCinema\docs\product\system-spec.md)

内容包括：

- 范围与非目标
- UX 契约
- 架构边界
- 房间/安全/性能原则
- 分阶段交付

### 房间控制协议

[docs/protocol/room-websocket-protocol.md](D:\VibeCoding\RemoteCinema\docs\protocol\room-websocket-protocol.md)

内容包括：

- WebSocket 消息模型
- 房间生命周期
- host/viewer 角色
- 播放控制事件
- 同步规则
- 重连和错误处理

### Host 推流生命周期

[docs/streaming/host-ffmpeg-supervisor-design.md](D:\VibeCoding\RemoteCinema\docs\streaming\host-ffmpeg-supervisor-design.md)

内容包括：

- FFmpeg supervisor 职责
- 媒体探测与校验
- 编码器选择与回退
- 进程生命周期
- readiness 检查
- 故障恢复

---

## 核心技术决策

当前默认值：

- 房间大小上限 4 个 viewer
- SRS 作为 media server
- RTMP 作为 FFmpeg ingest
- WebRTC 作为主播放传输
- HLS 作为回退
- host 操作通过 room service 变成权威房间状态

这些选择是有意的。它们优化的是私密、高质量的体验，而不是通用流媒体基础设施。

---

## SRS 集成

仓库中没有重新实现 SRS。

项目当前是把官方 SRS server 当作基础设施集成进来：

- FFmpeg 将向 SRS 推送 RTMP
- SRS 将向 viewer 暴露 WebRTC
- HLS 仍然作为回退路径存在

当前 room-service 生成的 URL 为：

- RTMP publish: `rtmp://<PUBLIC_HOST>:1935/live/<ROOM_ID>?token=<PUBLISH_TOKEN>`
- WebRTC WHEP: `http://<PUBLIC_HOST>:1985/rtc/v1/whep/?app=live&stream=<ROOM_ID>`
- HLS fallback: `http://<PUBLIC_HOST>:8080/live/<ROOM_ID>.m3u8`

---

## 已知现实约束

有些约束应当被视为硬工程事实：

- 浏览器不一定允许带声音的自动播放
- 在受控局域网之外，WebRTC 可能需要 STUN/TURN 规划
- 朴素的 file-to-RTMP streaming 并不能免费获得任意 pause/seek
- stream readiness 必须通过 media-server 侧可见性确认，而不能只看 FFmpeg 进程是否启动

如果实现忽略这些约束，Demo 里看起来可能没问题，但真实使用会失败。

---

## 推荐构建顺序

1. 先构建 pipeline MVP。
   目标：证明 本地文件 -> FFmpeg -> SRS -> 浏览器播放。

2. 再构建 room service 和 WebSocket 控制面。
   目标：定义房间生命周期、host/viewer 角色以及权威播放事件。

3. 将 FFmpeg supervisor 做成真正的子系统。
   目标：统一负责启动、健康检查、回退和关闭，而不是把进程管理散落到应用中。

4. 迁移到 WebRTC-first 播放。
   目标：实现预期中的低延迟同步体验。

5. 加固重连、回退和安全性。
   目标：让系统在理想局域网 Demo 之外也能使用。

---

## MVP 定义

第一个真正有意义的里程碑不是完整产品对齐，而是：

```text
Host 选择一个本地文件
房间被创建
FFmpeg 推流到 SRS
Viewer 加入房间
Viewer 能观看流
基础房间状态可见
```

MVP 不要求：

- 完美同步校正
- 健壮的 seek/pause 语义
- 播放列表支持
- 生产级 TURN 策略
- 高级安全加固

---

## 下一步实现目标

在当前文档之后，最合理的下一批实现产物包括：

- room service API 与事件契约实现说明
- SRS 部署/配置说明
- 第一版 FFmpeg 命令模板
- host client 状态机
- viewer client 播放状态机

---

## 最终原则

```text
对于 1 到 4 个人，正确答案不是更多基础设施。
正确答案是更干净的控制、更好的同步、更少的用户步骤。
```
