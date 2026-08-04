class Router {
  constructor() {
    this.routes = [];
  }
  _add(method, pattern, handler) {
    const paramNames = [];
    const regexStr = pattern
      .replace(/\/:([^/]+)/g, (_, name) => { paramNames.push(name); return '/([^/]+)'; })
      .replace(/\*/g, '.*');
    const regex = new RegExp(`^${regexStr}/?$`);
    this.routes.push({ method, regex, paramNames, handler });
  }
  get(p, h) { this._add('GET', p, h); }
  post(p, h) { this._add('POST', p, h); }
  match(method, pathname) {
    for (const r of this.routes) {
      if (r.method !== method) continue;
      const m = r.regex.exec(pathname);
      if (m) {
        const params = {};
        r.paramNames.forEach((name, i) => { params[name] = decodeURIComponent(m[i + 1]); });
        return { handler: r.handler, params };
      }
    }
    return null;
  }
}
module.exports = Router;
