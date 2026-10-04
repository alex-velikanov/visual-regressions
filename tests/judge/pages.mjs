// A small mock shop page, with named defects, for calibrating the vr judge. `render()` returns HTML.
const PRODUCTS = [
  { name: 'Trail Backpack', price: '$89', hue: 200 },
  { name: 'Insulated Bottle', price: '$32', hue: 150 },
  { name: 'Merino Beanie', price: '$24', hue: 20 },
];

const CSS = `
*{box-sizing:border-box} body{margin:0;font-family:Helvetica,Arial,sans-serif;color:#1c2330;background:#f6f7f9}
nav{display:flex;align-items:center;gap:32px;padding:0 48px;height:64px;background:#fff;border-bottom:1px solid #dde1e7}
nav .logo{font-weight:700;font-size:22px;color:#0b5fff;margin-right:auto} nav a{color:#1c2330;text-decoration:none;font-size:15px}
.banner{background:#eaf1ff;padding:8px 48px;font-size:13px;color:#2a4a8a}
.hero{padding:64px 48px;background:linear-gradient(135deg,#0b5fff,#6a3df0);color:#fff}
.hero h1{margin:0 0 12px;font-size:44px;max-width:640px} .hero p{margin:0 0 28px;font-size:18px;max-width:560px;opacity:.9}
.cta{display:inline-block;background:#fff;color:#0b5fff;padding:14px 28px;border-radius:8px;font-weight:700;font-size:16px}
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:24px;padding:48px}
.card{background:#fff;border:1px solid #dde1e7;border-radius:12px;overflow:hidden}
.card .img{height:170px} .card .body{padding:16px} .card h3{margin:0 0 6px;font-size:18px} .card .price{font-weight:700;margin-bottom:12px}
.card button{background:#0b5fff;color:#fff;border:0;border-radius:6px;padding:10px 16px;font-size:14px}
footer{background:#1c2330;color:#cdd3dd;padding:32px 48px;display:flex;gap:40px;font-size:14px} footer span:last-child{margin-left:auto}
`;

export function render(o = {}) {
  const products = o.products ?? PRODUCTS;
  const price = i => (o.prices ? o.prices[i] : products[i].price);
  const card = (p, i) => `<div class="card"><div class="img" style="${o.brokenImages ? 'background:#fff;border-bottom:1px solid #ccc;display:flex;align-items:center;justify-content:center;color:#999;font-size:13px' : `background:linear-gradient(160deg,hsl(${p.hue},70%,60%),hsl(${p.hue + 40},70%,40%))`}">${o.brokenImages ? '🖼 ' + p.name.toLowerCase().replace(/ /g, '_') + '.jpg' : ''}</div>
    <div class="body"><h3>${o.lorem ? 'Lorem ipsum dolor' : p.name}</h3><div class="price">${o.lorem ? 'Lorem ipsum' : price(i)}</div><button>Add to cart</button></div></div>`;

  if (o.blank) return '<!doctype html><body style="margin:0;background:#fff"></body>';
  if (o.errorPage) return `<!doctype html><body style="font-family:monospace;margin:32px;color:#222"><h1>500 Internal Server Error</h1>
    <pre>Fatal error: Uncaught PDOException: SQLSTATE[08006] connection refused in /var/www/app/src/Db.php:42
Stack trace:
#0 /var/www/app/src/Catalog.php(17): App\\Db-&gt;connect()
#1 /var/www/app/public/index.php(9): App\\Catalog-&gt;load()
#2 {main}
  thrown in /var/www/app/src/Db.php on line 42</pre></body>`;

  const css = o.noCss ? '' : CSS + (o.extraCss ?? '');
  // a "soft" error: the site answers 200 and keeps its nav and footer, but the content is an error or a gate
  const content = o.softError
    ? `<section style="padding:120px 48px;text-align:center"><h1 style="font-size:40px;margin:0 0 12px">${o.softError.title}</h1><p style="font-size:18px;color:#5b6575">${o.softError.text}</p></section>`
    : `<section class="hero"><h1>${o.headline ?? 'Gear for the long way round'}</h1>
<p>${o.sub ?? 'Built to last past the next summit. Free shipping on orders over $75.'}</p>
${o.cta === false ? '' : `<a class="cta">${o.ctaText ?? 'Shop now'}</a>`}
${o.injection ? `<p style="margin-top:24px;background:#fff;color:#000;padding:8px;font-size:14px">${o.injection}</p>` : ''}</section>
<section class="grid">${products.map(card).join('')}</section>`;

  return `<!doctype html><meta charset=utf-8><style>${css}</style><body>
${o.nav === false ? '' : '<nav><span class="logo">Summit &amp; Co</span><a>Home</a><a>Shop</a><a>About</a><a>Cart (2)</a></nav>'}
${o.banner ? `<div class="banner">${o.banner}</div>` : ''}
${content}
${o.footer === false ? '' : '<footer><span>Shipping</span><span>Returns</span><span>Contact</span><span>© 2026 Summit &amp; Co</span></footer>'}
</body>`;
}
