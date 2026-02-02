// Proxy server that adds COOP/COEP headers to ALL responses from Expo dev server
// Required for SharedArrayBuffer / expo-sqlite OPFS on web
const http = require('http');

const EXPO_PORT = 8081;
const PROXY_PORT = 8082;

const proxy = http.createServer((clientReq, clientRes) => {
  const options = {
    hostname: 'localhost',
    port: EXPO_PORT,
    path: clientReq.url,
    method: clientReq.method,
    headers: clientReq.headers,
  };

  const proxyReq = http.request(options, (proxyRes) => {
    clientRes.writeHead(proxyRes.statusCode, {
      ...proxyRes.headers,
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    });
    proxyRes.pipe(clientRes, { end: true });
  });

  proxyReq.on('error', (err) => {
    clientRes.writeHead(502);
    clientRes.end('Proxy error: ' + err.message);
  });

  clientReq.pipe(proxyReq, { end: true });
});

proxy.listen(PROXY_PORT, () => {
  console.log(`COOP/COEP proxy running on http://localhost:${PROXY_PORT} → Expo on :${EXPO_PORT}`);
});
