// A tiny website for the vr browser tests: one page per behaviour the vr scripts must handle.
// startSite() -> { main, other, visited, setMode, close }. `main` and `other` are base URLs (two origins).
import http from 'http';

const page = (body, head = '') => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>t</title>
<style>body{margin:0;font:20px sans-serif}nav{background:#123;color:#fff;padding:14px}h1{margin:20px}.hero{padding:30px;background:#cde}</style>${head}</head><body>${body}</body></html>`;

export async function startSite() {
  const visited = new Set();
  let mode = 'normal';
  let clock = 0;
  let mainUrl = '';
  let otherUrl = '';

  // A login: the test account signs in at /login (a form), gets a cookie, and /account and /orders need it.
  const TEST_USER = { email: 'tester@example.com', password: 's3cret-pw-9XZ' };
  const sessions = new Set();
  let authedHits = 0;
  const beacons = [];      // what the pages report back about the actions that ran in them
  let nextSession = 0;
  const newSession = () => { const sid = `s${++nextSession}-${Math.random().toString(36).slice(2)}`; sessions.add(sid); return sid; };
  const loggedIn = req => sessions.has(/(?:^|;\s*)sid=([^;]+)/.exec(req.headers.cookie || '')?.[1]);
  const loginPage = message => page(`<nav>Sign in</nav><h1>Sign in</h1><p>${message}</p>
    <form method="post" action="/login"><input id="email" name="email"><input id="password" name="password" type="password"><button type="submit">Sign in</button></form>`);

  const send = (res, status, body, type = 'text/html') => { res.statusCode = status; res.setHeader('content-type', type); res.end(body); };
  const redirect = (res, to) => { res.statusCode = 302; res.setHeader('location', to); res.end(); };

  const mainServer = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const path = url.pathname;
    visited.add(path);
    if (req.method === 'POST' && path === '/login') {
      let body = '';
      req.on('data', c => { body += c; });
      req.on('end', () => {
        const f = new URLSearchParams(body);
        if (f.get('email') === TEST_USER.email && f.get('password') === TEST_USER.password) {
          res.setHeader('set-cookie', `sid=${newSession()}; Path=/; HttpOnly`);
          return redirect(res, '/account');
        }
        send(res, 200, loginPage('Invalid email or password'));
      });
      return;
    }
    switch (path) {
      case '/login':
        return send(res, 200, loginPage(''));
      case '/account': case '/orders':
        if (!loggedIn(req)) return redirect(res, '/login');
        authedHits++;
        return send(res, 200, page(`<nav id="account-menu">Signed in as ${TEST_USER.email}</nav><h1>${path === '/account' ? 'Your account' : 'Your orders'}</h1>`
          + (mode === 'broken' ? '' : '<div class="hero"><p>Order #1001 has shipped.</p></div>')));
      case '/login-manual':    // stands in for a person signing in at an identity provider: a moment later, they are in
        return send(res, 200, page('<nav>Identity provider</nav><h1>Signing you in...</h1>',
          `<script>setTimeout(()=>{document.cookie="sid=${newSession()}; path=/";location.href="/account"},400)</script>`));
      // ---- pages with states that only steps can reach. The "-open" twins show the same state with no action needed,
      // so a test can compare screenshots byte for byte.
      case '/modal': case '/modal-open': {
        const open = path === '/modal-open';
        return send(res, 200, page(`<nav>modal</nav><h1>Product</h1>
          ${mode === 'broken' && !open ? '' : `<button id="open" style="visibility:${open ? 'hidden' : 'visible'}" onclick="this.style.visibility='hidden';document.getElementById('dlg').style.display='block';localStorage.setItem('opened','1');fetch('/__beacon?e=modal-open')">Details</button>`}
          <div id="dlg" role="dialog" style="display:${open ? 'block' : 'none'};margin:20px;padding:20px;border:3px solid #123;background:#fed">Free returns within 30 days</div>`));
      }
      case '/storage-set':     // leaves something behind in this browser
        return send(res, 200, page('<nav>storage</nav><h1>Setting it</h1>', '<script>localStorage.setItem("opened","1")</script>'));
      case '/storage-check':   // shows whether an earlier page left something behind in this browser
        return send(res, 200, page('<nav>storage</nav><h1 id="r"></h1>', '<script>addEventListener("DOMContentLoaded",()=>{document.getElementById("r").textContent=localStorage.getItem("opened")?"state leaked":"clean"})</script>'));
      case '/menu': case '/menu-open': {
        const open = path === '/menu-open';
        return send(res, 200, page(`<nav>menu</nav><div id="item" class="${open ? 'open' : ''}" style="padding:20px;font-size:24px" onmouseenter="fetch('/__beacon?e=hover')">Products
          <div id="sub" style="display:none;margin:10px 0 0;padding:10px;background:#cde">Shoes</div></div>`,
          '<style>#item:hover #sub,#item.open #sub{display:block!important}</style>'));
      }
      case '/search':          // the input is off screen, so its focus ring never shows: only the echoed text does
        return send(res, 200, page('<nav>search</nav><input id="q" style="position:absolute;left:-9999px"><h1 id="echo">Type a query</h1>',
          '<script>addEventListener("DOMContentLoaded",()=>{const q=document.getElementById("q");q.addEventListener("keydown",e=>{if(e.key==="Enter"){document.getElementById("echo").textContent="Results for "+q.value;fetch("/__beacon?e="+encodeURIComponent("search:"+q.value))}})})</script>'));
      case '/search-done':
        return send(res, 200, page('<nav>search</nav><h1 id="echo">Results for shoes</h1>'));
      case '/size':
        return send(res, 200, page('<nav>size</nav><select id="size" onchange="document.getElementById(\'chosen\').textContent=\'Size: \'+this.value;fetch(\'/__beacon?e=size:\'+this.value)"><option value="S">Small</option><option value="M">Medium</option><option value="L">Large</option></select><h1 id="chosen">Size: S</h1>'));
      case '/greeting':        // differs for a logged-in visitor, and has the account menu a login profile looks for
        return send(res, 200, page(loggedIn(req)
          ? `<nav id="account-menu">Signed in as ${TEST_USER.email}</nav><h1>Hello, tester</h1>`
          : '<nav>Guest</nav><h1>Sign in to see your orders</h1>'));
      case '/__beacon':
        beacons.push(url.searchParams.get('e'));
        return send(res, 200, 'ok', 'text/plain');
      case '/__expire':        // every session stops being valid
        sessions.clear();
        return send(res, 200, 'ok', 'text/plain');
      case '/':
        return send(res, 200, page(`<nav>home</nav><h1>Home</h1>
          <a href="/about/">about</a> <a href="/logout">logout</a> <a href="/gone">gone</a> <a href="/old">old</a>
          <a href="/missing">missing</a> <a href="/tall">tall</a> <a href="/file.pdf">pdf</a> <a href="/ok">ok</a>
          <a href="${otherUrl}/landing">external</a> <a href="mailto:a@b.c">mail</a>`));
      case '/about/': case '/about': case '/ok': case '/new': case '/sitemap-only': case '/logout': case '/file.pdf':
        return send(res, 200, page(`<nav>site</nav><h1>${path}</h1>`));
      case '/tall':
        return send(res, 200, page('<div style="height:3000px;background:linear-gradient(#fff,#8ad)">tall</div>'));
      case '/late':    // the heading appears 2.5 s after load: only waitFor can see it
        return send(res, 200, page('<nav>late</nav><div id="slot"></div>',
          '<script>setTimeout(()=>{document.getElementById("slot").innerHTML="<h1 id=\\"late\\">Loaded late</h1>"},2500)</script>'));
      case '/late-final':
        return send(res, 200, page('<nav>late</nav><div id="slot"><h1 id="late">Loaded late</h1></div>'));
      case '/clock':   // changes on every request, like a timestamp
        clock += 1;
        return send(res, 200, page(`<nav>clock</nav><h1>Stable heading</h1><p id="ts" style="font-size:40px">request ${clock}</p>`));
      // A finite animation fades a box in over 20 s; /anim-done shows the same box already faded in; /anim-static
      // has the infinite one's resting position. Screenshots with animations disabled must match the static pages.
      case '/anim-finite':
        return send(res, 200, page('<nav>anim</nav><div class="box" style="position:relative;width:80px;height:80px;background:#e33;animation:show 20s linear forwards"></div>',
          '<style>@keyframes show{from{opacity:0}to{opacity:1}}</style>'));
      case '/anim-done':
        return send(res, 200, page('<nav>anim</nav><div class="box" style="position:relative;width:80px;height:80px;background:#e33;opacity:1"></div>'));
      case '/anim-infinite':
        return send(res, 200, page('<nav>anim</nav><div class="box" style="position:relative;width:80px;height:80px;background:#e33;animation:mv 1s linear infinite alternate"></div>',
          '<style>@keyframes mv{from{left:0}to{left:300px}}</style>'));
      case '/anim-static':
        return send(res, 200, page('<nav>anim</nav><div class="box" style="position:relative;width:80px;height:80px;background:#e33;left:0"></div>'));
      case '/err404':
        return send(res, 404, page('<nav>x</nav><h1>Not found, on purpose</h1>'));
      case '/boom':
        return send(res, 500, page('<h1>Server error</h1>'));
      case '/gone':    // leaves the site
        return redirect(res, `${otherUrl}/landing`);
      case '/old':     // stays on the site
        return redirect(res, '/new');
      case '/shop':    // the end-to-end page: 'broken' mode loses its navigation
        return send(res, 200, page(`${mode === 'broken' ? '' : '<nav>Shop navigation</nav>'}<div class="hero"><h1>Gear</h1><p>Free shipping.</p></div>`));
      case '/__mode':
        mode = url.searchParams.get('m') || 'normal';
        return send(res, 200, 'ok', 'text/plain');
      case '/sitemap.xml':
        return send(res, 200, `<urlset><url><loc>${mainUrl}/sitemap-only</loc></url><url><loc>${mainUrl}/about</loc></url></urlset>`, 'application/xml');
      default:
        return send(res, 404, 'nope', 'text/plain');
    }
  });
  const otherServer = http.createServer((req, res) => send(res, 200, page('<h1>The other site</h1><a href="/back">back</a>')));

  const listen = s => new Promise(r => s.listen(0, '127.0.0.1', () => r(s.address().port)));
  const mainPort = await listen(mainServer);
  const otherPort = await listen(otherServer);
  mainUrl = `http://127.0.0.1:${mainPort}`;
  otherUrl = `http://127.0.0.1:${otherPort}`;
  return {
    main: mainUrl, other: otherUrl, visited, user: TEST_USER, authedHits: () => authedHits,
    expireSessions: async () => { sessions.clear(); },
    beacons: () => [...beacons], clearBeacons: () => { beacons.length = 0; },
    setMode: async m => { mode = m; },
    close: () => Promise.all([mainServer, otherServer].map(s => new Promise(r => { s.closeAllConnections?.(); s.close(r); }))),
  };
}
