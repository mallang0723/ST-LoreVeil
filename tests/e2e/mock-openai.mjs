// Minimal OpenAI-compatible mock. Records every chat/completions request body.
import http from 'node:http';

export const MOCK_REPLY = 'MOCK_REPLY_OK';

export function startMock(port = 0) {
    const requests = [];
    const server = http.createServer((req, res) => {
        const chunks = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => {
            const raw = Buffer.concat(chunks).toString('utf8');
            const url = req.url.split('?')[0];
            if (req.method === 'GET' && url.endsWith('/models')) {
                res.writeHead(200, { 'content-type': 'application/json' });
                return res.end(JSON.stringify({ object: 'list', data: [{ id: 'mock-model', object: 'model' }] }));
            }
            if (req.method === 'POST' && url.endsWith('/chat/completions')) {
                let body = null;
                try { body = JSON.parse(raw); } catch { /* keep null */ }
                requests.push({ url, body, raw });
                if (body && body.stream) {
                    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
                    const chunk = (delta, fin) => `data: ${JSON.stringify({ id: 'mock', object: 'chat.completion.chunk', model: 'mock-model', choices: [{ index: 0, delta, finish_reason: fin }] })}\n\n`;
                    res.write(chunk({ role: 'assistant', content: MOCK_REPLY }, null));
                    res.write(chunk({}, 'stop'));
                    return res.end('data: [DONE]\n\n');
                }
                res.writeHead(200, { 'content-type': 'application/json' });
                return res.end(JSON.stringify({
                    id: 'mock', object: 'chat.completion', model: 'mock-model',
                    choices: [{ index: 0, message: { role: 'assistant', content: MOCK_REPLY }, finish_reason: 'stop' }],
                    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
                }));
            }
            res.writeHead(404, { 'content-type': 'application/json' });
            res.end('{}');
        });
    });
    return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({
        port: server.address().port, requests, server,
        close: () => new Promise((r) => server.close(r)),
    })));
}
