// ==================== 1. SUPABASE ====================
// Même projet Supabase que la pharmacie — les tables sont toutes préfixées "mat_"
// donc aucun risque de conflit avec les tables de l'autre app.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

const supabaseUrl = 'https://szuwsflyfsopdojirpkl.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN6dXdzZmx5ZnNvcGRvamlycGtsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA0OTQwNzYsImV4cCI6MjA5NjA3MDA3Nn0.CZ0MW9gkluYav4HCiG4PSXAQOdHE70Y6SKtTU5Y6EOE';

const supabase = createClient(supabaseUrl, supabaseKey);

// ==================== 2. ETAT GLOBAL (STATE) ====================
let state = {
    currentUser: null,
    userProfile: null,
    profiles: [],
    equipmentModels: [],
    equipmentUnits: [],
    clients: [],
    sales: [],
    rentals: [],
    maintenanceTickets: [],
    saleCart: [] // unités sélectionnées pour la vente en cours : [{unitId, modelName, serial, price}]
};

// NB: `state` n'est jamais référencé directement depuis le HTML (pas d'oninput/onclick
// inline touchant `state`) — toute interaction passe par des fonctions exposées
// explicitement sur `window` en bas du fichier, avec des event listeners attachés en JS.

// ==================== 3. AUTHENTIFICATION ====================
supabase.auth.onAuthStateChange((event, session) => {
    if (session) {
        state.currentUser = session.user;
        unlockApplication();
    } else {
        state.currentUser = null;
        lockApplication();
    }
});

function lockApplication() {
    document.getElementById('main-app').style.display = 'none';
    document.getElementById('login-screen').style.display = 'flex';
    document.getElementById('app-body').classList.add('overflow-hidden');
}

async function unlockApplication() {
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('main-app').style.display = 'flex';
    document.getElementById('app-body').classList.remove('overflow-hidden');
    await loadDatabase();
}

async function handleLogin(e) {
    if (e) e.preventDefault();
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;
    const btn = document.getElementById('login-btn');

    btn.innerHTML = 'Connexion...';
    btn.disabled = true;

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
        showToast("Identifiants incorrects", "error");
        btn.innerHTML = 'Déverrouiller le système';
        btn.disabled = false;
    }
}

async function handleLogout() {
    await supabase.auth.signOut();
}

// ==================== 4. SECURITE / UTILITAIRES D'AFFICHAGE ====================
function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

const fmtMoney = n => new Intl.NumberFormat('fr-FR').format(n || 0) + ' FCFA';
const fmtDate = d => new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
const genId = prefix => prefix + Date.now().toString(36).toUpperCase() + Math.floor(100 + Math.random() * 900);

function showToast(msg, type = 'success') {
    const t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.className = `fixed bottom-6 right-6 z-[200] transform transition-all duration-300 translate-y-0 opacity-100 px-5 py-3 rounded-xl shadow-2xl font-bold text-sm ${type === 'error' ? 'bg-red-600 text-white' : 'bg-slate-900 text-white'}`;
    setTimeout(() => { t.classList.replace('translate-y-0', 'translate-y-20'); t.classList.replace('opacity-100', 'opacity-0'); }, 3000);
}

// ==================== 5. BASE DE DONNÉES ====================
async function loadDatabase() {
    try {
        // Filet de sécurité : marque les locations en retard, même si pg_cron
        // n'est pas actif sur ce projet Supabase (voir migration SQL).
        await supabase.rpc('mat_flag_overdue_rentals');

        const { data: profData, error: profErr } = await supabase.from('mat_profiles').select('*');
        if (profErr) throw profErr;
        state.profiles = profData || [];

        if (state.currentUser) {
            state.userProfile = state.profiles.find(p => p.id === state.currentUser.id);
            let displayName = state.userProfile?.full_name || state.currentUser.email.split('@')[0];
            document.getElementById('user-name').textContent = displayName;
            document.getElementById('user-avatar').textContent = displayName.charAt(0).toUpperCase();
            document.getElementById('user-role').textContent = state.userProfile?.role || 'Personnel';

            if (!state.userProfile) {
                showToast("⚠️ Aucun profil mat_profiles associé à ce compte. Contacte l'admin.", "error");
            }
        }

        const [modelsReq, unitsReq, clientsReq, salesReq, rentalsReq, ticketsReq] = await Promise.all([
            supabase.from('mat_equipment_models').select('*'),
            supabase.from('mat_equipment_units').select('*'),
            supabase.from('mat_clients').select('*'),
            supabase.from('mat_sales').select('*').order('created_at', { ascending: false }),
            supabase.from('mat_rentals').select('*').order('created_at', { ascending: false }),
            supabase.from('mat_maintenance_tickets').select('*').order('opened_at', { ascending: false })
        ]);

        if (modelsReq.error) throw modelsReq.error;
        if (unitsReq.error) throw unitsReq.error;
        if (clientsReq.error) throw clientsReq.error;
        if (salesReq.error) throw salesReq.error;
        if (rentalsReq.error) throw rentalsReq.error;
        if (ticketsReq.error) throw ticketsReq.error;

        state.equipmentModels = modelsReq.data || [];
        state.equipmentUnits = unitsReq.data || [];
        state.clients = clientsReq.data || [];
        state.sales = salesReq.data || [];
        state.rentals = rentalsReq.data || [];
        state.maintenanceTickets = ticketsReq.data || [];

        renderDashboard();
        if (!document.getElementById('page-catalogue').classList.contains('hidden')) renderCatalogue();
        if (!document.getElementById('page-parc').classList.contains('hidden')) renderParc();
        if (!document.getElementById('page-ventes').classList.contains('hidden')) renderVentes();
        if (!document.getElementById('page-locations').classList.contains('hidden')) renderLocations();
        if (!document.getElementById('page-sav').classList.contains('hidden')) renderSav();

    } catch (err) {
        showToast("Erreur de synchronisation: " + (err.message || ''), "error");
    }
}

// ==================== 6. ROUTAGE ====================
function navigate(page) {
    document.querySelectorAll('.page').forEach(p => { p.classList.add('hidden'); p.classList.remove('block'); });
    document.querySelectorAll('.nav-item').forEach(a => a.classList.remove('active'));
    const targetPage = document.getElementById('page-' + page);
    if (targetPage) { targetPage.classList.remove('hidden'); targetPage.classList.add('block'); }
    const targetNav = document.getElementById('nav-' + page);
    if (targetNav) targetNav.classList.add('active');

    if (window.innerWidth <= 1024 && !document.getElementById('sidebar').classList.contains('-translate-x-full')) toggleSidebar();

    if (page === 'dashboard') renderDashboard();
    if (page === 'catalogue') renderCatalogue();
    if (page === 'parc') renderParc();
    if (page === 'ventes') renderVentes();
    if (page === 'locations') renderLocations();
    if (page === 'sav') renderSav();
    // La page crm sera branchée à la prochaine étape.
}

function toggleSidebar() {
    const sb = document.getElementById('sidebar');
    const ov = document.getElementById('mob-overlay');
    sb.classList.toggle('-translate-x-full');
    ov.classList.toggle('hidden');
}

function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

// ==================== 7. CATALOGUE ====================
function renderCatalogue() {
    const query = (document.getElementById('search-catalogue')?.value || '').toLowerCase();
    const grid = document.getElementById('catalogue-grid');
    if (!grid) return;

    const matched = state.equipmentModels.filter(m => m.name.toLowerCase().includes(query) || (m.brand || '').toLowerCase().includes(query));

    if (!matched.length) {
        grid.innerHTML = `<p class="text-sm text-gray-400 col-span-full text-center py-8">Aucun modèle enregistré</p>`;
        return;
    }

    grid.innerHTML = matched.map(m => {
        const units = state.equipmentUnits.filter(u => u.model_id === m.id);
        const enStock = units.filter(u => u.status === 'en_stock').length;
        const total = units.length;
        return `
        <div class="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
            <div class="h-36 bg-gray-100 flex items-center justify-center">
                ${m.photo_url
                    ? `<img src="${escapeHtml(m.photo_url)}" class="w-full h-full object-cover" alt="${escapeHtml(m.name)}">`
                    : `<svg class="w-10 h-10 text-gray-300" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 19.5A2.5 2.5 0 016.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/></svg>`}
            </div>
            <div class="p-4">
                <p class="text-xs font-bold text-medical-600 uppercase tracking-wide">${escapeHtml(m.category || 'Général')}</p>
                <h4 class="font-display font-bold text-gray-900 mt-1">${escapeHtml(m.name)}</h4>
                <p class="text-xs text-gray-500">${escapeHtml(m.brand || '—')}</p>
                <div class="flex justify-between items-center mt-3 text-sm">
                    <span class="font-bold text-gray-900">${fmtMoney(m.sale_price)}</span>
                    <span class="text-xs text-gray-500">${m.rental_price_day ? fmtMoney(m.rental_price_day) + '/j' : ''}</span>
                </div>
                <div class="flex justify-between items-center mt-2 text-xs font-semibold">
                    <span class="text-emerald-600">${enStock} en stock</span>
                    <span class="text-gray-400">${total} unité(s) au total</span>
                </div>
            </div>
        </div>`;
    }).join('');
}

async function addEquipmentModel() {
    const name = document.getElementById('nm-name').value.trim();
    const brand = document.getElementById('nm-brand').value.trim();
    const category = document.getElementById('nm-category').value.trim() || 'Général';
    const salePrice = parseFloat(document.getElementById('nm-sale-price').value);
    const rentalPrice = parseFloat(document.getElementById('nm-rental-price').value) || 0;
    const warrantyMonths = parseInt(document.getElementById('nm-warranty').value) || 12;
    const description = document.getElementById('nm-description').value.trim();
    const photoFile = document.getElementById('nm-photo').files[0];

    if (!name || isNaN(salePrice)) return showToast("Nom et prix de vente obligatoires", "error");

    const btn = document.getElementById('btn-save-model');
    btn.disabled = true; btn.textContent = 'Sauvegarde...';

    try {
        let photoUrl = null;
        if (photoFile) {
            const path = `models/${Date.now()}_${photoFile.name.replace(/[^a-zA-Z0-9.\-_]/g, '_')}`;
            const { error: uploadErr } = await supabase.storage.from('mat-equipment-photos').upload(path, photoFile);
            if (uploadErr) throw uploadErr;
            const { data: urlData } = supabase.storage.from('mat-equipment-photos').getPublicUrl(path);
            photoUrl = urlData.publicUrl;
        }

        const { error } = await supabase.from('mat_equipment_models').insert([{
            name, brand, category, description,
            sale_price: salePrice, rental_price_day: rentalPrice,
            warranty_months: warrantyMonths, photo_url: photoUrl
        }]);
        if (error) throw error;

        closeModal('modal-add-model');
        showToast("✅ Modèle créé");
        document.getElementById('nm-name').value = '';
        document.getElementById('nm-brand').value = '';
        document.getElementById('nm-category').value = '';
        document.getElementById('nm-sale-price').value = '';
        document.getElementById('nm-rental-price').value = '';
        document.getElementById('nm-warranty').value = '12';
        document.getElementById('nm-description').value = '';
        document.getElementById('nm-photo').value = '';
        await loadDatabase();
    } catch (err) {
        showToast("Erreur création modèle: " + (err.message || ''), "error");
    } finally {
        btn.disabled = false; btn.textContent = 'Sauvegarder';
    }
}

// ==================== 8. PARC MATÉRIEL ====================
const statusLabelsFr = {
    en_stock: 'En stock', loue: 'En location', vendu: 'Vendu',
    en_maintenance: 'En maintenance', hors_service: 'Hors service', reserve: 'Réservé'
};
const statusBadgeClasses = {
    en_stock: 'bg-emerald-100 text-emerald-700', loue: 'bg-blue-100 text-blue-700', vendu: 'bg-slate-100 text-slate-600',
    en_maintenance: 'bg-amber-100 text-amber-700', hors_service: 'bg-red-100 text-red-700', reserve: 'bg-purple-100 text-purple-700'
};

function populateModelSelect(selectId) {
    const sel = document.getElementById(selectId);
    if (!sel) return;
    sel.innerHTML = state.equipmentModels.map(m => `<option value="${m.id}">${escapeHtml(m.name)} ${m.brand ? '— ' + escapeHtml(m.brand) : ''}</option>`).join('');
}

function renderParc() {
    const query = (document.getElementById('search-parc')?.value || '').toLowerCase();
    const statusFilter = document.getElementById('filter-parc-status')?.value || '';
    const body = document.getElementById('parc-body');
    if (!body) return;

    let matched = state.equipmentUnits.map(u => ({ ...u, model: state.equipmentModels.find(m => m.id === u.model_id) }));

    if (query) matched = matched.filter(u => u.serial_number.toLowerCase().includes(query) || (u.model?.name || '').toLowerCase().includes(query));
    if (statusFilter) matched = matched.filter(u => u.status === statusFilter);

    if (!matched.length) {
        body.innerHTML = `<tr><td colspan="7" class="px-6 py-8 text-center text-gray-400">Aucun équipement trouvé</td></tr>`;
        return;
    }

    body.innerHTML = matched.map(u => `
        <tr class="hover:bg-gray-50/50">
            <td class="px-6 py-3 font-bold">${escapeHtml(u.model?.name || 'Modèle supprimé')}</td>
            <td class="px-6 py-3 font-mono text-xs">${escapeHtml(u.serial_number)}</td>
            <td class="px-6 py-3 capitalize">${escapeHtml(u.condition)}</td>
            <td class="px-6 py-3"><span class="px-2 py-0.5 rounded text-xs font-bold ${statusBadgeClasses[u.status] || 'bg-gray-100 text-gray-600'}">${statusLabelsFr[u.status] || u.status}</span></td>
            <td class="px-6 py-3 capitalize">${escapeHtml(u.location)}</td>
            <td class="px-6 py-3 text-xs">${u.warranty_end_date ? fmtDate(u.warranty_end_date) : '—'}</td>
            <td class="px-6 py-3 text-right">
                ${u.status === 'en_stock' ? `<button data-id="${u.id}" data-loc="${u.location}" data-name="${escapeHtml(u.model?.name || '')} — ${escapeHtml(u.serial_number)}" class="btn-transfer-unit text-blue-600 font-bold text-xs cursor-pointer hover:underline">Transférer</button>` : ''}
            </td>
        </tr>
    `).join('');

    body.querySelectorAll('.btn-transfer-unit').forEach(btn => {
        btn.onclick = () => openTransferUnitModal(btn.dataset.id, btn.dataset.loc, btn.dataset.name);
    });
}

function openReceiveModal() {
    if (!state.equipmentModels.length) return showToast("Crée d'abord un modèle dans le Catalogue", "error");
    populateModelSelect('ru-model');
    document.getElementById('ru-serial').value = '';
    document.getElementById('ru-purchase-price').value = '';
    document.getElementById('ru-purchase-date').value = new Date().toISOString().split('T')[0];
    openModal('modal-receive-unit');
}

async function receiveEquipmentUnit() {
    const modelId = document.getElementById('ru-model').value;
    const serial = document.getElementById('ru-serial').value.trim();
    const condition = document.getElementById('ru-condition').value;
    const purchasePrice = parseFloat(document.getElementById('ru-purchase-price').value) || null;
    const purchaseDate = document.getElementById('ru-purchase-date').value || new Date().toISOString().split('T')[0];

    if (!modelId || !serial) return showToast("Modèle et numéro de série obligatoires", "error");

    const btn = document.getElementById('btn-receive-unit');
    btn.disabled = true; btn.textContent = 'Réception...';

    const { error } = await supabase.rpc('mat_receive_equipment_unit', {
        p_model_id: modelId,
        p_serial_number: serial,
        p_condition: condition,
        p_purchase_price: purchasePrice,
        p_purchase_date: purchaseDate,
        p_user_id: state.currentUser.id
    });

    btn.disabled = false; btn.textContent = 'Réceptionner';

    if (error) return showToast("Erreur: " + (error.message.includes('unique') ? "Ce numéro de série existe déjà" : error.message), "error");

    closeModal('modal-receive-unit');
    showToast("✅ Équipement réceptionné");
    await loadDatabase();
    renderParc();
}

let transferUnitId = null;

function openTransferUnitModal(unitId, currentLocation, label) {
    transferUnitId = unitId;
    document.getElementById('transfer-unit-label').textContent = label;
    document.getElementById('transfer-new-location').value = currentLocation === 'entrepot' ? 'showroom' : 'entrepot';
    openModal('modal-transfer-unit');
}

async function executeTransferUnit() {
    const newLocation = document.getElementById('transfer-new-location').value;
    const { error } = await supabase.rpc('mat_transfer_unit_location', {
        p_unit_id: transferUnitId, p_new_location: newLocation, p_user_id: state.currentUser.id
    });
    if (error) return showToast("Erreur transfert: " + error.message, "error");

    closeModal('modal-transfer-unit');
    showToast("✅ Transféré");
    await loadDatabase();
    renderParc();
}

// ==================== 9. VENTES ====================
function renderVentes() {
    const clientSelect = document.getElementById('vente-client');
    clientSelect.innerHTML = '<option value="">— Client Comptant —</option>' + state.clients.map(c => `<option value="${c.id}">${escapeHtml(c.name)}${c.client_type === 'clinique' ? ' 🏥' : ''}</option>`).join('');

    renderVenteUnits();
    updateSaleCartUI();
}

function renderVenteUnits() {
    const query = (document.getElementById('search-vente-units')?.value || '').toLowerCase();
    const grid = document.getElementById('vente-units-grid');
    if (!grid) return;

    let available = state.equipmentUnits
        .filter(u => u.status === 'en_stock')
        .filter(u => !state.saleCart.some(c => c.unitId === u.id)) // déjà dans le panier
        .map(u => ({ ...u, model: state.equipmentModels.find(m => m.id === u.model_id) }));

    if (query) available = available.filter(u => u.serial_number.toLowerCase().includes(query) || (u.model?.name || '').toLowerCase().includes(query));

    if (!available.length) {
        grid.innerHTML = `<p class="text-sm text-gray-400 col-span-full text-center py-8">Aucune unité disponible</p>`;
        return;
    }

    grid.innerHTML = available.map(u => `
        <div data-id="${u.id}" class="unit-card bg-white border rounded-xl p-4 cursor-pointer hover:border-blue-400 select-none shadow-sm">
            <div class="font-bold text-sm truncate">${escapeHtml(u.model?.name || 'Modèle supprimé')}</div>
            <div class="text-xs text-gray-500 font-mono mt-1">${escapeHtml(u.serial_number)}</div>
            <div class="flex justify-between mt-2 items-center"><span class="font-bold text-sm text-medical-600">${fmtMoney(u.model?.sale_price)}</span><span class="text-xs font-semibold text-gray-400 capitalize">${escapeHtml(u.condition)}</span></div>
        </div>
    `).join('');
    grid.querySelectorAll('.unit-card').forEach(card => card.onclick = () => addToSaleCart(card.dataset.id));
}

function addToSaleCart(unitId) {
    const unit = state.equipmentUnits.find(u => u.id === unitId);
    const model = state.equipmentModels.find(m => m.id === unit.model_id);
    state.saleCart.push({ unitId, modelName: model?.name || 'Modèle supprimé', serial: unit.serial_number, price: model?.sale_price || 0 });
    renderVenteUnits();
    updateSaleCartUI();
}

function removeFromSaleCart(unitId) {
    state.saleCart = state.saleCart.filter(c => c.unitId !== unitId);
    renderVenteUnits();
    updateSaleCartUI();
}

function clearSaleCart() {
    state.saleCart = [];
    renderVenteUnits();
    updateSaleCartUI();
}

function updateSaleCartUI() {
    const total = state.saleCart.reduce((s, i) => s + Number(i.price), 0);
    const cartEl = document.getElementById('vente-cart-items');
    cartEl.innerHTML = state.saleCart.map(c => `
        <div class="flex justify-between items-center bg-white border p-3 rounded-xl shadow-sm text-sm">
            <div class="flex-1 truncate mr-2">
                <div class="font-bold truncate">${escapeHtml(c.modelName)}</div>
                <div class="text-xs text-gray-400 font-mono">${escapeHtml(c.serial)}</div>
            </div>
            <button data-id="${c.unitId}" class="btn-remove-sale-cart text-red-500 font-bold text-xl cursor-pointer hover:text-red-700 px-1">×</button>
        </div>
    `).join('');
    cartEl.querySelectorAll('.btn-remove-sale-cart').forEach(btn => btn.onclick = () => removeFromSaleCart(btn.dataset.id));
    document.getElementById('vente-cart-total').textContent = fmtMoney(total);
}

async function validateEquipmentSale() {
    if (!navigator.onLine) return showToast("⚠️ Impossible d'encaisser hors ligne", "error");
    if (!state.saleCart.length) return showToast("Le panier est vide", "error");

    const clientId = document.getElementById('vente-client').value || null;
    const mode = document.getElementById('vente-payment-mode').value;
    const status = mode === 'credit' ? 'credit' : 'paye';
    const total = state.saleCart.reduce((s, i) => s + Number(i.price), 0);

    if (status === 'credit' && !clientId) return showToast("Sélectionne un client pour une vente à crédit", "error");

    const saleId = genId('VNT-');
    const btn = document.querySelector('[data-action="validate-sale"]');
    if (btn) btn.disabled = true;

    try {
        const { error } = await supabase.rpc('mat_process_sale', {
            p_sale_id: saleId,
            p_unit_ids: state.saleCart.map(c => c.unitId),
            p_total: total,
            p_mode: mode,
            p_status: status,
            p_client_id: clientId,
            p_user_id: state.currentUser.id
        });
        if (error) throw error;

        const cartSnapshot = [...state.saleCart];
        clearSaleCart();
        showToast("✅ Vente enregistrée");
        await loadDatabase();
        renderVentes();
        if (confirm('Imprimer la facture ?')) printEquipmentInvoice(saleId, cartSnapshot, total, mode, clientId);
    } catch (err) {
        showToast("Vente refusée: " + (err.message || ''), "error");
    } finally {
        if (btn) btn.disabled = false;
    }
}

function toggleClientTypeFields() {
    const isClinique = document.getElementById('nc-type').value === 'clinique';
    document.getElementById('nc-clinique-fields').classList.toggle('hidden', !isClinique);
}

async function addMatClient() {
    const clientType = document.getElementById('nc-type').value;
    const name = document.getElementById('nc-name').value.trim();
    const company = document.getElementById('nc-company').value.trim();
    const taxId = document.getElementById('nc-taxid').value.trim();
    const phone = document.getElementById('nc-phone').value.trim();
    const email = document.getElementById('nc-email').value.trim();
    const address = document.getElementById('nc-address').value.trim();

    if (!name || !phone) return showToast("Nom et téléphone obligatoires", "error");

    const btn = document.getElementById('btn-save-client');
    btn.disabled = true; btn.textContent = 'Création...';

    const { error } = await supabase.from('mat_clients').insert([{
        name, client_type: clientType, company_name: company || null, tax_id: taxId || null,
        phone, email: email || null, address: address || null
    }]);

    btn.disabled = false; btn.textContent = 'Créer';

    if (error) return showToast("Erreur création client: " + error.message, "error");

    closeModal('modal-add-client');
    showToast("✅ Client créé");
    document.getElementById('nc-name').value = '';
    document.getElementById('nc-company').value = '';
    document.getElementById('nc-taxid').value = '';
    document.getElementById('nc-phone').value = '';
    document.getElementById('nc-email').value = '';
    document.getElementById('nc-address').value = '';
    await loadDatabase();
    renderVentes();
}

function printEquipmentInvoice(saleId, items, total, mode, clientId) {
    const client = state.clients.find(c => c.id === clientId);
    const clientName = client ? (client.company_name || client.name) : 'Client Comptant';

    document.getElementById('print-receipt-area').innerHTML = `
        <div style="font-family: 'Courier New', monospace; max-width: 320px; margin: 0 auto; color: #000; padding: 5px; font-size: 12px; line-height: 1.3;">
            <div style="text-align: center; margin-bottom: 15px; border-bottom: 1px dashed #000; padding-bottom: 10px;">
                <h2 style="margin: 0; font-size: 15px; font-weight: bold; text-transform: uppercase;">MEDEQUIP — Équipements Médicaux</h2>
                <p style="margin: 2px 0 0 0; font-size: 11px;">Vente / Location / SAV</p>
            </div>
            <div style="margin-bottom: 10px; font-size: 11px;">
                <div><b>FACTURE :</b> ${escapeHtml(saleId)}</div>
                <div><b>DATE    :</b> ${fmtDate(new Date())}</div>
                <div><b>CLIENT  :</b> ${escapeHtml(clientName)}</div>
                <div><b>RÈGLEMENT:</b> ${escapeHtml(mode.toUpperCase())}</div>
            </div>
            <table style="width: 100%; text-align: left; border-collapse: collapse; margin-top: 5px;">
                <thead><tr style="border-bottom: 1px solid #000; font-weight: bold; font-size: 11px;">
                    <th style="padding-bottom: 3px;">ÉQUIPEMENT</th><th style="padding-bottom: 3px;">N° SÉRIE</th><th style="text-align: right; padding-bottom: 3px;">PRIX</th>
                </tr></thead>
                <tbody>
                    ${items.map(i => `<tr style="font-size: 11px;">
                        <td style="padding: 4px 0;">${escapeHtml(i.modelName)}</td>
                        <td style="padding: 4px 0; font-size: 10px;">${escapeHtml(i.serial)}</td>
                        <td style="text-align: right; padding: 4px 0;">${fmtMoney(i.price)}</td>
                    </tr>`).join('')}
                </tbody>
            </table>
            <div style="border-top: 1px dashed #000; margin-top: 10px; padding-top: 6px; text-align: right;">
                <div style="font-size: 13px; font-weight: bold;">NET À PAYER : ${fmtMoney(total)}</div>
            </div>
            <div style="text-align: center; margin-top: 25px; border-top: 1px solid #000; padding-top: 8px; font-size: 10px;">
                <p style="margin: 0;">Merci de votre confiance.</p>
                <p style="margin: 3px 0 0 0; color: #444;">Solutions : Agence Satmak © 2026</p>
            </div>
        </div>
    `;

    const printArea = document.getElementById('print-receipt-area');
    printArea.classList.remove('hidden');
    window.print();
    printArea.classList.add('hidden');
}

// ==================== 10. LOCATIONS ====================
const rentalStatusLabels = { en_cours: 'En cours', en_retard: 'En retard', retourne: 'Retournée', annule: 'Annulée' };
const rentalStatusClasses = {
    en_cours: 'bg-blue-100 text-blue-700', en_retard: 'bg-red-100 text-red-700',
    retourne: 'bg-slate-100 text-slate-600', annule: 'bg-gray-100 text-gray-500'
};

function renderLocations() {
    const statusFilter = document.getElementById('filter-rental-status')?.value || '';
    const body = document.getElementById('locations-body');
    if (!body) return;

    let matched = [...state.rentals].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    if (statusFilter) matched = matched.filter(r => r.status === statusFilter);

    if (!matched.length) {
        body.innerHTML = `<tr><td colspan="7" class="px-6 py-8 text-center text-gray-400">Aucune location trouvée</td></tr>`;
        return;
    }

    body.innerHTML = matched.map(r => {
        const unit = state.equipmentUnits.find(u => u.id === r.equipment_unit_id);
        const model = state.equipmentModels.find(m => m.id === unit?.model_id);
        const client = state.clients.find(c => c.id === r.client_id);
        const canReturn = r.status === 'en_cours' || r.status === 'en_retard';
        return `<tr class="hover:bg-gray-50/50">
            <td class="px-6 py-3 font-bold">${escapeHtml(model?.name || 'Modèle supprimé')} <span class="text-xs text-gray-400 font-mono block">${escapeHtml(unit?.serial_number || '')}</span></td>
            <td class="px-6 py-3">${escapeHtml(client?.name || '—')}</td>
            <td class="px-6 py-3 text-xs">${fmtDate(r.start_date)}</td>
            <td class="px-6 py-3 text-xs">${fmtDate(r.expected_end_date)}</td>
            <td class="px-6 py-3"><span class="px-2 py-0.5 rounded text-xs font-bold ${rentalStatusClasses[r.status] || 'bg-gray-100'}">${rentalStatusLabels[r.status] || r.status}</span></td>
            <td class="px-6 py-3 font-semibold">${fmtMoney(r.daily_rate)}</td>
            <td class="px-6 py-3 text-right">
                ${canReturn ? `<button data-id="${r.id}" data-label="${escapeHtml(model?.name || '')} — ${escapeHtml(unit?.serial_number || '')}" class="btn-return-rental text-blue-600 font-bold text-xs cursor-pointer hover:underline">Retourner</button>` : ''}
            </td>
        </tr>`;
    }).join('');

    body.querySelectorAll('.btn-return-rental').forEach(btn => {
        btn.onclick = () => openReturnRentalModal(btn.dataset.id, btn.dataset.label);
    });
}

function populateRentalUnitSelect() {
    const sel = document.getElementById('sr-unit');
    const available = state.equipmentUnits.filter(u => u.status === 'en_stock');
    if (!available.length) {
        sel.innerHTML = `<option value="">Aucune unité disponible</option>`;
        return;
    }
    sel.innerHTML = available.map(u => {
        const model = state.equipmentModels.find(m => m.id === u.model_id);
        return `<option value="${u.id}" data-rate="${model?.rental_price_day || 0}">${escapeHtml(model?.name || '')} — ${escapeHtml(u.serial_number)}</option>`;
    }).join('');
    onRentalUnitChange();
}

function onRentalUnitChange() {
    const sel = document.getElementById('sr-unit');
    const opt = sel.options[sel.selectedIndex];
    document.getElementById('sr-daily-rate').value = opt ? (opt.dataset.rate || 0) : 0;
}

function openStartRentalModal() {
    if (!state.equipmentUnits.some(u => u.status === 'en_stock')) return showToast("Aucune unité disponible pour la location", "error");
    if (!state.clients.length) return showToast("Crée d'abord un client", "error");

    populateRentalUnitSelect();
    document.getElementById('sr-client').innerHTML = state.clients.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
    document.getElementById('sr-end-date').value = '';
    document.getElementById('sr-deposit').value = '0';
    openModal('modal-start-rental');
}

async function startRental() {
    const unitId = document.getElementById('sr-unit').value;
    const clientId = document.getElementById('sr-client').value;
    const endDate = document.getElementById('sr-end-date').value;
    const dailyRate = parseFloat(document.getElementById('sr-daily-rate').value) || 0;
    const deposit = parseFloat(document.getElementById('sr-deposit').value) || 0;

    if (!unitId || !clientId || !endDate) return showToast("Équipement, client et date de retour obligatoires", "error");

    const btn = document.getElementById('btn-start-rental');
    btn.disabled = true; btn.textContent = 'Démarrage...';

    const rentalId = genId('LOC-');
    const { error } = await supabase.rpc('mat_start_rental', {
        p_rental_id: rentalId, p_unit_id: unitId, p_client_id: clientId,
        p_expected_end_date: endDate, p_daily_rate: dailyRate, p_deposit: deposit,
        p_user_id: state.currentUser.id
    });

    btn.disabled = false; btn.textContent = 'Démarrer';

    if (error) return showToast("Erreur: " + error.message, "error");

    closeModal('modal-start-rental');
    showToast("✅ Location démarrée");
    await loadDatabase();
    renderLocations();
}

let returnRentalId = null;

function openReturnRentalModal(rentalId, label) {
    returnRentalId = rentalId;
    document.getElementById('return-rental-label').textContent = label;
    document.getElementById('rr-send-maintenance').checked = false;
    openModal('modal-return-rental');
}

async function executeReturnRental() {
    const sendMaintenance = document.getElementById('rr-send-maintenance').checked;
    const { error } = await supabase.rpc('mat_return_rental', {
        p_rental_id: returnRentalId, p_user_id: state.currentUser.id, p_send_to_maintenance: sendMaintenance
    });

    if (error) return showToast("Erreur retour: " + error.message, "error");

    closeModal('modal-return-rental');
    showToast(sendMaintenance ? "✅ Retourné — envoyé en maintenance" : "✅ Retourné — de nouveau en stock");
    await loadDatabase();
    renderLocations();
}

// ==================== 11. SAV / MAINTENANCE ====================
const ticketStatusLabels = { ouvert: 'Ouvert', en_cours: 'En cours', resolu: 'Résolu', annule: 'Annulé' };
const ticketStatusClasses = {
    ouvert: 'bg-amber-100 text-amber-700', en_cours: 'bg-blue-100 text-blue-700',
    resolu: 'bg-emerald-100 text-emerald-700', annule: 'bg-gray-100 text-gray-500'
};

function renderSav() {
    const statusFilter = document.getElementById('filter-ticket-status')?.value || '';
    const body = document.getElementById('sav-body');
    if (!body) return;

    let matched = [...state.maintenanceTickets].sort((a, b) => new Date(b.opened_at) - new Date(a.opened_at));
    if (statusFilter) matched = matched.filter(t => t.status === statusFilter);

    if (!matched.length) {
        body.innerHTML = `<tr><td colspan="7" class="px-6 py-8 text-center text-gray-400">Aucun ticket trouvé</td></tr>`;
        return;
    }

    body.innerHTML = matched.map(t => {
        const unit = state.equipmentUnits.find(u => u.id === t.equipment_unit_id);
        const model = state.equipmentModels.find(m => m.id === unit?.model_id);
        const client = state.clients.find(c => c.id === t.client_id);
        const canClose = t.status === 'ouvert' || t.status === 'en_cours';
        return `<tr class="hover:bg-gray-50/50">
            <td class="px-6 py-3 font-bold">${escapeHtml(model?.name || 'Modèle supprimé')} <span class="text-xs text-gray-400 font-mono block">${escapeHtml(unit?.serial_number || '')}</span></td>
            <td class="px-6 py-3">${escapeHtml(client?.name || 'Interne')}</td>
            <td class="px-6 py-3 text-xs max-w-[220px] truncate" title="${escapeHtml(t.issue_description)}">${escapeHtml(t.issue_description)}</td>
            <td class="px-6 py-3"><span class="px-2 py-0.5 rounded text-xs font-bold ${ticketStatusClasses[t.status] || 'bg-gray-100'}">${ticketStatusLabels[t.status] || t.status}</span></td>
            <td class="px-6 py-3 text-xs">${fmtDate(t.opened_at)}</td>
            <td class="px-6 py-3 font-semibold">${t.cost ? fmtMoney(t.cost) : '—'}</td>
            <td class="px-6 py-3 text-right">
                ${canClose ? `<button data-id="${t.id}" data-label="${escapeHtml(model?.name || '')} — ${escapeHtml(unit?.serial_number || '')}" class="btn-close-ticket text-blue-600 font-bold text-xs cursor-pointer hover:underline">Clôturer</button>` : ''}
            </td>
        </tr>`;
    }).join('');

    body.querySelectorAll('.btn-close-ticket').forEach(btn => {
        btn.onclick = () => openCloseTicketModal(btn.dataset.id, btn.dataset.label);
    });
}

function openTicketModal() {
    if (!state.equipmentUnits.length) return showToast("Aucun équipement enregistré", "error");

    document.getElementById('tk-unit').innerHTML = state.equipmentUnits.map(u => {
        const model = state.equipmentModels.find(m => m.id === u.model_id);
        return `<option value="${u.id}">${escapeHtml(model?.name || '')} — ${escapeHtml(u.serial_number)} (${statusLabelsFr[u.status] || u.status})</option>`;
    }).join('');

    document.getElementById('tk-client').innerHTML = '<option value="">— Interne (pas de client) —</option>' +
        state.clients.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');

    document.getElementById('tk-issue').value = '';
    openModal('modal-add-ticket');
}

async function openMaintenanceTicket() {
    const unitId = document.getElementById('tk-unit').value;
    const clientId = document.getElementById('tk-client').value || null;
    const issue = document.getElementById('tk-issue').value.trim();

    if (!unitId || !issue) return showToast("Équipement et description obligatoires", "error");

    const btn = document.getElementById('btn-open-ticket');
    btn.disabled = true; btn.textContent = 'Ouverture...';

    const { error } = await supabase.rpc('mat_open_maintenance_ticket', {
        p_unit_id: unitId, p_client_id: clientId, p_issue: issue, p_user_id: state.currentUser.id
    });

    btn.disabled = false; btn.textContent = 'Ouvrir le ticket';

    if (error) return showToast("Erreur: " + error.message, "error");

    closeModal('modal-add-ticket');
    showToast("✅ Ticket SAV ouvert");
    await loadDatabase();
    renderSav();
}

let closeTicketId = null;

function openCloseTicketModal(ticketId, label) {
    closeTicketId = ticketId;
    document.getElementById('close-ticket-label').textContent = label;
    document.getElementById('ct-cost').value = '0';
    document.getElementById('ct-result-status').value = 'en_stock';
    document.getElementById('ct-notes').value = '';
    openModal('modal-close-ticket');
}

async function executeCloseTicket() {
    const cost = parseFloat(document.getElementById('ct-cost').value) || 0;
    const resultStatus = document.getElementById('ct-result-status').value;
    const notes = document.getElementById('ct-notes').value.trim();

    const { error } = await supabase.rpc('mat_close_maintenance_ticket', {
        p_ticket_id: closeTicketId, p_cost: cost, p_notes: notes,
        p_user_id: state.currentUser.id, p_result_status: resultStatus
    });

    if (error) return showToast("Erreur clôture: " + error.message, "error");

    closeModal('modal-close-ticket');
    showToast(resultStatus === 'hors_service' ? "✅ Ticket clôturé — équipement hors service" : "✅ Ticket clôturé — remis en stock");
    await loadDatabase();
    renderSav();
}

// ==================== 12. DASHBOARD ====================
function renderDashboard() {
    const todayStr = new Date().toDateString();
    const todaySales = state.sales.filter(s => new Date(s.created_at).toDateString() === todayStr);
    const dailyCA = todaySales.reduce((sum, s) => sum + Number(s.total), 0);

    const enStock = state.equipmentUnits.filter(u => u.status === 'en_stock').length;
    const enRetard = state.rentals.filter(r => r.status === 'en_retard').length;
    const savOuverts = state.maintenanceTickets.filter(t => t.status === 'ouvert' || t.status === 'en_cours').length;

    document.getElementById('stat-ventes').textContent = fmtMoney(dailyCA);
    document.getElementById('stat-ventes-nb').textContent = todaySales.length + ' vente(s)';
    document.getElementById('stat-en-stock').textContent = enStock;
    document.getElementById('stat-retard').textContent = enRetard;
    document.getElementById('stat-sav').textContent = savOuverts;

    // Répartition du parc par statut
    const statusLabels = {
        en_stock: 'En stock', loue: 'En location', vendu: 'Vendu',
        en_maintenance: 'En maintenance', hors_service: 'Hors service', reserve: 'Réservé'
    };
    const statusColors = {
        en_stock: 'bg-emerald-500', loue: 'bg-blue-500', vendu: 'bg-slate-400',
        en_maintenance: 'bg-amber-500', hors_service: 'bg-red-500', reserve: 'bg-purple-500'
    };
    const counts = {};
    state.equipmentUnits.forEach(u => { counts[u.status] = (counts[u.status] || 0) + 1; });
    const total = state.equipmentUnits.length || 1;

    const breakdown = document.getElementById('parc-breakdown');
    if (breakdown) {
        const entries = Object.keys(statusLabels).filter(k => counts[k]);
        breakdown.innerHTML = entries.length ? entries.map(k => `
            <div>
                <div class="flex justify-between text-xs font-semibold mb-1">
                    <span class="text-gray-600">${statusLabels[k]}</span>
                    <span class="text-gray-400">${counts[k]}</span>
                </div>
                <div class="w-full bg-gray-100 rounded-full h-2">
                    <div class="${statusColors[k]} h-2 rounded-full" style="width:${(counts[k] / total) * 100}%"></div>
                </div>
            </div>
        `).join('') : `<p class="text-xs text-gray-400 font-medium">Aucun équipement enregistré</p>`;
    }

    // Dernières ventes
    const tableBody = document.getElementById('recent-sales-body');
    const sortedSales = [...state.sales].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 5);
    tableBody.innerHTML = sortedSales.length ? sortedSales.map(s => {
        const client = state.clients.find(c => c.id === s.client_id);
        return `<tr>
            <td class="px-6 py-3 font-bold">${escapeHtml(s.id)}</td>
            <td class="px-6 py-3">${escapeHtml(client?.name || 'Client comptant')}</td>
            <td class="px-6 py-3 font-bold">${fmtMoney(s.total)}</td>
            <td class="px-6 py-3">${fmtDate(s.created_at)}</td>
        </tr>`;
    }).join('') : `<tr><td colspan="4" class="px-6 py-6 text-center text-gray-400">Aucune vente enregistrée</td></tr>`;
}

// ==================== 13. EXPOSITION GLOBALE (SCOPE MODULE) ====================
window.navigate = navigate;
window.toggleSidebar = toggleSidebar;
window.handleLogout = handleLogout;
window.openModal = openModal;
window.closeModal = closeModal;
window.renderCatalogue = renderCatalogue;
window.addEquipmentModel = addEquipmentModel;
window.renderParc = renderParc;
window.openReceiveModal = openReceiveModal;
window.receiveEquipmentUnit = receiveEquipmentUnit;
window.openTransferUnitModal = openTransferUnitModal;
window.executeTransferUnit = executeTransferUnit;
window.renderVentes = renderVentes;
window.renderVenteUnits = renderVenteUnits;
window.clearSaleCart = clearSaleCart;
window.validateEquipmentSale = validateEquipmentSale;
window.toggleClientTypeFields = toggleClientTypeFields;
window.addMatClient = addMatClient;
window.renderLocations = renderLocations;
window.onRentalUnitChange = onRentalUnitChange;
window.openStartRentalModal = openStartRentalModal;
window.startRental = startRental;
window.openReturnRentalModal = openReturnRentalModal;
window.executeReturnRental = executeReturnRental;
window.renderSav = renderSav;
window.openTicketModal = openTicketModal;
window.openMaintenanceTicket = openMaintenanceTicket;
window.openCloseTicketModal = openCloseTicketModal;
window.executeCloseTicket = executeCloseTicket;

// ==================== 14. INITIATIONS ET LISTENERS ====================
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('login-form')?.addEventListener('submit', handleLogin);

    document.getElementById('topbar-date').textContent = new Date().toLocaleDateString('fr-FR', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
    });

    window.addEventListener('offline', () => {
        showToast("⚠️ Connexion Internet perdue.", "error");
        const btn = document.querySelector('[data-action="validate-sale"]');
        if (btn) { btn.disabled = true; btn.classList.add('opacity-40', 'cursor-not-allowed'); }
    });

    window.addEventListener('online', () => {
        showToast("✅ Connexion rétablie.");
        const btn = document.querySelector('[data-action="validate-sale"]');
        if (btn) { btn.disabled = false; btn.classList.remove('opacity-40', 'cursor-not-allowed'); }
    });
});