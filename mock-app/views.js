// Server-rendered HTML. Deliberately "legacy": table layouts, generic class
// names, no data-* attributes, no semantic hooks for automation.

export function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function money(n) {
  return '$' + Number(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function layout(title, body) {
  return `<!DOCTYPE html>
<html>
<head>
<title>${esc(title)}</title>
<style>
body { font-family: Verdana, Arial, sans-serif; font-size: 12px; margin: 0; background: #d9d9d9; }
.w1 { width: 760px; margin: 0 auto; background: #ffffff; border: 1px solid #808080; }
.h1 { background: #003366; color: #ffffff; padding: 6px 10px; font-weight: bold; }
.h2 { background: #eeeeee; border-bottom: 1px solid #c0c0c0; padding: 4px 10px; font-size: 11px; }
.b1 { padding: 10px; }
.t1 { border-collapse: collapse; width: 100%; }
.t1 td, .t1 th { border: 1px solid #b0b0b0; padding: 4px 6px; text-align: left; font-size: 12px; }
.t1 th { background: #e4e4e4; }
.n1 { border: 1px solid #999900; background: #ffffcc; padding: 8px; margin-bottom: 10px; }
.n2 { border: 1px solid #990000; background: #ffe4e4; padding: 8px; margin-bottom: 10px; }
.n3 { border: 1px solid #009900; background: #e6ffe6; padding: 8px; margin-bottom: 10px; }
.f1 { font-size: 11px; color: #555555; padding: 6px 10px; border-top: 1px solid #c0c0c0; }
input[type=text], input[type=password], select { font-size: 12px; padding: 2px; }
</style>
</head>
<body>
<div class="w1">
<div class="h1">MERIDIAN SAVINGS &mdash; MEMBER SERVICING TERMINAL</div>
<div class="h2">Rel. 4.2.1c &nbsp;|&nbsp; Node: SVC-03 &nbsp;|&nbsp; Restricted internal use only</div>
<div class="b1">
${body}
</div>
<div class="f1">Meridian Savings internal system. Session activity is recorded.</div>
</div>
</body>
</html>`;
}

export function loginPage(msg) {
  return layout('Sign On', `
${msg ? `<div class="n2">${esc(msg)}</div>` : ''}
<p>Please sign on to continue.</p>
<form method="post" action="/login">
<table class="t1">
<tr><td width="140">Operator ID</td><td><input type="text" name="username" size="28"></td></tr>
<tr><td>Password</td><td><input type="password" name="password" size="28"></td></tr>
</table>
<p><input type="submit" value="Sign On"></p>
</form>`);
}

export function searchPage() {
  return layout('Member Search', `
<p>Enter a member number or a full/partial member name.</p>
<form method="get" action="/search/results">
<table class="t1">
<tr><td width="140">Search</td><td><input type="text" name="q" size="34"></td></tr>
</table>
<p><input type="submit" value="Search"></p>
</form>`);
}

export function resultsPage(q, rows) {
  if (rows.length === 0) {
    return layout('Search Results', `
<div class="n1">No member found matching "${esc(q)}".</div>
<p><a href="/search">Return to search</a></p>`);
  }
  const trs = rows
    .map(
      (m) => `<tr>
<td><a href="/member/${esc(m.id)}">${esc(m.id)}</a></td>
<td>${esc(m.name)}</td>
<td>${esc(money(m.savings))}</td>
<td>${esc(m.status.toUpperCase())}</td>
</tr>`
    )
    .join('\n');
  return layout('Search Results', `
<p>${rows.length} record(s) returned for "${esc(q)}".</p>
<table class="t1">
<tr><th width="90">Member No.</th><th>Name</th><th width="120">Savings</th><th width="90">Status</th></tr>
${trs}
</table>
<p><a href="/search">New search</a></p>`);
}

export function memberPage(m, msg) {
  const frozen = m.status === 'frozen';
  const action = frozen
    ? `<div class="n2">Action not permitted. This member record is frozen and cannot be serviced from this terminal. Contact the Risk Operations desk for release.</div>`
    : `<form method="post" action="/member/${esc(m.id)}/subaccount">
<table class="t1">
<tr><td width="140">Account Type</td><td>
<select name="type">
<option value="checking">Checking</option>
<option value="savings">Savings</option>
</select></td></tr>
<tr><td>Initial Deposit</td><td><input type="text" name="deposit" size="16" value="0.00"></td></tr>
</table>
<p><input type="submit" value="Open Sub-Account"></p>
</form>`;
  return layout('Member Detail', `
${msg ? `<div class="n2">${esc(msg)}</div>` : ''}
<table class="t1">
<tr><th width="140">Member No.</th><td>${esc(m.id)}</td></tr>
<tr><th>Name</th><td>${esc(m.name)}</td></tr>
<tr><th>Savings Balance</th><td>${esc(money(m.savings))}</td></tr>
<tr><th>Status</th><td>${esc(m.status.toUpperCase())}</td></tr>
</table>
<p>&nbsp;</p>
<div class="h2">OPEN SUB-ACCOUNT</div>
<p>&nbsp;</p>
${action}
<p><a href="/search">Return to search</a></p>`);
}

export function confirmPage(m, rec) {
  return layout('Sub-Account Confirmation', `
<div class="n3">Sub-account opened successfully.</div>
<table class="t1">
<tr><th width="170">Sub-Account Number</th><td>${esc(rec.number)}</td></tr>
<tr><th>Member No.</th><td>${esc(m.id)}</td></tr>
<tr><th>Member Name</th><td>${esc(m.name)}</td></tr>
<tr><th>Account Type</th><td>${esc(rec.type.toUpperCase())}</td></tr>
<tr><th>Initial Deposit</th><td>${esc(money(rec.deposit))}</td></tr>
<tr><th>Opened</th><td>${esc(rec.openedAt)}</td></tr>
</table>
<p>Retain this reference number for your records.</p>
<p><a href="/member/${esc(m.id)}">Back to member</a> &nbsp;|&nbsp; <a href="/search">New search</a></p>`);
}

export function notFoundPage() {
  return layout('Not Found', `
<div class="n1">The requested record or page does not exist.</div>
<p><a href="/search">Return to search</a></p>`);
}

export function errorPage() {
  return layout('System Error', `
<div class="n2">SYSTEM ERROR 500 &mdash; The servicing host did not complete your request.<br>
Reference SVC-03-E500. Please retry or contact the help desk.</div>
<p><a href="/search">Return to search</a></p>`);
}
