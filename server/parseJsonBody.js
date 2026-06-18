/**
 * Keasy Log Monitor — JSON Body Parser
 */

const MAX_BODY_SIZE = 1024 * 1024; // 1 MB

function parseJsonBody(req, callback) {
  let body = '';
  let exceeded = false;
  req.on('data', chunk => {
    body += chunk;
    if (body.length > MAX_BODY_SIZE) {
      exceeded = true;
      req.destroy();
    }
  });
  req.on('end', () => {
    if (exceeded) { callback(null); return; }
    try {
      callback(JSON.parse(body));
    } catch {
      callback(null);
    }
  });
  req.on('error', () => {
    if (!exceeded) callback(null);
  });
}

module.exports = parseJsonBody;
