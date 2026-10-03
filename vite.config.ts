import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import type { IncomingMessage, ServerResponse } from 'node:http';

function localVercelApi(): Plugin {
  return {
    name: 'local-vercel-api',
    configureServer(server) {
      server.middlewares.use('/api', async (req: IncomingMessage, res: ServerResponse, next) => {
        try {
          const pathname = (req.url || '/').split('?')[0];
          const endpoint = pathname.replace(/^\/+/, '') || 'health';
          if (!['submit', 'admin', 'appointments', 'health', 'services', 'social', 'pages'].includes(endpoint)) return next();

          const chunks: Buffer[] = [];
          for await (const chunk of req) chunks.push(Buffer.from(chunk));
          const raw = Buffer.concat(chunks).toString('utf8');
          let body: any = {};
          if (raw) {
            try { body = JSON.parse(raw); }
            catch { body = raw; }
          }

          const query = Object.fromEntries(new URL(req.url || '/', 'http://localhost').searchParams.entries());
          const request: any = Object.assign(req, { body, query });
          const response: any = res;
          response.status = (code: number) => { res.statusCode = code; return response; };
          response.json = (value: unknown) => {
            if (!res.headersSent) res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(JSON.stringify(value));
            return response;
          };

          const mod = await server.ssrLoadModule(`/api/${endpoint}.ts`);
          await mod.default(request, response);
        } catch (error: any) {
          console.error('[local API]', error);
          if (!res.headersSent) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
          }
          if (!res.writableEnded) res.end(JSON.stringify({ error: error?.message || 'Local API failed' }));
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  for (const [key, value] of Object.entries(env)) process.env[key] = value;
  return { plugins: [react(), localVercelApi()] };
});
