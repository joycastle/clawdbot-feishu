# HTML 快速部署指南

快速生成静态 HTML 并部署到公网可访问的链接。

## 流程

### 1. 创建 HTML 文件

```bash
# 写入 HTML 到 public 目录
cat > /home/ubuntu/clawd/public/mypage.html << 'EOF'
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>My Page</title>
</head>
<body>
    <h1>Hello World!</h1>
</body>
</html>
EOF
```

### 2. 启动本地 HTTP 服务器

```bash
cd /home/ubuntu/clawd/public && python3 -m http.server 8888
```

用 `background: true` 让它后台运行。

### 3. 启动 Cloudflare 隧道

```bash
/tmp/cloudflared tunnel --url http://localhost:8888
```

同样用 `background: true` 后台运行。

### 4. 获取公网链接

从 cloudflared 日志中找到类似这样的 URL：
```
https://xxx-xxx-xxx-xxx.trycloudflare.com
```

完整链接：`https://xxx.trycloudflare.com/mypage.html`

## 注意事项

- cloudflared 已下载到 `/tmp/cloudflared`
- 每次启动隧道会生成新的随机 URL
- 链接在隧道进程运行期间有效
- 发给用户时**不要用 markdown 加粗**（飞书会把 `**` 当成链接的一部分）

## 快速命令（一键启动）

```bash
# 确保 public 目录有 HTML 文件后执行：

# 启动 HTTP 服务器（后台）
cd /home/ubuntu/clawd/public && python3 -m http.server 8888 &

# 启动隧道（后台）
/tmp/cloudflared tunnel --url http://localhost:8888 &

# 等几秒后查看日志获取 URL
```

## 停止服务

```bash
pkill -f cloudflared
pkill -f "http.server 8888"
```
