---
name: genhtml
description: Generate HTML pages and deploy to public URL. Trigger with /genhtml command followed by requirements. Creates HTML based on user description, deploys via Cloudflare tunnel, returns accessible link.
---

# GenHTML Skill

Generate and deploy HTML pages with a single command.

## Trigger

`/genhtml <需求描述>`

## Workflow

1. Parse user requirements from the command
2. Generate HTML file to `/home/ubuntu/clawd/public/gen/`
3. Run deploy script (优先 sher.sh，失败则 cloudflared)
4. Return the public URL to user

## Generate HTML

Create HTML based on user requirements:
- Modern, responsive design
- Use inline CSS (no external dependencies)
- Include viewport meta for mobile
- Keep it clean and functional

Save to: `/home/ubuntu/clawd/public/gen/<filename>.html`

Also copy to `index.html` (sher.sh 需要入口文件)

## Deploy

Run the deploy script:

```bash
/home/ubuntu/clawd/skills/genhtml/scripts/deploy.sh
```

部署策略：
1. **优先 sher.sh** - 每天 1 次免费额度，链接短且稳定
2. **回退 cloudflared** - 无限制，链接较长

脚本会输出：
- `DEPLOY_METHOD=sher` 或 `DEPLOY_METHOD=cloudflared`
- `BASE_URL=https://xxx.sher.sh` 或 `BASE_URL=https://xxx.trycloudflare.com`

## Return URL

根据部署方式返回链接：
- sher: `https://xxx.sher.sh/` (index.html 是入口)
- cloudflared: `https://xxx.trycloudflare.com/gen/<filename>.html`

**Important:** Send URL as plain text, no markdown formatting.

## Example

User: `/genhtml 一个简单的计数器`

1. Generate `/home/ubuntu/clawd/public/gen/counter.html`
2. Copy to `index.html`
3. Run deploy script
4. Return URL
