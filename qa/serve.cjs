// Static server for the QA build that applies the SAME response headers as production (netlify.toml),
// so a Content-Security-Policy that would break the app shows up as a console error in the browser QA.
const http = require('http'), fs = require('fs'), path = require('path')
const root = path.resolve(process.argv[2] || 'dist-qa'), port = Number(process.argv[3] || 4173)
const toml = fs.readFileSync(path.join(__dirname, '..', 'netlify.toml'), 'utf8')
const block = toml.split('[[headers]]')[1] || ''
const headers = {}; for (const m of block.matchAll(/^\s*([A-Za-z-]+)\s*=\s*"(.*)"\s*$/gm)) if (!['for'].includes(m[1])) headers[m[1]] = m[2]
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webmanifest': 'application/manifest+json', '.json': 'application/json' }
http.createServer((req, res) => {
  let p = path.join(root, decodeURIComponent(req.url.split('?')[0])); if (!p.startsWith(root)) { res.writeHead(403); return res.end() }
  if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) p = path.join(root, 'index.html')
  res.writeHead(200, { ...headers, 'Content-Type': types[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(res)
}).listen(port, () => console.log('serving', root, 'with', Object.keys(headers).length, 'security headers'))
