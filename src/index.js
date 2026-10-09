const COOKIE = "pp_admin_session";
const SESSION_SECONDS = 8 * 60 * 60;

const FIELDS = [
  "title", "theme", "description", "prize", "prize_value",
  "ticket_quantity", "ticket_price", "start_date", "closing_date",
  "status", "tickets_sold", "image_url", "gallery_images", "rules"
];

const HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store"
};

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...HEADERS, ...extra }
  });
}

function page(content, status = 200) {
  return new Response(content, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "same-origin"
    }
  });
}

function b64(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function unb64(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  return Uint8Array.from(atob(padded), c => c.charCodeAt(0));
}

async function signingKey(secret) {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

async function createSession(secret) {
  const payload = b64(new TextEncoder().encode(JSON.stringify({
    admin: true,
    expires: Math.floor(Date.now() / 1000) + SESSION_SECONDS,
    nonce: crypto.randomUUID()
  })));

  const signature = await crypto.subtle.sign(
    "HMAC",
    await signingKey(secret),
    new TextEncoder().encode(payload)
  );

  return payload + "." + b64(new Uint8Array(signature));
}

async function validSession(request, secret) {
  try {
    const header = request.headers.get("Cookie") || "";
    const item = header.split(";").map(x => x.trim())
      .find(x => x.startsWith(COOKIE + "="));

    if (!item) return false;

    const parts = item.slice(COOKIE.length + 1).split(".");
    if (parts.length !== 2) return false;

    const valid = await crypto.subtle.verify(
      "HMAC",
      await signingKey(secret),
      unb64(parts[1]),
      new TextEncoder().encode(parts[0])
    );

    if (!valid) return false;

    const session = JSON.parse(
      new TextDecoder().decode(unb64(parts[0]))
    );

    return session.admin === true &&
      Number.isFinite(session.expires) &&
      session.expires > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

function cookie(value, age = SESSION_SECONDS) {
  return COOKIE + "=" + value +
    "; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=" + age;
}

async function body(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

async function ensureTables(env) {
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS finance_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL CHECK(type IN ('income','expense')),
      category TEXT NOT NULL,
      description TEXT NOT NULL,
      amount REAL NOT NULL CHECK(amount >= 0),
      transaction_date TEXT NOT NULL,
      competition_id INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `).run();

  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS fund_applications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      applicant_name TEXT NOT NULL,
      contact_email TEXT,
      animal_details TEXT,
      application_details TEXT,
      requested_amount REAL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'new',
      admin_notes TEXT,
      award_amount REAL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `).run();
}

function cleanCompetition(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return null;
  }

  const out = {};
  for (const field of FIELDS) {
    if (Object.prototype.hasOwnProperty.call(input, field)) {
      out[field] = input[field];
    }
  }

  if (typeof out.title !== "string" ||
      !out.title.trim() || out.title.length > 200) return null;

  for (const field of ["theme", "description", "prize", "rules",
                       "image_url", "gallery_images"]) {
    if (field in out && out[field] != null &&
        typeof out[field] !== "string") return null;
  }

  for (const field of ["ticket_price", "ticket_quantity", "tickets_sold",
                       "prize_value"]) {
    if (!(field in out)) continue;
    if (out[field] === "" || out[field] == null) {
      out[field] = 0;
      continue;
    }

    const n = Number(out[field]);
    if (!Number.isFinite(n) || n < 0) return null;

    if ((field === "ticket_quantity" || field === "tickets_sold") &&
        !Number.isInteger(n)) return null;

    out[field] = n;
  }

  if ("status" in out &&
      !["draft", "scheduled", "live", "closed"].includes(out.status)) {
    return null;
  }

  for (const field of ["start_date", "closing_date"]) {
    if (field in out && out[field] != null &&
        typeof out[field] !== "string") return null;
  }

  return out;
}

function loginPage() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Paws &amp; Prizes | Admin Login</title>
<style>
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;
place-items:center;background:#fffdf6;color:#252525;font-family:Arial,sans-serif;padding:20px}
main{width:100%;max-width:410px;padding:32px;border:1px solid #e8d89b;
border-radius:18px;background:#fff;box-shadow:0 12px 35px #3327000c}
.logo{font-size:28px;font-weight:800}.paw{color:#b58a19}
p{line-height:1.5;color:#696969}label{display:block;margin:18px 0 7px;font-weight:600}
input{width:100%;padding:13px;border:1px solid #ddd;border-radius:8px;font-size:16px}
button{width:100%;margin-top:22px;padding:14px;background:#f2cf58;border:0;
border-radius:8px;font-weight:800;font-size:16px;cursor:pointer}
#message{color:#a12727;overflow-wrap:anywhere}
</style>
</head>
<body><main>
<div class="logo"><span class="paw">🐾</span> PAWS &amp; PRIZES</div>
<p>Private administration. Sign in to manage your business.</p>
<form id="login">
<label for="email">Admin email</label>
<input id="email" type="email" autocomplete="username" required>
<label for="password">Password</label>
<input id="password" type="password" autocomplete="current-password" required>
<button>Sign in to dashboard</button>
<p id="message" role="alert"></p>
</form></main>
<script>
document.getElementById("login").addEventListener("submit",async function(e){
 e.preventDefault();
 const button=this.querySelector("button");
 const message=document.getElementById("message");
 button.disabled=true;message.textContent="Signing in...";
 try{
  const r=await fetch("/api/admin/login",{method:"POST",
   headers:{"Content-Type":"application/json"},
   body:JSON.stringify({email:document.getElementById("email").value,
   password:document.getElementById("password").value})});
  const data=await r.json();
  if(!r.ok)throw new Error(data.error||"Sign in failed.");
  location.replace("/admin");
 }catch(err){message.textContent=err.message||"Unable to sign in."}
 finally{button.disabled=false}
});
</script></body></html>`;
}

function dashboardPage() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Paws &amp; Prizes | Admin Dashboard</title>
<style>
:root{--gold:#f2cf58;--gold-dark:#a17a0c;--ink:#262626;--muted:#737373;
--line:#ece7d7;--bg:#fffdf7;--white:#fff}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 Arial,sans-serif}
button,input,select,textarea{font:inherit}
button{cursor:pointer}
header{height:72px;background:#fff;border-bottom:1px solid var(--line);
display:flex;align-items:center;justify-content:space-between;padding:0 24px;
position:sticky;top:0;z-index:5}
.brand{font-weight:900;font-size:21px;letter-spacing:.3px}
.brand span{color:var(--gold-dark)}
.header-right{display:flex;gap:10px;align-items:center}
.layout{display:grid;grid-template-columns:230px minmax(0,1fr);min-height:calc(100vh - 72px)}
aside{padding:20px 12px;background:#fff;border-right:1px solid var(--line)}
.nav-label{padding:10px 12px;color:#929292;font-size:11px;font-weight:800;letter-spacing:1px}
.nav{display:flex;gap:10px;align-items:center;width:100%;text-align:left;padding:12px;
border:0;border-radius:9px;background:transparent;color:#555;margin:2px 0}
.nav:hover,.nav.active{background:#fff5d1;color:#272727;font-weight:700}
main{padding:28px;min-width:0;max-width:1500px;width:100%;margin:auto}
h1{font-size:28px;line-height:1.2;margin:0 0 8px}
h2{font-size:19px;margin:0 0 14px}
h3{font-size:16px;margin:0 0 10px}
.sub{color:var(--muted);margin:0 0 24px}
.grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;margin:20px 0}
.card{background:#fff;border:1px solid var(--line);border-radius:13px;padding:18px;min-width:0}
.metric-label{font-size:13px;color:var(--muted)}
.metric{font-size:27px;font-weight:800;margin:8px 0 3px;overflow-wrap:anywhere}
.small{font-size:12px;color:var(--muted)}
.panel{background:#fff;border:1px solid var(--line);border-radius:13px;padding:20px;margin:18px 0}
.panel-head{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:14px}
.btn{border:1px solid #e4d7a7;background:#fff;padding:10px 14px;border-radius:8px;font-weight:700}
.btn.primary{background:var(--gold);border-color:var(--gold)}
.btn.danger{color:#a12727;border-color:#eccaca}
.btn:disabled{opacity:.55;cursor:not-allowed}
input,select,textarea{width:100%;padding:10px 11px;border:1px solid #ddd8ca;border-radius:7px;
background:#fff;color:#222;min-width:0}
textarea{min-height:90px;resize:vertical}
label{display:block;font-size:13px;font-weight:700;margin:0 0 6px}
.form-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}
.field.full{grid-column:1/-1}
.actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:16px}
.table-wrap{overflow-x:auto}
table{width:100%;border-collapse:collapse;font-size:13px}
th,td{text-align:left;padding:12px 10px;border-bottom:1px solid #f0ece2;vertical-align:top}
th{font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:#777;background:#fffdf8}
td{overflow-wrap:anywhere}
.pill{display:inline-block;border-radius:99px;padding:4px 8px;background:#f4f0e5;font-size:11px;font-weight:800}
.pill.live,.pill.approved,.pill.paid{background:#e6f5e9;color:#216b35}
.pill.draft,.pill.new{background:#fff3c9;color:#765800}
.pill.closed,.pill.declined{background:#eee;color:#555}
.notice{padding:14px;border-radius:9px;background:#fff5d5;border:1px solid #efdfa7;margin:14px 0}
.notice p{margin:4px 0}
.empty{padding:24px;text-align:center;color:#777}
.progress{height:8px;background:#eee9dc;border-radius:99px;overflow:hidden;margin:8px 0}
.progress span{display:block;height:100%;background:var(--gold)}
.hidden{display:none!important}
.error{color:#a12727;white-space:pre-wrap}
.good{color:#216b35}
.section-title{display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap}
.two{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}
footer{color:#888;font-size:12px;padding:22px 0}
@media(max-width:900px){.layout{grid-template-columns:1fr}aside{border-right:0;border-bottom:1px solid var(--line);
display:flex;gap:4px;overflow-x:auto;padding:8px}.nav-label{display:none}.nav{white-space:nowrap;width:auto}
main{padding:18px}.grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:560px){header{padding:0 14px}.brand{font-size:17px}main{padding:14px}
.grid{gap:9px}.card{padding:13px}.metric{font-size:22px}.form-grid,.two{grid-template-columns:1fr}
.field.full{grid-column:auto}h1{font-size:24px}.header-right .btn{padding:8px;font-size:12px}}
</style>
</head>
<body>
<header>
 <div class="brand"><span>🐾</span> PAWS &amp; PRIZES</div>
 <div class="header-right"><span class="small">Owner dashboard</span>
 <button class="btn" id="refresh">Refresh</button><button class="btn" id="logout">Sign out</button></div>
</header>
<div class="layout">
<aside>
 <div>
 <div class="nav-label">BUSINESS</div>
 <button class="nav active" data-view="overview">▦ &nbsp; Overview</button>
 <button class="nav" data-view="competitions">🏆 &nbsp; Competitions</button>
 <button class="nav" data-view="finances">£ &nbsp; Finances</button>
 <button class="nav" data-view="tickets">🎟 &nbsp; Tickets &amp; winners</button>
 <button class="nav" data-view="pawfund">🐾 &nbsp; Paw Fund</button>
 <div class="nav-label">MANAGEMENT</div>
 <button class="nav" data-view="reports">▤ &nbsp; Reports</button>
 <button class="nav" data-view="settings">⚙ &nbsp; Settings</button>
 </div>
</aside>
<main>
<section id="view-overview">
 <h1>Business overview</h1><p class="sub">Your Paws &amp; Prizes control center.</p>
 <div id="loadMessage" class="notice">Loading your business records…</div>
 <div class="grid">
  <div class="card"><div class="metric-label">Estimated ticket turnover</div><div class="metric" id="mTurnover">£0.00</div><div class="small">Ticket price × recorded tickets sold</div></div>
  <div class="card"><div class="metric-label">Recorded income</div><div class="metric" id="mIncome">£0.00</div><div class="small">Finance ledger entries</div></div>
  <div class="card"><div class="metric-label">Recorded expenses</div><div class="metric" id="mExpenses">£0.00</div><div class="small">Includes costs entered by you</div></div>
  <div class="card"><div class="metric-label">Ledger profit estimate</div><div class="metric" id="mProfit">£0.00</div><div class="small">Recorded income minus expenses</div></div>
  <div class="card"><div class="metric-label">Tickets recorded sold</div><div class="metric" id="mTickets">0</div><div class="small">Across all competitions</div></div>
  <div class="card"><div class="metric-label">Competitions live</div><div class="metric" id="mLive">0</div><div class="small">Status marked live</div></div>
  <div class="card"><div class="metric-label">Prize value recorded</div><div class="metric" id="mPrize">£0.00</div><div class="small">Prize values entered</div></div>
  <div class="card"><div class="metric-label">Potential 5% Paw Fund allocation</div><div class="metric" id="mFund">£0.00</div><div class="small">Estimate only; not a transfer</div></div>
 </div>
 <div class="panel"><div class="panel-head"><h2>Competition performance</h2><button class="btn" data-goto="competitions">Manage competitions</button></div>
 <div id="overviewComps" class="table-wrap"></div></div>
 <div class="panel"><h2>Important reminders</h2>
 <div class="notice"><p><strong>Payment records</strong></p><p>Ticket turnover is an estimate based on the tickets recorded in your competition records. It is not proof of received payments.</p></div>
 <div class="notice"><p><strong>Profit and Paw Fund</strong></p><p>Profit depends on complete income and cost records. The 5% figure is a planning estimate and does not move money automatically.</p></div>
 </div>
</section>

<section id="view-competitions" class="hidden">
 <div class="section-title"><div><h1>Competition manager</h1><p class="sub">Create and manage the competitions stored in your database.</p></div>
 <button class="btn primary" id="newComp">+ New competition</button></div>
 <div id="compFormPanel" class="panel hidden">
 <h2 id="compFormTitle">Create competition</h2>
 <form id="compForm">
 <input type="hidden" id="compId">
 <div class="form-grid">
  <div class="field"><label for="cTitle">Competition title *</label><input id="cTitle" required maxlength="200"></div>
  <div class="field"><label for="cTheme">Theme</label><input id="cTheme" placeholder="Pets, cars, tech…"></div>
  <div class="field full"><label for="cDescription">Description</label><textarea id="cDescription"></textarea></div>
  <div class="field"><label for="cPrize">Prize name</label><input id="cPrize"></div>
  <div class="field"><label for="cPrizeValue">Prize value (£)</label><input id="cPrizeValue" type="number" min="0" step=".01" value="0"></div>
  <div class="field"><label for="cQuantity">Ticket quantity</label><input id="cQuantity" type="number" min="0" step="1" value="1000"></div>
  <div class="field"><label for="cPrice">Ticket price (£)</label><input id="cPrice" type="number" min="0" step=".01" value="1.99"></div>
  <div class="field"><label for="cStart">Start date</label><input id="cStart" type="datetime-local"></div>
  <div class="field"><label for="cClosing">Closing date</label><input id="cClosing" type="datetime-local"></div>
  <div class="field"><label for="cStatus">Status</label><select id="cStatus"><option value="draft">Draft</option><option value="scheduled">Scheduled</option><option value="live">Live</option><option value="closed">Closed</option></select></div>
  <div class="field"><label for="cSold">Tickets sold</label><input id="cSold" type="number" min="0" step="1" value="0"></div>
  <div class="field full"><label for="cImage">Main image URL</label><input id="cImage" type="url" placeholder="https://…"></div>
  <div class="field full"><label for="cGallery">Gallery image URLs (comma separated)</label><textarea id="cGallery"></textarea></div>
  <div class="field full"><label for="cRules">Competition rules</label><textarea id="cRules"></textarea></div>
 </div>
 <div class="actions"><button class="btn primary" type="submit">Save competition</button><button class="btn" type="button" id="cancelComp">Cancel</button></div>
 <p id="compMessage" role="status"></p>
 </form></div>
 <div class="panel"><div class="panel-head"><h2>All competitions</h2><span class="small" id="compCount">0 competitions</span></div><div id="allComps" class="table-wrap"></div></div>
</section>

<section id="view-finances" class="hidden">
 <h1>Finances</h1><p class="sub">Record business income and costs. These records help estimate profit.</p>
 <div class="notice"><strong>Important:</strong> these are manual ledger records for now. They are not connected to your bank or payment provider.</div>
 <div class="panel"><h2>Add a transaction</h2>
 <form id="financeForm"><div class="form-grid">
 <div class="field"><label for="fType">Type</label><select id="fType"><option value="income">Income</option><option value="expense">Expense</option></select></div>
 <div class="field"><label for="fCategory">Category</label><select id="fCategory"><option>Ticket sales</option><option>Prize cost</option><option>Advertising</option><option>Payment fees</option><option>Refund</option><option>Software</option><option>Insurance</option><option>Professional fees</option><option>Other income</option><option>Other expense</option><option>Tax provision</option><option>Paw Fund payment</option></select></div>
 <div class="field"><label for="fAmount">Amount (£)</label><input id="fAmount" type="number" min="0.01" step=".01" required></div>
 <div class="field"><label for="fDate">Date</label><input id="fDate" type="date" required></div>
 <div class="field full"><label for="fDescription">Description</label><input id="fDescription" required maxlength="300"></div>
 <div class="field"><label for="fCompetition">Competition ID (optional)</label><input id="fCompetition" type="number" min="1"></div>
 </div><div class="actions"><button class="btn primary">Record transaction</button></div><p id="financeMessage" role="status"></p></form></div>
 <div class="grid">
 <div class="card"><div class="metric-label">Recorded income</div><div class="metric" id="fIncome">£0.00</div></div>
 <div class="card"><div class="metric-label">Recorded expenses</div><div class="metric" id="fExpenses">£0.00</div></div>
 <div class="card"><div class="metric-label">Ledger profit estimate</div><div class="metric" id="fProfit">£0.00</div></div>
 <div class="card"><div class="metric-label">Estimated 5% allocation</div><div class="metric" id="fFund">£0.00</div></div>
 </div>
 <div class="panel"><h2>Transaction history</h2><div id="transactions" class="table-wrap"></div></div>
</section>

<section id="view-tickets" class="hidden">
 <h1>Tickets &amp; winners</h1><p class="sub">Competition-level ticket totals and draw/fulfilment preparation.</p>
 <div class="notice"><strong>Current stage:</strong> the competition records contain ticket totals, but individual customer orders, allocated ticket numbers, payment confirmation, and independently verifiable draw records are not yet connected. Do not use this area as proof of a completed draw.</div>
 <div class="panel"><h2>Competition ticket summary</h2><div id="ticketTable" class="table-wrap"></div></div>
 <div class="panel"><h2>Next build items</h2><ul>
 <li>Connect payment-provider webhooks and verified order records.</li>
 <li>Store each order and ticket allocation securely.</li>
 <li>Build an auditable draw and winner verification workflow.</li>
 <li>Track contact attempts and prize fulfilment.</li></ul></div>
</section>

<section id="view-pawfund" class="hidden">
 <h1>Paw Fund</h1><p class="sub">Support for animals and the people who care for them.</p>
 <div class="notice"><strong>Applications are CLOSED.</strong><p>There is currently no public application form. This remains closed until you choose to open the fund and have the application process ready.</p></div>
 <div class="grid">
 <div class="card"><div class="metric-label">Potential 5% allocation</div><div class="metric" id="pPotential">£0.00</div><div class="small">Estimate from positive recorded ledger profit</div></div>
 <div class="card"><div class="metric-label">Applications recorded</div><div class="metric" id="pCount">0</div><div class="small">Applications already stored</div></div>
 <div class="card"><div class="metric-label">Awards recorded</div><div class="metric" id="pAwards">£0.00</div><div class="small">Award amounts recorded</div></div>
 <div class="card"><div class="metric-label">Paid out</div><div class="metric" id="pPaid">£0.00</div><div class="small">Payments recorded in application statuses</div></div>
 </div>
 <div class="panel"><h2>Application management</h2><p class="small">When the public form is built and opened, submissions will appear here for review. Sensitive applicant information must remain private.</p><div id="applications" class="table-wrap"></div></div>
 <div class="panel"><h2>Public page plan</h2><p>The public Paw Fund page will explain the mission, eligibility, available support, and how to apply. It will clearly show that applications are closed until you open them.</p></div>
</section>

<section id="view-reports" class="hidden">
 <h1>Reports</h1><p class="sub">A summary based on the records currently stored in your database.</p>
 <div class="panel"><h2>Competition report</h2><div id="reportComps" class="table-wrap"></div></div>
 <div class="panel"><h2>Financial summary</h2><div id="reportFinance"></div><button class="btn" id="exportFinance">Export transactions as CSV</button></div>
</section>

<section id="view-settings" class="hidden">
 <h1>Settings &amp; security</h1><p class="sub">Administration information and planned integrations.</p>
 <div class="panel"><h2>Admin access</h2><p>Dashboard access uses the secure Cloudflare Worker session. Your login secrets remain in Cloudflare and are not displayed here.</p><button class="btn" id="settingsLogout">Sign out securely</button></div>
 <div class="panel"><h2>Website connection</h2><p>The public website must request live competitions from the public competitions API to display database changes. We will connect and test that page separately after the dashboard works.</p></div>
 <div class="panel"><h2>Future integrations</h2><ul><li>Payment provider and verified orders</li><li>Automated emails and customer support</li><li>Accounting exports and receipt storage</li><li>Staff accounts and role permissions</li><li>Scheduled publication and reminders</li><li>Database backup and recovery checks</li></ul></div>
</section>
<footer>PAWS &amp; PRIZES · PRIVATE ADMINISTRATION · Keep your login details secure.</footer>
</main></div>
<script>
const $ = id => document.getElementById(id);
const money = n => new Intl.NumberFormat("en-GB",{style:"currency",currency:"GBP"}).format(Number(n)||0);
const esc = value => String(value == null ? "" : value).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const num = value => Number(value)||0;
let competitions=[],transactions=[],applications=[];
let currentView="overview";

async function api(path, options={}) {
 const response=await fetch(path,{...options,headers:{"Content-Type":"application/json",...(options.headers||{})}});
 let data;
 try{data=await response.json()}catch{data={error:"The server returned an unreadable response."}}
 if(response.status===401 && path!=="/api/admin/session"){location.replace("/admin/login");throw new Error("Please sign in again.")}
 if(!response.ok)throw new Error(data.error||"Request failed ("+response.status+").");
 return data;
}
function setMessage(id,text,good=false){$(id).textContent=text;$(id).className=good?"good":"error"}
function statusPill(status){return '<span class="pill '+esc(status)+'">'+esc(status||"draft")+'</span>'}
function showView(name){
 currentView=name;
 document.querySelectorAll("main section").forEach(s=>s.classList.add("hidden"));
 $("view-"+name).classList.remove("hidden");
 document.querySelectorAll(".nav").forEach(b=>b.classList.toggle("active",b.dataset.view===name));
}
document.querySelectorAll(".nav").forEach(b=>b.addEventListener("click",()=>showView(b.dataset.view)));
document.querySelectorAll("[data-goto]").forEach(b=>b.addEventListener("click",()=>showView(b.dataset.goto)));

function compTable(items,compact=false){
 if(!items.length)return '<div class="empty">No competitions yet. Create your first competition to get started.</div>';
 return '<table><thead><tr><th>Competition</th><th>Status</th><th>Tickets sold</th><th>Remaining</th><th>Turnover estimate</th>'+(compact?'':'<th>Closing date</th><th>Actions</th>')+'</tr></thead><tbody>'+
 items.map(c=>{
 const sold=num(c.tickets_sold),qty=num(c.ticket_quantity),remaining=Math.max(0,qty-sold);
 return '<tr><td><strong>'+esc(c.title)+'</strong><div class="small">ID '+esc(c.id)+'</div></td><td>'+statusPill(c.status)+'</td><td>'+sold.toLocaleString("en-GB")+'<div class="progress"><span style="width:'+Math.min(100,qty?sold/qty*100:0)+'%"></span></div><span class="small">'+(qty?Math.round(sold/qty*100):0)+'% sold</span></td><td>'+remaining.toLocaleString("en-GB")+'</td><td>'+money(sold*num(c.ticket_price))+'</td>'+(compact?'':'<td>'+esc(c.closing_date||"—")+'</td><td><button class="btn" data-edit="'+c.id+'">Edit</button> <button class="btn danger" data-delete="'+c.id+'">Delete</button></td>')+'</tr>';
 }).join("")+'</tbody></table>';
}
function transactionTable(items){
 if(!items.length)return '<div class="empty">No finance transactions recorded yet.</div>';
 return '<table><thead><tr><th>Date</th><th>Type</th><th>Category</th><th>Description</th><th>Competition</th><th>Amount</th><th></th></tr></thead><tbody>'+
 items.map(t=>'<tr><td>'+esc(t.transaction_date)+'</td><td>'+esc(t.type)+'</td><td>'+esc(t.category)+'</td><td>'+esc(t.description)+'</td><td>'+esc(t.competition_id||"—")+'</td><td>'+money(t.amount)+'</td><td><button class="btn danger" data-txdelete="'+t.id+'">Delete</button></td></tr>').join("")+'</tbody></table>';
}
function applicationTable(items){
 if(!items.length)return '<div class="empty">No applications recorded. Applications are currently closed.</div>';
 return '<table><thead><tr><th>Applicant</th><th>Requested</th><th>Status</th><th>Admin notes</th><th>Save</th></tr></thead><tbody>'+
 items.map(a=>'<tr><td><strong>'+esc(a.applicant_name)+'</strong><div class="small">'+esc(a.contact_email||"")+'</div><div class="small">ID '+a.id+'</div></td><td>'+money(a.requested_amount)+'</td><td><select data-appstatus="'+a.id+'">'+["new","under_review","awaiting_information","approved","declined","paid"].map(s=>'<option value="'+s+'" '+(s===a.status?'selected':'')+'>'+s.replace("_"," ")+'</option>').join("")+'</select><label> Award amount (£)</label><input data-appaward="'+a.id+'" type="number" min="0" step=".01" value="'+num(a.award_amount)+'"></td><td><textarea data-appnotes="'+a.id+'">'+esc(a.admin_notes||"")+'</textarea></td><td><button class="btn" data-appsave="'+a.id+'">Save</button></td></tr>').join("")+'</tbody></table>';
}
function render(){
 const turnover=competitions.reduce((s,c)=>s+num(c.ticket_price)*num(c.tickets_sold),0);
 const sold=competitions.reduce((s,c)=>s+num(c.tickets_sold),0);
 const prize=competitions.reduce((s,c)=>s+num(c.prize_value),0);
 const live=competitions.filter(c=>c.status==="live").length;
 const income=transactions.filter(t=>t.type==="income").reduce((s,t)=>s+num(t.amount),0);
 const expenses=transactions.filter(t=>t.type==="expense").reduce((s,t)=>s+num(t.amount),0);
 const profit=income-expenses, fund=Math.max(0,profit)*.05;
 $("mTurnover").textContent=money(turnover);$("mIncome").textContent=money(income);
 $("mExpenses").textContent=money(expenses);$("mProfit").textContent=money(profit);
 $("mTickets").textContent=sold.toLocaleString("en-GB");$("mLive").textContent=live;
 $("mPrize").textContent=money(prize);$("mFund").textContent=money(fund);
 $("fIncome").textContent=money(income);$("fExpenses").textContent=money(expenses);
 $("fProfit").textContent=money(profit);$("fFund").textContent=money(fund);
 $("pPotential").textContent=money(fund);$("pCount").textContent=applications.length;
 $("pAwards").textContent=money(applications.reduce((s,a)=>s+num(a.award_amount),0));
 $("pPaid").textContent=money(applications.filter(a=>a.status==="paid").reduce((s,a)=>s+num(a.award_amount),0));
 $("overviewComps").innerHTML=compTable(competitions.slice(0,5),true);
 $("allComps").innerHTML=compTable(competitions);$("compCount").textContent=competitions.length+" competitions";
 $("transactions").innerHTML=transactionTable(transactions);
 $("applications").innerHTML=applicationTable(applications);
 $("ticketTable").innerHTML=compTable(competitions);
 $("reportComps").innerHTML=compTable(competitions);
 $("reportFinance").innerHTML="<p>Recorded income: <strong>"+money(income)+"</strong></p><p>Recorded expenses: <strong>"+money(expenses)+"</strong></p><p>Ledger profit estimate: <strong>"+money(profit)+"</strong></p><p>Potential 5% allocation: <strong>"+money(fund)+"</strong></p>";
 $("loadMessage").textContent="Business records loaded. Figures reflect the data currently stored.";
 $("loadMessage").className="notice";
}
async function loadAll(){
 $("loadMessage").textContent="Loading your business records…";
 try{
  const results=await Promise.all([
   api("/api/admin/competitions"),api("/api/admin/transactions"),api("/api/admin/fund-applications")
  ]);
  competitions=results[0];transactions=results[1];applications=results[2];render();
 }catch(e){$("loadMessage").textContent="Unable to load dashboard data: "+e.message;$("loadMessage").className="notice error"}
}
function value(id){return $(id).value}
function openComp(c){
 $("compForm").reset();
 $("compId").value=c?c.id:"";
 $("compFormTitle").textContent=c?"Edit competition #"+c.id:"Create competition";
 $("cTitle").value=c?.title||"";$("cTheme").value=c?.theme||"";
 $("cDescription").value=c?.description||"";$("cPrize").value=c?.prize||"";
 $("cPrizeValue").value=num(c?.prize_value);$("cQuantity").value=c?.ticket_quantity??1000;
 $("cPrice").value=c?.ticket_price??1.99;$("cStart").value=toDateInput(c?.start_date);
 $("cClosing").value=toDateInput(c?.closing_date);$("cStatus").value=c?.status||"draft";
 $("cSold").value=num(c?.tickets_sold);$("cImage").value=c?.image_url||"";
 $("cGallery").value=c?.gallery_images||"";$("cRules").value=c?.rules||"";
 $("compMessage").textContent="";$("compFormPanel").classList.remove("hidden");
 $("compFormPanel").scrollIntoView({behavior:"smooth",block:"start"});
}
function toDateInput(value){
 if(!value)return "";
 const s=String(value);
 return s.length>=16?s.slice(0,16):s;
}
$("newComp").addEventListener("click",()=>openComp(null));
$("cancelComp").addEventListener("click",()=>$("compFormPanel").classList.add("hidden"));
$("compForm").addEventListener("submit",async e=>{
 e.preventDefault();
 const id=value("compId");
 const data={
  title:value("cTitle").trim(),theme:value("cTheme"),description:value("cDescription"),
  prize:value("cPrize"),prize_value:Number(value("cPrizeValue")||0),
  ticket_quantity:Number(value("cQuantity")||0),ticket_price:Number(value("cPrice")||0),
  start_date:value("cStart"),closing_date:value("cClosing"),status:value("cStatus"),
  tickets_sold:Number(value("cSold")||0),image_url:value("cImage"),
  gallery_images:value("cGallery"),rules:value("cRules")
 };
 try{
  const result=await api(id?"/api/admin/competitions/"+id:"/api/admin/competitions",{
   method:id?"PUT":"POST",body:JSON.stringify(data)
  });
  setMessage("compMessage",id?"Competition updated successfully.":"Competition created successfully.",true);
  await loadAll();$("compFormPanel").classList.add("hidden");
  showView("competitions");
 }catch(err){setMessage("compMessage",err.message)}
});
document.addEventListener("click",async e=>{
 const edit=e.target.closest("[data-edit]");
 const del=e.target.closest("[data-delete]");
 const txdel=e.target.closest("[data-txdelete]");
 const appsave=e.target.closest("[data-appsave]");
 if(edit){const c=competitions.find(x=>String(x.id)===edit.dataset.edit);if(c)openComp(c)}
 if(del){
  const c=competitions.find(x=>String(x.id)===del.dataset.delete);
  if(c&&confirm("Delete competition '"+c.title+"'? This cannot be undone.")){
   try{await api("/api/admin/competitions/"+c.id,{method:"DELETE"});await loadAll()}
   catch(err){alert(err.message)}
  }
 }
 if(txdel&&confirm("Delete this transaction record?")){
  try{await api("/api/admin/transactions/"+txdel.dataset.txdelete,{method:"DELETE"});await loadAll()}
  catch(err){alert(err.message)}
 }
 if(appsave){
  const id=appsave.dataset.appsave;
  const status=document.querySelector('[data-appstatus="'+id+'"]').value;
  const award=Number(document.querySelector('[data-appaward="'+id+'"]').value||0);
  const notes=document.querySelector('[data-appnotes="'+id+'"]').value;
  try{await api("/api/admin/fund-applications/"+id,{method:"PATCH",body:JSON.stringify({status,award_amount:award,admin_notes:notes})});await loadAll()}
  catch(err){alert(err.message)}
 }
});
$("financeForm").addEventListener("submit",async e=>{
 e.preventDefault();
 const data={type:value("fType"),category:value("fCategory"),
 description:value("fDescription").trim(),amount:Number(value("fAmount")),
 transaction_date:value("fDate"),competition_id:value("fCompetition")?Number(value("fCompetition")):null};
 try{
  await api("/api/admin/transactions",{method:"POST",body:JSON.stringify(data)});
  $("financeForm").reset();$("fDate").value=new Date().toISOString().slice(0,10);
  setMessage("financeMessage","Transaction recorded.",true);await loadAll();
 }catch(err){setMessage("financeMessage",err.message)}
});
async function logout(){
 try{await fetch("/api/admin/logout",{method:"POST"})}finally{location.replace("/admin/login")}
}
$("logout").addEventListener("click",logout);$("settingsLogout").addEventListener("click",logout);
$("refresh").addEventListener("click",loadAll);
$("exportFinance").addEventListener("click",()=>{
 const rows=[["Date","Type","Category","Description","Amount","Competition ID"],
 ...transactions.map(t=>[t.transaction_date,t.type,t.category,t.description,t.amount,t.competition_id||""])];
 const csv=rows.map(row=>row.map(v=>'"'+String(v??"").replace(/"/g,'""')+'"').join(",")).join("\\r\\n");
 const blob=new Blob([csv],{type:"text/csv;charset=utf-8;"});
 const url=URL.createObjectURL(blob),a=document.createElement("a");
 a.href=url;a.download="paws-and-prizes-transactions.csv";a.click();URL.revokeObjectURL(url);
});
(async()=>{
 try{
  const response=await fetch("/api/admin/session");
  if(!response.ok){location.replace("/admin/login");return}
  $("fDate").value=new Date().toISOString().slice(0,10);
  await loadAll();
 }catch(e){$("loadMessage").textContent="Unable to check your session. Please sign in again."}
})();
</script></body></html>`;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method.toUpperCase();

    try {
      if (path === "/api/health" && method === "GET") {
        return json({ ok: true, service: "paws-and-prizes" });
      }

      if ((path === "/admin/login" || path === "/admin/login/") &&
          method === "GET") {
        return page(loginPage());
      }

      if (path === "/api/admin/login" && method === "POST") {
        if (!env.ADMIN_EMAIL || !env.ADMIN_PASSWORD || !env.SESSION_SECRET) {
          return json({ error: "Admin login is not configured correctly." }, 503);
        }

        const data = await body(request);
        if (!data || typeof data.email !== "string" ||
            typeof data.password !== "string") {
          return json({ error: "Enter your email and password." }, 400);
        }

        const emailOK = data.email.trim().toLowerCase() ===
          env.ADMIN_EMAIL.trim().toLowerCase();
        const passwordOK = data.password === env.ADMIN_PASSWORD;

        if (!emailOK || !passwordOK) {
          return json({ error: "Incorrect email or password." }, 401);
        }

        const token = await createSession(env.SESSION_SECRET);
        return json({ ok: true }, 200, { "Set-Cookie": cookie(token) });
      }

      if (path === "/api/admin/logout" && method === "POST") {
        return json({ ok: true }, 200, { "Set-Cookie": cookie("", 0) });
      }

      if (path === "/api/admin/session" && method === "GET") {
        const ok = !!env.SESSION_SECRET &&
          await validSession(request, env.SESSION_SECRET);
        return json({ authenticated: ok }, ok ? 200 : 401);
      }

      if (path === "/admin" || path === "/admin/" ||
          path === "/admin/index.html") {
        const ok = !!env.SESSION_SECRET &&
          await validSession(request, env.SESSION_SECRET);
        if (!ok) return Response.redirect(new URL("/admin/login", url.origin), 302);
        return page(dashboardPage());
      }

      // Public website can only retrieve published competitions.
      if (path === "/api/competitions" && method === "GET") {
        const result = await env.DB.prepare(
          "SELECT * FROM competitions WHERE status = 'live' ORDER BY id DESC"
        ).all();
        return json(result.results || []);
      }

      // Everything below this point is private admin API.
      const adminCompetitionList = path === "/api/admin/competitions";
      const adminTransactionList = path === "/api/admin/transactions";
      const adminApplications = path === "/api/admin/fund-applications";
      const privateAPI = adminCompetitionList || adminTransactionList ||
        adminApplications ||
        /^\/api\/admin\/(competitions|transactions|fund-applications)\/\d+$/.test(path);

      if (privateAPI) {
        const ok = !!env.SESSION_SECRET &&
          await validSession(request, env.SESSION_SECRET);
        if (!ok) return json({ error: "Please sign in as admin." }, 401);

        if (!env.DB) return json({ error: "Database binding DB is missing." }, 500);
        await ensureTables(env);

        if (adminCompetitionList) {
          if (method === "GET") {
            const result = await env.DB.prepare(
              "SELECT * FROM competitions ORDER BY id DESC"
            ).all();
            return json(result.results || []);
          }

          if (method === "POST") {
            const data = cleanCompetition(await body(request));
            if (!data) return json({ error: "Please check the competition details." }, 400);

            const fields = FIELDS.filter(f => f in data);
            const result = await env.DB.prepare(
              "INSERT INTO competitions (" + fields.join(",") + ") VALUES (" +
              fields.map(() => "?").join(",") + ")"
            ).bind(...fields.map(f => data[f])).run();

            return json({ ok: true, id: result.meta?.last_row_id }, 201);
          }

          return json({ error: "Method not allowed." }, 405, { Allow: "GET, POST" });
        }

        const compMatch = path.match(/^\/api\/admin\/competitions\/(\d+)$/);
        if (compMatch) {
          const id = Number(compMatch[1]);

          if (method === "PUT" || method === "PATCH") {
            const data = cleanCompetition(await body(request));
            if (!data) return json({ error: "Please check the competition details." }, 400);

            const fields = FIELDS.filter(f => f in data);
            if (!fields.length) return json({ error: "No changes to save." }, 400);

            const result = await env.DB.prepare(
              "UPDATE competitions SET " + fields.map(f => f + " = ?").join(", ") +
              " WHERE id = ?"
            ).bind(...fields.map(f => data[f]), id).run();

            if (!result.meta?.changes) return json({ error: "Competition not found." }, 404);
            return json({ ok: true, id });
          }

          if (method === "DELETE") {
            const result = await env.DB.prepare(
              "DELETE FROM competitions WHERE id = ?"
            ).bind(id).run();
            if (!result.meta?.changes) return json({ error: "Competition not found." }, 404);
            return json({ ok: true, id });
          }

          return json({ error: "Method not allowed." }, 405, { Allow: "PUT, PATCH, DELETE" });
        }

        if (adminTransactionList) {
          if (method === "GET") {
            const result = await env.DB.prepare(
              "SELECT * FROM finance_transactions ORDER BY transaction_date DESC, id DESC"
            ).all();
            return json(result.results || []);
          }

          if (method === "POST") {
            const data = await body(request);
            if (!data || !["income", "expense"].includes(data.type) ||
                typeof data.category !== "string" || !data.category.trim() ||
                typeof data.description !== "string" || !data.description.trim() ||
                !Number.isFinite(Number(data.amount)) || Number(data.amount) <= 0 ||
                typeof data.transaction_date !== "string" ||
                !/^\d{4}-\d{2}-\d{2}$/.test(data.transaction_date)) {
              return json({ error: "Check the transaction details." }, 400);
            }

            const result = await env.DB.prepare(
              `INSERT INTO finance_transactions
              (type,category,description,amount,transaction_date,competition_id)
              VALUES (?,?,?,?,?,?)`
            ).bind(data.type, data.category.trim().slice(0,100),
              data.description.trim().slice(0,300), Number(data.amount),
              data.transaction_date,
              Number.isInteger(Number(data.competition_id)) && Number(data.competition_id) > 0
                ? Number(data.competition_id) : null
            ).run();

            return json({ ok: true, id: result.meta?.last_row_id }, 201);
          }

          return json({ error: "Method not allowed." }, 405, { Allow: "GET, POST" });
        }

        const txMatch = path.match(/^\/api\/admin\/transactions\/(\d+)$/);
        if (txMatch && method === "DELETE") {
          const result = await env.DB.prepare(
            "DELETE FROM finance_transactions WHERE id = ?"
          ).bind(Number(txMatch[1])).run();
          if (!result.meta?.changes) return json({ error: "Transaction not found." }, 404);
          return json({ ok: true });
        }

        if (adminApplications && method === "GET") {
          const result = await env.DB.prepare(
            "SELECT * FROM fund_applications ORDER BY id DESC"
          ).all();
          return json(result.results || []);
        }

        const appMatch = path.match(/^\/api\/admin\/fund-applications\/(\d+)$/);
        if (appMatch && method === "PATCH") {
          const data = await body(request);
          const allowed = ["new", "under_review", "awaiting_information",
            "approved", "declined", "paid"];

          if (!data || !allowed.includes(data.status) ||
              !Number.isFinite(Number(data.award_amount)) ||
              Number(data.award_amount) < 0 ||
              typeof data.admin_notes !== "string") {
            return json({ error: "Check the application update." }, 400);
          }

          const result = await env.DB.prepare(
            `UPDATE fund_applications SET status=?, award_amount=?, admin_notes=?,
             updated_at=CURRENT_TIMESTAMP WHERE id=?`
          ).bind(data.status, Number(data.award_amount),
            data.admin_notes.slice(0,5000), Number(appMatch[1])).run();

          if (!result.meta?.changes) return json({ error: "Application not found." }, 404);
          return json({ ok: true });
        }

        return json({ error: "Method not allowed." }, 405);
      }

      // Public pages and other static files remain served from ASSETS.
      if (env.ASSETS) return env.ASSETS.fetch(request);
      return json({ error: "Website assets are unavailable." }, 500);

    } catch (error) {
      console.error("Paws & Prizes Worker error:", error);
      return json({ error: "Something went wrong. Please try again." }, 500);
    }
  }
};
