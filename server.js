import http from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const distDir = path.join(root, 'dist');
const port = Number(process.env.PORT || 8787);
const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'POST' && req.url === '/api/chat') {
      const body = await readJson(req);
      const assistantText = await replyFromOpenAI(body);
      return json(res, 200, { assistantText });
    }

    const assetPath = resolveAsset(req.url || '/');
    if (assetPath) {
      await streamFile(assetPath, res);
      return;
    }

    const indexPath = path.join(distDir, 'index.html');
    if (existsSync(indexPath)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      createReadStream(indexPath).pipe(res);
      return;
    }

    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Loomspace server is running. Build the client first with npm run build.');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Server error';
    json(res, 500, { error: message });
  }
});

server.listen(port, () => {
  console.log(`Loomspace server listening on http://localhost:${port}`);
});

function resolveAsset(urlPath) {
  const clean = urlPath.split('?')[0];
  const filePath = clean === '/' ? path.join(distDir, 'index.html') : path.join(distDir, clean);
  if (!filePath.startsWith(distDir)) return null;
  if (existsSync(filePath) && statSync(filePath).isFile()) return filePath;
  return null;
}

async function streamFile(filePath, res) {
  const ext = path.extname(filePath).toLowerCase();
  const type = mimeTypes[ext] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': type });
  createReadStream(filePath).pipe(res);
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

async function replyFromOpenAI(body) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set');

  const messages = [
    {
      role: 'system',
      content: [
        'You are the Loomspace thread AI.',
        `Thread title: ${String(body.threadTitle || '')}`,
        `Thread description: ${String(body.threadDescription || '')}`,
        'Keep replies concise and useful.',
        'Do not mention policy or internal tools.',
      ].join(' '),
    },
    ...(Array.isArray(body.messages) ? body.messages : []).map((message) => ({
      role: message.role === 'assistant' ? 'assistant' : message.role === 'system' ? 'system' : 'user',
      content: String(message.text || ''),
    })),
  ];

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.4,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || 'OpenAI request failed');
  }

  const data = await response.json();
  const assistantText = data?.choices?.[0]?.message?.content?.trim();
  if (!assistantText) throw new Error('OpenAI returned no assistant text');
  return assistantText;
}

function json(res, statusCode, data) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

