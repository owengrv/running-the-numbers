// ======================== STATE ========================
let loans = [];
let investments = [];
let loanIdCounter = 0;
let invIdCounter = 0;

// ======================== PERSIST FIELD IDS ========================
const PERSIST_IDS = [
  'h_price','h_down','h_rate','h_term','h_tax','h_insurance','h_hoa','h_pmi','h_cagr','h_homestead',
  'cc_origination','cc_appraisal','cc_title','cc_escrow','cc_inspection','cc_recording','cc_prepaid_days','cc_other',
  'cf_owen','cf_brenna','cf_tax','cf_other','cf_expenses_input'
];

const STORAGE_KEY = 'rtn_state';

// ======================== SAVE / LOAD STATE ========================
function saveState() {
  const inputs = {};
  PERSIST_IDS.forEach(id => {
    const el = document.getElementById(id);
    if (el) inputs[id] = el.value;
  });
  const state = { inputs, loans, investments, loanIdCounter, invIdCounter };
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
    if (Array.isArray(state.loans)) loans = state.loans;
    if (Array.isArray(state.investments)) investments = state.investments;
    if (state.loanIdCounter !== undefined) loanIdCounter = state.loanIdCounter;
    if (state.invIdCounter !== undefined) invIdCounter = state.invIdCounter;
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
  return { inputs, loans, investments, loanIdCounter, invIdCounter };
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
  renderLoans();
  renderInvestments();
  calcHome();
  calcClose();
  calcCashflow();
  calcInvestments();
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

// ======================== TABS ========================
function switchTab(tab) {
  const validTabs = ['home', 'loans', 'cashflow', 'investments', 'summary'];
  if (!validTabs.includes(tab)) tab = 'home';

  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.getElementById('tab-' + tab).classList.add('active');
  document.querySelector(`.tab[data-tab="${tab}"]`).classList.add('active');

  // Update hash without triggering hashchange handler
  if (window.location.hash !== '#' + tab) {
    history.replaceState(null, '', '#' + tab);
  }

  if (tab === 'cashflow') syncCashflowLinks();
  if (tab === 'summary') calcSummary();
}

window.addEventListener('hashchange', () => {
  const hash = window.location.hash.slice(1);
  const validTabs = ['home', 'loans', 'cashflow', 'investments', 'summary'];
  if (validTabs.includes(hash)) switchTab(hash);
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
let homeTotalInterest = 0;
let homeCAGR = 4.0;
let homeTerm = 30;

function calcHome() {
  const price = parseFloat(document.getElementById('h_price').value) || 0;
  const downPct = parseFloat(document.getElementById('h_down').value) || 0;
  const rate = parseFloat(document.getElementById('h_rate').value) || 0;
  const term = parseInt(document.getElementById('h_term').value) || 30;
  const taxPct = parseFloat(document.getElementById('h_tax').value) || 0;
  const insAnnual = parseFloat(document.getElementById('h_insurance').value) || 0;
  const hoa = parseFloat(document.getElementById('h_hoa').value) || 0;
  const pmiRate = parseFloat(document.getElementById('h_pmi').value) || 0;
  homeCAGR = parseFloat(document.getElementById('h_cagr').value) || 0;
  homeTerm = term;

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
  document.getElementById('h_total').textContent = fmt(total);
  document.getElementById('h_loan').textContent = fmt(loanAmt);
  document.getElementById('h_downamt').textContent = fmt(downAmt);

  // Total interest
  const totalPaid = pi * n;
  const totalInterest = totalPaid - loanAmt;
  homeTotalInterest = totalInterest;
  document.getElementById('h_totalint').textContent = fmt(totalInterest);
  document.getElementById('h_totalcost').textContent = fmt(price + totalInterest + (taxMo * n) + (insMo * n));

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

  saveState();
}

// ======================== LOANS ========================
function addLoan() {
  const id = ++loanIdCounter;
  loans.push({ id, name: 'New Loan', loanAmt: 20000, term: 12, rate: 8, paymentType: 'interest_only', makePayments: true });
  renderLoans();
}

function removeLoan(id) {
  loans = loans.filter(l => l.id !== id);
  renderLoans();
}

function updateLoan(id, field, value) {
  const loan = loans.find(l => l.id === id);
  if (!loan) return;
  if (field === 'makePayments') {
    loan.makePayments = value === 'yes';
    renderLoanCard(loan);
  } else if (['loanAmt','term','rate'].includes(field)) {
    loan[field] = parseFloat(value) || 0;
  } else {
    loan[field] = value;
  }
  updateLoanDisplay(id);
  calcLoanSummary();
  syncCashflowLinks();
}

function calcLoanMonthly(loan) {
  if (!loan.makePayments) return 0;
  if (loan.paymentType === 'interest_only') {
    return loan.loanAmt * (loan.rate / 100 / 12);
  } else {
    const r = loan.rate / 100 / 12;
    const n = loan.term;
    if (r === 0) return loan.loanAmt / n;
    return loan.loanAmt * (r * Math.pow(1+r,n)) / (Math.pow(1+r,n)-1);
  }
}

function updateLoanDisplay(id) {
  const loan = loans.find(l => l.id === id);
  if (!loan) return;
  const monthly = calcLoanMonthly(loan);
  const moEl = document.getElementById('loan_monthly_' + id);
  if (moEl) {
    moEl.textContent = loan.makePayments ? fmt(monthly) : 'Deferred';
    moEl.style.color = loan.makePayments ? 'var(--accent3)' : 'var(--text3)';
  }
  const intEl = document.getElementById('loan_totalint_' + id);
  if (intEl) {
    intEl.textContent = loan.makePayments ? fmt(monthly * loan.term) : 'Deferred';
  }
}

function renderLoanCard(loan) {
  const card = document.getElementById('loan_card_' + loan.id);
  if (!card) return;
  const ptEl = card.querySelector('.loan-paytype-toggle');
  if (ptEl) {
    ptEl.innerHTML = loan.makePayments
      ? `<label>Payment Type</label>
         <select onchange="updateLoan(${loan.id},'paymentType',this.value)">
           <option value="interest_only" ${loan.paymentType==='interest_only'?'selected':''}>Interest Only</option>
           <option value="principal_interest" ${loan.paymentType==='principal_interest'?'selected':''}>Principal + Interest</option>
         </select>`
      : `<label>Payment Type</label>
         <input value="N/A (deferred)" disabled style="opacity:0.4;cursor:not-allowed;">`;
  }
}

function renderLoans() {
  const list = document.getElementById('loansList');
  if (loans.length === 0) {
    list.innerHTML = `<div style="text-align:center;padding:40px;color:var(--text3);font-family:var(--mono);font-size:13px;">No loan positions. Click "+ Add Loan" to model a collateralized loan.</div>`;
    calcLoanSummary();
    return;
  }

  list.innerHTML = loans.map(loan => `
    <div class="loan-card" id="loan_card_${loan.id}">
      <div class="loan-header">
        <div style="display:flex;align-items:center;gap:12px;">
          <span style="font-family:var(--mono);font-size:13px;color:var(--text2);" id="loan_name_display_${loan.id}">${loan.name}</span>
        </div>
        <button class="btn btn-danger" onclick="removeLoan(${loan.id})">Remove</button>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Loan Name</label>
          <input type="text" value="${loan.name}" oninput="updateLoan(${loan.id},'name',this.value);document.getElementById('loan_name_display_${loan.id}').textContent=this.value;" placeholder="e.g. Bitcoin Backed Loan">
        </div>
        <div class="form-group">
          <label>Loan Amount</label>
          <div class="input-wrap">
            <span class="input-prefix">$</span>
            <input class="has-prefix" type="number" value="${loan.loanAmt}" oninput="updateLoan(${loan.id},'loanAmt',this.value)">
          </div>
        </div>
        <div class="form-group">
          <label>Term (months)</label>
          <input type="number" value="${loan.term}" oninput="updateLoan(${loan.id},'term',this.value)">
        </div>
        <div class="form-group">
          <label>Interest Rate %</label>
          <div class="input-wrap">
            <input class="has-suffix" type="number" step="0.25" value="${loan.rate}" oninput="updateLoan(${loan.id},'rate',this.value)">
            <span class="input-suffix">%</span>
          </div>
        </div>
        <div class="form-group">
          <label>Monthly Payments?</label>
          <select onchange="updateLoan(${loan.id},'makePayments',this.value)">
            <option value="yes" ${loan.makePayments?'selected':''}>Yes</option>
            <option value="no" ${!loan.makePayments?'selected':''}>No (deferred)</option>
          </select>
        </div>
        <div class="form-group loan-paytype-toggle">
          ${loan.makePayments
            ? `<label>Payment Type</label>
               <select onchange="updateLoan(${loan.id},'paymentType',this.value)">
                 <option value="interest_only" ${loan.paymentType==='interest_only'?'selected':''}>Interest Only</option>
                 <option value="principal_interest" ${loan.paymentType==='principal_interest'?'selected':''}>Principal + Interest</option>
               </select>`
            : `<label>Payment Type</label>
               <input value="N/A (deferred)" disabled style="opacity:0.4;cursor:not-allowed;">`}
        </div>
      </div>
      <div style="display:flex;gap:24px;margin-top:8px;">
        <div>
          <div style="font-family:var(--mono);font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:0.1em;">Monthly Payment</div>
          <div id="loan_monthly_${loan.id}" style="font-family:var(--mono);font-size:18px;font-weight:600;color:${loan.makePayments?'var(--accent3)':'var(--text3)'};">${loan.makePayments ? fmt(calcLoanMonthly(loan)) : 'Deferred'}</div>
        </div>
        <div>
          <div style="font-family:var(--mono);font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:0.1em;">Total Interest Cost</div>
          <div id="loan_totalint_${loan.id}" style="font-family:var(--mono);font-size:18px;font-weight:600;color:var(--text2);">${fmt(calcLoanMonthly(loan) * loan.term)}</div>
        </div>
      </div>
    </div>
  `).join('');

  calcLoanSummary();
}

function calcLoanSummary() {
  const totalDebt = loans.reduce((s,l) => s + l.loanAmt, 0);
  const totalMonthly = loans.reduce((s,l) => s + calcLoanMonthly(l), 0);
  const avgRate = loans.length > 0 ? loans.reduce((s,l) => s + l.rate, 0) / loans.length : 0;

  document.getElementById('ls_collateral').textContent = loans.length;
  document.getElementById('ls_debt').textContent = fmt(totalDebt);
  document.getElementById('ls_monthly').textContent = fmt(totalMonthly);
  document.getElementById('ls_avgrate').textContent = avgRate.toFixed(2) + '%';

  syncCashflowLinks();
  calcSummary();
  saveState();
}

// ======================== CASHFLOW ========================
function syncCashflowLinks() {
  document.getElementById('cf_housing').value = homeMonthly.toFixed(2);
  const totalLoanPay = loans.reduce((s,l) => s + calcLoanMonthly(l), 0);
  document.getElementById('cf_loanpayments').value = totalLoanPay.toFixed(2);
  calcCashflow();
}

let cfNetMonthly = 0;
let cfTotalExpenses = 0;

function calcCashflow() {
  const owenAnnual = parseFloat(document.getElementById('cf_owen').value) || 0;
  const brennaAnnual = parseFloat(document.getElementById('cf_brenna').value) || 0;
  const otherAnnual = parseFloat(document.getElementById('cf_other').value) || 0;
  const taxBracket = parseFloat(document.getElementById('cf_tax').value) || 0;

  const owen = owenAnnual / 12;
  const brenna = brennaAnnual / 12;
  const other = otherAnnual / 12;

  const gross = owen + brenna + other;
  const taxes = gross * (taxBracket / 100);
  const net = gross - taxes;
  cfNetMonthly = net;

  const housing = parseFloat(document.getElementById('cf_housing').value) || 0;
  const loans_ = parseFloat(document.getElementById('cf_loanpayments').value) || 0;
  const other_exp = parseFloat(document.getElementById('cf_expenses_input').value) || 0;

  const expenses = housing + loans_ + other_exp;
  cfTotalExpenses = expenses;
  const surplus = net - expenses;

  document.getElementById('cfs_owen').textContent = fmt(owen);
  document.getElementById('cfs_brenna').textContent = fmt(brenna);
  document.getElementById('cfs_other').textContent = fmt(other);
  document.getElementById('cfs_gross').textContent = fmt(gross);
  document.getElementById('cfs_taxes').textContent = '-' + fmt(taxes);
  document.getElementById('cfs_net').textContent = fmt(net);

  document.getElementById('cfs_housing').textContent = '-' + fmt(housing);
  document.getElementById('cfs_loans').textContent = '-' + fmt(loans_);
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

// ======================== INVESTMENTS ========================
function addInvestment() {
  const id = ++invIdCounter;
  investments.push({ id, name: 'New Position', value: 10000, cagr: 15 });
  renderInvestments();
}

function removeInvestment(id) {
  investments = investments.filter(i => i.id !== id);
  renderInvestments();
  calcInvestments();
}

function updateInvestment(id, field, val) {
  const inv = investments.find(i => i.id === id);
  if (!inv) return;
  if (field === 'name') inv.name = val;
  else inv[field] = parseFloat(val) || 0;
  calcInvestments();
}

function renderInvestments() {
  const list = document.getElementById('investmentsList');
  if (investments.length === 0) {
    list.innerHTML = `<div style="text-align:center;padding:40px;color:var(--text3);font-family:var(--mono);font-size:13px;">No investment positions. Click "+ Add Position" to start modeling.</div>`;
    calcInvestments();
    return;
  }

  list.innerHTML = `
    <div class="inv-list-header">
      <div>Position Name</div>
      <div>Current Value</div>
      <div>Expected CAGR %</div>
      <div></div>
    </div>
  ` + investments.map(inv => `
    <div class="inv-list-row">
      <div class="form-group" style="margin:0;"><input type="text" value="${inv.name}" oninput="updateInvestment(${inv.id},'name',this.value)" placeholder="Position name"></div>
      <div class="form-group" style="margin:0;">
        <div class="input-wrap">
          <span class="input-prefix">$</span>
          <input class="has-prefix" type="number" value="${inv.value}" oninput="updateInvestment(${inv.id},'value',this.value)">
        </div>
      </div>
      <div class="form-group" style="margin:0;">
        <div class="input-wrap">
          <input class="has-suffix" type="number" step="0.5" value="${inv.cagr}" oninput="updateInvestment(${inv.id},'cagr',this.value)">
          <span class="input-suffix">%</span>
        </div>
      </div>
      <button class="btn btn-danger" onclick="removeInvestment(${inv.id})">&#x2715;</button>
    </div>
  `).join('');

  calcInvestments();
}

let invCurrentTotal = 0;
let invProjectedTotal = 0;
let invBlendedCAGR = 0;

function calcInvestments() {
  const totalCurrent = investments.reduce((s,i) => s + i.value, 0);
  invCurrentTotal = totalCurrent;

  const blendedRate = totalCurrent > 0
    ? investments.reduce((s,i) => s + (i.cagr * (i.value / totalCurrent)), 0)
    : 0;

  invBlendedCAGR = blendedRate;
  invProjectedTotal = totalCurrent;

  document.getElementById('inv_current').textContent = fmt(totalCurrent);
  document.getElementById('inv_cagr').textContent = blendedRate.toFixed(2) + '%';

  calcSummary();
  saveState();
}

// ======================== SUMMARY ========================
function calcSummary() {
  const surplus = cfNetMonthly - cfTotalExpenses;
  const annualSurplus = surplus * 12;

  const surplusEl = document.getElementById('sum_surplus');
  surplusEl.textContent = (surplus >= 0 ? '+' : '') + fmt(Math.abs(surplus));
  surplusEl.className = 'stat-value ' + (surplus >= 0 ? '' : 'negative');
  if (surplus < 0) surplusEl.textContent = '-' + fmt(Math.abs(surplus));

  const annualEl = document.getElementById('sum_annual');
  annualEl.textContent = (annualSurplus >= 0 ? '+' : '-') + fmt(Math.abs(annualSurplus));
  annualEl.className = 'stat-value ' + (annualSurplus >= 0 ? '' : 'negative');

  const ratio = cfNetMonthly > 0 ? (cfTotalExpenses / cfNetMonthly * 100) : 0;
  const barColor = ratio < 70 ? 'var(--green)' : ratio < 90 ? 'var(--yellow)' : 'var(--red)';
  document.getElementById('sum_bar').style.width = Math.min(ratio, 100) + '%';
  document.getElementById('sum_bar').style.background = barColor;
  document.getElementById('sum_bar_label').textContent = ratio.toFixed(1) + '% of net income consumed by expenses';
  document.getElementById('sum_annual_sub').textContent = surplus >= 0
    ? fmt(annualSurplus) + ' available to invest or save per year'
    : fmt(Math.abs(annualSurplus)) + ' annual shortfall';

  // Net worth projection
  const totalLoanDebt = loans.reduce((s,l) => s + l.loanAmt, 0);
  const monthlyRate = homeLoanAmt > 0
    ? (parseFloat(document.getElementById('h_rate').value) || 0) / 100 / 12
    : 0;
  const termMonths = homeTerm * 12;
  const pi = homeMonthly > 0 && homeLoanAmt > 0
    ? homeLoanAmt * (monthlyRate * Math.pow(1+monthlyRate, termMonths)) / (Math.pow(1+monthlyRate, termMonths) - 1)
    : 0;

  function mortgageBalanceAt(years) {
    if (homeLoanAmt === 0 || monthlyRate === 0) return homeLoanAmt;
    const n = Math.min(years * 12, termMonths);
    return homeLoanAmt * (Math.pow(1+monthlyRate, termMonths) - Math.pow(1+monthlyRate, n))
         / (Math.pow(1+monthlyRate, termMonths) - 1);
  }

  const blendedInvRate = invBlendedCAGR / 100;
  const invMonthlyRate = blendedInvRate / 12;

  function investmentsAt(years) {
    const months = years * 12;
    const portfolioGrowth = invCurrentTotal * Math.pow(1 + blendedInvRate, years);
    const monthlyContrib = parseFloat(document.getElementById('inv_monthly').value) || 0;
    let contribFV = 0;
    if (invMonthlyRate > 0) {
      contribFV = monthlyContrib * (Math.pow(1+invMonthlyRate, months) - 1) / invMonthlyRate;
    } else {
      contribFV = monthlyContrib * months;
    }
    return portfolioGrowth + contribFV;
  }

  const horizons = [
    { label: 'Today', years: 0 },
    { label: '5 Years', years: 5 },
    { label: '10 Years', years: 10 },
    { label: '15 Years', years: 15 },
    { label: '20 Years', years: 20 },
  ];

  let prevNW = null;
  const tbody = document.getElementById('nw_projection_body');
  tbody.innerHTML = '';

  horizons.forEach(h => {
    const homeValue = homePurchasePrice > 0
      ? homePurchasePrice * Math.pow(1 + homeCAGR / 100, h.years)
      : 0;
    const mortgageBal = mortgageBalanceAt(h.years);
    const equity = homeValue - mortgageBal;
    const invValue = investmentsAt(h.years);
    const debt = h.years === 0 ? totalLoanDebt : Math.max(totalLoanDebt - 0, 0);
    const netWorth = equity + invValue - debt;

    const change = prevNW !== null ? netWorth - prevNW : null;
    const changeText = change !== null
      ? `<span style="color:${change >= 0 ? 'var(--green)' : 'var(--red)'};">${change >= 0 ? '+' : ''}${fmt(change)}</span>`
      : '<span style="color:var(--text3);">—</span>';

    const nwColor = netWorth >= 0 ? 'var(--accent)' : 'var(--red)';

    tbody.innerHTML += `<tr>
      <td style="color:var(--text);font-weight:500;">${h.label}</td>
      <td>${homePurchasePrice > 0 ? fmt(homeValue) : '--'}</td>
      <td style="color:var(--accent2);">${homePurchasePrice > 0 ? fmt(equity) : '--'}</td>
      <td style="color:var(--accent2);">${fmt(invValue)}</td>
      <td style="color:var(--red);">${debt > 0 ? '-' + fmt(debt) : '$0'}</td>
      <td style="color:${nwColor};font-weight:600;font-size:14px;">${fmt(netWorth)}</td>
      <td>${changeText}</td>
    </tr>`;

    prevNW = netWorth;
  });
}

// ======================== INIT ========================
document.getElementById('headerDate').textContent = new Date().toLocaleDateString('en-US', {weekday:'short',year:'numeric',month:'short',day:'numeric'});

// Priority: URL state > localStorage > defaults
const loadedFromHash = loadFromHash();
if (!loadedFromHash) {
  loadFromStorage();
}

// Render dynamic lists before first calc pass
renderLoans();
renderInvestments();

// Determine starting tab
const initialHash = window.location.hash.slice(1);
const validTabs = ['home', 'loans', 'cashflow', 'investments', 'summary'];
const startTab = validTabs.includes(initialHash) && !initialHash.startsWith('state=') ? initialHash : 'home';

// Run all calcs
calcHome();
calcClose();
calcCashflow();
calcInvestments();
calcSummary();

// Activate correct tab (after calcs so linked fields are populated)
if (startTab !== 'home') switchTab(startTab);
