// ======================== STATE ========================
let renoItems = [];
let expenseItems = [];
let renoIdCounter = 0;
let expenseIdCounter = 0;

// ======================== PERSIST FIELD IDS ========================
const PERSIST_IDS = [
  'h_price','h_down','h_rate','h_term','h_tax','h_insurance','h_hoa','h_pmi','h_homestead',
  'cc_origination','cc_appraisal','cc_title','cc_escrow','cc_inspection','cc_recording','cc_prepaid_days','cc_other',
  'cf_gross_input','cf_tax',
  'reno_contingency'
];

const STORAGE_KEY = 'rtn_state';

// ======================== SAVE / LOAD STATE ========================
function saveState() {
  const inputs = {};
  PERSIST_IDS.forEach(id => {
    const el = document.getElementById(id);
    if (el) inputs[id] = el.value;
  });
  const state = { inputs, renoItems, expenseItems, renoIdCounter, expenseIdCounter };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    // localStorage unavailable (e.g. file:// in some browsers) — silently ignore
  }
}

function loadState(state) {
  if (!state) return false;
  try {
    // Restore simple inputs
    if (state.inputs) {
      PERSIST_IDS.forEach(id => {
        const el = document.getElementById(id);
        if (el && state.inputs[id] !== undefined) el.value = state.inputs[id];
      });
    }
    // Restore dynamic arrays
    if (Array.isArray(state.renoItems)) renoItems = state.renoItems;
    if (Array.isArray(state.expenseItems)) expenseItems = state.expenseItems;
    if (state.renoIdCounter !== undefined) renoIdCounter = state.renoIdCounter;
    if (state.expenseIdCounter !== undefined) expenseIdCounter = state.expenseIdCounter;
    return true;
  } catch (e) {
    return false;
  }
}

function loadFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    return loadState(JSON.parse(raw));
  } catch (e) {
    return false;
  }
}

// ======================== EXPORT / IMPORT ========================
function getExportState() {
  const inputs = {};
  PERSIST_IDS.forEach(id => {
    const el = document.getElementById(id);
    if (el) inputs[id] = el.value;
  });
  return { inputs, renoItems, expenseItems, renoIdCounter, expenseIdCounter };
}

function exportJSON() {
  const state = getExportState();
  const date = new Date().toISOString().slice(0, 10);
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `running-the-numbers-${date}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  showToast('Scenario exported');
}

function handleImportFile(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const state = JSON.parse(e.target.result);
      applyState(state);
      showToast('Scenario imported');
    } catch (err) {
      showToast('Invalid JSON file');
    }
  };
  reader.readAsText(file);
  // Reset the input so the same file can be re-imported
  event.target.value = '';
}

function applyState(state) {
  loadState(state);
  renderRenoItems();
  renderExpenseItems();
  calcHome();
  calcClose();
  calcExpenses();
  calcCashflow();
  calcReno();
  calcSummary();
  saveState();
}

// ======================== COPY LINK ========================
function copyLink() {
  const state = getExportState();
  const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(state))));
  const url = window.location.origin + window.location.pathname + '#state=' + encoded;
  navigator.clipboard.writeText(url).then(() => {
    showToast('Link copied to clipboard');
  }).catch(() => {
    // Fallback for browsers without clipboard API
    prompt('Copy this link:', url);
  });
}

function loadFromHash() {
  const hash = window.location.hash;
  if (!hash.startsWith('#state=')) return false;
  try {
    const encoded = hash.slice('#state='.length);
    const json = decodeURIComponent(escape(atob(encoded)));
    const state = JSON.parse(json);
    loadState(state);
    return true;
  } catch (e) {
    return false;
  }
}

// ======================== TOAST ========================
let toastTimer = null;
function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

// ======================== COLLAPSIBLE CARDS ========================
function toggleCard(id) {
  const card = document.getElementById(id);
  if (card) card.classList.toggle('collapsed');
}

// ======================== TABS ========================
const VALID_TABS = ['summary', 'home', 'cashflow', 'expenses', 'renovation'];

function switchTab(tab) {
  if (!VALID_TABS.includes(tab)) tab = 'summary';

  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.getElementById('tab-' + tab).classList.add('active');
  document.querySelector(`.tab[data-tab="${tab}"]`).classList.add('active');

  // Update hash without triggering hashchange handler
  if (window.location.hash !== '#' + tab) {
    history.replaceState(null, '', '#' + tab);
  }

  if (tab === 'cashflow') syncCashflowLinks();
  if (tab === 'expenses') calcExpenses();
  if (tab === 'renovation') calcReno();
  if (tab === 'summary') calcSummary();
}

window.addEventListener('hashchange', () => {
  const hash = window.location.hash.slice(1);
  if (VALID_TABS.includes(hash)) switchTab(hash);
});

// ======================== FORMATTING ========================
function fmt(n, decimals=0) {
  if (isNaN(n)) return '$0';
  return '$' + n.toFixed(decimals).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function fmtSigned(n) {
  const abs = fmt(Math.abs(n));
  return n >= 0 ? '+' + abs : '-' + fmt(Math.abs(n));
}

// ======================== HOME CALC ========================
let homeMonthly = 0;
let homeLoanAmt = 0;
let homePurchasePrice = 0;

function calcHome() {
  const price = parseFloat(document.getElementById('h_price').value) || 0;
  const downPct = parseFloat(document.getElementById('h_down').value) || 0;
  const rate = parseFloat(document.getElementById('h_rate').value) || 0;
  const term = parseInt(document.getElementById('h_term').value) || 30;
  const taxPct = parseFloat(document.getElementById('h_tax').value) || 0;
  const insAnnual = parseFloat(document.getElementById('h_insurance').value) || 0;
  const hoa = parseFloat(document.getElementById('h_hoa').value) || 0;
  const pmiRate = parseFloat(document.getElementById('h_pmi').value) || 0;
  const downAmt = price * (downPct / 100);
  const loanAmt = price - downAmt;
  homeLoanAmt = loanAmt;
  homePurchasePrice = price;

  const monthlyRate = rate / 100 / 12;
  const n = term * 12;

  let pi = 0;
  if (monthlyRate > 0) {
    pi = loanAmt * (monthlyRate * Math.pow(1 + monthlyRate, n)) / (Math.pow(1 + monthlyRate, n) - 1);
  } else {
    pi = loanAmt / n;
  }

  const homestead = document.getElementById('h_homestead').value === 'yes';
  const taxableValue = homestead ? price * 0.8 : price;
  const taxMo = (taxableValue * taxPct / 100) / 12;
  const insMo = insAnnual / 12;
  const pmiMo = downPct < 20 ? (loanAmt * pmiRate / 100) / 12 : 0;
  const total = pi + taxMo + insMo + pmiMo + hoa;
  homeMonthly = total;

  document.getElementById('h_pi').textContent = fmt(pi);
  document.getElementById('h_taxmo').textContent = fmt(taxMo);
  document.getElementById('h_insmo').textContent = fmt(insMo + pmiMo);
  document.getElementById('h_hoamo').textContent = fmt(hoa);
  document.getElementById('h_total').textContent = fmt(total);
  document.getElementById('h_loan').textContent = fmt(loanAmt);
  document.getElementById('h_downamt').textContent = fmt(downAmt);

  // Total interest
  const totalPaid = pi * n;
  const totalInterest = totalPaid - loanAmt;
  document.getElementById('h_totalint').textContent = fmt(totalInterest);
  document.getElementById('h_totalcost').textContent = fmt(price + totalInterest + (taxMo * n) + (insMo * n));
  document.getElementById('h_totalcost_label').textContent = `Total Cost over ${term} Years`;

  // Amortization schedule (first 24 months)
  let bal = loanAmt;
  let cumulInt = 0;
  const tbody = document.getElementById('amortBody');
  tbody.innerHTML = '';
  for (let i = 1; i <= Math.min(24, n); i++) {
    const intPart = bal * monthlyRate;
    const prinPart = pi - intPart;
    cumulInt += intPart;
    bal -= prinPart;
    tbody.innerHTML += `<tr>
      <td>${i}</td>
      <td>${fmt(pi)}</td>
      <td class="principal">${fmt(prinPart)}</td>
      <td class="interest">${fmt(intPart)}</td>
      <td>${fmt(cumulInt)}</td>
      <td class="balance">${fmt(Math.max(0, bal))}</td>
    </tr>`;
  }

  syncCashflowLinks();
  calcClose();
  calcSummary();
  saveState();
}

// ======================== COST TO CLOSE ========================
function calcClose() {
  const loanAmt = homeLoanAmt;
  const downAmt = homePurchasePrice - loanAmt;
  const monthlyRate = (parseFloat(document.getElementById('h_rate').value) || 0) / 100 / 12;

  const origPct = parseFloat(document.getElementById('cc_origination').value) || 0;
  const appraisal = parseFloat(document.getElementById('cc_appraisal').value) || 0;
  const title = parseFloat(document.getElementById('cc_title').value) || 0;
  const escrow = parseFloat(document.getElementById('cc_escrow').value) || 0;
  const inspection = parseFloat(document.getElementById('cc_inspection').value) || 0;
  const recording = parseFloat(document.getElementById('cc_recording').value) || 0;
  const prepaidDays = parseFloat(document.getElementById('cc_prepaid_days').value) || 0;
  const other = parseFloat(document.getElementById('cc_other').value) || 0;

  const origFee = loanAmt * (origPct / 100);
  const prepaidInt = loanAmt * monthlyRate * (prepaidDays / 30);
  const total = origFee + appraisal + title + escrow + inspection + recording + prepaidInt + other;
  const cashToClose = downAmt + total;

  document.getElementById('cc_s_origination').textContent = fmt(origFee);
  document.getElementById('cc_s_appraisal').textContent = fmt(appraisal);
  document.getElementById('cc_s_title').textContent = fmt(title);
  document.getElementById('cc_s_escrow').textContent = fmt(escrow);
  document.getElementById('cc_s_inspection').textContent = fmt(inspection);
  document.getElementById('cc_s_recording').textContent = fmt(recording);
  document.getElementById('cc_s_prepaid').textContent = fmt(prepaidInt);
  document.getElementById('cc_s_other').textContent = fmt(other);
  document.getElementById('cc_s_total').textContent = fmt(total);
  document.getElementById('cc_s_cashtoclose').textContent = fmt(cashToClose);

  calcSummary();
  saveState();
}

// ======================== CASHFLOW ========================
function syncCashflowLinks() {
  document.getElementById('cf_housing').value = homeMonthly.toFixed(2);
  // cf_expenses_input is kept in sync by calcExpenses()
  calcCashflow();
}

let cfNetMonthly = 0;
let cfTotalExpenses = 0;

function calcCashflow() {
  const grossAnnual = parseFloat(document.getElementById('cf_gross_input').value) || 0;
  const taxBracket = parseFloat(document.getElementById('cf_tax').value) || 0;

  const gross = grossAnnual / 12;
  const taxes = gross * (taxBracket / 100);
  const net = gross - taxes;
  cfNetMonthly = net;

  const housing = parseFloat(document.getElementById('cf_housing').value) || 0;
  const other_exp = parseFloat(document.getElementById('cf_expenses_input').value) || 0;

  const expenses = housing + other_exp;
  cfTotalExpenses = expenses;
  const surplus = net - expenses;

  document.getElementById('cfs_gross').textContent = fmt(gross);
  document.getElementById('cfs_taxes').textContent = '-' + fmt(taxes);
  document.getElementById('cfs_net').textContent = fmt(net);

  document.getElementById('cfs_housing').textContent = '-' + fmt(housing);
  document.getElementById('cfs_other_exp').textContent = '-' + fmt(other_exp);
  document.getElementById('cfs_expenses').textContent = '-' + fmt(expenses);

  const surplusEl = document.getElementById('cfs_surplus');
  surplusEl.textContent = (surplus >= 0 ? '+' : '-') + fmt(Math.abs(surplus));
  surplusEl.className = 'cf-line-value ' + (surplus >= 0 ? 'green' : 'red');

  const ratio = net > 0 ? (expenses / net * 100) : 0;
  const barColor = ratio < 70 ? 'var(--green)' : ratio < 90 ? 'var(--yellow)' : 'var(--red)';
  document.getElementById('cf_bar').style.width = Math.min(ratio, 100) + '%';
  document.getElementById('cf_bar').style.background = barColor;
  document.getElementById('cf_ratio_text').textContent = ratio.toFixed(1) + '% of net income';

  calcSummary();
  saveState();
}

// ======================== SUMMARY ========================
function calcSummary() {
  // Home section
  const cashToCloseEl = document.getElementById('cc_s_cashtoclose');
  const cashToClose = cashToCloseEl ? (parseFloat(cashToCloseEl.textContent.replace(/[$,]/g, '')) || 0) : 0;
  document.getElementById('sum_cash_to_close').textContent = cashToClose > 0 ? fmt(cashToClose) : '--';

  const renoTotalEl = document.getElementById('reno_total');
  const renoTotal = renoTotalEl ? (parseFloat(renoTotalEl.textContent.replace(/[$,]/g, '')) || 0) : 0;
  document.getElementById('sum_reno_budget').textContent = fmt(renoTotal);

  const oop = cashToClose + renoTotal;
  document.getElementById('sum_cash_oop').textContent = oop > 0 ? fmt(oop) : '--';

  // Cash flow section
  const grossAnnual = parseFloat(document.getElementById('cf_gross_input').value) || 0;
  const taxBracket = parseFloat(document.getElementById('cf_tax').value) || 0;
  const gross = grossAnnual / 12;
  const taxes = gross * (taxBracket / 100);
  const net = gross - taxes;
  const housing = parseFloat(document.getElementById('cf_housing').value) || 0;
  const otherExp = parseFloat(document.getElementById('cf_expenses_input').value) || 0;
  const expenses = housing + otherExp;
  const surplus = net - expenses;

  document.getElementById('sum_cfs_gross').textContent = fmt(gross);
  document.getElementById('sum_cfs_taxes').textContent = '-' + fmt(taxes);
  document.getElementById('sum_cfs_net').textContent = fmt(net);
  document.getElementById('sum_cfs_housing').textContent = '-' + fmt(housing);
  document.getElementById('sum_cfs_other_exp').textContent = '-' + fmt(otherExp);
  document.getElementById('sum_cfs_expenses').textContent = '-' + fmt(expenses);

  const surplusEl = document.getElementById('sum_surplus');
  surplusEl.textContent = (surplus >= 0 ? '+' : '-') + fmt(Math.abs(surplus));
  surplusEl.className = 'cf-line-value ' + (surplus >= 0 ? 'green' : 'red');

  const ratio = net > 0 ? (expenses / net * 100) : 0;
  const barColor = ratio < 70 ? 'var(--green)' : ratio < 90 ? 'var(--yellow)' : 'var(--red)';
  document.getElementById('sum_bar').style.width = Math.min(ratio, 100) + '%';
  document.getElementById('sum_bar').style.background = barColor;
  document.getElementById('sum_bar_label').textContent = ratio.toFixed(1) + '% of net income consumed by expenses';
}

// ======================== EXPENSE BUDGET ========================
const EXPENSE_TYPES = ['Housing', 'Food', 'Transport', 'Utilities', 'Health', 'Insurance', 'Entertainment', 'Personal', 'Savings', 'Other'];
const EXPENSE_FREQS = [
  { value: 'monthly', label: 'Monthly', divisor: 1 },
  { value: 'quarterly', label: 'Quarterly', divisor: 3 },
  { value: 'annually', label: 'Annually', divisor: 12 },
];

function expenseToMonthly(item) {
  const freq = EXPENSE_FREQS.find(f => f.value === item.frequency) || EXPENSE_FREQS[0];
  return (item.amount || 0) / freq.divisor;
}

function addExpenseItem() {
  const id = ++expenseIdCounter;
  expenseItems.push({ id, name: 'New Expense', frequency: 'monthly', amount: 0, type: 'Other' });
  renderExpenseItems();
}

function removeExpenseItem(id) {
  expenseItems = expenseItems.filter(e => e.id !== id);
  renderExpenseItems();
  calcExpenses();
}

function updateExpenseItem(id, field, value) {
  const item = expenseItems.find(e => e.id === id);
  if (!item) return;
  if (field === 'name') item.name = value;
  else if (field === 'amount') item.amount = parseFloat(value) || 0;
  else item[field] = value;
  calcExpenses();
}

function renderExpenseItems() {
  const list = document.getElementById('expenseItemsList');
  if (!list) return;
  if (expenseItems.length === 0) {
    list.innerHTML = `<div style="text-align:center;padding:40px;color:var(--text3);font-family:var(--mono);font-size:13px;">No expenses. Click "+ Add Expense" to start building your budget.</div>`;
    calcExpenses();
    return;
  }

  const freqOptions = EXPENSE_FREQS.map(f => `<option value="${f.value}">${f.label}</option>`).join('');
  const typeOptions = EXPENSE_TYPES.map(t => `<option value="${t}">${t}</option>`).join('');

  list.innerHTML = `
    <div style="display:grid;grid-template-columns:2fr 1fr 1fr 1fr auto;gap:12px;padding:0 4px 8px;font-family:var(--mono);font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:var(--text3);">
      <div>Expense Name</div>
      <div>Amount</div>
      <div>Frequency</div>
      <div>Type</div>
      <div></div>
    </div>
  ` + expenseItems.map(item => {
    const monthly = expenseToMonthly(item);
    const freqOpts = EXPENSE_FREQS.map(f => `<option value="${f.value}" ${item.frequency === f.value ? 'selected' : ''}>${f.label}</option>`).join('');
    const typeOpts = EXPENSE_TYPES.map(t => `<option value="${t}" ${item.type === t ? 'selected' : ''}>${t}</option>`).join('');
    return `
    <div class="expense-item-row">
      <div class="form-group" style="margin:0;">
        <input type="text" value="${item.name}" oninput="updateExpenseItem(${item.id},'name',this.value)" placeholder="e.g. Groceries">
      </div>
      <div class="form-group" style="margin:0;">
        <div class="input-wrap">
          <span class="input-prefix">$</span>
          <input class="has-prefix" type="number" value="${item.amount || ''}" oninput="updateExpenseItem(${item.id},'amount',this.value)" placeholder="0">
        </div>
      </div>
      <div class="form-group" style="margin:0;">
        <select onchange="updateExpenseItem(${item.id},'frequency',this.value)">${freqOpts}</select>
      </div>
      <div class="form-group" style="margin:0;">
        <select onchange="updateExpenseItem(${item.id},'type',this.value)">${typeOpts}</select>
      </div>
      <button class="btn btn-danger" onclick="removeExpenseItem(${item.id})">&#x2715;</button>
    </div>`;
  }).join('');

  calcExpenses();
}

function calcExpenses() {
  const monthlyTotal = expenseItems.reduce((s, e) => s + expenseToMonthly(e), 0);
  const annualTotal = monthlyTotal * 12;

  // Push to cashflow
  const expEl = document.getElementById('cf_expenses_input');
  if (expEl) expEl.value = monthlyTotal.toFixed(2);

  const monthlyEl = document.getElementById('exp_monthly_total');
  const annualEl = document.getElementById('exp_annual_total');
  const countEl = document.getElementById('exp_count');

  if (monthlyEl) monthlyEl.textContent = fmt(monthlyTotal);
  if (annualEl) annualEl.textContent = fmt(annualTotal);
  if (countEl) countEl.textContent = expenseItems.length;

  calcCashflow();
  saveState();
}

// ======================== THEME ========================
function toggleTheme() {
  const isLight = document.documentElement.getAttribute('data-theme') === 'light';
  const newTheme = isLight ? 'dark' : 'light';
  applyTheme(newTheme);
  try { localStorage.setItem('rtn_theme', newTheme); } catch(e) {}
}

function applyTheme(theme) {
  if (theme === 'light') {
    document.documentElement.setAttribute('data-theme', 'light');
    document.getElementById('themeToggleBtn').textContent = '☀';
  } else {
    document.documentElement.removeAttribute('data-theme');
    document.getElementById('themeToggleBtn').textContent = '☽';
  }
}

// ======================== RENOVATION ========================
function addRenoItem() {
  const id = ++renoIdCounter;
  renoItems.push({ id, label: 'New Item', amount: 0 });
  renderRenoItems();
}

function removeRenoItem(id) {
  renoItems = renoItems.filter(r => r.id !== id);
  renderRenoItems();
  calcReno();
}

function updateRenoItem(id, field, value) {
  const item = renoItems.find(r => r.id === id);
  if (!item) return;
  if (field === 'label') item.label = value;
  else item.amount = parseFloat(value) || 0;
  calcReno();
}

function renderRenoItems() {
  const list = document.getElementById('renoItemsList');
  if (!list) return;
  if (renoItems.length === 0) {
    list.innerHTML = `<div style="text-align:center;padding:40px;color:var(--text3);font-family:var(--mono);font-size:13px;">No line items. Click "+ Add Item" to start building your renovation budget.</div>`;
    calcReno();
    return;
  }

  list.innerHTML = `
    <div style="display:grid;grid-template-columns:2fr 1fr auto;gap:12px;padding:0 4px 8px;font-family:var(--mono);font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:var(--text3);">
      <div>Item / Scope</div>
      <div>Estimated Cost</div>
      <div></div>
    </div>
  ` + renoItems.map(item => `
    <div class="reno-item-row">
      <div class="form-group" style="margin:0;">
        <input type="text" value="${item.label}" oninput="updateRenoItem(${item.id},'label',this.value)" placeholder="e.g. Kitchen Remodel">
      </div>
      <div class="form-group" style="margin:0;">
        <div class="input-wrap">
          <span class="input-prefix">$</span>
          <input class="has-prefix" type="number" value="${item.amount || ''}" oninput="updateRenoItem(${item.id},'amount',this.value)" placeholder="0">
        </div>
      </div>
      <button class="btn btn-danger" onclick="removeRenoItem(${item.id})">&#x2715;</button>
    </div>
  `).join('');

  calcReno();
}

function calcReno() {
  const subtotal = renoItems.reduce((s, r) => s + (r.amount || 0), 0);
  const contingencyPct = parseFloat(document.getElementById('reno_contingency')?.value) || 0;
  const contingencyAmt = subtotal * (contingencyPct / 100);
  const total = subtotal + contingencyAmt;

  const subtotalEl = document.getElementById('reno_subtotal');
  const contingencyAmtEl = document.getElementById('reno_contingency_amt');
  const totalEl = document.getElementById('reno_total');
  const countEl = document.getElementById('reno_count');

  if (subtotalEl) subtotalEl.textContent = fmt(subtotal);
  if (contingencyAmtEl) contingencyAmtEl.textContent = fmt(contingencyAmt);
  if (totalEl) totalEl.textContent = fmt(total);
  if (countEl) countEl.textContent = renoItems.length;

  calcSummary();
  saveState();
}

// ======================== INIT ========================
document.getElementById('headerDate').textContent = new Date().toLocaleDateString('en-US', {weekday:'short',year:'numeric',month:'short',day:'numeric'});

// Apply saved theme before anything renders (default: light)
try {
  const savedTheme = localStorage.getItem('rtn_theme') || 'light';
  applyTheme(savedTheme);
} catch(e) { applyTheme('light'); }

// Priority: URL state > localStorage > defaults
const loadedFromHash = loadFromHash();
if (!loadedFromHash) {
  loadFromStorage();
}

// Seed default items if none loaded
if (renoItems.length === 0) {
  renoIdCounter = 1;
  renoItems = [{ id: 1, label: 'my total reno budget', amount: 200000 }];
}
if (expenseItems.length === 0) {
  expenseIdCounter = 1;
  expenseItems = [{ id: 1, name: 'my total expenses', amount: 8000, frequency: 'monthly', type: 'Other' }];
}

// Render dynamic lists before first calc pass
renderRenoItems();
renderExpenseItems();

// Determine starting tab
const initialHash = window.location.hash.slice(1);
const startTab = VALID_TABS.includes(initialHash) && !initialHash.startsWith('state=') ? initialHash : 'summary';

// Run all calcs
calcHome();
calcClose();
calcExpenses();
calcCashflow();
calcReno();
calcSummary();

// Activate correct tab (after calcs so linked fields are populated)
if (startTab !== 'summary') switchTab(startTab);
