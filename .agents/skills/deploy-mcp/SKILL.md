---
name: deploy-mcp
description: Build, deploy, and verify the lift-ai MCP server to Cloudflare Workers
---

# Deploy MCP Server

Build, deploy, and verify the lift-ai MCP server at `/Users/sachitgoyal/code/lift-ai-mcp/`.

## Arguments

- No args or `prod` → deploy to production (`lift-ai-mcp.sachitgoyal6.workers.dev`)
- `dev` → deploy to dev (`lift-ai-mcp-dev.sachitgoyal6.workers.dev`)

## Steps

1. **Build**
   ```bash
   cd /Users/sachitgoyal/code/lift-ai-mcp && npm run build
   ```
   If build fails, show errors and stop.

2. **Deploy**
   ```bash
   # Production (default)
   cd /Users/sachitgoyal/code/lift-ai-mcp && npm run deploy:prod

   # Dev
   cd /Users/sachitgoyal/code/lift-ai-mcp && npm run deploy:dev
   ```

3. **Verify health**
   ```bash
   # Production
   curl -s https://lift-ai-mcp.sachitgoyal6.workers.dev/health

   # Dev
   curl -s https://lift-ai-mcp-dev.sachitgoyal6.workers.dev/health
   ```
   Expect `{"status":"ok"}`. If not, show error and suggest `npm run cf:tail` to debug.

4. **Report** — Show:
   - Environment deployed to
   - Worker URL
   - Health check result
   - Version ID from deploy output

## Secrets

If secrets need updating (rare):
```bash
cd /Users/sachitgoyal/code/lift-ai-mcp
npx wrangler secret put SUPABASE_URL --env <env>
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY --env <env>
```

## Debugging

Tail live logs:
```bash
cd /Users/sachitgoyal/code/lift-ai-mcp && npm run cf:tail      # production
cd /Users/sachitgoyal/code/lift-ai-mcp && npm run cf:tail:dev  # dev
```
