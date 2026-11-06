import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore, collection, addDoc, getDocs, doc, setDoc, deleteDoc, onSnapshot, query, where, enableMultiTabIndexedDbPersistence } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

// ==========================================
// Firebase Configuration (مشروع yly-sharqia)
// ==========================================
const firebaseConfig = {
    apiKey: "AIzaSyDbEwtCHsaxhfB1OhbvabGlwE7X0zR5npg",
    authDomain: "yly-sharqia.firebaseapp.com",
    projectId: "yly-sharqia",
    storageBucket: "yly-sharqia.firebasestorage.app",
    messagingSenderId: "107394485972",
    appId: "1:107394485972:web:de901ff55eabe0516c7541",
    measurementId: "G-PDZNLN4EMF"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
enableMultiTabIndexedDbPersistence(db).catch((err) => {
    if (err.code == 'failed-precondition') console.warn('التخزين الأوفلاين يعمل في تبويب واحد فقط.');
    else if (err.code == 'unimplemented') console.warn('المتصفح لا يدعم التخزين المحلي لـ Firestore.');
});
const auth = getAuth(app);

// ==========================================
// 2. Global State & Constants
// ==========================================
const state = {
    me: null, members: [], activities: [], records: [], recMap: {},
    selType: '', selActivityId: '', repType: '', openMemberId: null,
    reportHeaders: [], reportRows: [], reportTitle: '',
    html5QrCode: null, isScannerRunning: false, isPrinting: false, isLoggingOut: false
};
const TYPES = { meeting: 'ميتنج', session: 'سيشن', event: 'ايفنت', task: 'تاسك' };
const MODES = { online: 'أونلاين', offline: 'أوفلاين' };
const stageMap = { "HR": "الموارد البشرية (HR)", "PR": "العلاقات العامة (PR)", "OR": "التنظيم (OR)", "SM": "السوشيال ميديا (SM)" };

// 3. Utilities
function getEgyptDate() {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
}
let today = getEgyptDate();
let selectedAttendanceDate = today;

// ==========================================
// 3. Security & Utilities
// ==========================================
function escapeHTML(str) {
    if (str === null || str === undefined) return '';
    return str.toString()
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function normalizeArabic(text) {
    if(!text) return '';
    return text.replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي');
}

function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => { clearTimeout(timeout); func(...args); };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

window.showToast = function(msg, type) {
    const t = document.getElementById('toast');
    if(!t) return;
    t.innerText = msg;
    // تركنا التصميم الأساسي وأضفنا اللون كـ Style مباشر لا يعتمد على مكتبة
    t.className = 'fixed top-5 left-1/2 transform -translate-x-1/2 px-6 py-3 rounded-full shadow-xl font-bold text-xs md:text-sm max-w-[90%] w-auto text-center whitespace-nowrap text-white z-[999999]';
    t.style.backgroundColor = type === 'success' ? '#16a34a' : '#dc2626'; 
    t.classList.remove('hidden');
    setTimeout(() => t.classList.add('hidden'), 3000);
}

let audioCtx = null;
function playSound(type) {
    try {
        if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        if (audioCtx.state === 'suspended') audioCtx.resume();
        const osc = audioCtx.createOscillator();
        osc.connect(audioCtx.destination);
        if(type === 'success') {
            osc.frequency.setValueAtTime(800, audioCtx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(1200, audioCtx.currentTime + 0.1);
        } else {
            osc.frequency.setValueAtTime(300, audioCtx.currentTime);
            osc.frequency.linearRampToValueAtTime(100, audioCtx.currentTime + 0.2);
        }
        osc.start();
        osc.stop(audioCtx.currentTime + 0.2);
    } catch(e) {}
}

// ==========================================
// 4. Lazy Loaders
// ==========================================
let isXlsxLoaded = false;
async function requireXLSX() {
    if (isXlsxLoaded) return;
    return new Promise((resolve, reject) => {
        window.showToast('جاري تحضير الإكسيل...', 'success');
        const script = document.createElement('script');
        script.src = "https://cdn.jsdelivr.net/npm/xlsx-js-style@1.2.0/dist/xlsx.bundle.js";
        script.onload = () => { isXlsxLoaded = true; resolve(); };
        script.onerror = reject;
        document.head.appendChild(script);
    });
}

let isQrLoaded = false;
async function requireQRScanner() {
    if (isQrLoaded) return;
    return new Promise((resolve, reject) => {
        const script1 = document.createElement('script');
        script1.src = "https://cdnjs.cloudflare.com/ajax/libs/html5-qrcode/2.3.8/html5-qrcode.min.js";
        script1.onload = () => {
            const script2 = document.createElement('script');
            script2.src = "https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js";
            script2.onload = () => { isQrLoaded = true; resolve(); };
            document.head.appendChild(script2);
        };
        document.head.appendChild(script1);
    });
}

async function generateQRBase64(text) {
    await requireQRScanner();
    return new Promise((resolve) => {
        const holder = document.createElement('div');
        holder.style.display = 'none';
        document.body.appendChild(holder);
        new QRCode(holder, { text: text, width: 100, height: 100, correctLevel : QRCode.CorrectLevel.H });
        setTimeout(() => {
            const img = holder.querySelector('img');
            const canvas = holder.querySelector('canvas');
            let src = '';
            if (img && img.src) src = img.src;
            else if (canvas) src = canvas.toDataURL();
            document.body.removeChild(holder);
            resolve(src ? `<img src="${src}" style="width:100px !important; height:100px !important; margin:0 auto !important; display:block !important;" />` : '');
        }, 300);
    });
}

// Print / PDF / Excel
function getPrintTemplate(title, content) {
    const todayPrintDate = new Date().toLocaleDateString('ar-EG');
    return `
    <style>
                    @import url('https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800;900&display=swap');
                    .print-page, .print-page * { box-sizing: border-box !important; font-family: 'Cairo', sans-serif !important; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
                    .print-page { padding: 2px; width: 100% !important; max-width: 100% !important; background: #ffffff !important; color: #000 !important; }
                    .print-page .print-header { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #1e3a8a; padding-bottom: 4px; margin-bottom: 6px; }
                    .print-page .print-meta-area { text-align: right; font-size: 9pt; color: #4b5563; font-weight: 700; }
                    .print-page .print-title-area { text-align: center; flex: 1; padding: 0 5px; }
                    .print-page .print-title-area h1 { font-size: 15pt; font-weight: 900; margin: 0; color: #1e3a8a; }
                    .print-page .print-title-area h2 { font-size: 11pt; font-weight: 800; margin: 2px 0 0 0; color: #dc2626; }
                    .print-page .print-logo-area img { width: 38px; height: 38px; object-fit: contain; }
                    
                    .print-page table { width: 100% !important; max-width: 100% !important; border-collapse: collapse !important; margin-top: 5px !important; table-layout: fixed !important; page-break-inside: auto !important; }
                    .print-page tr { page-break-inside: avoid !important; page-break-after: auto !important; }
                    .print-page thead { display: table-header-group !important; }
                    .print-page tfoot { display: table-footer-group !important; }
                    .print-page th { background-color: #1e3a8a !important; color: #ffffff !important; font-weight: 900 !important; border: 1px solid #1e3a8a !important; padding: 6px 2px !important; text-align: center !important; font-size: 12.5px !important; word-break: normal !important; word-wrap: normal !important; overflow-wrap: normal !important; white-space: normal !important; }
                    .print-page td { border: 1px solid #d1d5db !important; padding: 5px 2px !important; font-size: 11.5px !important; font-weight: 700 !important; text-align: center !important; vertical-align: middle !important; line-height: 1.4 !important; word-break: normal !important; word-wrap: normal !important; overflow-wrap: normal !important; white-space: normal !important; } 
                    
                    .print-page .print-student-card { border: 4px double #1e3a8a !important; border-radius: 15px; padding: 15px; width: 320px; margin: 10px auto; text-align: center; page-break-inside: avoid; background: #fff; color: #000; }
                    .print-page .print-card-title { font-size: 14pt; font-weight: bold; margin-bottom: 8px; color: #dc2626; }
                    .print-page .print-card-name { font-size: 17pt; font-weight: 900; margin: 8px 0; border-bottom: 2px solid #1e3a8a; padding-bottom: 8px; color: #000; }
                    .print-page .print-card-row { font-size: 11pt; font-weight: bold; margin: 4px 0; display: flex; justify-content: space-between; border-bottom: 1px dashed #ccc; padding: 2px 0; }
                </style>
    <div class="print-page" dir="rtl">
        <div class="print-header">
            <div class="print-meta-area"><div>تاريخ الطباعة: ${todayPrintDate}</div><div>YLY System</div></div>
            <div class="print-title-area"><h1>YLY Leaders</h1><h2>${escapeHTML(title)}</h2></div>
            <div class="print-logo-area"><img src="https://res.cloudinary.com/dsxrjmcxs/image/upload/c_limit,w_400,q_auto,f_auto/v1784657850/s60xlqx1otmwcijtjw1l.png"></div>
        </div>
        <div class="print-body">${content}</div>
    </div>`;
}

window.printHTML = async function(title, content) {
    if (state.isPrinting) return;
    state.isPrinting = true;
    window.showToast('جاري تحضير الطباعة...', 'success');
    
    try {
        let printIframe = document.getElementById('silent-print-iframe');
        if (!printIframe) {
            printIframe = document.createElement('iframe');
            printIframe.id = 'silent-print-iframe';
            printIframe.style.cssText = 'position: fixed; right: -9999px; bottom: -9999px; width: 0; height: 0; border: none;';
            document.body.appendChild(printIframe);
        }
        
        const iframeDoc = printIframe.contentWindow.document;
        iframeDoc.open();
        // إجبار A4 portrait عمودي دائماً لجميع التقارير
        iframeDoc.write(`<!DOCTYPE html><html dir="rtl" lang="ar"><head><title>${escapeHTML(title)}</title><style>@page { size: A4 portrait !important; margin: 4mm !important; }</style></head><body>${getPrintTemplate(title, content)}</body></html>`);
        iframeDoc.close();
        
        setTimeout(() => {
            printIframe.contentWindow.focus();
            printIframe.contentWindow.print();
            state.isPrinting = false;
        }, 500);
    } catch (e) {
        window.showToast('حدث خطأ أثناء الطباعة', 'error');
        state.isPrinting = false;
    }
};

window.savePDF = async function(title, content) {
    window.showToast('جاري تحضير واستخراج ملف الـ PDF...', 'success');
    
    // 1. تحميل مكتبة html2pdf إذا لم تكن موجودة
    if (typeof html2pdf === 'undefined') {
        await new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js';
            script.onload = resolve;
            script.onerror = () => { window.showToast('فشل تحميل مكتبة الـ PDF', 'error'); reject(); };
            document.head.appendChild(script);
        });
    }

    // 2. تهيئة الحاوية المخفية
    let container = document.getElementById('pdf-generator-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'pdf-generator-container';
        document.body.appendChild(container);
    }
    
    // ضبط الستايل ليكون خارج الشاشة تماماً ولكن قابل للقراءة بواسطة المكتبة
    container.style.cssText = 'position: fixed; left: -9999px; top: 0; width: 210mm; min-height: 297mm; background: white; z-index: -9999; visibility: visible; direction: ltr;';
    
    // 3. حقن المحتوى داخل الحاوية
    container.innerHTML = `<div style="direction: rtl; width: 100%; margin: 0 auto;">${getPrintTemplate(title, content)}</div>`;

    // 4. السر هنا: إعطاء المتصفح نصف ثانية (500 ملي ثانية) لرسم الجداول والـ CSS قبل الالتقاط
    setTimeout(async () => {
        // استهداف العنصر الداخلي مباشرة كما في الكود الناجح
        const element = container.firstElementChild;

        const opt = {
            margin:       4,
            filename:     `${title.replace(/\s+/g, '_')}.pdf`,
            image:        { type: 'jpeg', quality: 0.98 },
            html2canvas:  { scale: 2, useCORS: true, logging: false },
            jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' }
        };

        try {
            await html2pdf().set(opt).from(element).save();
            window.showToast('تم تحميل ملف الـ PDF بنجاح', 'success');
        } catch(e) {
            window.showToast('حدث خطأ أثناء التصدير', 'error');
        } finally {
            // تفريغ المحتوى بعد الانتهاء تماماً
            container.innerHTML = '';
        }
    }, 500); // المهلة الزمنية
};

window.exportToExcelStyle = async function(headers, rows, reportTitle, fileName) {
    await requireXLSX();
    if (typeof XLSX === 'undefined') { window.showToast('مكتبة الإكسيل غير محملة', 'error'); return; }

    const wb = XLSX.utils.book_new();
    wb.Workbook = { Views: [{ RTL: true }] };

    const wsData = [ [reportTitle], headers, ...rows ];
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    const colCount = headers.length;

    ws['!merges'] = [ { s: { r: 0, c: 0 }, e: { r: 0, c: colCount - 1 } } ];

    const borderStyle = {
        top: { style: "thin", color: { rgb: "D1D5DB" } },
        bottom: { style: "thin", color: { rgb: "D1D5DB" } },
        left: { style: "thin", color: { rgb: "D1D5DB" } },
        right: { style: "thin", color: { rgb: "D1D5DB" } }
    };
    const headerBorderStyle = {
        top: { style: "thin", color: { rgb: "000000" } },
        bottom: { style: "thin", color: { rgb: "000000" } },
        left: { style: "thin", color: { rgb: "000000" } },
        right: { style: "thin", color: { rgb: "000000" } }
    };

    if (ws['A1']) {
        ws['A1'].s = {
            font: { name: 'Cairo', sz: 15, bold: true, color: { rgb: "DC2626" } },
            alignment: { horizontal: "center", vertical: "center" },
            fill: { fgColor: { rgb: "F9FAFB" } }
        };
    }

    for (let col = 0; col < colCount; col++) {
        const cellRef = XLSX.utils.encode_cell({ r: 1, c: col });
        if (ws[cellRef]) {
            ws[cellRef].s = {
                font: { name: 'Cairo', sz: 12, bold: true, color: { rgb: "FFFFFF" } },
                fill: { fgColor: { rgb: "1E3A8A" } },
                alignment: { horizontal: "center", vertical: "center", wrapText: true },
                border: headerBorderStyle
            };
        }
    }

    const totalRows = wsData.length;
    for (let r = 2; r < totalRows; r++) {
        for (let c = 0; c < colCount; c++) {
            const cellRef = XLSX.utils.encode_cell({ r: r, c: c });
            if (ws[cellRef]) {
                ws[cellRef].t = typeof ws[cellRef].v === 'number' ? 'n' : 's';
                ws[cellRef].s = {
                    font: { name: 'Cairo', sz: 11 },
                    alignment: { horizontal: "center", vertical: "center", wrapText: true },
                    border: borderStyle
                };
            }
        }
    }

    ws['!cols'] = headers.map((h, colIndex) => {
        let maxLen = h ? h.toString().length : 10;
        for (let r = 2; r < totalRows; r++) {
            const val = wsData[r][colIndex];
            if (val !== undefined && val !== null) {
                const len = val.toString().length;
                if (len > maxLen) maxLen = len;
            }
        }
        return { wch: Math.min(Math.max(maxLen + 4, 14), 40) };
    });

    ws['!rows'] = [{ hpt: 35 }, { hpt: 26 }];

    XLSX.utils.book_append_sheet(wb, ws, "التقرير");
    XLSX.writeFile(wb, `${fileName}.xlsx`);
}

// ==========================================
// 5. Auth & Realtime Data (قاعدة بيانات جديدة)
// Collections: members | activities | records
//  members   : {id, name, phone, committee, role:'member'|'hr', followers:[ids], password, date, createdAt}
//  activities: {type:'meeting'|'session'|'event'|'task', mode:'online'|'offline'|'', title, date, code}
//  records   : docId = `${activityId}_${memberId}` -> {activityId, memberId, type, status, source, createdAt}
//              (حضور/تسليم = وجود السجل، والغياب/عدم التسليم = غياب السجل)
// ==========================================
const loading = document.getElementById('loadingOverlay');
const hideLoading = () => { if (loading) { loading.style.opacity = '0'; setTimeout(() => loading.style.display = 'none', 300); } };
window.__ylyLoaded = true;
const failSafeTimer = setTimeout(hideLoading, 5000);

let unsubBase = []; let unsubScoped = [];
function clearScoped() { unsubScoped.forEach(u => u()); unsubScoped = []; }
function clearAllListeners() { clearScoped(); unsubBase.forEach(u => u()); unsubBase = []; }

onAuthStateChanged(auth, (user) => {
    clearTimeout(failSafeTimer);
    clearAllListeners();
    const code = localStorage.getItem('currentMemberId');
    if (!user || !code) { if (!state.isLoggingOut) hideLoading(); return; }
    state.me = null;

    unsubBase.push(onSnapshot(query(collection(db, "members"), where("id", "==", code)), (snap) => {
        if (snap.empty) { hideLoading(); return; }
        const d = snap.docs[0];
        const me = { ...d.data(), docId: d.id };
        const scopeKey = (m) => m ? `${m.role}|${(m.followers || []).join(',')}` : '';
        const changed = scopeKey(state.me) !== scopeKey(me);
        state.me = me;
        if (changed) startScoped();
        applyRole();
        hideLoading();
    }));

    unsubBase.push(onSnapshot(collection(db, "activities"), (snap) => {
        state.activities = [];
        snap.forEach(d => state.activities.push({ ...d.data(), docId: d.id }));
        state.activities.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
        refreshViews();
    }));
});

function startScoped() {
    clearScoped();
    const me = state.me;
    if (!me) return;
    if (me.role === 'hr') {
        const ids = [me.id, ...(me.followers || [])].slice(0, 30);
        unsubScoped.push(onSnapshot(query(collection(db, "members"), where("id", "in", ids)), (snap) => {
            state.members = [];
            snap.forEach(d => state.members.push({ ...d.data(), docId: d.id }));
            refreshViews();
        }));
        unsubScoped.push(onSnapshot(query(collection(db, "records"), where("memberId", "in", ids)), (snap) => {
            state.records = [];
            snap.forEach(d => state.records.push({ ...d.data(), docId: d.id }));
            refreshViews();
        }));
    } else {
        state.members = [me];
        unsubScoped.push(onSnapshot(query(collection(db, "records"), where("memberId", "==", me.id)), (snap) => {
            state.records = [];
            snap.forEach(d => state.records.push({ ...d.data(), docId: d.id }));
            refreshViews();
        }));
    }
}

function applyRole() {
    const me = state.me;
    if (!me) return;
    const isHr = me.role === 'hr';
    document.getElementById('navBar').classList.toggle('hidden', !isHr);
    document.getElementById('hdrUser').innerText = me.name ? me.name.split(' ')[0] : '';
    if (isHr) {
        const tab = localStorage.getItem('activeTab');
        const t = (tab === 'reports') ? 'reports' : 'home';
        window.showTab(t, document.getElementById(`nav-${t}`));
    } else {
        window.showTab('memberDashboard', null);
    }
    refreshViews();
}

function refreshViews() {
    if (!state.me) return;
    state.recMap = {};
    state.records.forEach(r => { state.recMap[`${r.activityId}_${r.memberId}`] = r; });
    if (state.me.role === 'hr') {
        renderHomeFilters();
        renderHome();
        if (document.getElementById('internalMemberPage').classList.contains('active') && state.openMemberId) renderMemberFile(state.openMemberId);
    } else {
        renderMemberDashboard();
    }
}

window.onload = () => {
    today = getEgyptDate();
    document.getElementById('headerDate').innerText = today;
    const rf = document.getElementById('repFrom'), rt = document.getElementById('repTo');
    if (rf) rf.value = today.substring(0, 8) + '01';
    if (rt) rt.value = today;
    if (localStorage.getItem('isLoggedIn') === 'true') {
        document.getElementById('appContent').classList.remove('hidden');
    } else {
        document.getElementById('loginOverlay').style.display = 'flex';
    }
};

window.handleLogin = async function () {
    const code = document.getElementById('loginCode').value.trim();
    const pass = document.getElementById('loginPass').value.trim();
    const errorMsg = document.getElementById('loginError');
    const loginBtn = document.querySelector('.login-btn');
    const fail = (msg) => {
        errorMsg.innerText = msg; errorMsg.classList.remove('hidden');
        loginBtn.innerText = 'تسجيل الدخول'; loginBtn.disabled = false; loginBtn.style.opacity = '1';
    };
    if (!code || !pass) return fail('يرجى إدخال الكود وكلمة المرور');
    errorMsg.classList.add('hidden');
    loginBtn.innerText = 'جاري تسجيل الدخول...'; loginBtn.disabled = true; loginBtn.style.opacity = '0.7';
    localStorage.setItem('currentMemberId', code);
    try {
        await signInWithEmailAndPassword(auth, `${code}@yly.app`, pass);
        proceedLogin();
    } catch (error) {
        try {
            const snap = await getDocs(query(collection(db, "members"), where("id", "==", code), where("password", "==", pass)));
            if (snap.empty) { localStorage.removeItem('currentMemberId'); return fail('الكود أو كلمة المرور غير صحيحة'); }
            try { await createUserWithEmailAndPassword(auth, `${code}@yly.app`, pass); }
            catch (cErr) { await signInWithEmailAndPassword(auth, `${code}@yly.app`, pass); }
            proceedLogin();
        } catch (err) {
            localStorage.removeItem('currentMemberId');
            fail('حدث خطأ أثناء الاتصال بقاعدة البيانات');
        }
    }
};

function proceedLogin() {
    localStorage.setItem('isLoggedIn', 'true');
    document.getElementById('loginOverlay').style.display = 'none';
    document.getElementById('appContent').classList.remove('hidden');
}

window.logout = async function () {
    try {
        state.isLoggingOut = true;
        if (loading) { loading.style.display = 'flex'; loading.style.opacity = '1'; }
        if (auth && auth.currentUser) await signOut(auth);
    } catch (e) { console.error(e); }
    finally { localStorage.clear(); location.reload(); }
};

// ==========================================
// 6. UI Helpers
// ==========================================
window.showTab = async function (id, btn) {
    if (state.isScannerRunning) await window.stopReportScanner();
    document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
    document.getElementById(id).classList.add('active');
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    if (btn) btn.classList.add('active');
    if (id !== 'memberDashboard') localStorage.setItem('activeTab', id);
    window.scrollTo(0, 0);
};

window.toggleCustomDropdown = function (event, menuId) {
    event.stopPropagation();
    const menu = document.getElementById(menuId);
    if (!menu) return;
    const wasHidden = menu.classList.contains('hide');
    window.closeAllDropdowns();
    if (wasHidden) { menu.classList.remove('hide'); menu.classList.add('show'); }
};
window.closeAllDropdowns = function () {
    document.querySelectorAll('.dropdown-menu').forEach(m => { m.classList.remove('show'); m.classList.add('hide'); });
};
window.openInternalPage = function (id) {
    document.getElementById(id).classList.add('active');
    document.body.classList.add('internal-open');
    window.scrollTo(0, 0);
};
window.closeInternalPage = function (id) {
    document.getElementById(id).classList.remove('active');
    document.body.classList.remove('internal-open');
    if (id === 'internalMemberPage') state.openMemberId = null;
};

// قائمة اختيار مخصصة (نفس تصميم القوائم الحالية)
function ddHTML(id, options, value, cb) {
    const cur = options.find(o => o.v === value) || options[0];
    return `<div class="relative w-full">
        <input type="text" id="${id}Display" readonly value="${escapeHTML(cur.t)}" class="w-full p-1 bg-white text-[10px] md:text-sm md:p-2 font-bold border rounded cursor-pointer text-center" onclick="toggleCustomDropdown(event,'${id}Menu')">
        <div id="${id}Menu" class="dropdown-menu hide absolute top-full right-0 mt-1 bg-white border border-blue-200 rounded-lg shadow-2xl z-[100] w-full overflow-hidden text-right max-h-60 overflow-y-auto">
        ${options.map(o => `<div class="p-2 text-xs hover:bg-blue-50 border-b cursor-pointer font-bold text-blue-900" onclick="pickOption('${cb}','${o.v}')">${escapeHTML(o.t)}</div>`).join('')}
        </div></div>`;
}
window.pickOption = function (cb, v) { window.closeAllDropdowns(); window[cb](v); };

window.showCustomAlert = function (title, message, ok) {
    document.getElementById('alertTitle').innerText = title;
    document.getElementById('alertMessage').innerText = message;
    document.getElementById('customAlertModal').style.display = 'flex';
    playSound(ok ? 'success' : 'error');
};
window.closeCustomAlert = function () { document.getElementById('customAlertModal').style.display = 'none'; };

// ==========================================
// 7. Attendance Logic
// ==========================================
const isTask = (a) => a.type === 'task';
const actLabel = (a) => `${a.date} - ${a.title || ''}`;
const typeLabel = (a) => TYPES[a.type] + (a.mode && MODES[a.mode] ? ` (${MODES[a.mode]})` : '');

// الحالة: present | absent | submitted | notsubmitted | upcoming
function statusOf(a, memberId) {
    const rec = state.recMap[`${a.docId}_${memberId}`];
    if (rec) return isTask(a) ? 'submitted' : 'present';
    if ((a.date || '') > today) return 'upcoming';
    return isTask(a) ? 'notsubmitted' : 'absent';
}
const ST = {
    present: ['حضر', 'text-green-700 bg-green-50'],
    absent: ['غاب', 'text-red-700 bg-red-50'],
    submitted: ['سلّم', 'text-green-700 bg-green-50'],
    notsubmitted: ['لم يسلّم', 'text-red-700 bg-red-50'],
    upcoming: ['—', 'text-gray-500 bg-gray-50']
};
const badge = (st) => `<span class="px-2 py-0.5 rounded font-bold text-[10px] md:text-xs ${ST[st][1]}">${ST[st][0]}</span>`;

function calcStats(memberId, acts = state.activities) {
    const s = { present: 0, absent: 0, submitted: 0, notsubmitted: 0 };
    acts.forEach(a => { const st = statusOf(a, memberId); if (s[st] !== undefined) s[st]++; });
    const total = s.present + s.absent;
    s.rate = total ? Math.round((s.present / total) * 100) : null;
    return s;
}
const followedMembers = () => state.members
    .filter(m => state.me && m.id !== state.me.id && (state.me.followers || []).includes(m.id))
    .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ar'));

// ---------- الصفحة الرئيسية: القائمة + الفلترة ----------
window.setHomeType = function (v) { state.selType = v; state.selActivityId = ''; renderHomeFilters(); renderHome(); };
window.setHomeActivity = function (v) { state.selActivityId = v; renderHomeFilters(); renderHome(); };

function renderHomeFilters() {
    const types = [{ v: '', t: 'كل الأنواع' }, ...Object.entries(TYPES).map(([v, t]) => ({ v, t }))];
    const acts = state.activities.filter(a => !state.selType || a.type === state.selType);
    if (state.selActivityId && !acts.some(a => a.docId === state.selActivityId)) state.selActivityId = '';
    const actOpts = [{ v: '', t: 'اختر اليوم / النشاط' }, ...acts.map(a => ({ v: a.docId, t: actLabel(a) }))];
    document.getElementById('homeFilters').innerHTML =
        `<div class="grid grid-cols-2 gap-2">${ddHTML('homeType', types, state.selType, 'setHomeType')}${ddHTML('homeAct', actOpts, state.selActivityId, 'setHomeActivity')}</div>`;
}

function renderHome() {
    const list = followedMembers();
    document.getElementById('followCount').innerText = list.length;
    const act = state.activities.find(a => a.docId === state.selActivityId);
    const head = document.getElementById('homeHead');
    const body = document.getElementById('homeBody');
    const info = document.getElementById('homeActInfo');
    if (!list.length) {
        head.innerHTML = '';
        body.innerHTML = `<tr><td class="text-center text-gray-500 py-4 text-xs">لم يتم تحديد أعضاء لمتابعتهم بعد</td></tr>`;
        info.classList.add('hidden');
        return;
    }
    if (act) {
        info.classList.remove('hidden');
        info.innerHTML = `${typeLabel(act)} — <b>${escapeHTML(act.title)}</b> — ${act.date}`;
        head.innerHTML = `<tr><th class="col-index">م</th><th>الاسم</th><th>اللجنة</th><th>الحالة</th><th class="no-print">إجراء</th></tr>`;
        body.innerHTML = list.map((m, i) => {
            const st = statusOf(act, m.id);
            const action = isTask(act)
                ? `<button onclick="toggleTask('${m.id}')" class="${st === 'submitted' ? 'bg-red-100 text-red-700' : 'bg-green-600 text-white'} px-2 py-1 rounded text-[10px] font-bold">${st === 'submitted' ? 'إلغاء التسليم' : 'تسجيل تسليم'}</button>`
                : `<button onclick="openMemberFile('${m.id}')" class="bg-gray-800 text-white px-2 py-1 rounded text-[10px] font-bold">الملف</button>`;
            return `<tr><td>${i + 1}</td><td class="font-bold">${escapeHTML(m.name)}</td><td>${escapeHTML(m.committee)}</td><td>${badge(st)}</td><td class="no-print">${action}</td></tr>`;
        }).join('');
    } else {
        info.classList.add('hidden');
        head.innerHTML = `<tr><th class="col-index">م</th><th>الاسم</th><th>اللجنة</th><th>حضور</th><th>غياب</th><th>تاسكات</th><th class="no-print">إجراء</th></tr>`;
        body.innerHTML = list.map((m, i) => {
            const s = calcStats(m.id);
            return `<tr><td>${i + 1}</td><td class="font-bold">${escapeHTML(m.name)}</td><td>${escapeHTML(m.committee)}</td>
                <td class="text-green-700 font-bold">${s.present}</td><td class="text-red-700 font-bold">${s.absent}</td>
                <td>${s.submitted}/${s.submitted + s.notsubmitted}</td>
                <td class="no-print"><button onclick="openMemberFile('${m.id}')" class="bg-gray-800 text-white px-2 py-1 rounded text-[10px] font-bold">الملف</button></td></tr>`;
        }).join('');
    }
}

window.toggleTask = async function (memberId) {
    const act = state.activities.find(a => a.docId === state.selActivityId);
    if (!act || !isTask(act)) return;
    const id = `${act.docId}_${memberId}`;
    try {
        if (state.recMap[id]) await deleteDoc(doc(db, "records", id));
        else await setDoc(doc(db, "records", id), {
            activityId: act.docId, memberId, type: 'task', status: 'submitted',
            source: 'hr', markedBy: state.me.id, date: act.date, createdAt: new Date().toISOString()
        });
    } catch (e) { window.showToast('تعذر الحفظ', 'error'); }
};

// ---------- ملف العضو (صفحة داخلية) ----------
function memberFileHTML(m, withQr) {
    const s = calcStats(m.id);
    const rows = state.activities.map(a => `<tr><td>${a.date}</td><td>${typeLabel(a)}</td><td>${escapeHTML(a.title)}</td><td>${badge(statusOf(a, m.id))}</td></tr>`).join('')
        || `<tr><td colspan="4" class="text-center text-gray-500 py-3">لا توجد أنشطة مسجلة</td></tr>`;
    return `<div class="std-dash-card text-center mb-3 border-t-4 border-blue-600">
        ${withQr ? '<div id="dashQr" class="p-2 bg-white border rounded-lg inline-block mb-2"></div>' : ''}
        <h2 class="text-xl font-bold text-gray-900">${escapeHTML(m.name)}</h2>
        <p class="text-gray-500 font-mono font-bold">كود: ${escapeHTML(m.id)}</p>
        <div class="bg-blue-100 rounded-lg p-1 text-xs text-blue-900 font-bold inline-block my-1">${escapeHTML(stageMap[m.committee] || m.committee)}</div>
        <div class="grid grid-cols-3 gap-2 mt-2">
            <div class="bg-green-50 p-2 rounded border border-green-100"><div class="text-2xl font-bold text-green-600">${s.present}</div><div class="text-[10px] text-green-800">حضور</div></div>
            <div class="bg-red-50 p-2 rounded border border-red-100"><div class="text-2xl font-bold text-red-600">${s.absent}</div><div class="text-[10px] text-red-800">غياب</div></div>
            <div class="bg-blue-50 p-2 rounded border border-blue-100"><div class="text-2xl font-bold text-blue-700">${s.rate === null ? '-' : s.rate + '%'}</div><div class="text-[10px] text-blue-800">نسبة الحضور</div></div>
        </div>
    </div>
    <div class="std-dash-card"><div class="overflow-x-auto"><table class="custom-table">
        <thead><tr><th>التاريخ</th><th>النوع</th><th>العنوان</th><th>الحالة</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
}

window.openMemberFile = function (id) {
    state.openMemberId = id;
    renderMemberFile(id);
    window.openInternalPage('internalMemberPage');
};
function renderMemberFile(id) {
    const m = state.members.find(x => x.id === id);
    if (!m) return;
    document.getElementById('memberFileTitle').innerText = m.name;
    document.getElementById('memberFileBody').innerHTML = memberFileHTML(m, false);
}
function memberPrintContent(m) {
    const s = calcStats(m.id);
    const rows = state.activities.map(a => `<tr><td>${a.date}</td><td>${typeLabel(a)}</td><td>${escapeHTML(a.title)}</td><td>${ST[statusOf(a, m.id)][0]}</td></tr>`).join('');
    return `<p style="font-weight:800;margin:4px 0">${escapeHTML(m.name)} — كود ${escapeHTML(m.id)} — ${escapeHTML(stageMap[m.committee] || m.committee)}</p>
        <p style="margin:4px 0">حضور: ${s.present} | غياب: ${s.absent} | نسبة الحضور: ${s.rate === null ? '-' : s.rate + '%'} | تاسكات مسلّمة: ${s.submitted}/${s.submitted + s.notsubmitted}</p>
        <table><thead><tr><th>التاريخ</th><th>النوع</th><th>العنوان</th><th>الحالة</th></tr></thead><tbody>${rows}</tbody></table>`;
}
const currentFileMember = () => state.me.role === 'hr' ? state.members.find(x => x.id === state.openMemberId) : state.me;
window.printMemberFile = function () { const m = currentFileMember(); if (m) window.printHTML(`ملف العضو - ${m.name}`, memberPrintContent(m)); };
window.pdfMemberFile = function () { const m = currentFileMember(); if (m) window.savePDF(`ملف العضو - ${m.name}`, memberPrintContent(m)); };

// ---------- لوحة العضو العادي (حضوره وغيابه فقط) ----------
function renderMemberDashboard() {
    const el = document.getElementById('memberDashBody');
    if (!el || !state.me) return;
    el.innerHTML = memberFileHTML(state.me, true);
    requireQRScanner().then(() => {
        const q = document.getElementById('dashQr');
        if (q && !q.firstChild) new QRCode(q, { text: state.me.id, width: 110, height: 110 });
    }).catch(() => { });
}

// ==========================================
// 8. Reports (صفحة التقارير)
// ==========================================
window.setRepType = function (v) { state.repType = v; renderRepFilter(); };
function renderRepFilter() {
    const types = [{ v: '', t: 'كل الأنواع' }, ...Object.entries(TYPES).map(([v, t]) => ({ v, t }))];
    document.getElementById('repTypeBox').innerHTML = ddHTML('repType', types, state.repType, 'setRepType');
}
renderRepFilter();

// بحث عن عضو بالاسم أو الكود
window.searchMember = function () {
    const q = normalizeArabic(document.getElementById('reportMemberSearch').value.trim());
    const box = document.getElementById('reportSearchResults');
    if (!q) { box.classList.add('hidden'); return; }
    const found = followedMembers().filter(m => normalizeArabic(m.name || '').includes(q) || (m.id || '').startsWith(q));
    box.classList.remove('hidden');
    box.innerHTML = found.length
        ? found.map(m => `<div class="p-2 text-xs hover:bg-blue-50 border-b cursor-pointer font-bold text-blue-900 flex justify-between" onclick="openMemberFile('${m.id}')"><span>${escapeHTML(m.name)}</span><span class="text-gray-500 font-mono">${escapeHTML(m.id)} · ${escapeHTML(m.committee)}</span></div>`).join('')
        : `<div class="p-2 text-xs text-gray-500 text-center">لا توجد نتائج</div>`;
};
window.handleMemberSearch = debounce(() => window.searchMember(), 250);

// بحث بالـ QR
window.startReportScanner = async function () {
    if (state.isScannerRunning) return window.stopReportScanner();
    try {
        await requireQRScanner();
        document.getElementById('reportReaderWrap').classList.remove('hidden');
        state.html5QrCode = new Html5Qrcode('reportReader');
        state.isScannerRunning = true;
        document.getElementById('btnQrScan').innerText = '✖';
        await state.html5QrCode.start({ facingMode: 'environment' }, { fps: 10, qrbox: { width: 200, height: 200 } }, async (text) => {
            const code = (text || '').trim();
            const m = followedMembers().find(x => x.id === code);
            if (!m) { playSound('error'); window.showToast('هذا العضو ليس ضمن متابعتك', 'error'); return; }
            playSound('success');
            await window.stopReportScanner();
            window.openMemberFile(m.id);
        });
    } catch (e) {
        state.isScannerRunning = false;
        document.getElementById('reportReaderWrap').classList.add('hidden');
        document.getElementById('btnQrScan').innerText = '📷';
        window.showToast('تعذر تشغيل الكاميرا', 'error');
    }
};
window.stopReportScanner = async function () {
    try { if (state.html5QrCode) { await state.html5QrCode.stop(); state.html5QrCode.clear(); } } catch (e) { }
    state.html5QrCode = null; state.isScannerRunning = false;
    document.getElementById('reportReaderWrap').classList.add('hidden');
    document.getElementById('btnQrScan').innerText = '📷';
};

// تقرير عام للأعضاء المتابَعين
window.generateReport = function () {
    const from = document.getElementById('repFrom').value, to = document.getElementById('repTo').value;
    const acts = state.activities.filter(a => (!state.repType || a.type === state.repType) && (!from || a.date >= from) && (!to || a.date <= to));
    const list = followedMembers();
    if (!list.length) return window.showToast('لا يوجد أعضاء متابَعون', 'error');
    if (!acts.length) return window.showToast('لا توجد أنشطة في هذه الفترة', 'error');
    const title = `تقرير ${state.repType ? TYPES[state.repType] : 'الأنشطة'} (${from || '...'} → ${to || '...'})`;
    state.reportHeaders = ['م', 'الاسم', 'اللجنة', 'حضور', 'غياب', 'سلّم', 'لم يسلّم', 'نسبة الحضور'];
    state.reportRows = list.map((m, i) => {
        const s = calcStats(m.id, acts);
        return [i + 1, m.name, m.committee, s.present, s.absent, s.submitted, s.notsubmitted, s.rate === null ? '-' : s.rate + '%'];
    });
    state.reportTitle = title;
    document.getElementById('reportResult').classList.remove('hidden');
    document.getElementById('reportResultTitle').innerText = title;
    document.getElementById('reportTable').innerHTML =
        `<thead><tr>${state.reportHeaders.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${state.reportRows.map(r => `<tr>${r.map(c => `<td>${escapeHTML(c)}</td>`).join('')}</tr>`).join('')}</tbody>`;
};
const reportHTML = () => `<table><thead><tr>${state.reportHeaders.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${state.reportRows.map(r => `<tr>${r.map(c => `<td>${escapeHTML(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
window.printReport = () => state.reportRows.length && window.printHTML(state.reportTitle, reportHTML());
window.pdfReport = () => state.reportRows.length && window.savePDF(state.reportTitle, reportHTML());
window.excelReport = () => state.reportRows.length && window.exportToExcelStyle(state.reportHeaders, state.reportRows, state.reportTitle, `YLY_Report_${today}`);
