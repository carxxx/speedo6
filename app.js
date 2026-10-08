const SPEED_MAX = 200;
const RPM_MAX = 10;
const SPEED_DECAY = 9;
const RPM_DECAY = 10;

let currentSpeed = 0;
let currentSpeedUnit = 'mph';
let currentRpm = 0;
let currentFuel = 1;
let currentHealth = 1;
let currentGear = 0;
let currentOdometer = 0;
let currentEngine = false;
let currentHeadlights = 0;
let leftIndicator = false;
let rightIndicator = false;
let seatbeltFastened = false;

let displaySpeed = 0;
let displayRpm = 0;
let targetSpeed = 0;
let targetRpm = 0;
let animationRunning = false;
let lastFrame = 0;

let dashboardEl = null;
let currentScale = 1;
const EL = {};
const blinkTimers = {};

let syncState = {
    mode: 'none', role: 'host', code: '', socket: null, connected: false
};
let peerInstance = null;
let peerConnections = [];
let clientConnection = null;
let pendingTelemetry = {};
let telemetryTimeout = null;

const peerIceServers = {
    config: {
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:global.stun.twilio.com:3478' }
        ]
    }
};

function clamp(n, min, max) { return Math.min(Math.max(n, min), max); }
function toBool(value) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    if (typeof value === 'string') return ['true','1','on','yes','enabled'].includes(value.trim().toLowerCase());
    return Boolean(value);
}
function normalizeRatio(value, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return n > 1 ? clamp(n, 0, 100) / 100 : clamp(n, 0, 1);
}
function gearText(gear) {
    const n = Number(gear) || 0;
    if (n === 0) return 'N';
    if (n < 0) return 'R';
    return String(n);
}
function setRatio(el, value) { if (el) el.style.setProperty('--value', String(clamp(value, 0, 1))); }

function updateSpeedUI() {
    const pct = clamp(displaySpeed / SPEED_MAX, 0, 1) * 100;
    if (EL.speedDisplay) EL.speedDisplay.textContent = Math.round(displaySpeed);
    if (EL.speedProgressFill) EL.speedProgressFill.style.width = pct.toFixed(2) + '%';
}
function updateRpmUI() {
    const pct = clamp(displayRpm / RPM_MAX, 0, 1);
    const segments = EL.rpmSegments || [];
    const count = Math.ceil(pct * segments.length);
    segments.forEach((seg, i) => {
        seg.style.background = i < count
            ? (i >= 8 ? 'var(--danger)' : i >= 6 ? 'var(--warn)' : 'var(--accent)')
            : 'rgba(255,255,255,.09)';
        seg.style.opacity = i < count ? '1' : '.75';
    });
    if (EL.rpmValue) EL.rpmValue.textContent = displayRpm.toFixed(1) + 'K';
}
function animateTelemetry(timestamp) {
    if (!animationRunning) return;
    const now = timestamp || performance.now();
    const dt = Math.min((now - lastFrame) / 1000, .1) || .016;
    lastFrame = now;
    const sFactor = SPEED_DECAY * dt / (1 + SPEED_DECAY * dt);
    const rFactor = RPM_DECAY * dt / (1 + RPM_DECAY * dt);
    displaySpeed += (targetSpeed - displaySpeed) * sFactor;
    displayRpm += (targetRpm - displayRpm) * rFactor;
    updateSpeedUI();
    updateRpmUI();
    if (Math.abs(targetSpeed - displaySpeed) < .03 && Math.abs(targetRpm - displayRpm) < .01) {
        displaySpeed = targetSpeed; displayRpm = targetRpm;
        updateSpeedUI(); updateRpmUI();
        animationRunning = false;
        return;
    }
    requestAnimationFrame(animateTelemetry);
}
function startAnimation() {
    if (syncState.mode === 'host' && syncState.connected) return;
    if (animationRunning) return;
    animationRunning = true;
    lastFrame = performance.now();
    requestAnimationFrame(animateTelemetry);
}

function broadcastTelemetry(key, value) {
    if (syncState.mode !== 'host' || !syncState.connected) return;
    pendingTelemetry[key] = value;
    if (telemetryTimeout) return;
    telemetryTimeout = setTimeout(() => {
        const msg = JSON.stringify({ type: 'telemetry', data: pendingTelemetry });
        peerConnections.forEach(conn => { if (conn && conn.open) conn.send(msg); });
        if (syncState.socket && syncState.socket.readyState === WebSocket.OPEN) syncState.socket.send(msg);
        pendingTelemetry = {};
        telemetryTimeout = null;
    }, 16);
}

function setSpeed(speed) {
    broadcastTelemetry('speed', speed);
    const numeric = Number(speed);
    currentSpeed = Number.isFinite(numeric) ? Math.max(0, numeric) : 0;
    let display = currentSpeed * 2.236936;
    targetSpeed = clamp(display, 0, SPEED_MAX);
    currentSpeedUnit = 'mph';
    if (EL.speedUnit) EL.speedUnit.textContent = 'MPH';
    startAnimation();
}
function setRPM(rpm) {
    broadcastTelemetry('rpm', rpm);
    const numeric = Number(rpm);
    currentRpm = Number.isFinite(numeric) ? Math.max(0, numeric) : 0;
    targetRpm = clamp(currentRpm * 10, 0, RPM_MAX);
    startAnimation();
}
function setFuel(fuel) {
    broadcastTelemetry('fuel', fuel);
    currentFuel = normalizeRatio(fuel, currentFuel);
    setRatio(EL.fuelFill, currentFuel);
    if (EL.fuelText) EL.fuelText.textContent = Math.round(currentFuel * 100) + '%';
}
function setHealth(health) {
    broadcastTelemetry('health', health);
    currentHealth = normalizeRatio(health, currentHealth);
    setRatio(EL.healthFill, currentHealth);
    if (EL.healthText) EL.healthText.textContent = Math.round(currentHealth * 100) + '%';
}
function setGear(gear) {
    broadcastTelemetry('gear', gear);
    currentGear = Number(gear) || 0;
    if (EL.gearDisplay) EL.gearDisplay.textContent = gearText(currentGear);
}
function setEngine(state) {
    broadcastTelemetry('engine', state);
    currentEngine = toBool(state);
    if (EL.indicatorEngine) EL.indicatorEngine.classList.toggle('on', currentEngine);
    if (EL.engineText) EL.engineText.textContent = currentEngine ? 'ON' : 'OFF';
}
function setHeadlights(state) {
    broadcastTelemetry('headlights', state);
    currentHeadlights = Number(state) || (state ? 1 : 0);
    const on = currentHeadlights > 0;
    if (EL.indicatorHeadlights) EL.indicatorHeadlights.classList.toggle('on', on);
    if (EL.lightsText) EL.lightsText.textContent = on ? 'ON' : 'OFF';
}
function startBlink(el, intervalMs) {
    if (!el || blinkTimers[el.id]) return;
    let visible = true;
    blinkTimers[el.id] = setInterval(() => { visible = !visible; el.style.opacity = visible ? '1' : '.18'; }, intervalMs);
}
function stopBlink(el) {
    if (!el) return;
    if (blinkTimers[el.id]) { clearInterval(blinkTimers[el.id]); delete blinkTimers[el.id]; }
    el.style.opacity = '';
}
function setLeftIndicator(state) {
    broadcastTelemetry('leftIndicator', state);
    leftIndicator = toBool(state);
    if (!EL.indicatorLeft) return;
    EL.indicatorLeft.classList.toggle('on', leftIndicator);
    leftIndicator ? startBlink(EL.indicatorLeft, 500) : stopBlink(EL.indicatorLeft);
}
function setRightIndicator(state) {
    broadcastTelemetry('rightIndicator', state);
    rightIndicator = toBool(state);
    if (!EL.indicatorRight) return;
    EL.indicatorRight.classList.toggle('on', rightIndicator);
    rightIndicator ? startBlink(EL.indicatorRight, 500) : stopBlink(EL.indicatorRight);
}
function setSeatbelts(state) {
    broadcastTelemetry('seatbelt', state);
    seatbeltFastened = toBool(state);
    if (!EL.indicatorSeatbelt) return;
    const warning = !seatbeltFastened;
    EL.indicatorSeatbelt.classList.toggle('on', warning);
    warning ? startBlink(EL.indicatorSeatbelt, 600) : stopBlink(EL.indicatorSeatbelt);
}
function setOdometer(distance) {
    broadcastTelemetry('odometer', distance);
    const n = Number(distance);
    currentOdometer = Number.isFinite(n) ? n : 0;
    if (EL.odometer) EL.odometer.textContent = currentOdometer.toFixed(1).padStart(8, '0') + ' mi';
}

function setPosition(left, top) {
    if (!dashboardEl) return;
    dashboardEl.style.left = typeof left === 'number' ? left + 'px' : left;
    dashboardEl.style.top = typeof top === 'number' ? top + 'px' : top;
    dashboardEl.style.bottom = 'auto';
    dashboardEl.style.right = 'auto';
    saveSettings();
}
function updateScale() {
    if (dashboardEl) dashboardEl.style.transform = 'scale(' + currentScale + ')';
}
function loadSettings() {
    if (!dashboardEl) return;
    try {
        const settings = JSON.parse(localStorage.getItem('spedo_settings') || 'null');
        if (!settings) return;
        currentScale = Number.isFinite(settings.scale) ? clamp(settings.scale, .6, 1.8) : 1;
        if (Number.isFinite(settings.left) && Number.isFinite(settings.top)) {
            dashboardEl.style.left = settings.left + 'px';
            dashboardEl.style.top = settings.top + 'px';
            dashboardEl.style.right = 'auto';
            dashboardEl.style.bottom = 'auto';
        }
        updateScale();
    } catch (e) { console.warn('[SAMC HUD] settings load failed', e); }
}
function saveSettings() {
    if (!dashboardEl) return;
    const cs = getComputedStyle(dashboardEl);
    localStorage.setItem('spedo_settings', JSON.stringify({
        scale: currentScale,
        left: parseFloat(cs.left) || dashboardEl.offsetLeft,
        top: parseFloat(cs.top) || dashboardEl.offsetTop
    }));
}
function resetSettings() {
    currentScale = 1;
    if (dashboardEl) {
        dashboardEl.style.left = '';
        dashboardEl.style.top = '';
        dashboardEl.style.right = '2.2vw';
        dashboardEl.style.bottom = '2.4vh';
        dashboardEl.style.transform = 'scale(1)';
    }
    localStorage.removeItem('spedo_settings');
}
function setupDragging() {
    if (!dashboardEl) return;
    let dragging = false, sx = 0, sy = 0, ix = 0, iy = 0;
    dashboardEl.addEventListener('pointerdown', e => {
        if (e.target.closest('.no-drag') || e.target.closest('button,input')) return;
        dragging = true;
        sx = e.clientX; sy = e.clientY;
        ix = dashboardEl.offsetLeft; iy = dashboardEl.offsetTop;
        dashboardEl.setPointerCapture(e.pointerId);
        e.preventDefault();
    });
    dashboardEl.addEventListener('pointermove', e => {
        if (!dragging) return;
        dashboardEl.style.left = (ix + e.clientX - sx) + 'px';
        dashboardEl.style.top = (iy + e.clientY - sy) + 'px';
        dashboardEl.style.right = 'auto'; dashboardEl.style.bottom = 'auto';
    });
    dashboardEl.addEventListener('pointerup', e => {
        if (!dragging) return;
        dragging = false;
        try { dashboardEl.releasePointerCapture(e.pointerId); } catch (_) {}
        saveSettings();
    });
    dashboardEl.addEventListener('lostpointercapture', () => { if (dragging) { dragging = false; saveSettings(); } });
}
function setupControls() {
    document.getElementById('btn-scale-up')?.addEventListener('click', e => { e.stopPropagation(); currentScale = clamp(currentScale + .1, .6, 1.8); updateScale(); saveSettings(); });
    document.getElementById('btn-scale-down')?.addEventListener('click', e => { e.stopPropagation(); currentScale = clamp(currentScale - .1, .6, 1.8); updateScale(); saveSettings(); });
    document.getElementById('btn-reset')?.addEventListener('click', e => { e.stopPropagation(); resetSettings(); });
}
function cleanupSpeedometer() {
    Object.values(blinkTimers).forEach(clearInterval);
    Object.keys(blinkTimers).forEach(k => delete blinkTimers[k]);
    [EL.indicatorLeft, EL.indicatorRight, EL.indicatorSeatbelt].forEach(el => { if (el) { el.style.opacity=''; el.classList.remove('on'); } });
    animationRunning = false;
}

function resetSpeedometerValues() {
    currentEngine = false; currentHeadlights = 0; leftIndicator = false; rightIndicator = false; seatbeltFastened = false;
    displaySpeed = targetSpeed = 0; displayRpm = targetRpm = 0;
    setEngine(false); setSpeed(0); setRPM(0); setFuel(1); setHealth(1); setGear(0); setHeadlights(0); setLeftIndicator(false); setRightIndicator(false); setSeatbelts(true); setOdometer(0);
}

function generateHostCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let result = '';
    for (let i = 0; i < 6; i++) result += chars[Math.floor(Math.random() * chars.length)];
    return result;
}
function updateSyncStatus(stateClass, text) {
    const dot = document.getElementById('sync-status-dot');
    const label = document.getElementById('sync-status-text');
    if (dot) dot.className = 'status-dot ' + stateClass;
    if (label) label.textContent = text.toUpperCase();
}
function showSyncPanel() { document.getElementById('sync-panel')?.classList.remove('hide'); }
function hideSyncPanel() { document.getElementById('sync-panel')?.classList.add('hide'); }
function updateActivePill(title, subtitle) {
    const pill = document.getElementById('sync-active-pill');
    const text = document.getElementById('sync-active-text');
    if (text) text.textContent = title;
    if (pill) {
        const small = pill.querySelector('span');
        if (small) small.textContent = subtitle || 'Remote display is receiving telemetry';
    }
}

function setSyncButtons(role, connected) {
    if (role === 'host') {
        document.getElementById('btn-host-connect')?.classList.toggle('hide', connected);
        document.getElementById('btn-host-disconnect')?.classList.toggle('hide', !connected);
    } else {
        document.getElementById('btn-sync-connect')?.classList.toggle('hide', connected);
        document.getElementById('btn-sync-disconnect')?.classList.toggle('hide', !connected);
    }
}
function disconnectPeerJS() {
    if (clientConnection) { try { clientConnection.close(); } catch (_) {} clientConnection = null; }
    peerConnections.forEach(c => { try { c.close(); } catch (_) {} });
    peerConnections = [];
    if (peerInstance) { try { peerInstance.destroy(); } catch (_) {} peerInstance = null; }
}
function connectPeerJS(role, roomCode) {
    disconnectPeerJS();
    updateSyncStatus('connecting', 'Connecting');
    let peerId = 'samc-spedo-' + roomCode;
    if (role === 'host') {
        peerInstance = new Peer(peerId, peerIceServers);
        peerInstance.on('open', () => { syncState.connected = true; syncState.mode='host'; syncState.code=roomCode; setSyncButtons('host',true); updateSyncStatus('connected','Host Ready'); hideSyncPanel(); });
        peerInstance.on('connection', conn => {
            peerConnections.push(conn);
            conn.on('open', () => {
                updateActivePill('HUD LINK ACTIVE', 'Code: ' + roomCode);
                document.getElementById('sync-active-pill')?.classList.remove('hide');
                dashboardEl?.classList.add('sync-hidden');
                cleanupSpeedometer();
                conn.send(JSON.stringify({ type:'telemetry', data:{ speed:currentSpeed, rpm:currentRpm, fuel:currentFuel, health:currentHealth, gear:currentGear, engine:currentEngine, headlights:currentHeadlights, leftIndicator, rightIndicator, seatbelt:seatbeltFastened, odometer:currentOdometer }}));
            });
            conn.on('close', () => {
                peerConnections = peerConnections.filter(x => x !== conn);
                if (!peerConnections.length && syncState.mode === 'host') {
                    dashboardEl?.classList.remove('sync-hidden');
                    document.getElementById('sync-active-pill')?.classList.add('hide');
                    startAnimation();
                }
            });
        });
        peerInstance.on('error', err => { console.error('[SAMC PeerJS]', err); updateSyncStatus('disconnected','P2P Error'); });
    } else {
        peerInstance = new Peer(peerIceServers);
        peerInstance.on('open', () => {
            clientConnection = peerInstance.connect(peerId);
            clientConnection.on('open', () => { syncState.connected=true; syncState.mode='client'; syncState.code=roomCode; setSyncButtons('client',true); updateSyncStatus('connected','Client Connected'); hideSyncPanel(); });
            clientConnection.on('data', data => handleSyncData(data));
            clientConnection.on('close', () => { resetSpeedometerValues(); handleDisconnectState(); });
        });
        peerInstance.on('error', err => { console.error('[SAMC PeerJS]', err); updateSyncStatus('disconnected','Host Not Found'); });
    }
}
function handleSyncData(data) {
    try {
        const msg = typeof data === 'string' ? JSON.parse(data) : data;
        if (!msg) return;
        if (msg.type === 'telemetry' && syncState.mode === 'client') {
            applyTelemetry(msg.data);
        }
    } catch (e) { console.warn('[SAMC Sync] invalid message'); }
}
function connectWebSocket(url, role, roomCode) {
    disconnectPeerJS();
    updateSyncStatus('connecting', 'Connecting');
    try {
        const socket = new WebSocket(url);
        syncState.socket = socket;
        socket.onopen = () => socket.send(JSON.stringify({type:'join',room:roomCode,role}));
        socket.onmessage = event => {
            try {
                const msg = JSON.parse(event.data);
                if (msg.type === 'joined') {
                    syncState.connected=true; syncState.mode=role; syncState.code=roomCode; setSyncButtons(role,true); updateSyncStatus('connected', role==='host'?'Host Ready':'Client Connected'); hideSyncPanel();
                    if (role === 'host') updateActivePill('HUD LINK READY','Waiting for remote display');
                } else if (msg.type === 'client_connected' && role === 'host') {
                    dashboardEl?.classList.add('sync-hidden'); document.getElementById('sync-active-pill')?.classList.remove('hide'); updateActivePill('HUD LINK ACTIVE', 'Code: ' + roomCode); cleanupSpeedometer();
                } else if (msg.type === 'client_disconnected' && role === 'host') {
                    dashboardEl?.classList.remove('sync-hidden'); document.getElementById('sync-active-pill')?.classList.add('hide'); startAnimation();
                } else if (msg.type === 'host_disconnected' && role === 'client') resetSpeedometerValues();
                else if (msg.type === 'telemetry') handleSyncData(msg);
            } catch (e) { console.warn('[SAMC Sync] malformed socket message'); }
        };
        socket.onclose = handleDisconnectState;
        socket.onerror = () => updateSyncStatus('disconnected','Connection Error');
    } catch (_) { updateSyncStatus('disconnected','Connection Failed'); }
}
function disconnectWebSocket() {
    disconnectPeerJS();
    if (syncState.socket) { try { syncState.socket.close(); } catch (_) {} syncState.socket = null; }
    handleDisconnectState();
}
function handleDisconnectState() {
    syncState.connected = false; syncState.mode = 'none';
    updateSyncStatus('disconnected','Disconnected');
    setSyncButtons('host', false); setSyncButtons('client', false);
    dashboardEl?.classList.remove('sync-hidden');
    document.getElementById('sync-active-pill')?.classList.add('hide');
}
function setupSyncSystem() {
    const btnSync = document.getElementById('btn-sync');
    const btnClose = document.getElementById('btn-sync-close');
    const hostTab = document.getElementById('sync-role-host');
    const clientTab = document.getElementById('sync-role-client');
    const hostPanel = document.getElementById('sync-host-panel');
    const clientPanel = document.getElementById('sync-client-panel');
    const hostCode = document.getElementById('sync-host-code');
    const input = document.getElementById('sync-client-code-input');

    syncState.code = generateHostCode();
    if (hostCode) hostCode.textContent = syncState.code;
    const cached = localStorage.getItem('spedo_sync_code');
    if (cached && input) input.value = cached;

    btnSync?.addEventListener('click', e => { e.stopPropagation(); showSyncPanel(); });
    btnClose?.addEventListener('click', e => { e.stopPropagation(); hideSyncPanel(); });
    hostTab?.addEventListener('click', () => {
        syncState.role='host'; hostTab.classList.add('active'); clientTab.classList.remove('active'); hostPanel.classList.remove('hide'); clientPanel.classList.add('hide');
        syncState.code=generateHostCode(); if (hostCode) hostCode.textContent=syncState.code;
    });
    clientTab?.addEventListener('click', () => { syncState.role='client'; clientTab.classList.add('active'); hostTab.classList.remove('active'); clientPanel.classList.remove('hide'); hostPanel.classList.add('hide'); });
    document.getElementById('btn-host-connect')?.addEventListener('click', () => connectPeerJS('host', syncState.code));
    document.getElementById('btn-host-disconnect')?.addEventListener('click', disconnectWebSocket);
    document.getElementById('btn-sync-connect')?.addEventListener('click', () => {
        const code = (input?.value || '').trim().toUpperCase();
        if (!/^[A-Z0-9]{6}$/.test(code)) { alert('Enter a valid 6-character pairing code.'); return; }
        localStorage.setItem('spedo_sync_code', code);
        connectPeerJS('client', code);
    });
    document.getElementById('btn-sync-disconnect')?.addEventListener('click', disconnectWebSocket);
    document.getElementById('btn-restore-hud')?.addEventListener('click', disconnectWebSocket);
}

function applyTelemetry(data) {
    if (!data || typeof data !== 'object') return;
    const payload = (data.data && typeof data.data === 'object') ? data.data : data;
    const dash = document.getElementById('speedometer');
    if (payload.visible !== undefined && dash) dash.classList.toggle('hide', payload.visible === false);
    if (payload.speed !== undefined) {
        let speed = Number(payload.speed);
        if (Number.isFinite(speed)) {
            const unit = String(payload.speedUnit || payload.unit || '').toLowerCase();
            if (unit === 'km/h' || unit === 'kmh' || unit === 'kph') speed /= 3.6;
            else if (unit === 'mph') speed /= 2.236936;
            setSpeed(speed);
        }
    }
    if (payload.rpm !== undefined) setRPM(payload.rpm);
    if (payload.fuel !== undefined) setFuel(normalizeRatio(payload.fuel, currentFuel));
    if (payload.health !== undefined) setHealth(normalizeRatio(payload.health, currentHealth));
    if (payload.gear !== undefined) setGear(payload.gear);
    if (payload.engine !== undefined) setEngine(payload.engine);
    if (payload.headlights !== undefined) setHeadlights(payload.headlights);
    if (payload.leftIndicator !== undefined || payload.left !== undefined) setLeftIndicator(payload.leftIndicator ?? payload.left);
    if (payload.rightIndicator !== undefined || payload.right !== undefined) setRightIndicator(payload.rightIndicator ?? payload.right);
    if (payload.seatbelt !== undefined || payload.seatbeltFastened !== undefined) setSeatbelts(payload.seatbelt ?? payload.seatbeltFastened);
    if (payload.odometer !== undefined) setOdometer(payload.odometer);
}
window.addEventListener('message', event => {
    try {
        const data = event?.data;
        if (!data) return;
        if (typeof data === 'string') { try { applyTelemetry(JSON.parse(data)); } catch (_) {} return; }
        if (data.action === 'visible') { document.getElementById('speedometer')?.classList.toggle('hide', data.visible === false); return; }
        const action = String(data.action || data.type || '').toLowerCase();
        if (['vehicle','speedometer','update','telemetry'].includes(action) || data.speed !== undefined || data.rpm !== undefined || data.fuel !== undefined || data.health !== undefined || data.gear !== undefined) applyTelemetry(data);
    } catch (e) { console.warn('[SAMC HUD] telemetry error', e); }
});

function setupDemoMode() {
    const params = new URLSearchParams(location.search);
    if (params.get('demo') !== '1') return;
    const panel = document.createElement('div');
    panel.id = 'demo-controls';
    panel.innerHTML = `
        <div class="demo-title">SAMC HUD DEMO</div>
        <label>Speed <input id="demo-speed" type="range" min="0" max="200" value="92"></label>
        <label>RPM <input id="demo-rpm" type="range" min="0" max="100" value="58"></label>
        <label>Fuel <input id="demo-fuel" type="range" min="0" max="100" value="72"></label>
        <label>Vehicle <input id="demo-health" type="range" min="0" max="100" value="91"></label>`;
    document.body.appendChild(panel);
    const sync = () => {
        const speedMps = Number(document.getElementById('demo-speed').value) / 2.236936;
        setSpeed(speedMps); setRPM(Number(document.getElementById('demo-rpm').value)/10); setFuel(Number(document.getElementById('demo-fuel').value)/100); setHealth(Number(document.getElementById('demo-health').value)/100);
    };
    panel.querySelectorAll('input').forEach(i => i.addEventListener('input', sync));
    setInterval(() => { const b = Math.round((Math.sin(Date.now()/700)+1)*50); const speed = clamp(Number(document.getElementById('demo-speed').value)+ (b-50)*.02,0,200); setSpeed(speed/2.236936); }, 160);
    setGear(3); setEngine(true); setHeadlights(true); setSeatbelts(false); sync();
}

function init() {
    dashboardEl = document.getElementById('speedometer');
    EL.speedDisplay = document.getElementById('speed-display');
    EL.speedUnit = document.getElementById('speed-unit');
    EL.gearDisplay = document.getElementById('gear-display');
    EL.odometer = document.getElementById('odometer');
    EL.fuelFill = document.getElementById('fuel-fill'); EL.fuelText = document.getElementById('fuel-text');
    EL.healthFill = document.getElementById('health-fill'); EL.healthText = document.getElementById('health-text');
    EL.speedProgressFill = document.getElementById('speed-progress-fill');
    EL.rpmValue = document.getElementById('rpm-value');
    EL.rpmSegments = Array.from(document.querySelectorAll('#rpm-segments i'));
    EL.indicatorLeft = document.getElementById('indicator-left'); EL.indicatorRight = document.getElementById('indicator-right');
    EL.indicatorSeatbelt = document.getElementById('indicator-seatbelt'); EL.indicatorEngine = document.getElementById('indicator-engine'); EL.indicatorHeadlights = document.getElementById('indicator-headlights');
    EL.engineText = document.getElementById('engine-text'); EL.lightsText = document.getElementById('lights-text');

    loadSettings(); setupDragging(); setupControls(); setupSyncSystem();
    setSpeed(0); setRPM(0); setFuel(1); setHealth(1); setGear(0); setEngine(false); setHeadlights(false); setLeftIndicator(false); setRightIndicator(false); setSeatbelts(true); setOdometer(0);
    setupDemoMode();
}

document.addEventListener('DOMContentLoaded', init);
