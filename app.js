// ==========================
// SEGURANÇA (MIDDLEWARE)
// ==========================
if (!localStorage.getItem('hrc_auth_token') && !sessionStorage.getItem('hrc_auth_token')) {
    window.location.href = 'login.html';
}

// ==========================
// CONFIGURAÇÕES GERAIS
// ==========================
const PENALTY_FEE = 0.02; // Multa 2%
const DAILY_INTEREST = 0.0033; // Juros 0,33% ao dia

// ==========================
// ESTADO DA APLICAÇÃO
// ==========================
const firebaseConfig = {
  apiKey: "AIzaSyBxLvYPA4ESwZUftTrlvJ3NNxWwqO0EgeY",
  authDomain: "hrc-imoveis.firebaseapp.com",
  projectId: "hrc-imoveis",
  storageBucket: "hrc-imoveis.firebasestorage.app",
  messagingSenderId: "627895479271",
  appId: "1:627895479271:web:e6e87ee0a7f05193f12b42",
  databaseURL: "https://hrc-imoveis-default-rtdb.firebaseio.com"
};

if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}
const database = firebase.database();

let houses = [];
let systemUsers = [];

// ==========================
// MIGRAÇÃO LOCAL -> NUVEM
// ==========================
function migrateLocalToCloud() {
    const localHouses = JSON.parse(localStorage.getItem('lumina_houses'));
    if (localHouses && localHouses.length > 0) {
        database.ref('lumina_houses').once('value', (snapshot) => {
            if (!snapshot.exists() || Object.keys(snapshot.val()).length === 0) {
                let housesObj = {};
                localHouses.forEach(h => housesObj[h.id] = h);
                database.ref('lumina_houses').set(housesObj);
            }
        });
    }

    const localUsers = JSON.parse(localStorage.getItem('hrc_users'));
    if (localUsers && localUsers.length > 0) {
        database.ref('hrc_users').once('value', (snapshot) => {
            if (!snapshot.exists() || Object.keys(snapshot.val()).length === 0) {
                let usersObj = {};
                localUsers.forEach(u => usersObj[u.id] = u);
                database.ref('hrc_users').set(usersObj);
            }
        });
    }
}
migrateLocalToCloud();

database.ref('lumina_houses').on('value', (snapshot) => {
    const val = snapshot.val() || {};
    houses = Object.values(val);
    renderApp();
});

database.ref('hrc_users').on('value', (snapshot) => {
    const val = snapshot.val() || {};
    systemUsers = Object.values(val);
    renderUserTable();
});

function saveHousesToCloud() {
    let housesObj = {};
    houses.forEach(h => housesObj[h.id] = h);
    database.ref('lumina_houses').set(housesObj);
}

function saveUsersToCloud() {
    let usersObj = {};
    systemUsers.forEach(u => usersObj[u.id] = u);
    database.ref('hrc_users').set(usersObj);
}
let currentMonthFilter = getCurrentMonthStr(); // Formato YYYY-MM
let chartInstance = null;

// Elementos DOM
const tableBody = document.getElementById('houses-tbody');
const formHouse = document.getElementById('form-house');
const formPayment = document.getElementById('form-payment');

// ==========================
// INICIALIZAÇÃO
// ==========================
document.addEventListener('DOMContentLoaded', () => {
    updateDateDisplay();
    populateMonthFilter();
    renderApp();
    renderUserTable();
    setupEventListeners();
    
    // Mostra o nome do usuário logado no rodapé da sidebar
    const userNameElement = document.getElementById('logged-user-name');
    if (userNameElement) {
        userNameElement.textContent = localStorage.getItem('current_user') || 'Admin';
    }
    
    // Seção padrão
    switchSection('dashboard');
});

function logout() {
    localStorage.removeItem('hrc_auth_token');
    sessionStorage.removeItem('hrc_auth_token');
    localStorage.removeItem('current_user');
    window.location.href = 'login.html';
}

// ==========================
// LÓGICA DE NEGÓCIO E RENDERIZAÇÃO
// ==========================

function getCurrentMonthStr() {
    const today = new Date();
    return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
}

function getTodayString() {
    const today = new Date();
    return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
}

// Calcula as informações da fatura de um mês específico
function calculateInvoice(house, monthStr) {
    const [year, month] = monthStr.split('-').map(Number);
    const dueDate = new Date(year, month - 1, house.dueDay); // Mês é 0-indexed
    dueDate.setHours(23, 59, 59, 999);
    
    let baseValue = parseFloat(house.rentValue);
    
    // Verifica se já existe um pagamento ou registro para esse mês
    let existingRecord = house.payments ? house.payments.find(p => p.month === monthStr) : null;
    
    let status = "Pendente";
    let penalty = 0;
    let interest = 0;
    let energy = existingRecord && existingRecord.energy ? parseFloat(existingRecord.energy) : 0;
    let energyTax = existingRecord && existingRecord.energyTax ? parseFloat(existingRecord.energyTax) : 0;
    let energyKwh = existingRecord && existingRecord.energyKwh ? parseFloat(existingRecord.energyKwh) : 0;
    let energyPrice = existingRecord && existingRecord.energyPrice ? parseFloat(existingRecord.energyPrice) : 0.95;
    
    let internet = house.hasInternet ? parseFloat(house.internetValue || 0) : 0;
    
    let total = baseValue + energy + internet;
    
    if (existingRecord && existingRecord.status === 'Pago') {
        return {
            status: 'Pago',
            dueDate,
            baseValue,
            energy,
            energyTax,
            energyKwh,
            energyPrice,
            internet,
            penalty: 0,
            interest: 0,
            total: parseFloat(existingRecord.amountPaid),
            payDate: existingRecord.payDate
        };
    }
    
    // Se não está pago, verifica atraso baseado na data REAL de hoje
    const today = new Date();
    today.setHours(0,0,0,0);
    const dueDateCompare = new Date(dueDate);
    dueDateCompare.setHours(0,0,0,0);
    
    if (today > dueDateCompare) {
        status = "Atrasado";
        const diffTime = Math.abs(today - dueDateCompare);
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        
        // Usa as taxas específicas da casa ou o padrão global se não existirem
        const pRate = (house.penaltyPct !== undefined && house.penaltyPct !== null && !isNaN(house.penaltyPct) ? house.penaltyPct : (PENALTY_FEE * 100)) / 100;
        const iRate = (house.interestPct !== undefined && house.interestPct !== null && !isNaN(house.interestPct) ? house.interestPct : (DAILY_INTEREST * 100)) / 100;

        penalty = baseValue * pRate;
        interest = baseValue * iRate * diffDays;
        total = baseValue + energy + internet + penalty + interest;
    }
    
    return {
        status, dueDate, baseValue, energy, energyTax, energyKwh, energyPrice, internet, penalty, interest, total
    };
}

function formatCurrency(val) {
    return val.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatDate(dateItem) {
    const d = new Date(dateItem);
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

function renderApp() {
    renderTable();
    updateDashboard();
}

function saveData() {
    saveHousesToCloud();
}

function switchSection(section) {
    const dashboard = document.getElementById('dashboard-section');
    const chart = document.getElementById('chart-section');
    const table = document.querySelector('.table-section');
    const luz = document.getElementById('luz-section');
    const internet = document.getElementById('internet-section');
    const users = document.getElementById('users-section');
    const headerRight = document.querySelector('.header-right');

    // Limpar ativos
    document.querySelectorAll('.nav-links li').forEach(li => li.classList.remove('active'));
    
    // Esconder tudo
    dashboard.style.display = 'none';
    if (chart) chart.style.display = 'none';
    table.style.display = 'none';
    luz.style.display = 'none';
    if (internet) internet.style.display = 'none';
    users.style.display = 'none';
    headerRight.style.display = 'none';
    
    document.getElementById('page-title').textContent = section.charAt(0).toUpperCase() + section.slice(1);

    if (section === 'dashboard') {
        dashboard.style.display = 'grid';
        if (chart) chart.style.display = 'grid';
        // Hide new house button on dashboard, or show it? Let's leave it hidden, so user has to go to Imóveis to add.
        // Actually, let's keep headerRight visible just in case, but Imóveis makes more sense.
        // We'll hide table and headerRight for dashboard.
        document.getElementById('menu-dashboard-link').parentElement.classList.add('active');
        document.getElementById('page-title').textContent = 'Dashboard Financeiro';
    } else if (section === 'imoveis') {
        table.style.display = 'block';
        headerRight.style.display = 'block';
        document.getElementById('menu-houses-link').parentElement.classList.add('active');
        document.getElementById('page-title').textContent = 'Seus Imóveis';
    } else if (section === 'luz') {
        luz.style.display = 'block';
        document.getElementById('menu-luz-link').parentElement.classList.add('active');
        document.getElementById('page-title').textContent = 'Controle de Energia';
    } else if (section === 'internet') {
        if (internet) internet.style.display = 'block';
        document.getElementById('menu-internet-link').parentElement.classList.add('active');
        document.getElementById('page-title').textContent = 'Internet Social';
        renderInternetTable();
    } else if (section === 'users') {
        users.style.display = 'block';
        document.getElementById('menu-users-link').parentElement.classList.add('active');
        document.getElementById('page-title').textContent = 'Gestão de Usuários';
    }
}
function renderLuzTable() {
    const filterMonth = document.getElementById('luz-month-filter').value;
    const tbody = document.getElementById('luz-tbody');
    tbody.innerHTML = '';

    houses.forEach(house => {
        const invoice = calculateInvoice(house, filterMonth);
        
        // Tentar buscar kWh se gravado no record de pagamento
        let record = house.payments ? house.payments.find(p => p.month === filterMonth) : null;
        let kwhText = "---";
        if (record && record.energyKwh) {
            kwhText = record.energyKwh + " kWh";
        } else if (invoice.energy > 0) {
            // Se tem valor mas não gravou kWh no record (retroativo ou manual sem kwh), mostra só o valor
            kwhText = "(Manual)";
        }

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><strong>${house.number}</strong></td>
            <td>${house.tenant}</td>
            <td>${kwhText}</td>
            <td><strong>${formatCurrency(invoice.energy)}</strong></td>
            <td><span class="badge badge-${invoice.status}">${invoice.status}</span></td>
            <td>
                <button class="btn-icon" onclick="openEnergyModal('${house.id}', '${filterMonth}')" title="Editar Luz"><i class='bx bx-edit'></i></button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function openEnergyModal(id, month) {
    const house = houses.find(h => h.id === id);
    const invoice = calculateInvoice(house, month);
    
    document.getElementById('energy-house-id').value = id;
    document.getElementById('energy-month').value = month;
    document.getElementById('energy-house-number-display').textContent = `${house.number} - ${house.tenant}`;
    
    // Buscar se já tem kWh gravado
    let record = house.payments ? house.payments.find(p => p.month === month) : null;
    
    document.getElementById('energy-modal-kwh').value = record && record.energyKwh ? record.energyKwh : '';
    document.getElementById('energy-modal-price').value = record && record.energyPrice !== undefined ? record.energyPrice : 0.95;
    document.getElementById('energy-modal-tax').value = record && record.energyTax !== undefined ? record.energyTax : '0.00';
    document.getElementById('energy-modal-total-value').value = invoice.energy > 0 ? invoice.energy : '';
    
    document.getElementById('modal-energy').classList.add('active');
}

function handleEnergySubmit(e) {
    e.preventDefault();
    const id = document.getElementById('energy-house-id').value;
    const month = document.getElementById('energy-month').value;
    const kwh = parseFloat(document.getElementById('energy-modal-kwh').value) || 0;
    const price = parseFloat(document.getElementById('energy-modal-price').value) || 0.95;
    const tax = parseFloat(document.getElementById('energy-modal-tax').value) || 0;
    const totalEnergy = parseFloat(document.getElementById('energy-modal-total-value').value) || 0;
    
    const house = houses.find(h => h.id === id);
    if (!house.payments) house.payments = [];
    
    let record = house.payments.find(p => p.month === month);
    
    if (record) {
        record.energy = totalEnergy;
        record.energyKwh = kwh;
        record.energyPrice = price;
        record.energyTax = tax;
        // Se já estava pago, temos que atualizar o amountPaid total
        if (record.status === 'Pago') {
            // Recalcula o total baseado no aluguel base + multas ja gravadas + nova energia + internet
            const baseInvoice = calculateInvoice({...house, payments: house.payments.filter(p => p.month !== month)}, month);
            record.amountPaid = baseInvoice.baseValue + baseInvoice.penalty + baseInvoice.interest + totalEnergy + baseInvoice.internet;
        }
    } else {
        // Cria um record pendente só pra energia
        house.payments.push({
            month: month,
            status: 'Pendente',
            energy: totalEnergy,
            energyKwh: kwh,
            energyPrice: price,
            energyTax: tax,
            amountPaid: 0 // Ainda não pago
        });
    }
    
    document.getElementById('modal-energy').classList.remove('active');
    saveHousesToCloud();
    renderApp();
    renderLuzTable();
}

// ==========================
// INTERNET SOCIAL
// ==========================

function renderInternetTable() {
    const tbody = document.getElementById('internet-tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    houses.forEach(house => {
        const hasInternet = house.hasInternet || false;
        const internetVal = house.internetValue || 0;

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><strong>${house.number}</strong></td>
            <td>${house.tenant}</td>
            <td>
                <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                    <input type="checkbox" onchange="toggleInternet('${house.id}', this.checked)" ${hasInternet ? 'checked' : ''} style="width: 18px; height: 18px; cursor: pointer;">
                    <span>${hasInternet ? 'Sim' : 'Não'}</span>
                </label>
            </td>
            <td>
                <input type="number" step="0.01" value="${internetVal}" onchange="updateInternetValue('${house.id}', this.value)" style="padding: 8px; border-radius: 4px; border: 1px solid var(--border); background: var(--bg-main); color: var(--text-main); width: 100px;" ${!hasInternet ? 'disabled' : ''}>
            </td>
            <td>
                <span class="badge ${hasInternet ? 'badge-Pago' : 'badge-Pendente'}">${hasInternet ? 'Ativa' : 'Inativa'}</span>
            </td>
        `;
        tbody.appendChild(tr);
    });

    if (document.getElementById('internet-section').style.display === 'block') {
        renderInternetAnimation();
    }
}

function toggleInternet(houseId, isChecked) {
    const house = houses.find(h => h.id === houseId);
    if (house) {
        house.hasInternet = isChecked;
        if (isChecked && (!house.internetValue || house.internetValue === 0)) {
            house.internetValue = 50; // default initial value
        }
        saveHousesToCloud();
        renderApp();
        renderInternetTable();
        renderInternetAnimation();
    }
}

function updateInternetValue(houseId, val) {
    const house = houses.find(h => h.id === houseId);
    if (house) {
        house.internetValue = parseFloat(val) || 0;
        saveHousesToCloud();
        renderApp();
        // não precisa renderizar a tabela inteira, mas garante atualizar o estado.
    }
}

function renderInternetAnimation() {
    const topology = document.getElementById('internet-topology');
    const svgLines = document.getElementById('topology-lines');
    const nodesContainer = document.getElementById('topology-nodes');
    
    if (!topology || !svgLines || !nodesContainer || houses.length === 0) return;
    
    // Clear previous
    svgLines.innerHTML = '';
    // Keep only the tower
    nodesContainer.innerHTML = `
        <div class="topo-tower" id="topo-tower">
            <i class='bx bx-broadcast'></i>
        </div>
    `;
    
    const width = topology.clientWidth || 800; // fallback if hidden
    const height = topology.clientHeight || 350;
    const centerX = width / 2;
    const centerY = height / 2;
    
    // Calculate positions for houses in a circle/ellipse
    const radiusX = Math.min(width * 0.4, 300);
    const radiusY = Math.min(height * 0.35, 120);
    
    houses.forEach((house, index) => {
        const angle = (index / houses.length) * 2 * Math.PI - Math.PI / 2;
        const x = centerX + radiusX * Math.cos(angle);
        const y = centerY + radiusY * Math.sin(angle);
        
        // Add house node
        const node = document.createElement('div');
        node.className = `topo-house ${house.hasInternet ? 'active' : 'inactive'}`;
        node.style.left = `${x}px`;
        node.style.top = `${y}px`;
        node.innerHTML = `
            <i class='bx bx-home-alt'></i>
            <div class="topo-house-label">${house.number}</div>
        `;
        nodesContainer.appendChild(node);
        
        // Add SVG line
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', centerX);
        line.setAttribute('y1', centerY);
        line.setAttribute('x2', x);
        line.setAttribute('y2', y);
        line.setAttribute('class', house.hasInternet ? 'topo-line-active' : 'topo-line-inactive');
        svgLines.appendChild(line);
    });
}

// Window resize to redraw
window.addEventListener('resize', () => {
    if (document.getElementById('internet-section').style.display === 'block') {
        renderInternetAnimation();
    }
});

// ==========================
// TABELA E DASHBOARD
// ==========================

function renderTable() {
    const searchText = document.getElementById('search-input').value.toLowerCase();
    const statusFilter = document.getElementById('status-filter').value;
    const filterMonth = document.getElementById('month-filter').value;
    
    const housesGrid = document.getElementById('houses-grid');
    if (!housesGrid) return;
    
    housesGrid.innerHTML = '';
    housesGrid.className = ''; // Remove default grid
    
    const groups = {};
    
    houses.forEach(house => {
        if (searchText && !house.number.toLowerCase().includes(searchText) && !house.tenant.toLowerCase().includes(searchText)) {
            return;
        }
        
        const invoice = calculateInvoice(house, filterMonth);
        
        if (statusFilter !== 'all' && invoice.status !== statusFilter) {
            return;
        }
        
        const isLate = invoice.status === 'Atrasado';
        
        const card = document.createElement('div');
        card.className = `house-card status-${invoice.status}`;
        
        card.innerHTML = `
            <div class="house-card-header">
                <div class="house-card-icon">
                    <i class='bx bx-home-alt'></i>
                </div>
                <div class="house-card-title">
                    <h3>${house.number}</h3>
                    <span class="badge badge-${invoice.status}">${invoice.status}</span>
                </div>
            </div>
            
            <div class="house-card-body">
                <div class="hc-info-row">
                    <i class='bx bx-user'></i>
                    <div>
                        <strong>${house.tenant}</strong>
                        <small>${house.phone}</small>
                    </div>
                </div>
                <div class="hc-info-row">
                    <i class='bx bx-calendar'></i>
                    <div>
                        <strong class="${isLate ? 'text-danger' : ''}">${formatDate(invoice.dueDate)}</strong>
                        <small>Vencimento</small>
                    </div>
                </div>
                
                <div class="hc-finance">
                    <div class="hc-finance-item">
                        <small>Aluguel${invoice.energy > 0 ? ' + Luz' : ''}${invoice.internet > 0 ? ' + Net' : ''}</small>
                        <strong>${formatCurrency(invoice.baseValue)} ${invoice.energy > 0 ? `+ ${formatCurrency(invoice.energy)}` : ''} ${invoice.internet > 0 ? `+ ${formatCurrency(invoice.internet)}` : ''}</strong>
                    </div>
                    <div class="hc-finance-item total">
                        <small>Total Final</small>
                        <strong>${formatCurrency(invoice.total)}</strong>
                    </div>
                </div>
            </div>
            
            <div class="house-card-actions">
                <div class="hc-actions-left">
                    <button class="btn-icon" style="color: #25D366;" onclick="openShareModal('${house.id}', '${filterMonth}')" title="Enviar Whats"><i class='bx bxl-whatsapp'></i></button>
                    ${invoice.status !== 'Pago' ? 
                    `<button class="btn-icon pay" style="color: var(--success);" onclick="openPaymentModal('${house.id}', '${filterMonth}')" title="Registrar Pagamento"><i class='bx bx-dollar-circle'></i></button>` 
                    : `<button class="btn-icon text-warning" onclick="revertPayment('${house.id}', '${filterMonth}')" title="Cancelar Pagamento"><i class='bx bx-undo'></i></button>`}
                </div>
                <div class="hc-actions-right">
                    <button class="btn-icon" onclick="editHouse('${house.id}')" title="Editar"><i class='bx bx-edit' ></i></button>
                    <button class="btn-icon delete" onclick="deleteHouse('${house.id}')" title="Excluir"><i class='bx bx-trash' ></i></button>
                </div>
            </div>
        `;
        
        const baseAddress = house.address ? house.address.trim() : '';
        const baseCep = house.cep ? house.cep.trim() : '';
        let displayAddr = baseAddress ? `${baseAddress}${baseCep ? ' (CEP: '+baseCep+')' : ''}` : 'Endereço Não Informado';
        
        const normalizeStr = (str) => str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, ' ');
        const normalizedDisplayAddr = normalizeStr(displayAddr);
        
        let foundKey = Object.keys(groups).find(k => normalizeStr(k) === normalizedDisplayAddr);
        
        if (foundKey) {
            displayAddr = foundKey;
        }
        
        if (!groups[displayAddr]) groups[displayAddr] = [];
        groups[displayAddr].push(card);
    });
    
    for (const [address, cards] of Object.entries(groups)) {
        const groupContainer = document.createElement('div');
        groupContainer.className = 'address-group';
        
        const header = document.createElement('div');
        header.className = 'address-group-header';
        header.innerHTML = `<h3><i class='bx bx-map'></i> ${address}</h3>`;
        groupContainer.appendChild(header);
        
        const gridInner = document.createElement('div');
        gridInner.className = 'houses-grid-inner';
        cards.forEach(c => gridInner.appendChild(c));
        
        groupContainer.appendChild(gridInner);
        housesGrid.appendChild(groupContainer);
    }
}

function updateDashboard() {
    let totalReceber = 0;
    let totalRecebido = 0;
    let totalAtraso = 0;
    let lateAlertsHtml = "";
    
    const filterMonth = getCurrentMonthStr(); // Dashboard sempre baseia no mes atual e atrasos gerais
    
    houses.forEach(house => {
        const invoice = calculateInvoice(house, filterMonth);
        
        if (invoice.status === 'Pago') {
            totalRecebido += invoice.total;
        } else if (invoice.status === 'Atrasado') {
            totalAtraso += invoice.total;
            totalReceber += invoice.total;
            
            lateAlertsHtml += `
                <li>
                    <div class="late-info">
                        <strong class="text-danger">${house.number} - ${house.tenant}</strong>
                        <span>Venceu em: ${formatDate(invoice.dueDate)}</span>
                    </div>
                    <div class="late-amount text-danger">
                        ${formatCurrency(invoice.total)}
                    </div>
                </li>
            `;
        } else {
            totalReceber += invoice.total;
            
            // Faltam 3 dias ou menos pra vencer?
            const today = new Date();
            today.setHours(0,0,0,0);
            const diffTime = invoice.dueDate - today;
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            
            if (diffDays <= 3 && diffDays >= 0) {
                lateAlertsHtml += `
                <li>
                    <div class="late-info">
                        <strong class="text-warning">${house.number} - ${house.tenant}</strong>
                        <span>Vence em ${diffDays} dia(s)</span>
                    </div>
                    <div class="late-amount text-warning">
                        ${formatCurrency(invoice.total)}
                    </div>
                </li>
            `;
            }
        }
    });
    
    document.getElementById('val-receber').textContent = formatCurrency(totalReceber);
    document.getElementById('val-recebido').textContent = formatCurrency(totalRecebido);
    document.getElementById('val-atraso').textContent = formatCurrency(totalAtraso);
    
    const alertsList = document.getElementById('alerts-list');
    if (lateAlertsHtml === "") {
        alertsList.innerHTML = `<li style="justify-content:center; color:var(--text-muted);">Nenhum alerta pendente.</li>`;
    } else {
        alertsList.innerHTML = lateAlertsHtml;
    }
    
    renderChart();
}

function updateAddressDatalist() {
    const dataList = document.getElementById('address-suggestions');
    if (!dataList) return;
    dataList.innerHTML = '';
    
    const normalizeStr = (str) => str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, ' ');
    const seen = new Set();
    const uniqueAddresses = [];
    
    houses.forEach(h => {
        if (!h.address || h.address.trim() === '') return;
        const norm = normalizeStr(h.address);
        if (!seen.has(norm)) {
            seen.add(norm);
            uniqueAddresses.push(h.address.trim());
        }
    });
    
    uniqueAddresses.forEach(address => {
        const option = document.createElement('option');
        option.value = address;
        dataList.appendChild(option);
    });
}

// ==========================
// EVENTOS E MODAIS
// ==========================

function setupEventListeners() {
    document.getElementById('btn-new-house').addEventListener('click', () => {
        document.getElementById('form-house').reset();
        document.getElementById('house-id').value = '';
        document.getElementById('modal-house-title').textContent = "Cadastrar Imóvel";
        updateAddressDatalist();
        document.getElementById('modal-house').classList.add('active');
    });

    document.getElementById('house-address').addEventListener('change', (e) => {
        const address = e.target.value;
        if (!address) return;
        
        // Find if any house has this address and a CEP
        const existingHouse = houses.find(h => h.address === address && h.cep && h.cep.trim() !== '');
        if (existingHouse) {
            document.getElementById('house-cep').value = existingHouse.cep;
        }
    });

    document.getElementById('close-modal-house').addEventListener('click', () => {
        document.getElementById('modal-house').classList.remove('active');
    });
    
    document.getElementById('close-modal-payment').addEventListener('click', () => {
        document.getElementById('modal-payment').classList.remove('active');
    });
    
    document.getElementById('search-input').addEventListener('input', renderTable);
    document.getElementById('status-filter').addEventListener('change', renderTable);
    document.getElementById('month-filter').addEventListener('change', renderTable);

    formHouse.addEventListener('submit', handleHouseSubmit);
    formPayment.addEventListener('submit', handlePaymentSubmit);
    document.getElementById('form-energy-modal').addEventListener('submit', handleEnergySubmit);
    
    document.getElementById('close-modal-energy').addEventListener('click', () => {
        document.getElementById('modal-energy').classList.remove('active');
    });

    const updateEnergyModalTotal = () => {
        const kwh = parseFloat(document.getElementById('energy-modal-kwh').value) || 0;
        const price = parseFloat(document.getElementById('energy-modal-price').value) || 0;
        const tax = parseFloat(document.getElementById('energy-modal-tax').value) || 0;
        if (kwh > 0 || tax > 0) {
            document.getElementById('energy-modal-total-value').value = ((kwh * price) + tax).toFixed(2);
        } else {
            document.getElementById('energy-modal-total-value').value = '';
        }
    };
    
    document.getElementById('energy-modal-kwh').addEventListener('input', updateEnergyModalTotal);
    document.getElementById('energy-modal-price').addEventListener('input', updateEnergyModalTotal);
    document.getElementById('energy-modal-tax').addEventListener('input', updateEnergyModalTotal);
    
    // Menu links
    document.getElementById('menu-dashboard-link').addEventListener('click', (e) => { e.preventDefault(); switchSection('dashboard'); });
    document.getElementById('menu-houses-link').addEventListener('click', (e) => { e.preventDefault(); switchSection('imoveis'); }); 
    document.getElementById('menu-luz-link').addEventListener('click', (e) => { e.preventDefault(); switchSection('luz'); });
    document.getElementById('menu-internet-link').addEventListener('click', (e) => { e.preventDefault(); switchSection('internet'); });
    document.getElementById('menu-users-link').addEventListener('click', (e) => { e.preventDefault(); switchSection('users'); });
    document.getElementById('btn-logout').addEventListener('click', logout);

    document.getElementById('luz-month-filter').addEventListener('change', renderLuzTable);
    
    document.getElementById('close-modal-share').addEventListener('click', () => {
        document.getElementById('modal-share').classList.remove('active');
    });

    document.getElementById('btn-copy-pix').addEventListener('click', () => {
        const input = document.getElementById('pix-payload-input');
        input.select();
        document.execCommand('copy');
        alert('Código PIX copiado para a área de transferência!');
    });

    document.getElementById('btn-whatsapp-confirm').addEventListener('click', handleWhatsAppSend);
    document.getElementById('btn-generate-pdf').addEventListener('click', handleDownloadPDF);

    const calcUpdateEnergy = () => {
        const kwh = parseFloat(document.getElementById('energy-kwh').value) || 0;
        const price = parseFloat(document.getElementById('energy-price').value) || 0;
        const tax = parseFloat(document.getElementById('energy-tax').value) || 0;
        if (kwh > 0 || tax > 0) {
            const totalEnergyR$ = (kwh * price) + tax;
            document.getElementById('energy-value').value = totalEnergyR$.toFixed(2);
        } else {
            document.getElementById('energy-value').value = '';
        }
        updateFinalTotal();
    };

    const updateFinalTotal = () => {
        const hId = document.getElementById('pay-house-id').value;
        const month = document.getElementById('pay-month').value;
        const house = houses.find(h => h.id === hId);
        if (house) {
            const invoice = calculateInvoice(house, month);
            const valEnergia = parseFloat(document.getElementById('energy-value').value) || 0;
            const calcTotal = invoice.baseValue + invoice.penalty + invoice.interest + valEnergia;
            document.getElementById('pay-total-final').textContent = formatCurrency(calcTotal);
        }
    };

    document.getElementById('energy-kwh').addEventListener('input', calcUpdateEnergy);
    document.getElementById('energy-price').addEventListener('input', calcUpdateEnergy);
    document.getElementById('energy-tax').addEventListener('input', calcUpdateEnergy);
    document.getElementById('energy-value').addEventListener('input', updateFinalTotal);

    // Toggle Sidebar Mobile
    const btnToggle = document.getElementById('btn-toggle-sidebar');
    const sidebar = document.querySelector('.sidebar');
    const overlay = document.getElementById('sidebar-overlay');

    if (btnToggle && sidebar && overlay) {
        const toggleSidebar = () => {
            sidebar.classList.toggle('active');
            overlay.classList.toggle('active');
        };

        btnToggle.addEventListener('click', toggleSidebar);
        overlay.addEventListener('click', toggleSidebar);

        // Fechar ao clicar em links (importante no mobile)
        document.querySelectorAll('.nav-links li a').forEach(link => {
            link.addEventListener('click', () => {
                sidebar.classList.remove('active');
                overlay.classList.remove('active');
            });
        });
    }
}

function handleHouseSubmit(e) {
    e.preventDefault();
    const id = document.getElementById('house-id').value;
    const houseData = {
        number: document.getElementById('house-number').value,
        tenant: document.getElementById('tenant-name').value,
        phone: document.getElementById('tenant-phone').value,
        address: document.getElementById('house-address') ? document.getElementById('house-address').value.trim() : '',
        cep: document.getElementById('house-cep') ? document.getElementById('house-cep').value.trim() : '',
        dueDay: parseInt(document.getElementById('due-day').value),
        startDate: document.getElementById('start-date').value,
        rentValue: parseFloat(document.getElementById('rent-value').value),
        penaltyPct: document.getElementById('penalty-pct').value === "" ? 0 : parseFloat(document.getElementById('penalty-pct').value),
        interestPct: document.getElementById('interest-pct').value === "" ? 0 : parseFloat(document.getElementById('interest-pct').value),
        payments: []
    };

    if (id) {
        // Edit
        const idx = houses.findIndex(h => h.id === id);
        houseData.id = id;
        houseData.payments = houses[idx].payments || [];
        houses[idx] = houseData;
    } else {
        // New
        houseData.id = Date.now().toString();
        houses.push(houseData);
    }

    document.getElementById('modal-house').classList.remove('active');
    saveHousesToCloud();
    renderApp();
}

function deleteHouse(id) {
    if (confirm("Tem certeza que deseja excluir este imóvel e todo o seu histórico financeiro?")) {
        houses = houses.filter(h => h.id !== id);
        saveHousesToCloud();
        renderApp();
    }
}

function editHouse(id) {
    const house = houses.find(h => h.id === id);
    if (!house) return;
    
    document.getElementById('house-id').value = house.id;
    document.getElementById('house-number').value = house.number;
    document.getElementById('tenant-name').value = house.tenant;
    document.getElementById('tenant-phone').value = house.phone;
    if (document.getElementById('house-address')) document.getElementById('house-address').value = house.address || '';
    if (document.getElementById('house-cep')) document.getElementById('house-cep').value = house.cep || '';
    document.getElementById('due-day').value = house.dueDay;
    document.getElementById('start-date').value = house.startDate;
    document.getElementById('rent-value').value = house.rentValue;
    document.getElementById('penalty-pct').value = house.penaltyPct !== undefined && house.penaltyPct !== null && !isNaN(house.penaltyPct) ? house.penaltyPct : "2.00";
    document.getElementById('interest-pct').value = house.interestPct !== undefined && house.interestPct !== null && !isNaN(house.interestPct) ? house.interestPct : "0.33";
    
    document.getElementById('modal-house-title').textContent = "Editar Imóvel";
    updateAddressDatalist();
    document.getElementById('modal-house').classList.add('active');
}

window.openPaymentModal = function(id, month) {
    const house = houses.find(h => h.id === id);
    const invoice = calculateInvoice(house, month);
    
    document.getElementById('pay-house-id').value = house.id;
    document.getElementById('pay-month').value = month;
    
    document.getElementById('pay-house-number').textContent = house.number + ' - ' + house.tenant;
    const [y, m] = month.split('-');
    document.getElementById('pay-month-name').textContent = `${m}/${y}`;
    
    document.getElementById('pay-base').textContent = formatCurrency(invoice.baseValue);
    
    const feesRow = document.getElementById('pay-fees-row');
    if (invoice.penalty > 0 || invoice.interest > 0) {
        feesRow.style.display = 'flex';
        document.getElementById('pay-fees').textContent = formatCurrency(invoice.penalty + invoice.interest);
    } else {
        feesRow.style.display = 'none';
    }
    
    // Buscar se já tem record para carregar inputs de energia específicos
    let record = house.payments ? house.payments.find(p => p.month === month) : null;
    document.getElementById('energy-kwh').value = record && record.energyKwh ? record.energyKwh : '';
    document.getElementById('energy-price').value = record && record.energyPrice !== undefined ? record.energyPrice : 0.95;
    document.getElementById('energy-tax').value = record && record.energyTax !== undefined ? record.energyTax : '0.00';
    
    document.getElementById('energy-value').value = invoice.energy > 0 ? invoice.energy : '';
    document.getElementById('pay-total-final').textContent = formatCurrency(invoice.total);
    
    document.getElementById('modal-payment').classList.add('active');
}

function handlePaymentSubmit(e) {
    e.preventDefault();
    const id = document.getElementById('pay-house-id').value;
    const month = document.getElementById('pay-month').value;
    const energyVal = parseFloat(document.getElementById('energy-value').value) || 0;
    
    const house = houses.find(h => h.id === id);
    
    if (!house.payments) house.payments = [];
    
    // Calcula invoice mas substitui a energia informada
    const tempInvoice = calculateInvoice({
        ...house,
        payments: [] // Calcula fingindo q nao ta pago
    }, month);
    
    const amountPaid = tempInvoice.baseValue + tempInvoice.penalty + tempInvoice.interest + energyVal + tempInvoice.internet;
    
    // Remove if exist
    house.payments = house.payments.filter(p => p.month !== month);
    
    const kwhVal = parseFloat(document.getElementById('energy-kwh').value) || 0;
    const priceVal = parseFloat(document.getElementById('energy-price').value) || 0.95;
    const taxVal = parseFloat(document.getElementById('energy-tax').value) || 0;

    house.payments.push({
        month: month,
        status: 'Pago',
        energy: energyVal,
        energyKwh: kwhVal,
        energyPrice: priceVal,
        energyTax: taxVal,
        amountPaid: amountPaid,
        payDate: getTodayString()
    });
    
    document.getElementById('modal-payment').classList.remove('active');
    saveHousesToCloud();
    renderApp();
    if (document.getElementById('luz-section').style.display !== 'none') {
        renderLuzTable();
    }
}

window.revertPayment = function(id, month) {
    if(confirm("Deseja cancelar o recebimento dessa fatura? Ela voltará para pendente/atrasada.")){
        const house = houses.find(h => h.id === id);
        if (house && house.payments) {
            house.payments = house.payments.filter(p => p.month !== month);
            saveHousesToCloud();
            renderApp();
        }
    }
}

// ==========================
// UTILITÁRIOS
// ==========================

function updateDateDisplay() {
    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    const todayStr = new Date().toLocaleDateString('pt-BR', options);
    document.getElementById('current-date').textContent = todayStr.charAt(0).toUpperCase() + todayStr.slice(1);
}

function populateMonthFilter() {
    const select = document.getElementById('month-filter');
    const selectLuz = document.getElementById('luz-month-filter');
    const today = new Date();
    let currentY = today.getFullYear();
    let currentM = today.getMonth() + 1; // 1-12
    
    // Mostra os ultimos 2 meses, o atual, e o proximo.
    for (let i = -2; i <= 1; i++) {
        let d = new Date(currentY, currentM - 1 + i, 1);
        let valStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        let labelStr = d.toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' });
        labelStr = labelStr.charAt(0).toUpperCase() + labelStr.slice(1); // Maiuscula
        
        const option = document.createElement('option');
        option.value = valStr;
        option.textContent = labelStr;
        
        const optionLuz = option.cloneNode(true);

        if (i === 0) {
            option.selected = true;
            optionLuz.selected = true;
        }
        select.appendChild(option);
        selectLuz.appendChild(optionLuz);
    }
}

// ==========================
// WHATSAPP E PIX
// ==========================

// Função de CRC16 CCITT (0xFFFF) - Padronizada para PIX
function crc16(data) {
    let crc = 0xFFFF;
    const poly = 0x1021;
    for (let i = 0; i < data.length; i++) {
        let b = data.charCodeAt(i);
        crc ^= (b << 8);
        for (let j = 0; j < 8; j++) {
            if ((crc & 0x8000) !== 0) {
                crc = ((crc << 1) ^ poly);
            } else {
                crc <<= 1;
            }
        }
    }
    return (crc & 0xFFFF).toString(16).toUpperCase().padStart(4, '0');
}

function generatePixPayload(amount) {
    const key = "85221619091"; // CPF original
    const name = "HENRIQUE ROCHA CLAVIJO";
    const city = "PORTO ALEGRE";
    const desc = "***"; // TXID reservado para 'não informado' - Mais compatível

    // TLV Helper
    const tlv = (tag, value) => {
        const valStr = String(value);
        const len = valStr.length.toString().padStart(2, '0');
        return `${tag}${len}${valStr}`;
    };

    // Merchant Account Information (Tag 26)
    const merchantInfo = tlv("00", "br.gov.bcb.pix") + tlv("01", key);

    let payload = 
        tlv("00", "01") + 
        tlv("26", merchantInfo) + 
        tlv("52", "0000") + 
        tlv("53", "986") + 
        tlv("54", amount.toFixed(2)) + 
        tlv("58", "BR") + 
        tlv("59", name) + 
        tlv("60", city) + 
        tlv("62", tlv("05", desc)) + 
        "6304";

    return payload + crc16(payload);
}

window.openShareModal = function(id, month) {
    const house = houses.find(h => h.id === id);
    if (!house) return;
    const invoice = calculateInvoice(house, month);
    
    document.getElementById('share-tenant-name').textContent = house.tenant;
    const [y, m] = month.split('-');
    document.getElementById('share-month-label').textContent = `${m}/${y}`;
    
    const pixCode = generatePixPayload(invoice.total);
    document.getElementById('pix-payload-input').value = pixCode;
    
    // QR Code Image via API (ECC=M para melhor leitura)
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&ecc=M&margin=1&data=${encodeURIComponent(pixCode)}`;
    document.getElementById('pix-qrcode').src = qrUrl;
    
    // Guardar dados pro envio do Whats
    window.currentReportData = { 
        house, 
        invoice, 
        pixCode,
        monthStr: `${m}/${y}`
    };
    
    document.getElementById('modal-share').classList.add('active');
};

function handleWhatsAppSend() {
    const { house, invoice, pixCode, monthStr } = window.currentReportData;
    
    // Preparar mensagem de texto
    let message = `*RELATÓRIO DE ALUGUEL - ${monthStr}*\n\n`;
    message += `🏠 *Imóvel:* ${house.number}\n`;
    message += `👤 *Inquilino:* ${house.tenant}\n\n`;
    message += `💰 *Valor Base:* ${formatCurrency(invoice.baseValue)}\n`;
    
    if (invoice.energy > 0) {
        const baseEnergy = invoice.energy - invoice.energyTax;
        if (baseEnergy > 0) {
            if (invoice.energyKwh > 0 && invoice.energyPrice > 0) {
                message += `⚡ *Energia (${invoice.energyKwh} kWh):* ${formatCurrency(baseEnergy)}\n`;
            } else {
                message += `⚡ *Energia:* ${formatCurrency(baseEnergy)}\n`;
            }
        }
        if (invoice.energyTax > 0) {
            message += `💡 *Taxas Equatorial:* ${formatCurrency(invoice.energyTax)}\n`;
        }
    }
    
    if (invoice.penalty > 0) message += `⚠ *Multa:* ${formatCurrency(invoice.penalty)}\n`;
    if (invoice.interest > 0) message += `📈 *Juros Diários:* ${formatCurrency(invoice.interest)}\n`;
    if (invoice.internet > 0) message += `🌐 *Internet Social:* ${formatCurrency(invoice.internet)}\n`;
    message += `\n💵 *TOTAL A PAGAR:* *${formatCurrency(invoice.total)}*\n\n`;
    message += `🏦 *DADOS PARA PAGAMENTO (PIX):*\n`;
    message += `Fav: Henrique Rocha Clavijo\n`;
    message += `CPF: 852.216.190-91 (Banco Itaú)\n\n`;
    message += `*PIX COPIA E COLA:* \n\`${pixCode}\`\n\n`;
    message += `_Por favor, após o pagamento, envie o comprovante por aqui._`;

    const cleanPhone = house.phone.replace(/\D/g, '');
    const finalPhone = cleanPhone.length === 11 ? '55' + cleanPhone : cleanPhone;
    const waUrl = `https://wa.me/${finalPhone}?text=${encodeURIComponent(message)}`;

    // Tentar usar Web Share API se disponível (Móvel)
    if (navigator.share && navigator.canShare) {
        // Precisamos gerar o PDF primeiro para compartilhar o arquivo
        const template = document.getElementById('invoice-pdf-template');
        fillPdfTemplate(house, invoice, pixCode, monthStr);
        
        const element = template.cloneNode(true);
        element.style.display = 'block';
        element.style.position = 'static';

        const opt = {
            margin: 0,
            image: { type: 'jpeg', quality: 0.98 },
            html2canvas: { scale: 2, useCORS: true, letterRendering: true, scrollY: 0 },
            jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
        };

        // Gerar blob e compartilhar
        html2pdf().set(opt).from(element).outputPdf('blob').then(blob => {
            const file = new File([blob], `Fatura_${house.number}_${monthStr.replace(/\//g, '-')}.pdf`, { type: 'application/pdf' });
            
            if (navigator.canShare({ files: [file] })) {
                navigator.share({
                    files: [file],
                    title: `Fatura ${house.number}`,
                    text: message
                }).catch(() => {
                    // Fallback se o usuário cancelar ou der erro
                    window.open(waUrl, '_blank');
                });
            } else {
                window.open(waUrl, '_blank');
            }
        });
    } else {
        // Fallback padrão Desktop: Abre link do Whats e usuário anexa o PDF baixado
        window.open(waUrl, '_blank');
    }
}

function fillPdfTemplate(house, invoice, pixCode, monthStr) {
    document.getElementById('pdf-current-date').textContent = new Date().toLocaleDateString('pt-BR');
    document.getElementById('pdf-tenant-name').textContent = house.tenant;
    document.getElementById('pdf-house-number').textContent = house.number;
    document.getElementById('pdf-house-address').textContent = house.address || 'Endereço não cadastrado';
    document.getElementById('pdf-house-cep').textContent = house.cep || 'CEP não cadastrado';
    document.getElementById('pdf-month-ref').textContent = monthStr;
    document.getElementById('pdf-due-date').textContent = formatDate(invoice.dueDate);
    document.getElementById('pdf-total-value').textContent = formatCurrency(invoice.total);
    document.getElementById('pdf-pix-qrcode').src = document.getElementById('pix-qrcode').src;
    document.getElementById('pdf-pix-code').textContent = pixCode;

    // Gerar Hash de Autenticação Digital
    const timestamp = new Date().getTime();
    const hashStr = (house.id + house.tenant + monthStr + timestamp).replace(/\s/g, '').toUpperCase();
    let hash = 0;
    for (let i = 0; i < hashStr.length; i++) {
        hash = ((hash << 5) - hash) + hashStr.charCodeAt(i);
        hash = hash & hash; 
    }
    const finalHash = Math.abs(hash).toString(16).toUpperCase().padStart(8, '0') + '-' + timestamp.toString(36).toUpperCase();
    document.getElementById('pdf-auth-hash').textContent = finalHash;
    const now = new Date();
    document.getElementById('pdf-gen-time').textContent = `${now.toLocaleDateString('pt-BR')} às ${now.toLocaleTimeString('pt-BR')}`;

    const itemsList = document.getElementById('pdf-items-list');
    itemsList.innerHTML = `
        <tr>
            <td style="padding: 12px; border-bottom: 1px solid #f1f5f9; font-size: 14px;">Aluguel Mensal - Ref. ${monthStr}</td>
            <td style="padding: 12px; border-bottom: 1px solid #f1f5f9; text-align: right; font-size: 14px;">${formatCurrency(invoice.baseValue)}</td>
        </tr>
    `;

    if (invoice.energy > 0) {
        const baseEnergy = invoice.energy - invoice.energyTax;
        if (baseEnergy > 0) {
            let energyDesc = "Consumo de Energia (Luz)";
            if (invoice.energyKwh > 0 && invoice.energyPrice > 0) {
                energyDesc += ` - ${invoice.energyKwh} kWh`;
            }
            itemsList.innerHTML += `<tr><td style="padding: 12px; border-bottom: 1px solid #f1f5f9; font-size: 14px;">${energyDesc}</td><td style="padding: 12px; border-bottom: 1px solid #f1f5f9; text-align: right; font-size: 14px;">${formatCurrency(baseEnergy)}</td></tr>`;
        }
        if (invoice.energyTax > 0) {
            itemsList.innerHTML += `<tr><td style="padding: 12px; border-bottom: 1px solid #f1f5f9; font-size: 14px;">Taxas Equatorial (Luz)</td><td style="padding: 12px; border-bottom: 1px solid #f1f5f9; text-align: right; font-size: 14px;">${formatCurrency(invoice.energyTax)}</td></tr>`;
        }
    } else {
        // Luz ainda não lançada — exibe linha indicando que está pendente
        itemsList.innerHTML += `<tr><td style="padding: 12px; border-bottom: 1px solid #f1f5f9; font-size: 14px; color: #94a3b8;">Energia Elétrica (Luz)</td><td style="padding: 12px; border-bottom: 1px solid #f1f5f9; text-align: right; font-size: 14px; color: #94a3b8; font-style: italic;">A lançar</td></tr>`;
    }
    if (invoice.penalty > 0) {
        itemsList.innerHTML += `<tr><td style="padding: 12px; border-bottom: 1px solid #f1f5f9; font-size: 14px; color: #ef4444;">Multa por Atraso</td><td style="padding: 12px; border-bottom: 1px solid #f1f5f9; text-align: right; font-size: 14px; color: #ef4444;">${formatCurrency(invoice.penalty)}</td></tr>`;
    }
    if (invoice.interest > 0) {
        itemsList.innerHTML += `<tr><td style="padding: 12px; border-bottom: 1px solid #f1f5f9; font-size: 14px; color: #ef4444;">Juros Diários</td><td style="padding: 12px; border-bottom: 1px solid #f1f5f9; text-align: right; font-size: 14px; color: #ef4444;">${formatCurrency(invoice.interest)}</td></tr>`;
    }
    if (invoice.internet > 0) {
        itemsList.innerHTML += `<tr><td style="padding: 12px; border-bottom: 1px solid #f1f5f9; font-size: 14px;">Internet Social</td><td style="padding: 12px; border-bottom: 1px solid #f1f5f9; text-align: right; font-size: 14px;">${formatCurrency(invoice.internet)}</td></tr>`;
    }
}

function handleDownloadPDF() {
    const { house, invoice, pixCode, monthStr } = window.currentReportData;
    const template = document.getElementById('invoice-pdf-template');
    
    fillPdfTemplate(house, invoice, pixCode, monthStr);

    const element = template.cloneNode(true);
    element.style.display = 'block';
    element.style.position = 'static';

    const opt = {
        margin:       0,
        filename:     `Fatura_${house.number.replace(/\s+/g, '_')}_${monthStr.replace(/\//g, '-')}.pdf`,
        image:        { type: 'jpeg', quality: 0.98 },
        html2canvas:  { scale: 2, useCORS: true, letterRendering: true, scrollY: 0 },
        jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' }
    };

    html2pdf().set(opt).from(element).save().then(() => {
        alert('Fatura PDF gerada e baixada!');
    });
}

// ==========================
// GRÁFICOS (CHART.JS)
// ==========================
function renderChart() {
    const ctx = document.getElementById('revenueChart').getContext('2d');
    
    // Pegar ultimos 6 meses
    const labels = [];
    const dataPaid = [];
    
    const today = new Date();
    for (let i = 5; i >= 0; i--) {
        let d = new Date(today.getFullYear(), today.getMonth() - i, 1);
        let monthStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        labels.push(d.toLocaleDateString('pt-BR', { month: 'short' }));
        
        let sum = 0;
        houses.forEach(h => {
            if (h.payments) {
                const isPaid = h.payments.find(p => p.month === monthStr && p.status === 'Pago');
                if (isPaid) {
                    sum += isPaid.amountPaid;
                }
            }
        });
        dataPaid.push(sum);
    }

    if (chartInstance) {
        chartInstance.destroy();
    }

    chartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Faturamento Recebido (R$)',
                data: dataPaid,
                backgroundColor: 'rgba(16, 185, 129, 0.8)', // Success green
                borderRadius: 6,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    beginAtZero: true,
                    grid: { color: 'rgba(255, 255, 255, 0.05)' },
                    ticks: { color: '#94A3B8' }
                },
                x: {
                    grid: { display: false },
                    ticks: { color: '#94A3B8' }
                }
            },
            plugins: {
                legend: { display: false }
            }
        }
    });
}
// ==========================
// GESTÃO DE USUÁRIOS
// ==========================
function renderUserTable() {
    const tbody = document.getElementById('users-tbody');
    if (!tbody) return;
    
    tbody.innerHTML = '';
    systemUsers.forEach(user => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><strong>${user.name}</strong></td>
            <td>${user.username}</td>
            <td class="actions">
                <button class="btn-icon" onclick="editUser('${user.id}')" title="Editar / Mudar Senha"><i class='bx bx-edit'></i></button>
                ${user.id !== 'admin_root' ? 
                   `<button class="btn-icon delete" onclick="deleteUser('${user.id}')" title="Excluir"><i class='bx bx-trash'></i></button>` 
                   : ``}
            </td>
        `;
        tbody.appendChild(tr);
    });
}

window.openUserModal = function(id = '') {
    if (id) {
        const user = systemUsers.find(u => u.id === id);
        if (user) {
            document.getElementById('user-id').value = user.id;
            document.getElementById('user-name').value = user.name;
            document.getElementById('user-login').value = user.username;
            document.getElementById('user-password').value = user.password;
            document.getElementById('modal-user-title').textContent = "Editar Usuário";
        }
    } else {
        document.getElementById('form-user').reset();
        document.getElementById('user-id').value = '';
        document.getElementById('modal-user-title').textContent = "Novo Usuário";
    }
    document.getElementById('modal-user').classList.add('active');
};

document.getElementById('close-modal-user').addEventListener('click', () => {
    document.getElementById('modal-user').classList.remove('active');
});

document.getElementById('form-user').addEventListener('submit', (e) => {
    e.preventDefault();
    const id = document.getElementById('user-id').value;
    const userData = {
        name: document.getElementById('user-name').value,
        username: document.getElementById('user-login').value,
        password: document.getElementById('user-password').value
    };
    
    if (id) {
        // Editar usuário existente
        const idx = systemUsers.findIndex(u => u.id === id);
        if (idx !== -1) {
            systemUsers[idx] = { ...systemUsers[idx], ...userData };
            alert('Dados do usuário atualizados com sucesso!');
        }
    } else {
        // Novo Usuário
        userData.id = 'user_' + Date.now();
        systemUsers.push(userData);
        alert('Usuário cadastrado com sucesso!');
    }
    
    saveUsersToCloud();
    
    renderUserTable();
    document.getElementById('modal-user').classList.remove('active');
    document.getElementById('form-user').reset();
});

window.editUser = function(id) {
    openUserModal(id);
};

window.deleteUser = function(id) {
    if (confirm('Deseja realmente excluir este acesso?')) {
        systemUsers = systemUsers.filter(u => u.id !== id);
        saveUsersToCloud();
        renderUserTable();
    }
};
