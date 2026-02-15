---
name: deploy-mcp
description: Build, deploy, and verify the workout MCP server to Cloudflare Workers
---

# Deploy MCP Server

Build, deploy, and verify the workout MCP server at `/Users/sachitgoyal/code/workout-mcp-server/`.

## Arguments

- No args or `prod` → deploy to production (`workout-mcp-server.sachitgoyal6.workers.dev`)
- `dev` → deploy to dev (`workout-mcp-server-dev.sachitgoyal6.workers.dev`)

## Steps

1. **Build**
   ```bash
   cd /Users/sachitgoyal/code/workout-mcp-server && npm run build
   ```
   If build fails, show errors and stop.

2. **Deploy**
   ```bash
   # Production (default)
   cd /Users/sachitgoyal/code/workout-mcp-server && npm run deploy:prod

   # Dev
   cd /Users/sachitgoyal/code/workout-mcp-server && npm run deploy:dev
   ```

3. **Verify health**
   ```bash
   # Production
   curl -s https://workout-mcp-server.sachitgoyal6.workers.dev/health

   # Dev
   curl -s https://workout-mcp-server-dev.sachitgoyal6.workers.dev/health
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
cd /Users/sachitgoyal/code/workout-mcp-server
npx wrangler secret put SUPABASE_URL --env <env>
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY --env <env>
```

## Debugging

Tail live logs:
```bash
cd /Users/sachitgoyal/code/workout-mcp-server && npm run cf:tail      # production
cd /Users/sachitgoyal/code/workout-mcp-server && npm run cf:tail:dev  # dev
```
