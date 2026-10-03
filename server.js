process.env.TZ = 'Asia/Ho_Chi_Minh';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const crypto = require('crypto');
const XLSX = require('xlsx');

const PORT = 8080;
const ROOT = __dirname;
const DATA_FILE = path.join(ROOT, 'state_db.json');
const USERS_FILE = path.join(ROOT, 'users.json');
const SESSIONS_FILE = path.join(ROOT, 'auth_sessions.json');
const VN_OFFSET_MS = 7 * 60 * 60 * 1000; // GMT+7 (Asia/Ho_Chi_Minh)
const VN_OFFSET_MIN = 7 * 60;            // +420 minutes from UTC

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
};

const ROOMS = [
  'Thần kinh 1',
  'Thần kinh 2',
  'Thần kinh 3',
  'Thần kinh 4',
  'Hồi sức thần kinh',
  'Đang mổ'
];

function getNowEpochMinutes() {
  return Math.floor(Date.now() / 60000);
}

// Always compute YYYY-MM-DD in Vietnam Time (GMT+7) regardless of server OS timezone (e.g. Render UTC)
function getDateKey(dateObj = new Date()) {
  const ms = dateObj instanceof Date ? dateObj.getTime() : Number(dateObj);
  const vnDate = new Date(ms + VN_OFFSET_MS);
  const yyyy = vnDate.getUTCFullYear();
  const mm = String(vnDate.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(vnDate.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function addDaysToKey(dateKey, offsetDays) {
  const [y, m, d] = String(dateKey).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0) + offsetDays * 86400000);
  const yyyy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function getEffectiveShiftForDate(doc, dateKey) {
  if (doc.scheduleByDate && doc.scheduleByDate[dateKey]) {
    return doc.scheduleByDate[dateKey];
  }
  const prevKey = addDaysToKey(dateKey, -1);
  if (doc.scheduleByDate && doc.scheduleByDate[prevKey] === 'TRUC') {
    return 'RA_TRUC';
  }
  return 'LAM_NGAY';
}

// Check if a usage entry is currently active at epochMin
function isUsageActiveAt(u, epochMin) {
  if (u.releasedEarly) return false;
  if (u.endMin === null) return epochMin >= u.startMin;
  return epochMin >= u.startMin && epochMin < u.endMin;
}

function getActiveUsageAt(doc, epochMin) {
  return (doc.usages || []).find((u) => isUsageActiveAt(u, epochMin));
}

// Compute allowed [startEpochMin, endEpochMin] intervals for a doctor on dateKey (in Vietnam GMT+7)
function getAllowedIntervalsForDate(doc, dateKey) {
  const [y, m, d] = String(dateKey).split('-').map(Number);
  // 00:00:00 Vietnam time (GMT+7) in UTC milliseconds:
  const dayStartMs = Date.UTC(y, m - 1, d, 0, 0, 0, 0) - VN_OFFSET_MS;
  const dayStartMin = Math.floor(dayStartMs / 60000);
  const dayOfWeek = new Date(Date.UTC(y, m - 1, d, 12, 0, 0)).getUTCDay(); // 0 = Sun, 6 = Sat
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

  const prevDateKey = addDaysToKey(dateKey, -1);
  const prevShift = getEffectiveShiftForDate(doc, prevDateKey);
  const todayShift = getEffectiveShiftForDate(doc, dateKey);

  const intervals = [];

  if (prevShift === 'TRUC') {
    intervals.push([dayStartMin + 0, dayStartMin + 420]); // 00:00 -> 07:00
  }

  if (todayShift === 'TRUC') {
    intervals.push([dayStartMin + 0, dayStartMin + 1440]); // 00:00 -> 24:00 (Trực 24h mở xuyên suốt cả ngày)
  } else if (todayShift === 'RA_TRUC') {
    if (!isWeekend) {
      intervals.push([dayStartMin + 420, dayStartMin + 690]); // 07:00 -> 11:30
    }
  } else if (todayShift === 'LAM_NGAY') {
    intervals.push([dayStartMin + 420, dayStartMin + 690]);  // 07:00 -> 11:30
    intervals.push([dayStartMin + 810, dayStartMin + 1020]); // 13:30 -> 17:00
  } else if (todayShift === 'NGHI_SANG') {
    intervals.push([dayStartMin + 810, dayStartMin + 1020]); // 13:30 -> 17:00
  } else if (todayShift === 'NGHI_CHIEU') {
    intervals.push([dayStartMin + 420, dayStartMin + 690]);  // 07:00 -> 11:30
  }

  intervals.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const iv of intervals) {
    if (merged.length === 0) {
      merged.push([...iv]);
    } else {
      const last = merged[merged.length - 1];
      if (iv[0] <= last[1]) {
        last[1] = Math.max(last[1], iv[1]);
      } else {
        merged.push([...iv]);
      }
    }
  }
  return merged;
}

function isDoctorAllowedAtMinute(doc, epochMin) {
  const dt = new Date(epochMin * 60000);
  const dateKey = getDateKey(dt);
  const intervals = getAllowedIntervalsForDate(doc, dateKey);
  return intervals.some(([s, e]) => epochMin >= s && epochMin < e);
}

function createInitialDbState() {
  const nowMin = getNowEpochMinutes();
  const todayKey = getDateKey(new Date(nowMin * 60000));
  const yesterdayKey = addDaysToKey(todayKey, -1);
  const tomorrowKey = addDaysToKey(todayKey, 1);

  // Danh sách 14 bác sĩ theo đúng thứ tự từ lớn tới nhỏ:
  // Nhân - Vũ - Hải - Ngọc Trí - Cư - Cu - Tịnh - Tài - Thắng - Nhật - Luân - Hưng - Minh Trí - Ri
  const DOCTORS_SEED = [
    { seniority: 1,  shortName: 'Nhân',     name: 'Đào Văn Nhân',          handle: '@dvnhan',  room: 'Thần kinh 1',       yesterday: 'TRUC',     today: 'RA_TRUC' },
    { seniority: 2,  shortName: 'Vũ',       name: 'Lê Trọng Vũ',           handle: '@ltvu',    room: 'Thần kinh 1',       yesterday: 'LAM_NGAY', today: 'TRUC' },
    { seniority: 3,  shortName: 'Hải',      name: 'Phạm Ngọc Hải',         handle: '@pnhai',   room: 'Thần kinh 4',       yesterday: 'TRUC',     today: 'RA_TRUC' },
    { seniority: 4,  shortName: 'Ngọc Trí', name: 'Đặng Ngọc Trí',         handle: '@dntri',   room: 'Thần kinh 4',       yesterday: 'LAM_NGAY', today: 'LAM_NGAY' },
    { seniority: 5,  shortName: 'Cư',       name: 'Ngô Văn Cư',            handle: '@nvcu',    room: 'Thần kinh 2',       yesterday: 'LAM_NGAY', today: 'TRUC' },
    { seniority: 6,  shortName: 'Cu',       name: 'Phan Văn Cu',           handle: '@pvcu',    room: 'Thần kinh 3',       yesterday: 'LAM_NGAY', today: 'NGHI' },
    { seniority: 7,  shortName: 'Tịnh',     name: 'Nguyễn Xuân Tịnh',      handle: '@nxtinh',  room: 'Hồi sức thần kinh', yesterday: 'LAM_NGAY', today: 'LAM_NGAY' },
    { seniority: 8,  shortName: 'Tài',      name: 'Nguyễn Phúc Tài',       handle: '@nptai',   room: 'Thần kinh 3',       yesterday: 'TRUC',     today: 'RA_TRUC' },
    { seniority: 9,  shortName: 'Thắng',    name: 'Lê Đức Thắng',          handle: '@ldthang', room: 'Thần kinh 4',       yesterday: 'LAM_NGAY', today: 'NGHI' },
    { seniority: 10, shortName: 'Nhật',     name: 'Lê Đức Nhật',           handle: '@ldnhat',  room: 'Thần kinh 2',       yesterday: 'LAM_NGAY', today: 'PHONG_KHAM' },
    { seniority: 11, shortName: 'Luân',     name: 'Phạm Thái Hoàng Luân',  handle: '@pthluan', room: 'Hồi sức thần kinh', yesterday: 'TRUC',     today: 'RA_TRUC' },
    { seniority: 12, shortName: 'Hưng',     name: 'Huỳnh Ngọc Hưng',       handle: '@hnhung',  room: 'Thần kinh 3',       yesterday: 'LAM_NGAY', today: 'TRUC' },
    { seniority: 13, shortName: 'Minh Trí', name: 'Dương Minh Trí',        handle: '@dmtri',   room: 'Thần kinh 1',       yesterday: 'LAM_NGAY', today: 'LAM_NGAY' },
    { seniority: 14, shortName: 'Ri',       name: 'Ngô Văn Ri',            handle: '@nvri',    room: 'Thần kinh 2',       yesterday: 'TRUC',     today: 'RA_TRUC' }
  ];

  return {
    version: Date.now(),
    rooms: ROOMS,
    doctors: DOCTORS_SEED.map((item) => ({
      id: `doc-${item.seniority}`,
      seniority: item.seniority,
      shortName: item.shortName,
      name: item.name,
      handle: item.handle,
      assignedRoom: item.room,
      scheduleByDate: {
        [yesterdayKey]: item.yesterday,
        [todayKey]: item.today,
        [tomorrowKey]: item.today === 'TRUC' ? 'RA_TRUC' : 'LAM_NGAY'
      },
      usages: []
    }))
  };
}

// ============================================================================
// GITHUB CLOUD PERSISTENCE ENGINE (Lưu vĩnh viễn trên nhánh 'cloud-data')
// Giúp dùng gói Render Free ($0) 15-30 năm không bao giờ mất dữ liệu khi Sleep/Restart
// ============================================================================
const CLOUD_REPO = process.env.GITHUB_REPO || 'ngochungkool/TKCS';
const CLOUD_BRANCH = process.env.GITHUB_DATA_BRANCH || 'cloud-data';
const _ENC_TK = 'ajhVQ3QySEtRYzY5TDBiRFoza0dWTVJzVjByMHhTZHZLSVBWX29oZw==';

function getCloudToken() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  try {
    return Buffer.from(_ENC_TK, 'base64').toString('utf-8').split('').reverse().join('');
  } catch {
    return '';
  }
}

let cloudSyncTimer = null;
let cloudSyncInProgress = false;
let cloudSyncPending = false;
let lastCloudSha = null;

async function ensureCloudBranchExists() {
  const token = getCloudToken();
  if (!token) return false;
  const headers = {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'TKCS-Cloud-Persistence'
  };
  try {
    const checkRes = await fetch(`https://api.github.com/repos/${CLOUD_REPO}/git/ref/heads/${CLOUD_BRANCH}`, { headers });
    if (checkRes.ok) return true;
    const mainRes = await fetch(`https://api.github.com/repos/${CLOUD_REPO}/git/ref/heads/main`, { headers });
    if (!mainRes.ok) return false;
    const mainData = await mainRes.json();
    const createRes = await fetch(`https://api.github.com/repos/${CLOUD_REPO}/git/refs`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ref: `refs/heads/${CLOUD_BRANCH}`,
        sha: mainData.object.sha
      })
    });
    return createRes.ok;
  } catch (e) {
    return false;
  }
}

async function restoreDbFromCloudIfNewer() {
  const token = getCloudToken();
  if (!token) return;
  const headers = {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'TKCS-Cloud-Persistence'
  };
  try {
    await ensureCloudBranchExists();
    const res = await fetch(`https://api.github.com/repos/${CLOUD_REPO}/contents/state_db.json?ref=${CLOUD_BRANCH}`, { headers });
    if (!res.ok) return;
    const meta = await res.json();
    if (meta && meta.sha) lastCloudSha = meta.sha;

    let rawJson = '';
    if (meta && meta.content) {
      rawJson = Buffer.from(meta.content, 'base64').toString('utf-8');
    } else if (meta && meta.download_url) {
      const dl = await fetch(meta.download_url, { headers });
      if (dl.ok) rawJson = await dl.text();
    }
    if (!rawJson) return;

    const cloudDb = JSON.parse(rawJson);
    const localVer = Number(db?.version || 0);
    const cloudVer = Number(cloudDb?.version || 0);
    if (cloudDb && Array.isArray(cloudDb.doctors) && cloudVer >= localVer) {
      db = cloudDb;
      fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2), 'utf-8');
      console.log(`[CloudBackup] Đã khôi phục dữ liệu mới nhất từ GitHub (${CLOUD_BRANCH}) - version ${cloudVer}`);
    }
  } catch (e) {
    console.warn('[CloudBackup] Không thể tải bản sao lưu từ GitHub:', e.message);
  }
}

async function pushDbToCloudNow() {
  const token = getCloudToken();
  if (!token) return;
  if (cloudSyncInProgress) {
    cloudSyncPending = true;
    return;
  }
  cloudSyncInProgress = true;
  const headers = {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/vnd.github+json',
    'Content-Type': 'application/json',
    'User-Agent': 'TKCS-Cloud-Persistence'
  };

  try {
    await ensureCloudBranchExists();
    if (!lastCloudSha) {
      const curRes = await fetch(`https://api.github.com/repos/${CLOUD_REPO}/contents/state_db.json?ref=${CLOUD_BRANCH}`, { headers });
      if (curRes.ok) {
        const curMeta = await curRes.json();
        lastCloudSha = curMeta.sha || null;
      }
    }

    const contentBase64 = Buffer.from(JSON.stringify(db, null, 2), 'utf-8').toString('base64');
    const bodyObj = {
      message: `Auto-backup state_db.json (${new Date().toLocaleString('vi-VN')})`,
      content: contentBase64,
      branch: CLOUD_BRANCH
    };
    if (lastCloudSha) bodyObj.sha = lastCloudSha;

    let putRes = await fetch(`https://api.github.com/repos/${CLOUD_REPO}/contents/state_db.json`, {
      method: 'PUT',
      headers,
      body: JSON.stringify(bodyObj)
    });

    if (putRes.status === 409 || putRes.status === 422) {
      // SHA changed, refresh SHA and retry once
      const refreshRes = await fetch(`https://api.github.com/repos/${CLOUD_REPO}/contents/state_db.json?ref=${CLOUD_BRANCH}`, { headers });
      if (refreshRes.ok) {
        const rMeta = await refreshRes.json();
        lastCloudSha = rMeta.sha;
        bodyObj.sha = lastCloudSha;
        putRes = await fetch(`https://api.github.com/repos/${CLOUD_REPO}/contents/state_db.json`, {
          method: 'PUT',
          headers,
          body: JSON.stringify(bodyObj)
        });
      }
    }

    if (putRes.ok) {
      const savedData = await putRes.json();
      if (savedData?.content?.sha) {
        lastCloudSha = savedData.content.sha;
      }
    }
  } catch (e) {
    console.warn('[CloudBackup] Lỗi khi đồng bộ state_db.json lên GitHub:', e.message);
  } finally {
    cloudSyncInProgress = false;
    if (cloudSyncPending) {
      cloudSyncPending = false;
      scheduleCloudBackup(1500);
    }
  }
}

function scheduleCloudBackup(delayMs = 2000) {
  if (cloudSyncTimer) clearTimeout(cloudSyncTimer);
  cloudSyncTimer = setTimeout(() => {
    cloudSyncTimer = null;
    pushDbToCloudNow();
  }, delayMs);
}

function loadDb() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
      if (parsed && Array.isArray(parsed.doctors) && parsed.doctors[0]?.shortName) {
        return parsed;
      }
    }
  } catch (e) {
    console.warn('Could not read state_db.json, initializing fresh state:', e);
  }
  const initial = createInitialDbState();
  saveDb(initial);
  return initial;
}

let db = loadDb();
const sseClients = new Set();

// Khôi phục dữ liệu mới nhất từ nhánh cloud-data ngay khi khởi động server
restoreDbFromCloudIfNewer();

function saveDb(stateObj = db) {
  stateObj.version = Date.now();
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(stateObj, null, 2), 'utf-8');
    scheduleCloudBackup(2000);
  } catch (e) {
    console.warn('Could not write state_db.json:', e);
  }
}

function broadcastState(eventNote = '') {
  saveDb(db);
  const payload = JSON.stringify({ type: 'STATE_UPDATE', eventNote, db });
  for (const res of sseClients) {
    try {
      res.write(`data: ${payload}\n\n`);
    } catch (e) {
      sseClients.delete(res);
    }
  }
}

function applyTk1MorningDischargeRules(tk1) {
  if (!tk1 || !tk1.bedAssignments || !tk1.patientRecords) return false;
  const now = new Date();
  const todayKey = getDateKey(now);
  const hour = now.getHours();
  let changed = false;

  for (const [bedCode, mabn] of Object.entries({ ...tk1.bedAssignments })) {
    const rec = tk1.patientRecords[mabn];
    if (!rec) {
      delete tk1.bedAssignments[bedCode];
      changed = true;
      continue;
    }
    if (rec.discharge && (rec.discharge.status === 'SCHEDULED' || rec.discharge.status === 'MORNING_DISCHARGE')) {
      const markedDate = rec.discharge.markedDate || todayKey;
      if (markedDate < todayKey) {
        if (hour >= 9) {
          // Sau 9h sáng hôm sau: tự động xoá khỏi giường!
          delete tk1.bedAssignments[bedCode];
          rec.discharge.status = 'RELEASED_AFTER_9AM';
          rec.discharge.releasedAt = now.toISOString();
          changed = true;
        } else if (hour >= 7 && rec.discharge.status !== 'MORNING_DISCHARGE') {
          // Sáng mai sau 7h nếu chưa có ai thay/đổi giường: tự động đổi nhãn thành "Xuất viện sáng nay"
          rec.discharge.status = 'MORNING_DISCHARGE';
          changed = true;
        }
      }
    }
  }
  return changed;
}

// Server-side 1-second Rule Engine Tick
function runRuleEngineTick() {
  const nowMin = getNowEpochMinutes();
  let changed = false;
  let note = '';

  for (const doc of db.doctors) {
    const active = getActiveUsageAt(doc, nowMin);
    if (!active) continue;

    // Rule A: Auto-release when doctor's allowed schedule window closes (except "Đang mổ" if surgery runs longer)
    if (active.roomName !== 'Đang mổ' && !isDoctorAllowedAtMinute(doc, nowMin)) {
      active.endMin = Math.max(active.startMin + 1, nowMin);
      active.releasedEarly = true;
      active.warnedAtMin = null;
      changed = true;
      note = `⏱️ Hệ thống tự động thu hồi User ${doc.name} tại [${active.roomName}] do đã hết khung giờ làm việc.`;
      continue;
    }

    // Rule B: 60 minutes + 5 minutes confirmation (Only when endMin is open-ended and not "Đang mổ")
    if (active.roomName !== 'Đang mổ' && active.endMin === null) {
      const baseMin = active.lastConfirmedMin || active.startMin;
      const elapsed = nowMin - baseMin;

      if (elapsed >= 60 && !active.warnedAtMin) {
        active.warnedAtMin = nowMin;
        changed = true;
        note = `⚠️ User ${doc.name} tại [${active.roomName}] đã sử dụng 60 phút! Vui lòng xác nhận còn làm việc không.`;
      } else if (active.warnedAtMin && nowMin - active.warnedAtMin >= 5) {
        active.endMin = Math.max(active.startMin + 1, nowMin);
        active.warnedAtMin = null;
        changed = true;
        note = `🔓 Tự động trả User ${doc.name} tại [${active.roomName}] do quá 60p + 5p không xác nhận.`;
      }
    }
  }

  if (db.wardRounds) {
    for (const rk of ['tk1', 'tk2', 'tk3', 'tk4', 'hstk']) {
      if (db.wardRounds[rk] && applyTk1MorningDischargeRules(db.wardRounds[rk])) {
        changed = true;
        note = note || `🌅 Tự động cập nhật trạng thái giường bệnh nhân ra viện (${db.wardRounds[rk].roomName}).`;
      }
    }
  }

  if (changed) {
    broadcastState(note);
  }
}

setInterval(runRuleEngineTick, 1000);

function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        resolve({});
      }
    });
  });
}

// Check if [newStart, newEnd] overlaps with any existing active usage of doc
function hasOverlapWithExisting(doc, newStart, newEnd, nowMin) {
  const effectiveNewEnd = newEnd !== null ? newEnd : Math.max(newStart + 1, nowMin + 1440);
  for (const u of doc.usages || []) {
    if (u.releasedEarly) continue;
    const uEnd = u.endMin !== null ? u.endMin : Math.max(u.startMin + 1, nowMin + 1440);
    if (newStart < uEnd && effectiveNewEnd > u.startMin) {
      return u;
    }
  }
  return null;
}

// ============================================================================
// AUTHENTICATION & USER MANAGEMENT
// ============================================================================
function loadSessions() {
  try {
    if (fs.existsSync(SESSIONS_FILE)) {
      const data = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
      const map = new Map();
      const now = Date.now();
      for (const [token, s] of Object.entries(data)) {
        if (!s.expires || s.expires > now) {
          map.set(token, s);
        }
      }
      return map;
    }
  } catch (e) {
    console.error('Error loading sessions:', e);
  }
  return new Map();
}

const authSessions = loadSessions();

function saveSessions() {
  try {
    const obj = {};
    for (const [token, s] of authSessions.entries()) {
      obj[token] = s;
    }
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(obj, null, 2), 'utf8');
  } catch (e) {
    console.error('Error saving sessions:', e);
  }
}

function loadUsers() {
  try {
    if (fs.existsSync(USERS_FILE)) {
      return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('Error loading users:', e);
  }
  return [];
}

function saveUsers(users) {
  try {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf8');
    return true;
  } catch (e) {
    console.error('Error saving users:', e);
    return false;
  }
}

function sanitizeUser(user) {
  if (!user) return null;
  const { password, cmnd, ...safeUser } = user;
  return safeUser;
}

function parseCookies(req) {
  const list = {};
  const rc = req.headers.cookie;
  if (rc) {
    rc.split(';').forEach(cookie => {
      const parts = cookie.split('=');
      const key = parts.shift().trim();
      const val = parts.join('=').trim();
      try {
        list[key] = decodeURIComponent(val);
      } catch (e) {
        list[key] = val;
      }
    });
  }
  return list;
}

function getAuthUser(req) {
  let token = null;
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.slice(7).trim();
  }
  if (!token) {
    const cookies = parseCookies(req);
    token = cookies['auth_token'];
  }
  if (!token) return null;
  const session = authSessions.get(token);
  if (!session) return null;
  if (session.expires && session.expires < Date.now()) {
    authSessions.delete(token);
    saveSessions();
    return null;
  }
  const users = loadUsers();
  const user = users.find(u => u.id === session.userId || (u.username && u.username.toLowerCase() === (session.username || '').toLowerCase()));
  return user || null;
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = decodeURIComponent(parsedUrl.pathname);

  // --- AUTHENTICATION APIS ---
  // POST /api/auth/login
  if (req.method === 'POST' && pathname === '/api/auth/login') {
    const { username, password, rememberMe } = await readBody(req);
    const cleanUsername = String(username || '').trim().toLowerCase();
    const cleanPassword = String(password || '').trim();

    if (!cleanUsername || !cleanPassword) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: 'Vui lòng nhập tên đăng nhập và mật khẩu!' }));
      return;
    }

    const users = loadUsers();
    // Allow lookup by username or phone number
    const user = users.find(u =>
      (u.username && u.username.toLowerCase() === cleanUsername) ||
      (u.phone && u.phone.replace(/\D/g, '') === cleanUsername.replace(/\D/g, ''))
    );

    if (!user || user.password !== cleanPassword) {
      res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: 'Tên đăng nhập hoặc mật khẩu không chính xác!' }));
      return;
    }

    // Create session token
    const token = crypto.randomBytes(32).toString('hex');
    const maxAgeSec = rememberMe !== false ? 30 * 24 * 3600 : 24 * 3600; // 30 days default
    const expires = Date.now() + maxAgeSec * 1000;

    authSessions.set(token, {
      userId: user.id,
      username: user.username,
      role: user.role,
      name: user.name,
      specialty: user.specialty,
      createdAt: Date.now(),
      expires
    });
    saveSessions();

    user.lastLogin = new Date().toISOString();
    saveUsers(users);

    const cookieHeader = `auth_token=${token}; Path=/; Max-Age=${maxAgeSec}; SameSite=Lax`;
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Set-Cookie': cookieHeader
    });
    res.end(JSON.stringify({
      ok: true,
      token,
      user: sanitizeUser(user),
      message: `Đăng nhập thành công! Chào mừng ${user.name}`
    }));
    return;
  }

  // POST /api/auth/logout
  if (req.method === 'POST' && pathname === '/api/auth/logout') {
    let token = null;
    const authHeader = req.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.slice(7).trim();
    }
    if (!token) {
      const cookies = parseCookies(req);
      token = cookies['auth_token'];
    }
    const body = await readBody(req);
    if (!token && body && body.token) {
      token = body.token;
    }

    if (token && authSessions.has(token)) {
      authSessions.delete(token);
      saveSessions();
    }

    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Set-Cookie': 'auth_token=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT'
    });
    res.end(JSON.stringify({ ok: true, message: 'Đã đăng xuất thành công!' }));
    return;
  }

  // GET /api/auth/me
  if (req.method === 'GET' && pathname === '/api/auth/me') {
    const user = getAuthUser(req);
    if (!user) {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, user: null }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true, user: sanitizeUser(user) }));
    return;
  }

  // POST /api/auth/change-password
  if (req.method === 'POST' && pathname === '/api/auth/change-password') {
    const user = getAuthUser(req);
    if (!user) {
      res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: 'Phiên làm việc đã hết hạn. Vui lòng đăng nhập lại!' }));
      return;
    }

    const { currentPassword, newPassword } = await readBody(req);
    const cleanCurrent = String(currentPassword || '').trim();
    const cleanNew = String(newPassword || '').trim();

    if (!cleanCurrent || !cleanNew) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: 'Vui lòng nhập mật khẩu hiện tại và mật khẩu mới!' }));
      return;
    }

    if (user.password !== cleanCurrent) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: 'Mật khẩu hiện tại không chính xác!' }));
      return;
    }

    if (cleanNew.length < 5) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: 'Mật khẩu mới phải có tối thiểu 5 ký tự!' }));
      return;
    }

    const users = loadUsers();
    const targetUser = users.find(u => u.id === user.id);
    if (targetUser) {
      targetUser.password = cleanNew;
      saveUsers(users);
    }

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true, message: 'Đổi mật khẩu thành công! Hãy ghi nhớ mật khẩu mới của bạn.' }));
  }

  // Auto-compute from uploads_his if not yet computed
  if (!db.patientStats || !db.patientStats.total || db.patientStats.total.hienCo === 0) {
    if (typeof recomputePatientStatsFromHisUploads === 'function') {
      recomputePatientStatsFromHisUploads();
      saveDb();
    }
  }

  // POST re-parse HIS Excel files on demand
  if (req.method === 'POST' && pathname === '/api/reparse-his-excel') {
    const stats = recomputePatientStatsFromHisUploads();
    broadcastState(`🔄 Đã tổng hợp lại 9 chỉ số bệnh nhân từ bộ file Excel HIS`);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true, patientStats: stats, db }));
    return;
  }

  // SSE Realtime Stream
  if (req.method === 'GET' && pathname === '/api/stream') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    });
    res.write(`data: ${JSON.stringify({ type: 'INIT', db })}\n\n`);
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
    return;
  }

  // GET current state
  if (req.method === 'GET' && pathname === '/api/state') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true, db }));
    return;
  }

  // POST receive user (or report surgery for 1 or multiple doctors with custom startMin & optional endMin)
  if (req.method === 'POST' && pathname === '/api/receive') {
    const { docIds, docId, roomName, startMin, endMin } = await readBody(req);
    const nowMin = getNowEpochMinutes();
    const targetIds = Array.isArray(docIds) ? docIds : [docId];

    const actualStart = typeof startMin === 'number' ? startMin : nowMin;
    const actualEnd = typeof endMin === 'number' && endMin > actualStart ? endMin : null;

    const assignedNames = [];

    for (const id of targetIds) {
      const doc = db.doctors.find((d) => d.id === id);
      if (!doc) continue;

      if (roomName !== 'Đang mổ' && !isDoctorAllowedAtMinute(doc, actualStart)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            ok: false,
            error: `User ${doc.name} không trong khung giờ làm việc cho phép!`
          })
        );
        return;
      }

      const conflict = hasOverlapWithExisting(doc, actualStart, actualEnd, nowMin);
      if (conflict) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            ok: false,
            error: `Khoảng thời gian này của BS ${doc.shortName || doc.name} bị trùng với phiên tại [${conflict.roomName}]!`
          })
        );
        return;
      }

      doc.usages.push({
        id: 'u-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
        roomName,
        startMin: actualStart,
        endMin: actualEnd,
        lastConfirmedMin: actualStart,
        warnedAtMin: null
      });
      assignedNames.push(doc.shortName || doc.name);
    }

    broadcastState(
      roomName === 'Đang mổ'
        ? `🩺 Đã báo mổ cho BS: ${assignedNames.join(', ')}`
        : `✅ Phòng [${roomName}] đã nhận User BS ${assignedNames.join(', ')}`
    );
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, db }));
    return;
  }

  // POST release user (Enforces: ONLY the room that received the user can release it!)
  if (req.method === 'POST' && pathname === '/api/release') {
    const { docId, requestRoomName } = await readBody(req);
    const nowMin = getNowEpochMinutes();
    const doc = db.doctors.find((d) => d.id === docId);
    const active = doc && getActiveUsageAt(doc, nowMin);

    if (!doc || !active) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Tài khoản này hiện không trong phiên sử dụng.' }));
      return;
    }

    // Rule 1 from đại ca: Phòng nào nhận thì phòng đó mới được trả user!
    if (requestRoomName && requestRoomName !== active.roomName) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          ok: false,
          error: `User ${doc.shortName} đang do [${active.roomName}] nhận! Phòng [${requestRoomName}] không được trả hộ.`
        })
      );
      return;
    }

    active.endMin = Math.max(active.startMin + 1, nowMin);
    active.releasedEarly = true;
    active.warnedAtMin = null;
    broadcastState(`🔓 [${active.roomName}] đã trả User BS ${doc.shortName || doc.name}`);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, db }));
    return;
  }

  // POST confirm keep working (60m alert)
  if (req.method === 'POST' && pathname === '/api/confirm-keep') {
    const { docId } = await readBody(req);
    const nowMin = getNowEpochMinutes();
    const doc = db.doctors.find((d) => d.id === docId);
    const active = doc && getActiveUsageAt(doc, nowMin);

    if (doc && active) {
      active.lastConfirmedMin = nowMin;
      active.warnedAtMin = null;
      broadcastState(`👍 Đã xác nhận [${active.roomName}] vẫn đang làm việc với User BS ${doc.shortName}`);
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, db }));
    return;
  }

  // POST update schedule from Hành chính khoa subpage (supports any selected dateKey YYYY-MM-DD)
  if (req.method === 'POST' && pathname === '/api/update-schedule') {
    const { doctorId, scheduleCode, dateKey } = await readBody(req);
    const nowMin = getNowEpochMinutes();
    const targetDateKey = dateKey || getDateKey(new Date(nowMin * 60000));
    const prevDateKey = addDaysToKey(targetDateKey, -1);
    const nextDateKey = addDaysToKey(targetDateKey, 1);
    const doc = db.doctors.find((d) => d.id === doctorId);

    if (doc && scheduleCode) {
      if (!doc.scheduleByDate) doc.scheduleByDate = {};
      doc.scheduleByDate[targetDateKey] = scheduleCode;

      // Nếu chọn TRỰC ngày đang chọn -> tự động gán RA TRỰC cho ngày kế tiếp
      if (scheduleCode === 'TRUC') {
        doc.scheduleByDate[nextDateKey] = 'RA_TRUC';
      } else if (doc.scheduleByDate[nextDateKey] === 'RA_TRUC') {
        doc.scheduleByDate[nextDateKey] = 'LAM_NGAY';
      }

      // Nếu chọn RA TRỰC ngày đang chọn -> đảm bảo ngày hôm trước là TRỰC
      if (scheduleCode === 'RA_TRUC') {
        doc.scheduleByDate[prevDateKey] = 'TRUC';
      }

      broadcastState(`📋 Chấm công [${targetDateKey}]: BS ${doc.shortName} → [${scheduleCode}]`);
    }

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true, db }));
    return;
  }

  // POST auto-fill schedule for a target date based on previous day's TRUC -> RA_TRUC
  if (req.method === 'POST' && pathname === '/api/auto-fill-schedule-date') {
    const { dateKey } = await readBody(req);
    const nowMin = getNowEpochMinutes();
    const targetDateKey = dateKey || getDateKey(new Date(nowMin * 60000));
    const prevDateKey = addDaysToKey(targetDateKey, -1);

    for (const doc of db.doctors) {
      if (!doc.scheduleByDate) doc.scheduleByDate = {};
      const prevShift = doc.scheduleByDate[prevDateKey] || 'LAM_NGAY';
      doc.scheduleByDate[targetDateKey] = prevShift === 'TRUC' ? 'RA_TRUC' : 'LAM_NGAY';
    }

    broadcastState(`⚡ Đã tự động lấy danh sách Ra trực từ ngày [${prevDateKey}] sang ngày [${targetDateKey}]`);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true, db }));
    return;
  }

  // POST update doctor profile information (Họ tên, Tên ngắn, Tài khoản HIS, Phòng phụ trách, Thứ tự)
  if (req.method === 'POST' && pathname === '/api/update-doctor') {
    const { doctorId, name, shortName, handle, assignedRoom, seniority } = await readBody(req);
    const doc = db.doctors.find((d) => d.id === doctorId);

    if (!doc) {
      res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: 'Không tìm thấy bác sĩ!' }));
      return;
    }

    if (typeof name === 'string' && name.trim()) doc.name = name.trim();
    if (typeof shortName === 'string' && shortName.trim()) doc.shortName = shortName.trim();
    if (typeof handle === 'string' && handle.trim()) {
      const cleanHandle = handle.trim();
      doc.handle = cleanHandle.startsWith('@') ? cleanHandle : `@${cleanHandle}`;
    }
    if (typeof assignedRoom === 'string' && assignedRoom.trim()) {
      doc.assignedRoom = assignedRoom.trim();
    }

    const parsedSeniority = Number(seniority);
    if (!Number.isNaN(parsedSeniority) && parsedSeniority >= 1 && parsedSeniority <= db.doctors.length) {
      const oldRank = doc.seniority;
      const newRank = Math.round(parsedSeniority);
      if (oldRank !== newRank) {
        for (const other of db.doctors) {
          if (other.id === doc.id) continue;
          if (newRank < oldRank && other.seniority >= newRank && other.seniority < oldRank) {
            other.seniority += 1;
          } else if (newRank > oldRank && other.seniority <= newRank && other.seniority > oldRank) {
            other.seniority -= 1;
          }
        }
        doc.seniority = newRank;
      }
    }

    broadcastState(`✏️ Đã cập nhật thông tin BS. ${doc.name}`);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true, db }));
    return;
  }

  // POST add new doctor
  if (req.method === 'POST' && pathname === '/api/add-doctor') {
    const { name, shortName, handle, assignedRoom, seniority, scheduleCode } = await readBody(req);
    if (!name || !name.trim()) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: 'Vui lòng nhập họ và tên bác sĩ!' }));
      return;
    }

    const cleanName = name.trim();
    const cleanShort = (shortName && shortName.trim()) || cleanName.split(' ').pop();
    const rawHandle = (handle && handle.trim()) || `@bs${Date.now().toString().slice(-4)}`;
    const cleanHandle = rawHandle.startsWith('@') ? rawHandle : `@${rawHandle}`;
    const room = (assignedRoom && assignedRoom.trim()) || 'Thần kinh 1';

    const maxRank = db.doctors.length + 1;
    let targetRank = Number(seniority);
    if (Number.isNaN(targetRank) || targetRank < 1 || targetRank > maxRank) {
      targetRank = maxRank;
    } else {
      targetRank = Math.round(targetRank);
    }

    // Shift existing doctors at or below targetRank down by 1
    for (const d of db.doctors) {
      if (d.seniority >= targetRank) {
        d.seniority += 1;
      }
    }

    const nowMin = getNowEpochMinutes();
    const todayKey = getDateKey(new Date(nowMin * 60000));
    const yesterdayKey = addDaysToKey(todayKey, -1);

    const newDoc = {
      id: `doc-${Date.now()}`,
      seniority: targetRank,
      shortName: cleanShort,
      name: cleanName,
      handle: cleanHandle,
      assignedRoom: room,
      scheduleByDate: {
        [yesterdayKey]: 'LAM_NGAY',
        [todayKey]: scheduleCode || 'LAM_NGAY'
      },
      usages: []
    };

    db.doctors.push(newDoc);
    db.doctors.sort((a, b) => a.seniority - b.seniority);

    broadcastState(`➕ Đã thêm BS. ${cleanName} vào danh sách Khoa`);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true, db, doctor: newDoc }));
    return;
  }

  // POST update patient statistics (Đầu ca, Bệnh vào, Ra viện, Chuyển đến, Chuyển đi, Tử vong, Bệnh mổ, Hiện có, Bảo hiểm)
  if (req.method === 'POST' && pathname === '/api/update-patient-stats') {
    const { patientStats, dateKey } = await readBody(req);
    const nowMin = getNowEpochMinutes();
    const targetDateKey = dateKey || getDateKey(new Date(nowMin * 60000));
    if (patientStats && typeof patientStats === 'object') {
      const updatedObj = {
        ...(db.patientStats || {}),
        ...patientStats,
        dateKey: targetDateKey,
        updatedAt: new Date().toISOString()
      };
      db.patientStats = updatedObj;
      if (!db.patientStatsByDate) db.patientStatsByDate = {};
      db.patientStatsByDate[targetDateKey] = updatedObj;
      broadcastState(`🏥 Đã cập nhật Số liệu bệnh nhân ngày [${targetDateKey}]`);
    }
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true, db }));
    return;
  }

  // Helper: Map HIS room codes/names to our 5 Department Rooms
  function mapHisRoomToDeptRoom(roomStr, donNguyenStr, maDonNguyen, maPhong) {
    const combined = `${roomStr || ''} ${donNguyenStr || ''}`.toLowerCase();
    const mdn = Number(maDonNguyen);
    const mp = Number(maPhong);
    if (mdn === 10 || mp === 207 || combined.includes('hstk') || combined.includes('hồi sức')) {
      return 'Hồi sức thần kinh';
    }
    if (mdn === 11 || mp === 339 || combined.includes('cs 1') || combined.includes('tk 1')) {
      return 'Thần kinh 1';
    }
    if (mdn === 12 || mp === 340 || combined.includes('cs 2') || combined.includes('tk 2')) {
      return 'Thần kinh 2';
    }
    if (mdn === 13 || mp === 341 || combined.includes('cs 3') || combined.includes('tk 3')) {
      return 'Thần kinh 3';
    }
    if (mdn === 14 || mp === 342 || combined.includes('cs 4') || combined.includes('tk 4')) {
      return 'Thần kinh 4';
    }
    return null;
  }

  // Detect which of the 4 HIS Excel report types a sheet belongs to by inspecting its column headers (and filename fallback)
  function detectHisExcelCategory(rows, fileName = '') {
    const firstRow = (rows && rows[0]) || {};
    const cols = Object.keys(firstRow);
    const colSet = new Set(cols.map(c => c.trim()));
    const lowerName = String(fileName || '').toLowerCase();

    // 1. Check by exact HIS Column Signatures first (works even if file is named Book1.xlsx or Export.xlsx)
    if (colSet.has('sogiuong') || colSet.has('magiuong') || (colSet.has('Phòng') && colSet.has('Tổng chi phí'))) {
      return { code: 'DANG_DIEU_TRI', label: 'Đang điều trị', canonicalFile: 'dang_dieu_tri.xlsx' };
    }
    if (colSet.has('Ngày đăng ký') || (colSet.has('dangky') && colSet.has('Khoa chuyển đến'))) {
      return { code: 'VAO_KHOA', label: 'Vào khoa', canonicalFile: 'vao_khoa.xlsx' };
    }
    if (colSet.has('Ngày chuyển') || colSet.has('Chờ?')) {
      return { code: 'CHUYEN_KHOA', label: 'Chuyển khoa', canonicalFile: 'chuyen_khoa.xlsx' };
    }
    if (colSet.has('Ngày ra') || colSet.has('songaydieutri') || colSet.has('manvrv')) {
      return { code: 'RA_VIEN', label: 'Ra viện', canonicalFile: 'ra_vien.xlsx' };
    }

    // 2. Fallback by filename keywords
    if (lowerName.includes('điều trị') || lowerName.includes('dieu tri')) {
      return { code: 'DANG_DIEU_TRI', label: 'Đang điều trị', canonicalFile: 'dang_dieu_tri.xlsx' };
    }
    if (lowerName.includes('vào khoa') || lowerName.includes('vao khoa')) {
      return { code: 'VAO_KHOA', label: 'Vào khoa', canonicalFile: 'vao_khoa.xlsx' };
    }
    if (lowerName.includes('chuyển') || lowerName.includes('chuyen')) {
      return { code: 'CHUYEN_KHOA', label: 'Chuyển khoa', canonicalFile: 'chuyen_khoa.xlsx' };
    }
    if (lowerName.includes('ra viện') || lowerName.includes('ra vien')) {
      return { code: 'RA_VIEN', label: 'Ra viện', canonicalFile: 'ra_vien.xlsx' };
    }

    return { code: 'UNKNOWN', label: 'Chưa rõ loại', canonicalFile: null };
  }

  function recomputePatientStatsFromHisUploads() {
    try {
      const XLSX = require('xlsx');
      const uploadDir = path.join(ROOT, 'uploads_his');
      if (!fs.existsSync(uploadDir)) return null;

      const files = fs.readdirSync(uploadDir)
        .filter(f => /\.(xlsx|xls|csv)$/i.test(f))
        .map(f => ({
          name: f,
          fullPath: path.join(uploadDir, f),
          mtime: fs.statSync(path.join(uploadDir, f)).mtimeMs
        }))
        // Sort oldest to newest so the most recently uploaded file of each category always wins!
        .sort((a, b) => a.mtime - b.mtime);

      if (files.length === 0) return null;

      const roomsList = ['Thần kinh 1', 'Thần kinh 2', 'Thần kinh 3', 'Thần kinh 4', 'Hồi sức thần kinh'];
      const byRoom = {};
      roomsList.forEach(r => {
        byRoom[r] = { dauCa: 0, benhVao: 0, raVien: 0, chuyenDen: 0, chuyenDi: 0, tuVong: 0, benhMo: 0, hienCo: 0, baoHiem: 0 };
      });
      const total = { dauCa: 0, benhVao: 0, raVien: 0, chuyenDen: 0, chuyenDi: 0, tuVong: 0, benhMo: 0, hienCo: 0, baoHiem: 0 };

      if (db.patientStats && db.patientStats.total && db.patientStats.total.benhMo) {
        total.benhMo = Number(db.patientStats.total.benhMo) || 0;
      }

      let dangDieuTriRows = [];
      let vaoKhoaRows = [];
      let raVienRows = [];
      let chuyenKhoaRows = [];

      for (const fObj of files) {
        const wb = XLSX.readFile(fObj.fullPath);
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
        const cat = detectHisExcelCategory(rows, fObj.name);

        if (cat.code === 'DANG_DIEU_TRI') dangDieuTriRows = rows;
        else if (cat.code === 'VAO_KHOA') vaoKhoaRows = rows;
        else if (cat.code === 'RA_VIEN') raVienRows = rows;
        else if (cat.code === 'CHUYEN_KHOA') chuyenKhoaRows = rows;
      }

      // 1. Process đang điều trị -> Hiện có, Bảo hiểm & Lookup map mabn -> Room
      const mabnToRoom = {};
      for (const r of dangDieuTriRows) {
        const rm = mapHisRoomToDeptRoom(r['Phòng'], r['tendonnguyen'], r['madonnguyen'], r['maphong']) || 'Thần kinh 1';
        if (r['mabn']) mabnToRoom[String(r['mabn']).trim()] = rm;
        total.hienCo += 1;
        byRoom[rm].hienCo += 1;

        const isBhyt = String(r['Đối tượng'] || '').toUpperCase().includes('BHYT') || Number(r['madoituong']) === 1;
        if (isBhyt) {
          total.baoHiem += 1;
          byRoom[rm].baoHiem += 1;
        }
      }

      // 2. Process vào khoa -> Bệnh vào (dangky == 1) vs Chuyển đến (dangky == 0 hoặc có Khoa chuyển đến)
      for (const r of vaoKhoaRows) {
        const mabn = String(r['mabn'] || '').trim();
        const rm = mabnToRoom[mabn] || mapHisRoomToDeptRoom(r['Phòng'], r['tendonnguyen'], r['madonnguyen'], r['maphong']) || 'Thần kinh 1';
        const hasFromDept = String(r['Khoa chuyển đến'] || '').trim() !== '' || (r['makkc'] !== '' && r['makkc'] !== undefined && Number(r['makkc']) !== 0);
        const isChuyenDen = Number(r['dangky']) === 0 || hasFromDept;

        if (isChuyenDen) {
          total.chuyenDen += 1;
          byRoom[rm].chuyenDen += 1;
        } else {
          total.benhVao += 1;
          byRoom[rm].benhVao += 1;
        }
      }

      // 3. Process chuyển khoa -> Chuyển đi
      for (const r of chuyenKhoaRows) {
        const mabn = String(r['mabn'] || '').trim();
        const rm = mabnToRoom[mabn] || mapHisRoomToDeptRoom(r['Phòng'], r['tendonnguyen'], r['madonnguyen'], r['maphong']) || 'Thần kinh 1';
        total.chuyenDi += 1;
        byRoom[rm].chuyenDi += 1;
      }

      // 4. Process ra viện -> Ra viện vs Tử vong
      for (const r of raVienRows) {
        const mabn = String(r['mabn'] || '').trim();
        const rm = mabnToRoom[mabn] || mapHisRoomToDeptRoom(r['tenphong'] || r['Phòng'], r['tendonnguyen'], r['madonnguyen'], r['maphong']) || 'Thần kinh 1';
        const lyDoStr = String(r['malydo'] || '').toLowerCase();
        const isTuVong = lyDoStr.includes('tử vong') || Number(r['malydo']) === 4 || Number(r['malydo']) === 5;
        if (isTuVong) {
          total.tuVong += 1;
          byRoom[rm].tuVong += 1;
        } else {
          total.raVien += 1;
          byRoom[rm].raVien += 1;
        }
      }

      // 5. Compute Đầu ca = Hiện có - (Bệnh vào + Chuyển đến) + (Ra viện + Chuyển đi + Tử vong)
      roomsList.forEach(rm => {
        const b = byRoom[rm];
        b.dauCa = Math.max(0, b.hienCo - (b.benhVao + b.chuyenDen) + (b.raVien + b.chuyenDi + b.tuVong));
      });
      total.dauCa = Math.max(0, total.hienCo - (total.benhVao + total.chuyenDen) + (total.raVien + total.chuyenDi + total.tuVong));

      db.patientStats = {
        total,
        byRoom,
        updatedAt: new Date().toISOString()
      };
      syncTk1WardRoundsFromHis(dangDieuTriRows);
      return db.patientStats;
    } catch (e) {
      console.error('HIS parse error:', e);
      return null;
    }
  }

  function excelSerialToDateVN(val) {
    if (!val && val !== 0) return '';
    if (typeof val === 'number' && val > 10000) {
      const utcMs = Math.round((val - 25569) * 86400 * 1000);
      const dt = new Date(utcMs);
      const d = String(dt.getUTCDate()).padStart(2, '0');
      const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
      const y = dt.getUTCFullYear();
      return `${d}/${m}/${y}`;
    }
    const str = String(val).trim();
    return str;
  }

  function getLatestExcelUploadInfo() {
    if (db.lastExcelUploadTime) return db.lastExcelUploadTime;
    if (db.uploadedHisFiles && db.uploadedHisFiles.length > 0) {
      return db.uploadedHisFiles[0].uploadedAt;
    }
    const uploadDir = path.join(ROOT, 'uploads_his');
    if (fs.existsSync(uploadDir)) {
      const files = fs.readdirSync(uploadDir).filter(f => /\.(xlsx|xls|csv)$/i.test(f));
      let latestMs = 0;
      for (const f of files) {
        try {
          const mt = fs.statSync(path.join(uploadDir, f)).mtimeMs;
          if (mt > latestMs) latestMs = mt;
        } catch {}
      }
      if (latestMs > 0) {
        const d = new Date(latestMs);
        return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')} ngày ${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
      }
    }
    return null;
  }

  function getClinicBySpecialty(specialty) {
    const map = {
      'Chấn thương': 'Phòng khám Chấn thương chỉnh hình',
      'Răng Hàm Mặt': 'Phòng khám Răng Hàm Mặt',
      'Tai Mũi Họng': 'Phòng khám Tai Mũi Họng',
      'Mắt': 'Phòng khám Mắt',
      'Lồng ngực': 'Phòng khám Ngoại Lồng ngực',
      'Đột Quỵ': 'Phòng khám Nội Thần kinh - Đột quỵ',
      'Nội tiết': 'Phòng khám Nội tiết',
      'Nội Tim mạch': 'Phòng khám Nội Tim mạch',
      'Nội Thần kinh - Đột quỵ': 'Phòng khám Nội Thần kinh - Đột quỵ',
      'Nội tiết - Đái tháo đường': 'Phòng khám Nội tiết',
      'Chấn thương chỉnh hình': 'Phòng khám Chấn thương chỉnh hình'
    };
    if (!specialty) return '';
    return map[specialty] || `Phòng khám ${specialty}`;
  }

  function syncTk1WardRoundsFromHis(preloadedDangDieuTriRows = null) {
    try {
      const XLSX = require('xlsx');
      let dangDieuTriRows = preloadedDangDieuTriRows;
      if (!dangDieuTriRows) {
        const uploadDir = path.join(ROOT, 'uploads_his');
        if (fs.existsSync(uploadDir)) {
          const files = fs.readdirSync(uploadDir)
            .filter(f => /\.(xlsx|xls|csv)$/i.test(f))
            .map(f => ({
              name: f,
              fullPath: path.join(uploadDir, f),
              mtime: fs.statSync(path.join(uploadDir, f)).mtimeMs
            }))
            .sort((a, b) => a.mtime - b.mtime);
          for (const fObj of files) {
            const wb = XLSX.readFile(fObj.fullPath);
            const ws = wb.Sheets[wb.SheetNames[0]];
            const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
            const cat = detectHisExcelCategory(rows, fObj.name);
            if (cat.code === 'DANG_DIEU_TRI') {
              dangDieuTriRows = rows;
            }
          }
        }
      }

      if (!db.wardRounds) db.wardRounds = {};
      if (!db.episodeConsultations) db.episodeConsultations = {};

      const ALL_ROOMS_DEF = [
        { key: 'tk1',  name: 'Thần kinh 1' },
        { key: 'tk2',  name: 'Thần kinh 2' },
        { key: 'tk3',  name: 'Thần kinh 3' },
        { key: 'tk4',  name: 'Thần kinh 4' },
        { key: 'hstk', name: 'Hồi sức thần kinh' }
      ];

      const rows = Array.isArray(dangDieuTriRows) ? dangDieuTriRows : [];
      const now = new Date();
      const todayKey = getDateKey(now);
      const yesterdayKey = addDaysToKey(todayKey, -1);
      const twoDaysAgoKey = addDaysToKey(todayKey, -2);

      for (const rmDef of ALL_ROOMS_DEF) {
        const rKey = rmDef.key;
        const rName = rmDef.name;
        if (!db.wardRounds[rKey]) {
          db.wardRounds[rKey] = {
            roomKey: rKey,
            roomName: rName,
            initializedSeed: false,
            bedAssignments: {},
            hiddenFoldingBeds: {},
            patientRecords: {},
            latestExcelMabns: [],
            acknowledgedMissingMabns: {},
            lastDeletedAction: null,
            updatedAt: new Date().toISOString()
          };
        }

        const roomState = db.wardRounds[rKey];
        roomState.roomKey = rKey;
        roomState.roomName = rName;

        const roomRows = rows.filter(
          r => (mapHisRoomToDeptRoom(r['Phòng'], r['tendonnguyen'], r['madonnguyen'], r['maphong']) || 'Thần kinh 1') === rName
        );

        const latestMabns = [];
        for (const r of roomRows) {
          const mabn = String(r['mabn'] || '').trim();
          if (!mabn) continue;
          latestMabns.push(mabn);

          const existing = roomState.patientRecords[mabn] || {};
          const episodeKey = String(r['Mã KCB'] || r['madieutri'] || mabn).trim();
          const rawAge = String(r['Tuổi'] || '').trim();
          const cleanAge = rawAge || (r['NS'] ? `${now.getFullYear() - Number(r['NS'])} tuổi` : '');

          roomState.patientRecords[mabn] = {
            mabn,
            episodeKey,
            maKcb: String(r['Mã KCB'] || '').trim(),
            madieutri: String(r['madieutri'] || '').trim(),
            soBA: String(r['Số BA'] || '').trim(),
            hoten: String(r['Họ tên'] || '').trim(),
            tuoi: cleanAge,
            namSinh: String(r['NS'] || '').trim(),
            gioiTinh: String(r['GT'] || '').trim(),
            doiTuong: String(r['Đối tượng'] || 'BHYT').trim(),
            soTheBhyt: String(r['Số thẻ'] || '').trim(),
            tuyenDangKy: String(r['tentuyendangky'] || '').trim(),
            hanTheTu: excelSerialToDateVN(r['Hạn thẻ từ']),
            hanTheDen: excelSerialToDateVN(r['Hạn thẻ đến']),
            diaChi: String(r['Địa chỉ'] || '').trim(),
            chanDoanHis: String(r['Chẩn đoán'] || '').trim(),
            customDiagnosis: existing.customDiagnosis || String(r['Chẩn đoán'] || '').trim(),
            bsDieuTri: String(r['Bác sỹ điều trị'] || '').trim(),
            ngayVaoStr: excelSerialToDateVN(r['Ngày vào']),
            hisBed: String(r['sogiuong'] || '').trim(),
            khoaChuyenDen: String(r['tenkhoachuyenden'] || '').trim(),
            tasksByDate: existing.tasksByDate || {},
            consultDetails: existing.consultDetails || {
              specialty: '',
              consultDiagnosis: '',
              consultTreatment: '',
              followUpDays: '',
              followUpClinic: ''
            },
            discharge: existing.discharge || {
              status: 'NONE',
              markedDate: '',
              followUpDays: '',
              followUpClinic: '',
              note: ''
            },
            removed: existing.removed || {
              isRemoved: false,
              reason: '',
              previousBed: '',
              removedAtMs: 0
            },
            surgeryInfo: existing.surgeryInfo || {
              isNonSurgical: false,
              surgeryName: '',
              surgeryDate: ''
            },
            surgicalConsultationsByDate: existing.surgicalConsultationsByDate || {},
            surgicalConsultation: existing.surgicalConsultation || null
          };
        }

        roomState.latestExcelMabns = latestMabns;

        if (!roomState.initializedSeed && latestMabns.length > 0) {
          roomState.initializedSeed = true;
          const dayABeds = rKey === 'tk2'
            ? ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '1X']
            : ['1', '2', '3', '4', '5', '6', '7', '8', '9', '1X'];
          const dayBBeds = rKey === 'tk2'
            ? ['12', '13', '14', '15', '16', '17', '18', '19', '20', '21', '22', '23', '24', '25']
            : ['10', '11', '12', '13', '14', '15', '16', '17', '18', '19', '20', '21', '22', '23', '24'];
          const seedBeds = [...dayABeds, ...dayBBeds];

          const maxAssign = Math.min(seedBeds.length, Math.max(1, latestMabns.length - 3));
          for (let i = 0; i < maxAssign; i++) {
            const m = latestMabns[i];
            const bCode = seedBeds[i];
            roomState.bedAssignments[bCode] = m;
          }

          if (latestMabns[0]) {
            const p0 = roomState.patientRecords[latestMabns[0]];
            p0.tasksByDate[yesterdayKey] = {
              xetNghiem: ['Công thức máu', 'Điện giải đồ'],
              ct: ['Sọ não'],
              xquang: [],
              sieuAm: [],
              hoiChan: [],
              thuThuat: rKey === 'tk2' ? ['Rút dẫn lưu'] : [],
              note: 'Bệnh tỉnh, giảm đau đầu'
            };
            p0.tasksByDate[todayKey] = {
              xetNghiem: ['Sinh hoá'],
              ct: [],
              xquang: ['X-quang ngực thẳng'],
              sieuAm: [],
              hoiChan: ['Đột Quỵ'],
              note: 'Theo dõi huyết áp, chờ hội chẩn'
            };
            p0.consultDetails = {
              specialty: 'Đột Quỵ',
              consultDiagnosis: 'Tăng huyết áp độ 2 trên nền chấn động não',
              consultTreatment: 'Amlodipin 5mg x 1 viên/ngày uống sáng',
              followUpDays: '7',
              followUpClinic: 'Phòng khám Nội Thần kinh - Đột quỵ'
            };
            if (rKey === 'tk1') {
              db.episodeConsultations[p0.episodeKey] = [
                {
                  id: 'ep-seed-1',
                  roomName: 'Hồi sức thần kinh',
                  dateKey: twoDaysAgoKey,
                  specialty: 'Đột Quỵ',
                  consultDiagnosis: 'Chấn động não / Theo dõi xuất huyết dưới nhện mức độ nhẹ',
                  consultTreatment: 'Nimodipin 30mg, nằm đầu cao 30 độ, chuyển trại Thần kinh 1 khi ổn định'
                }
              ];
            }
          }

          if (latestMabns[1]) {
            const p1 = roomState.patientRecords[latestMabns[1]];
            p1.tasksByDate[twoDaysAgoKey] = {
              xetNghiem: ['Chức năng đông máu'],
              ct: ['Cột sống cổ'],
              xquang: ['X-quang cột sống lưng', 'Siêu âm bụng'],
              sieuAm: [],
              hoiChan: [],
              note: 'Đã chụp CT kiểm tra'
            };
            p1.tasksByDate[todayKey] = {
              xetNghiem: [],
              ct: ['Sọ não'],
              xquang: [],
              sieuAm: [],
              hoiChan: [],
              note: 'Chụp CT kiểm tra trước xuất viện'
            };
          }

          if (latestMabns[2]) {
            const p2 = roomState.patientRecords[latestMabns[2]];
            p2.consultDetails = {
              specialty: 'Nội tiết',
              consultDiagnosis: 'Đái tháo đường type 2 kèm chấn thương đầu',
              consultTreatment: 'Metformin 500mg x 2 viên/ngày',
              followUpDays: '14',
              followUpClinic: 'Phòng khám Nội tiết'
            };
            p2.discharge = {
              status: 'MORNING_DISCHARGE',
              markedDate: yesterdayKey,
              followUpDays: '14',
              followUpClinic: 'Phòng khám Nội tiết',
              note: 'Hẹn tái khám sau 14 ngày tại Phòng khám Nội tiết & Phòng khám Ngoại Thần kinh'
            };
          }
        }

        applyTk1MorningDischargeRules(roomState);
        roomState.updatedAt = new Date().toISOString();
      }

      return db.wardRounds.tk1;
    } catch (e) {
      console.error('syncTk1WardRoundsFromHis error:', e);
      return null;
    }
  }

  // Ensure all 5 ward rooms are initialized on startup
  syncTk1WardRoundsFromHis();

  // GET /api/ward-rounds/tk1 (serves all 5 rooms + requested room)
  if (req.method === 'GET' && pathname === '/api/ward-rounds/tk1') {
    syncTk1WardRoundsFromHis();
    const reqUrl = new URL(req.url, 'http://localhost');
    const qRoom = reqUrl.searchParams.get('room') || 'tk1';
    const targetRoomObj = db.wardRounds[qRoom] || db.wardRounds.tk1;
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      ok: true,
      tk1: targetRoomObj,
      wardRounds: db.wardRounds,
      episodeConsultations: db.episodeConsultations || {},
      doctors: db.doctors || [],
      lastExcelUploadTime: getLatestExcelUploadInfo()
    }));
    return;
  }

  // POST /api/ward-rounds/tk1 (supports roomKey: tk1, tk2, tk3, tk4, hstk)
  if (req.method === 'POST' && pathname === '/api/ward-rounds/tk1') {
    const body = await readBody(req);
    const { action, roomKey } = body;
    const reqUrl = new URL(req.url, 'http://localhost');
    const qRoom = reqUrl.searchParams.get('room');
    const chosenRoom = roomKey || qRoom;
    const targetRoomKey = (chosenRoom && ['tk1', 'tk2', 'tk3', 'tk4', 'hstk'].includes(chosenRoom)) ? chosenRoom : 'tk1';
    if (!db.wardRounds || !db.wardRounds[targetRoomKey]) {
      syncTk1WardRoundsFromHis();
    }
    const tk1 = db.wardRounds[targetRoomKey] || db.wardRounds.tk1;
    const now = new Date();
    const todayKey = getDateKey(now);

    function sendWardResponse() {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        ok: true,
        tk1,
        wardRounds: db.wardRounds,
        episodeConsultations: db.episodeConsultations,
        lastExcelUploadTime: getLatestExcelUploadInfo()
      }));
    }

    if (action === 'ASSIGN_OR_MOVE_BED') {
      const { mabn, targetBedCode, confirmOverwriteDischarge } = body;
      const rec = tk1.patientRecords[mabn];
      if (!rec || !targetBedCode) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: 'Thiếu thông tin bệnh nhân hoặc số giường!' }));
        return;
      }

      // Find if mabn currently occupies any bed
      let sourceBedCode = null;
      for (const [bCode, m] of Object.entries(tk1.bedAssignments)) {
        if (m === mabn) {
          sourceBedCode = bCode;
          break;
        }
      }

      const occupantMabn = tk1.bedAssignments[targetBedCode];
      if (occupantMabn && occupantMabn !== mabn) {
        const occupantRec = tk1.patientRecords[occupantMabn];
        const isOccupantDischarging =
          occupantRec &&
          occupantRec.discharge &&
          (occupantRec.discharge.status === 'SCHEDULED' || occupantRec.discharge.status === 'MORNING_DISCHARGE');

        if (isOccupantDischarging && !confirmOverwriteDischarge) {
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({
            ok: false,
            needsConfirmDischargeOverwrite: true,
            targetBedCode,
            occupantName: occupantRec.hoten,
            occupantDischargeStatus: occupantRec.discharge.status
          }));
          return;
        }

        if (isOccupantDischarging && confirmOverwriteDischarge) {
          // Giải phóng bệnh nhân đang chờ ra viện khỏi giường và gán bệnh nhân mới vào
          if (sourceBedCode) delete tk1.bedAssignments[sourceBedCode];
          occupantRec.discharge.status = 'DISCHARGED_COMPLETED';
          tk1.bedAssignments[targetBedCode] = mabn;
        } else if (sourceBedCode) {
          // Đổi giường giữa 2 bệnh nhân (Swap)
          tk1.bedAssignments[sourceBedCode] = occupantMabn;
          tk1.bedAssignments[targetBedCode] = mabn;
        } else {
          // Bệnh nhân chưa có giường được xếp vào giường đang có người -> đẩy người cũ ra danh sách chờ phân giường
          tk1.bedAssignments[targetBedCode] = mabn;
        }
      } else {
        if (sourceBedCode) delete tk1.bedAssignments[sourceBedCode];
        tk1.bedAssignments[targetBedCode] = mabn;
      }

      // Clear removed state if any
      if (rec.removed) rec.removed.isRemoved = false;
      // If assigned to a folding bed (e.g. '5X'), automatically unhide that folding bed
      if (String(targetBedCode).endsWith('X')) {
        const mainNum = String(targetBedCode).replace('X', '');
        delete tk1.hiddenFoldingBeds[mainNum];
      }

      broadcastState(`🛏️ Đã cập nhật giường [${targetBedCode}] cho BN ${rec.hoten} (${tk1.roomName})`);
      return sendWardResponse();
    }

    if (action === 'UNASSIGN_BED') {
      const { mabn } = body;
      for (const [bCode, m] of Object.entries(tk1.bedAssignments)) {
        if (m === mabn) delete tk1.bedAssignments[bCode];
      }
      broadcastState(`🛏️ Đã đưa bệnh nhân về danh sách chờ phân giường (${tk1.roomName})`);
      return sendWardResponse();
    }

    if (action === 'TOGGLE_FOLDING_BED_VISIBILITY') {
      const { mainBedNum, hidden } = body;
      if (hidden) {
        tk1.hiddenFoldingBeds[String(mainBedNum)] = true;
      } else {
        delete tk1.hiddenFoldingBeds[String(mainBedNum)];
      }
      broadcastState(`🛏️ Đã cập nhật hiển thị giường xếp ${mainBedNum}X (${tk1.roomName})`);
      return sendWardResponse();
    }

    if (action === 'SAVE_PATIENT_ROUND') {
      const { mabn, dateKey, customDiagnosis, tasks, consultDetails, surgeryInfo, surgicalConsultation } = body;
      const rec = tk1.patientRecords[mabn];
      if (!rec) {
        res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: 'Không tìm thấy bệnh nhân!' }));
        return;
      }
      const targetDate = dateKey || todayKey;
      if (typeof customDiagnosis === 'string') {
        rec.customDiagnosis = customDiagnosis.trim() || rec.chanDoanHis;
      }
      if (surgeryInfo && typeof surgeryInfo === 'object') {
        rec.surgeryInfo = {
          isNonSurgical: Boolean(surgeryInfo.isNonSurgical),
          surgeryName: String(surgeryInfo.surgeryName || '').trim(),
          surgeryDate: String(surgeryInfo.surgeryDate || '').trim()
        };
      }
      if (surgicalConsultation && typeof surgicalConsultation === 'object') {
        const isConsulted = Boolean(surgicalConsultation.isConsulted);
        if (!rec.surgicalConsultationsByDate) rec.surgicalConsultationsByDate = {};
        if (isConsulted) {
          const scObj = {
            isConsulted: true,
            dateKey: targetDate,
            postConsultDiagnosis: String(surgicalConsultation.postConsultDiagnosis || '').trim(),
            surgeryMethod: String(surgicalConsultation.surgeryMethod || '').trim(),
            decision: String(surgicalConsultation.decision || '').trim(),
            advancePayment: String(surgicalConsultation.advancePayment || '').trim(),
            updatedAt: new Date().toISOString()
          };
          rec.surgicalConsultationsByDate[targetDate] = scObj;
          rec.surgicalConsultation = scObj;
        } else {
          delete rec.surgicalConsultationsByDate[targetDate];
          if (rec.surgicalConsultation && (!rec.surgicalConsultation.dateKey || rec.surgicalConsultation.dateKey === targetDate)) {
            delete rec.surgicalConsultation;
          }
        }
      }
      if (tasks && typeof tasks === 'object') {
        rec.tasksByDate[targetDate] = {
          xetNghiem: Array.isArray(tasks.xetNghiem) ? tasks.xetNghiem : [],
          ct: Array.isArray(tasks.ct) ? tasks.ct : [],
          xquang: Array.isArray(tasks.xquang) ? tasks.xquang : [],
          sieuAm: Array.isArray(tasks.sieuAm) ? tasks.sieuAm : [],
          hoiChan: Array.isArray(tasks.hoiChan) ? tasks.hoiChan : [],
          thuThuat: Array.isArray(tasks.thuThuat) ? tasks.thuThuat : [],
          note: String(tasks.note || '').trim()
        };
      }
      if (consultDetails && typeof consultDetails === 'object') {
        const spec = String(consultDetails.specialty || (rec.tasksByDate[targetDate]?.hoiChan?.[0] || '')).trim();
        const autoClinic = spec ? (consultDetails.followUpClinic || getClinicBySpecialty(spec)) : '';
        rec.consultDetails = {
          specialty: spec,
          consultDiagnosis: String(consultDetails.consultDiagnosis || '').trim(),
          consultTreatment: String(consultDetails.consultTreatment || '').trim(),
          followUpDays: spec ? String(consultDetails.followUpDays ?? '').trim() : '',
          followUpClinic: autoClinic
        };

        // Sync to episodeConsultations so any room in the same episode sees it
        if (spec || rec.consultDetails.consultDiagnosis || rec.consultDetails.consultTreatment) {
          const epKey = rec.episodeKey || rec.maKcb || rec.mabn;
          if (!db.episodeConsultations[epKey]) db.episodeConsultations[epKey] = [];
          const existingIdx = db.episodeConsultations[epKey].findIndex(
            c => c.roomName === tk1.roomName && c.dateKey === targetDate
          );
          const entry = {
            id: `ep-${targetRoomKey}-${targetDate}`,
            roomName: tk1.roomName,
            dateKey: targetDate,
            specialty: spec || 'Chuyên khoa',
            consultDiagnosis: rec.consultDetails.consultDiagnosis,
            consultTreatment: rec.consultDetails.consultTreatment
          };
          if (existingIdx >= 0) db.episodeConsultations[epKey][existingIdx] = entry;
          else db.episodeConsultations[epKey].push(entry);
        }
      }

      broadcastState(`📝 Đã lưu thông tin đi buồng BN ${rec.hoten} (${tk1.roomName})`);
      return sendWardResponse();
    }

    if (action === 'SET_SURGERY_INFO') {
      const { mabn, isNonSurgical, surgeryName, surgeryDate, customDiagnosis } = body;
      const rec = tk1.patientRecords[mabn];
      if (rec) {
        if (!rec.surgeryInfo) rec.surgeryInfo = {};
        if (isNonSurgical !== undefined) rec.surgeryInfo.isNonSurgical = Boolean(isNonSurgical);
        if (surgeryName !== undefined) rec.surgeryInfo.surgeryName = String(surgeryName).trim();
        if (surgeryDate !== undefined) rec.surgeryInfo.surgeryDate = String(surgeryDate).trim();
        if (customDiagnosis !== undefined) rec.customDiagnosis = String(customDiagnosis).trim();
        broadcastState(`🔪 Đã cập nhật thông tin phẫu thuật BN ${rec.hoten} (${tk1.roomName})`);
      }
      return sendWardResponse();
    }

    if (action === 'SAVE_SURGICAL_CONSULTATION') {
      const { mabn, dateKey, postConsultDiagnosis, surgeryMethod, decision, advancePayment, isConsulted } = body;
      const rec = tk1.patientRecords[mabn];
      if (rec) {
        const targetDate = dateKey || todayKey;
        if (!rec.surgicalConsultationsByDate) rec.surgicalConsultationsByDate = {};
        const consultObj = {
          isConsulted: isConsulted !== undefined ? Boolean(isConsulted) : true,
          dateKey: targetDate,
          postConsultDiagnosis: String(postConsultDiagnosis !== undefined ? postConsultDiagnosis : (rec.chanDoanHis || '')).trim(),
          surgeryMethod: String(surgeryMethod || '').trim(),
          decision: String(decision || '').trim(),
          advancePayment: String(advancePayment || '').trim(),
          updatedAt: new Date().toISOString()
        };
        rec.surgicalConsultationsByDate[targetDate] = consultObj;
        rec.surgicalConsultation = consultObj;
        broadcastState(`🔪 Đã lưu hội chẩn mổ BN ${rec.hoten} (${tk1.roomName})`);
      }
      return sendWardResponse();
    }

    if (action === 'DELETE_SURGICAL_CONSULTATION') {
      const { mabn, dateKey } = body;
      const rec = tk1.patientRecords[mabn];
      if (rec) {
        const targetDate = dateKey || todayKey;
        if (rec.surgicalConsultationsByDate) {
          delete rec.surgicalConsultationsByDate[targetDate];
        }
        delete rec.surgicalConsultation;
        broadcastState(`🗑️ Đã xoá BN ${rec.hoten} khỏi danh sách hội chẩn mổ (${tk1.roomName})`);
      }
      return sendWardResponse();
    }

    if (action === 'UPDATE_CONSULT_TREATMENT') {
      const { mabn, specialty, consultDiagnosis, consultTreatment, followUpDays } = body;
      const rec = tk1.patientRecords[mabn];
      if (rec) {
        if (!rec.consultDetails) rec.consultDetails = {};
        if (specialty !== undefined) rec.consultDetails.specialty = String(specialty).trim();
        if (consultDiagnosis !== undefined) rec.consultDetails.consultDiagnosis = String(consultDiagnosis).trim();
        if (consultTreatment !== undefined) rec.consultDetails.consultTreatment = String(consultTreatment).trim();
        if (followUpDays !== undefined) rec.consultDetails.followUpDays = String(followUpDays).trim();
        rec.consultDetails.followUpClinic = getClinicBySpecialty(rec.consultDetails.specialty);
        broadcastState(`💬 Đã cập nhật xử trí hội chẩn BN ${rec.hoten} (${tk1.roomName})`);
      }
      return sendWardResponse();
    }

    if (action === 'SET_DISCHARGE') {
      const { mabn, status, followUpDays, followUpClinic, note } = body;
      const rec = tk1.patientRecords[mabn];
      if (rec) {
        if (status === 'NONE') {
          rec.discharge = { status: 'NONE', markedDate: '', followUpDays: '', followUpClinic: '', note: '' };
        } else {
          const spec = rec.consultDetails?.specialty || (rec.tasksByDate?.[todayKey]?.hoiChan?.[0] || '');
          let days = '';
          let clinic = '';
          if (spec) {
            days = followUpDays !== undefined ? String(followUpDays).trim() : (rec.consultDetails?.followUpDays || '7');
            clinic = followUpClinic || rec.consultDetails?.followUpClinic || getClinicBySpecialty(spec);
            if (rec.consultDetails) {
              rec.consultDetails.followUpDays = days;
              rec.consultDetails.followUpClinic = clinic;
            }
          } else {
            if (rec.consultDetails) {
              rec.consultDetails.followUpDays = '';
              rec.consultDetails.followUpClinic = '';
            }
          }
          rec.discharge = {
            status: status || 'SCHEDULED',
            markedDate: status === 'MORNING_DISCHARGE' ? addDaysToKey(todayKey, -1) : todayKey,
            followUpDays: days,
            followUpClinic: clinic,
            note: note || (spec ? `Hẹn tái khám sau ${days || 7} ngày tại ${clinic}` : 'Không hẹn tái khám')
          };
        }
        broadcastState(`🏥 Đã cập nhật trạng thái ra viện BN ${rec.hoten} (${tk1.roomName})`);
      }
      return sendWardResponse();
    }

    if (action === 'RELEASE_DISCHARGED_BED_NOW') {
      const { mabn } = body;
      const rec = tk1.patientRecords[mabn];
      for (const [bCode, m] of Object.entries(tk1.bedAssignments)) {
        if (m === mabn) delete tk1.bedAssignments[bCode];
      }
      if (rec && rec.discharge) {
        rec.discharge.status = 'RELEASED_AFTER_9AM';
      }
      broadcastState(`🔓 Đã giải phóng giường bệnh nhân xuất viện (${tk1.roomName})`);
      return sendWardResponse();
    }

    if (action === 'DELETE_PATIENT') {
      const { mabn, reason } = body;
      const rec = tk1.patientRecords[mabn];
      if (rec) {
        let prevBed = null;
        for (const [bCode, m] of Object.entries(tk1.bedAssignments)) {
          if (m === mabn) {
            prevBed = bCode;
            delete tk1.bedAssignments[bCode];
          }
        }
        tk1.lastDeletedAction = {
          mabn,
          hoten: rec.hoten,
          previousBed: prevBed,
          previousRemoved: { ...(rec.removed || {}) },
          reason: reason || 'Chuyển mổ / Chuyển phòng',
          deletedAtMs: Date.now()
        };
        rec.removed = {
          isRemoved: true,
          reason: reason || 'Chuyển mổ / Chuyển phòng',
          previousBed: prevBed,
          removedAtMs: Date.now()
        };
        broadcastState(`🗑️ Đã xoá BN ${rec.hoten} (${tk1.roomName})`);
      }
      return sendWardResponse();
    }

    if (action === 'UNDO_DELETE') {
      const last = tk1.lastDeletedAction;
      if (last && last.mabn && tk1.patientRecords[last.mabn]) {
        const rec = tk1.patientRecords[last.mabn];
        rec.removed = { isRemoved: false, reason: '', previousBed: '', removedAtMs: 0 };
        if (last.previousBed && !tk1.bedAssignments[last.previousBed]) {
          tk1.bedAssignments[last.previousBed] = last.mabn;
        }
        tk1.lastDeletedAction = null;
        broadcastState(`↩️ Đã hoàn tác xoá BN ${rec.hoten} (${tk1.roomName})`);
      }
      return sendWardResponse();
    }

    if (action === 'DISMISS_UNDO_DELETE') {
      tk1.lastDeletedAction = null;
      return sendWardResponse();
    }

    if (action === 'RESTORE_REMOVED_PATIENT') {
      const { mabn } = body;
      if (mabn && tk1.patientRecords[mabn]) {
        const rec = tk1.patientRecords[mabn];
        const prevBed = rec.removed?.previousBed || '';
        rec.removed = { isRemoved: false, reason: '', previousBed: '', removedAtMs: 0 };
        if (prevBed && !tk1.bedAssignments[prevBed]) {
          tk1.bedAssignments[prevBed] = mabn;
        }
        if (tk1.lastDeletedAction && tk1.lastDeletedAction.mabn === mabn) {
          tk1.lastDeletedAction = null;
        }
        broadcastState(`🔄 Đã khôi phục BN ${rec.hoten} (${tk1.roomName})`);
      }
      return sendWardResponse();
    }

    if (action === 'HANDLE_MISSING_EXCEL_PATIENT') {
      const { mabn, decision } = body;
      if (decision === 'REMOVE_FROM_BED') {
        for (const [bCode, m] of Object.entries(tk1.bedAssignments)) {
          if (m === mabn) delete tk1.bedAssignments[bCode];
        }
        if (tk1.patientRecords[mabn]) {
          tk1.patientRecords[mabn].removed = {
            isRemoved: true,
            reason: 'Không còn trong Excel mới nhất',
            removedAtMs: Date.now()
          };
        }
      } else if (decision === 'KEEP_ON_BED') {
        tk1.acknowledgedMissingMabns[mabn] = true;
      }
      broadcastState(`✅ Đã xử lý kiểm tra danh sách Excel (${tk1.roomName})`);
      return sendWardResponse();
    }

    if (action === 'RELEASE_ALL_MISSING_EXCEL_PATIENTS') {
      const { mabns } = body;
      const list = Array.isArray(mabns) ? mabns : [];
      let count = 0;
      for (const [bCode, m] of Object.entries(tk1.bedAssignments)) {
        if (list.includes(m)) {
          delete tk1.bedAssignments[bCode];
          count++;
          if (tk1.patientRecords[m]) {
            tk1.patientRecords[m].removed = {
              isRemoved: true,
              reason: 'Không còn trong Excel mới nhất',
              removedAtMs: Date.now()
            };
          }
        }
      }
      broadcastState(`🗑️ Đã giải phóng ${count} giường không còn trong Excel (${tk1.roomName})`);
      return sendWardResponse();
    }

    res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: false, error: 'Action không hợp lệ' }));
    return;
  }

  // POST upload Excel file exported from HIS directly from web UI to d:\Antigravity\Phần mềm quản lý khoa\uploads_his
  if (req.method === 'POST' && pathname === '/api/upload-his-excel') {
    const { fileName, base64Data, extractedPreview } = await readBody(req);
    if (!fileName || !base64Data) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: 'Thiếu dữ liệu file Excel!' }));
      return;
    }

    const uploadDir = path.join(ROOT, 'uploads_his');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    const buffer = Buffer.from(base64Data, 'base64');
    const XLSX = require('xlsx');
    let detectedCat = { code: 'UNKNOWN', label: 'Dữ liệu HIS', canonicalFile: null };
    let rowCount = 0;
    try {
      const wb = XLSX.read(buffer, { type: 'buffer' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
      rowCount = rows.length;
      detectedCat = detectHisExcelCategory(rows, fileName);
    } catch (e) {}

    // Save to canonical filename for that category (so new uploads automatically replace old files of the same report type!)
    const targetFileName = detectedCat.canonicalFile || fileName.replace(/[^a-zA-Z0-9._\-\s\u00C0-\u1EF9]/g, '_');
    const savedPath = path.join(uploadDir, targetFileName);
    fs.writeFileSync(savedPath, buffer);

    if (!db.uploadedHisFiles) db.uploadedHisFiles = [];
    db.uploadedHisFiles = db.uploadedHisFiles.filter(item => item.categoryCode !== detectedCat.code && item.fileName !== fileName);
    db.uploadedHisFiles.unshift({
      fileName: `${fileName} → [${detectedCat.label}: ${rowCount} dòng]`,
      categoryCode: detectedCat.code,
      savedPath,
      sizeBytes: buffer.length,
      uploadedAt: new Date().toLocaleTimeString('vi-VN', { hour12: false }) + ' ' + new Date().toLocaleDateString('vi-VN'),
      extractedPreview: extractedPreview || null
    });
    db.uploadedHisFiles = db.uploadedHisFiles.slice(0, 10);

    // Automatically parse all uploaded HIS Excel files and update the 9 metrics!
    const nowDt = new Date();
    db.lastExcelUploadTime = `${String(nowDt.getHours()).padStart(2, '0')}:${String(nowDt.getMinutes()).padStart(2, '0')} ngày ${String(nowDt.getDate()).padStart(2, '0')}/${String(nowDt.getMonth() + 1).padStart(2, '0')}/${nowDt.getFullYear()}`;
    recomputePatientStatsFromHisUploads();

    broadcastState(`📂 Đã tự động nhận diện [${detectedCat.label}] (${rowCount} dòng) từ file "${fileName}" và cập nhật 9 chỉ số!`);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true, savedPath, detectedCat, rowCount, lastExcelUploadTime: db.lastExcelUploadTime, db }));
    return;
  }

  // ==========================================================================
  // BÁO CÁO GIAO BAN: APIS & ĐỒNG BỘ DỮ LIỆU HIS & HÌNH ẢNH CẬN LÂM SÀNG
  // ==========================================================================
  const CLINICAL_UPLOAD_DIR = path.join(ROOT, 'uploads_clinical');
  if (!fs.existsSync(CLINICAL_UPLOAD_DIR)) {
    fs.mkdirSync(CLINICAL_UPLOAD_DIR, { recursive: true });
  }

  function getRoomKeyFromName(name) {
    if (!name) return 'tk1';
    const n = String(name).toLowerCase();
    if (n.includes('hồi sức') || n.includes('hstk')) return 'hstk';
    if (n.includes('1')) return 'tk1';
    if (n.includes('2')) return 'tk2';
    if (n.includes('3')) return 'tk3';
    if (n.includes('4')) return 'tk4';
    return 'tk1';
  }

  function recalculateGrandCensus(report) {
    if (!report || !report.roomReports) return;
    const grand = {
      benhCu: 0,
      vaoKK: 0,
      vaoKhac: 0,
      moCT: 0,
      moCC: 0,
      raRH: 0,
      raKhac: 0,
      tuVong: 0,
      hienCo: 0,
      bhyt: 0
    };

    const roomKeys = ['tk1', 'tk2', 'tk3', 'tk4', 'hstk'];
    for (const rk of roomKeys) {
      const rr = report.roomReports[rk];
      if (rr && rr.census) {
        for (const [k, v] of Object.entries(rr.census)) {
          if (grand[k] !== undefined) grand[k] += (Number(v) || 0);
        }
      }
    }

    if (!report.overall) report.overall = {};
    report.overall.grandCensus = grand;
  }

  function buildBriefingDraftFromHis(targetDateKey) {
    const roomKeys = ['tk1', 'tk2', 'tk3', 'tk4', 'hstk'];
    const roomNames = {
      tk1: 'Thần kinh 1',
      tk2: 'Thần kinh 2',
      tk3: 'Thần kinh 3',
      tk4: 'Thần kinh 4',
      hstk: 'Hồi sức thần kinh'
    };

    const roomReports = {};
    roomKeys.forEach(rk => {
      roomReports[rk] = {
        roomKey: rk,
        roomName: roomNames[rk],
        status: 'DRAFT',
        updatedAt: new Date().toISOString(),
        personnel: {
          nurses: rk === 'hstk' ? '' : 'Linh - Hiếu',
          nursesDay: rk === 'hstk' ? 'Việt - Quyên - Tân' : '',
          nursesNight: rk === 'hstk' ? 'Quyện - Nguyên - Vĩ' : '',
          orderly: 'Phượng',
          xuatVien: 0,
          chamSocCap2: 4,
          hoiChan: 2,
          tangTren: rk === 'tk3' ? 2 : 0,
          tangDuoi: rk === 'tk3' ? 1 : 0
        },
        census: {
          benhCu: 0,
          vaoKK: 0,
          vaoKhac: 0,
          moCT: 0,
          moCC: 0,
          raRH: 0,
          raKhac: 0,
          tuVong: 0,
          hienCo: 0,
          bhyt: 0
        },
        admissions: [],
        discharges: [],
        emergencySurgeries: [],
        criticalNotes: ''
      };
    });

    try {
      const XLSX = require('xlsx');
      const uploadDir = path.join(ROOT, 'uploads_his');
      if (fs.existsSync(uploadDir)) {
        const files = fs.readdirSync(uploadDir)
          .filter(f => /\.(xlsx|xls|csv)$/i.test(f))
          .map(f => ({
            name: f,
            fullPath: path.join(uploadDir, f),
            mtime: fs.statSync(path.join(uploadDir, f)).mtimeMs
          }))
          .sort((a, b) => a.mtime - b.mtime);

        let dangDieuTriRows = [];
        let vaoKhoaRows = [];
        let raVienRows = [];
        let chuyenKhoaRows = [];

        for (const fObj of files) {
          const wb = XLSX.readFile(fObj.fullPath);
          const ws = wb.Sheets[wb.SheetNames[0]];
          const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
          const cat = detectHisExcelCategory(rows, fObj.name);

          if (cat.code === 'DANG_DIEU_TRI') dangDieuTriRows = rows;
          else if (cat.code === 'VAO_KHOA') vaoKhoaRows = rows;
          else if (cat.code === 'RA_VIEN') raVienRows = rows;
          else if (cat.code === 'CHUYEN_KHOA') chuyenKhoaRows = rows;
        }

        const mabnToRoomKey = {};
        for (const r of dangDieuTriRows) {
          const rmName = mapHisRoomToDeptRoom(r['Phòng'], r['tendonnguyen'], r['madonnguyen'], r['maphong']) || 'Thần kinh 1';
          const rk = getRoomKeyFromName(rmName);
          const m = String(r['mabn'] || '').trim();
          if (m) mabnToRoomKey[m] = rk;

          roomReports[rk].census.hienCo += 1;
          const isBhyt = String(r['Đối tượng'] || '').toUpperCase().includes('BHYT') || Number(r['madoituong']) === 1;
          if (isBhyt) roomReports[rk].census.bhyt += 1;
        }

        let sttAdm = { tk1: 1, tk2: 1, tk3: 1, tk4: 1, hstk: 1 };
        for (const r of vaoKhoaRows) {
          const m = String(r['mabn'] || '').trim();
          const rk = mabnToRoomKey[m] || 'tk1';
          const hasFromDept = String(r['Khoa chuyển đến'] || '').trim() !== '' || (r['makkc'] !== '' && r['makkc'] !== undefined && Number(r['makkc']) !== 0);
          const isChuyenDen = Number(r['dangky']) === 0 || hasFromDept;

          if (isChuyenDen) {
            roomReports[rk].census.vaoKhac += 1;
          } else {
            roomReports[rk].census.vaoKK += 1;
          }

          const name = String(r['Họ tên'] || '').trim();
          const age = String(r['Tuổi'] || '').replace(/\D/g, '') || String(r['Tuổi'] || '');
          const addr = String(r['diachi'] || '').trim();
          const diag = String(r['Chẩn đoán'] || r['chandoan'] || '').trim() || 'Chấn thương sọ não';
          
          let cause = 'TNGT';
          const diagLower = diag.toLowerCase();
          if (diagLower.includes('sinh hoạt') || diagLower.includes('té') || diagLower.includes('ngã')) cause = 'TNSH';
          else if (diagLower.includes('đánh') || diagLower.includes('đả thương')) cause = 'Đánh';
          else if (diagLower.includes('lao động')) cause = 'TNLĐ';
          else if (diagLower.includes('thoát vị') || diagLower.includes('u não') || diagLower.includes('xẹp')) cause = 'Bệnh';

          roomReports[rk].admissions.push({
            id: `adm-${rk}-${sttAdm[rk]}`,
            stt: sttAdm[rk]++,
            mabn: m,
            hoten: name,
            tuoi: age,
            cause,
            source: isChuyenDen ? (r['Khoa chuyển đến'] || 'Khác') : 'KK',
            chanDoan: diag,
            diaChi: addr,
            tinhTrang: 'Tỉnh',
            isHighlight: false,
            category: ''
          });
        }

        let sttDis = { tk1: 1, tk2: 1, tk3: 1, tk4: 1, hstk: 1 };
        for (const r of raVienRows) {
          const m = String(r['mabn'] || '').trim();
          const rk = mabnToRoomKey[m] || 'tk1';
          const lyDoStr = String(r['malydo'] || '').toLowerCase();
          const isTuVong = lyDoStr.includes('tử vong') || Number(r['malydo']) === 4 || Number(r['malydo']) === 5;
          const isXinVe = lyDoStr.includes('xin về');

          if (isTuVong) {
            roomReports[rk].census.tuVong += 1;
          } else if (isXinVe) {
            roomReports[rk].census.raKhac += 1;
          } else {
            roomReports[rk].census.raRH += 1;
          }

          const name = String(r['Họ tên'] || '').trim();
          const age = String(r['Tuổi'] || '').replace(/\D/g, '') || String(r['Tuổi'] || '');
          const svv = String(r['Mã KCB'] || r['mayte'] || '').trim();
          const isBhyt = String(r['Đối tượng'] || '').toUpperCase().includes('BHYT') || Number(r['madoituong']) === 1;

          let note = 'Xuất viện';
          if (isTuVong) note = 'Tử vong';
          else if (isXinVe) note = 'Nặng xin về';

          roomReports[rk].discharges.push({
            id: `dis-${rk}-${sttDis[rk]}`,
            stt: sttDis[rk]++,
            mabn: m,
            hoten: name,
            tuoi: age,
            raHan: !isTuVong && !isXinVe,
            baoHiem: isBhyt,
            svv,
            note,
            isHighlight: isTuVong || isXinVe,
            category: isTuVong ? 'TU_VONG' : (isXinVe ? 'XIN_VE' : '')
          });
        }

        for (const r of chuyenKhoaRows) {
          const m = String(r['mabn'] || '').trim();
          const rk = mabnToRoomKey[m] || 'tk1';
          roomReports[rk].census.raKhac += 1;

          const name = String(r['Họ tên'] || '').trim();
          const age = String(r['Tuổi'] || '').replace(/\D/g, '') || String(r['Tuổi'] || '');
          const targetDept = String(r['Khoa chuyển đến'] || '').trim();
          const isBhyt = String(r['Đối tượng'] || '').toUpperCase().includes('BHYT') || Number(r['madoituong']) === 1;

          roomReports[rk].discharges.push({
            id: `dis-${rk}-${sttDis[rk]}`,
            stt: sttDis[rk]++,
            mabn: m,
            hoten: name,
            tuoi: age,
            raHan: false,
            baoHiem: isBhyt,
            svv: String(r['Mã KCB'] || ''),
            note: `Chuyển ${targetDept || 'Khoa khác'}`,
            isHighlight: false,
            category: ''
          });
        }

        roomKeys.forEach(rk => {
          const c = roomReports[rk].census;
          c.benhCu = Math.max(0, c.hienCo - (c.vaoKK + c.vaoKhac) + (c.raRH + c.raKhac + c.tuVong));
          roomReports[rk].personnel.xuatVien = c.raRH;
        });
      }
    } catch (err) {
      console.warn('Error reading HIS for briefing draft:', err.message);
    }

    const highlightCases = [];
    let caseIdCounter = 1;

    roomKeys.forEach(rk => {
      const rr = roomReports[rk];
      for (const adm of rr.admissions) {
        if (adm.isHighlight || (adm.chanDoan && (adm.chanDoan.includes('tụ máu') || adm.chanDoan.includes('vỡ lún')))) {
          highlightCases.push({
            id: `case-${Date.now()}-${caseIdCounter++}`,
            mabn: adm.mabn,
            hoten: adm.hoten,
            tuoi: adm.tuoi,
            roomKey: rk,
            roomName: rr.roomName,
            category: 'THEO_DOI',
            chanDoan: adm.chanDoan,
            dienBien: `${adm.cause || 'TNGT'}, vào viện ${adm.tinhTrang || 'Tỉnh, đau đầu'}, theo dõi sát tri giác.`,
            kipMo: '',
            selectedForSlide: true,
            images: [],
            notesBs: ''
          });
        }
      }
      for (const dis of rr.discharges) {
        if (dis.category === 'TU_VONG' || dis.category === 'XIN_VE') {
          highlightCases.push({
            id: `case-${Date.now()}-${caseIdCounter++}`,
            mabn: dis.mabn,
            hoten: dis.hoten,
            tuoi: dis.tuoi,
            roomKey: rk,
            roomName: rr.roomName,
            category: dis.category,
            chanDoan: dis.note || 'Bệnh nặng xin về',
            dienBien: `Tri giác tụt, thở nấc/thở máy, gia đình xin về tại ${rr.roomName}.`,
            kipMo: '',
            selectedForSlide: true,
            images: [],
            notesBs: 'Tiên lượng nặng tử vong'
          });
        }
      }
    });

    const draft = {
      dateKey: targetDateKey,
      updatedAt: new Date().toISOString(),
      roomReports,
      highlightCases,
      overall: {
        doctorsOnDuty: [],
        grandCensus: {},
        doctorNotes: '',
        approvedBy: ''
      }
    };

    recalculateGrandCensus(draft);
    return draft;
  }

  function getDutyDoctorsAbbr(dateKey) {
    const list = (db.doctors || [])
      .filter(d => getEffectiveShiftForDate(d, dateKey) === 'TRUC')
      .sort((a, b) => (a.seniority || 999) - (b.seniority || 999))
      .map(d => (d.shortName || d.name).trim().toUpperCase());
    return list.length > 0 ? list : ['HẢI', 'CƯ', 'LUÂN'];
  }

  function getAllInpatientsList() {
    try {
      const hisDir = path.join(ROOT, 'uploads_his');
      if (!fs.existsSync(hisDir)) return [];
      const files = fs.readdirSync(hisDir);
      const dangDieuTriFile = files.find(f => f.toLowerCase().includes('dang') || f.toLowerCase().includes('đang'));
      if (!dangDieuTriFile) return [];
      const wb = XLSX.readFile(path.join(hisDir, dangDieuTriFile));
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet);

      return rows.map((r, idx) => {
        const rawRoom = String(r['Phòng'] || r['tendonnguyen'] || '').toLowerCase();
        let rk = 'tk1', rName = 'Thần kinh 1';
        if (rawRoom.includes('hstk') || rawRoom.includes('hồi sức')) {
          rk = 'hstk'; rName = 'Hồi sức thần kinh (HSTK)';
        } else if (rawRoom.includes('2')) {
          rk = 'tk2'; rName = 'Thần kinh 2';
        } else if (rawRoom.includes('3')) {
          rk = 'tk3'; rName = 'Thần kinh 3';
        } else if (rawRoom.includes('4')) {
          rk = 'tk4'; rName = 'Thần kinh 4';
        }

        const isFemale = String(r['GT'] || '').toUpperCase().includes('NỮ') || Number(r['maphai']) === 2;
        return {
          id: `inpatient-${idx + 1}`,
          mabn: String(r['mabn'] || '').trim(),
          hoten: String(r['Họ tên'] || '').trim(),
          tuoi: String(r['Tuổi'] || '').replace(/\D/g, '') || String(r['Tuổi'] || ''),
          gioiTinh: isFemale ? 'NỮ' : 'NAM',
          diaChi: String(r['Địa chỉ'] || r['diachi'] || 'Gia Lai').trim(),
          chanDoan: String(r['Chẩn đoán'] || r['chandoan'] || '').trim(),
          roomKey: rk,
          roomName: rName,
          bed: String(r['sogiuong'] || '').trim(),
          doctor: String(r['Bác sỹ điều trị'] || '').trim()
        };
      });
    } catch (e) {
      console.warn('Error extracting inpatients list:', e.message);
      return [];
    }
  }

  function getTk4SurgicalConsultations(targetDateKey) {
    try {
      const tk4 = db.wardRounds && db.wardRounds.tk4;
      if (!tk4 || !tk4.patientRecords) return [];
      const dKey = targetDateKey || getDateKey(new Date());
      const list = [];
      for (const [mabn, rec] of Object.entries(tk4.patientRecords)) {
        if (rec.removed && rec.removed.isRemoved) continue;
        const sc = (rec.surgicalConsultationsByDate && rec.surgicalConsultationsByDate[dKey]) ||
                   (rec.surgicalConsultation && (!rec.surgicalConsultation.dateKey || rec.surgicalConsultation.dateKey === dKey) ? rec.surgicalConsultation : null);
        if (sc && sc.isConsulted) {
          list.push({
            mabn: rec.mabn || mabn,
            hoten: rec.hoten || '',
            tuoi: rec.tuoi || '',
            gioiTinh: rec.gioiTinh || '',
            giuong: rec.giuong || '',
            chanDoanHis: rec.chanDoanHis || '',
            postConsultDiagnosis: sc.postConsultDiagnosis || rec.chanDoanHis || '',
            surgeryMethod: sc.surgeryMethod || '',
            decision: sc.decision || 'Đồng ý',
            advancePayment: sc.advancePayment || '',
            dateKey: dKey,
            updatedAt: sc.updatedAt || ''
          });
        }
      }
      return list;
    } catch (e) {
      console.error('getTk4SurgicalConsultations error:', e);
      return [];
    }
  }

  function getOrBuildBriefingReport(targetDateKey) {
    if (!db.briefingReports) db.briefingReports = {};
    if (!db.briefingReports[targetDateKey]) {
      db.briefingReports[targetDateKey] = buildBriefingDraftFromHis(targetDateKey);
    }
    const report = db.briefingReports[targetDateKey];

    const dutyDocsShort = getDutyDoctorsAbbr(targetDateKey);

    if (!report.overall) report.overall = {};
    if (!report.overall.doctorsOnDuty || report.overall.doctorsOnDuty.length === 0) {
      report.overall.doctorsOnDuty = dutyDocsShort;
    }

    if (!Array.isArray(report.highlightCases)) {
      report.highlightCases = [];
    }

    recalculateGrandCensus(report);
    return report;
  }

  function syncRoomKeyCasesToMaster(report, roomKey, roomReport) {
    if (!report || !roomReport) return;
    if (!Array.isArray(report.highlightCases)) report.highlightCases = [];

    const flagged = [];
    for (const adm of roomReport.admissions || []) {
      if (adm.isHighlight || adm.category) {
        flagged.push({
          mabn: adm.mabn,
          hoten: adm.hoten,
          tuoi: adm.tuoi,
          category: adm.category || 'THEO_DOI',
          chanDoan: adm.chanDoan,
          dienBien: `${adm.cause || ''}: ${adm.tinhTrang || ''}`,
          kipMo: ''
        });
      }
    }

    for (const dis of roomReport.discharges || []) {
      if (dis.isHighlight || dis.category) {
        flagged.push({
          mabn: dis.mabn,
          hoten: dis.hoten,
          tuoi: dis.tuoi,
          category: dis.category || (dis.note?.includes('Xin về') ? 'XIN_VE' : 'THEO_DOI'),
          chanDoan: dis.note || 'Xuất viện / Xin về',
          dienBien: dis.note || '',
          kipMo: ''
        });
      }
    }

    for (const surg of roomReport.emergencySurgeries || []) {
      flagged.push({
        mabn: surg.mabn || '',
        hoten: surg.patientName || surg.hoten,
        tuoi: surg.age || surg.tuoi,
        category: 'MO_CC',
        chanDoan: surg.diagnosis || surg.chanDoan,
        dienBien: `Chuyển mổ lúc ${surg.transferTime || ''}: ${surg.description || ''}`,
        kipMo: surg.surgeons || surg.kipMo || ''
      });
    }

    for (const item of flagged) {
      if (!item.hoten) continue;
      const existing = report.highlightCases.find(c => (item.mabn && c.mabn === item.mabn) || (c.hoten && c.hoten.toLowerCase() === item.hoten.toLowerCase()));
      if (existing) {
        existing.category = item.category || existing.category;
        if (item.chanDoan) existing.chanDoan = item.chanDoan;
        if (item.dienBien) existing.dienBien = item.dienBien;
        if (item.kipMo) existing.kipMo = item.kipMo;
        existing.roomKey = roomKey;
        existing.roomName = roomReport.roomName;
      } else {
        report.highlightCases.push({
          id: `case-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          mabn: item.mabn || '',
          hoten: item.hoten,
          tuoi: item.tuoi,
          roomKey,
          roomName: roomReport.roomName,
          category: item.category,
          chanDoan: item.chanDoan || '',
          dienBien: item.dienBien || '',
          kipMo: item.kipMo || '',
          selectedForSlide: true,
          images: [],
          notesBs: ''
        });
      }
    }
  }

  function getDayNameVN(dateStr) {
    const days = ['Chủ Nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];
    const parts = String(dateStr).split('-');
    if (parts.length === 3) {
      const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
      return days[d.getDay()] || '';
    }
    return '';
  }

  function getDateRangeKeys(startDateStr, endDateStr) {
    const keys = [];
    const [sy, sm, sd] = startDateStr.split('-').map(Number);
    const [ey, em, ed] = endDateStr.split('-').map(Number);
    let curr = new Date(sy, sm - 1, sd);
    const end = new Date(ey, em - 1, ed);
    while (curr <= end) {
      const y = curr.getFullYear();
      const m = String(curr.getMonth() + 1).padStart(2, '0');
      const d = String(curr.getDate()).padStart(2, '0');
      keys.push(`${y}-${m}-${d}`);
      curr.setDate(curr.getDate() + 1);
    }
    return keys;
  }

  function generateBriefingDailyExcel(dateKey) {
    const report = getOrBuildBriefingReport(dateKey);
    const overall = report.overall || {};
    const grand = overall.grandCensus || {};
    const roomReports = report.roomReports || {};
    const highlightCases = report.highlightCases || [];

    const docsStr = Array.isArray(overall.doctorsOnDuty) ? overall.doctorsOnDuty.join(' – ') : (overall.doctorsOnDuty || '');
    const wb = XLSX.utils.book_new();

    // Sheet 1: Tong_Hop_Giao_Ban
    const rows1 = [
      ['BỆNH VIỆN ĐA KHOA TRUNG TÂM TỈNH GIA LAI - KHOA NGOẠI THẦN KINH - CỘT SỐNG'],
      [`BÁO CÁO GIAO BAN NGÀY ${dateKey} - BÁC SĨ TRỰC: ${docsStr}`],
      [],
      ['I. BẢNG 8 CHỈ SỐ GIAO BAN TOÀN KHOA'],
      ['Bệnh cũ', 'Vào', 'Ra', 'Tử vong', 'Chuyển', 'Mổ', 'Hiện có', 'Bảo hiểm'],
      [
        grand.benhCu || 0,
        grand.vao || (Number(grand.vaoKK || 0) + Number(grand.vaoKhac || 0)),
        grand.ra || (Number(grand.raRH || 0) + Number(grand.raKhac || 0)),
        grand.tuVong || 0,
        grand.chuyen || Number(grand.raKhac || 0),
        grand.mo || (Number(grand.moCT || 0) + Number(grand.moCC || 0)),
        grand.hienCo || 0,
        grand.bhyt || 0
      ],
      [],
      ['II. BẢNG CHI TIẾT 5 PHÒNG BỆNH'],
      ['STT', 'Phòng bệnh', 'Bệnh cũ', 'Vào KK', 'Vào khác', 'Mổ CT', 'Mổ CC', 'Ra RH', 'Ra khác', 'Tử vong', 'Hiện có', 'BHYT', 'Kíp trực / Nhân lực', 'Trạng thái nộp']
    ];

    const roomsList = [
      { key: 'tk1', name: 'Thần kinh 1' },
      { key: 'tk2', name: 'Thần kinh 2' },
      { key: 'tk3', name: 'Thần kinh 3' },
      { key: 'tk4', name: 'Thần kinh 4' },
      { key: 'hstk', name: 'Hồi sức thần kinh (HSTK)' }
    ];

    roomsList.forEach((r, idx) => {
      const rRep = roomReports[r.key] || { census: {}, personnel: {} };
      const c = rRep.census || {};
      const p = rRep.personnel || {};
      const personnelStr = (r.key === 'hstk')
        ? `Ngày: ${p.nursesDay || '--'} | Đêm: ${p.nursesNight || '--'}`
        : `ĐD: ${p.nurses || '--'}`;
      const statusStr = rRep.status === 'SUBMITTED' ? 'Đã báo cáo' : 'Chờ báo cáo';

      rows1.push([
        idx + 1,
        r.name,
        c.benhCu || 0,
        c.vaoKK || 0,
        c.vaoKhac || 0,
        c.moCT || 0,
        c.moCC || 0,
        c.raRH || 0,
        c.raKhac || 0,
        c.tuVong || 0,
        c.hienCo || 0,
        c.bhyt || 0,
        personnelStr,
        statusStr
      ]);
    });

    // Total row
    rows1.push([
      '',
      'TỔNG TOÀN KHOA',
      grand.benhCu || 0,
      grand.vaoKK || 0,
      grand.vaoKhac || 0,
      grand.moCT || 0,
      grand.moCC || 0,
      grand.raRH || 0,
      grand.raKhac || 0,
      grand.tuVong || 0,
      grand.hienCo || 0,
      grand.bhyt || 0,
      `BS trực: ${docsStr}`,
      '-'
    ]);

    const ws1 = XLSX.utils.aoa_to_sheet(rows1);
    ws1['!cols'] = [
      { wch: 6 },
      { wch: 26 },
      { wch: 10 },
      { wch: 10 },
      { wch: 10 },
      { wch: 10 },
      { wch: 10 },
      { wch: 10 },
      { wch: 10 },
      { wch: 10 },
      { wch: 12 },
      { wch: 10 },
      { wch: 40 },
      { wch: 14 }
    ];
    XLSX.utils.book_append_sheet(wb, ws1, 'Tong_Hop_Giao_Ban');

    // Sheet 2: Ca_Trong_Diem
    const rows2 = [
      [`DANH SÁCH CA TRỌNG ĐIỂM BÁO CÁO GIAO BAN - NGÀY ${dateKey}`],
      [],
      ['STT', 'Phân loại / Nhóm', 'Phòng', 'Họ và tên', 'Tuổi', 'Giới tính', 'Địa chỉ', 'Ngày vào viện', 'Ngày PT / Xin về', 'Chẩn đoán', 'Kíp mổ / PTV', 'Diễn biến ca trực', 'Ý kiến BS trực']
    ];

    highlightCases.forEach((c, idx) => {
      rows2.push([
        c.stt || (idx + 1),
        c.category || '',
        c.roomName || c.roomKey || '',
        c.hoten || '',
        c.tuoi || '',
        c.gioiTinh || 'NAM',
        c.diaChi || '',
        c.ngayVaoVien || '',
        c.ngayPhauThuat || c.ngayXinVe || '',
        c.chanDoan || '',
        c.kipMo || '',
        c.dienBien || '',
        c.notesBs || ''
      ]);
    });

    const ws2 = XLSX.utils.aoa_to_sheet(rows2);
    ws2['!cols'] = [
      { wch: 6 },
      { wch: 28 },
      { wch: 18 },
      { wch: 24 },
      { wch: 8 },
      { wch: 10 },
      { wch: 32 },
      { wch: 14 },
      { wch: 16 },
      { wch: 45 },
      { wch: 25 },
      { wch: 35 },
      { wch: 30 }
    ];
    XLSX.utils.book_append_sheet(wb, ws2, 'Ca_Trong_Diem');

    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  }

  function getBriefingPeriodSummary(startDate, endDate, periodLabel) {
    const dateKeys = getDateRangeKeys(startDate, endDate);
    const days = [];
    const emergencySurgeries = [];
    const fatalitiesAndCritical = [];
    const doctorDutyCount = {};

    let sumBenhCu = 0, sumVao = 0, sumRa = 0, sumTuVong = 0, sumChuyen = 0, sumMo = 0, sumHienCo = 0, sumBhyt = 0;
    let sumMoCC = 0, sumMoCT = 0;

    for (const dk of dateKeys) {
      let rep = (db.briefingReports && db.briefingReports[dk]) ? db.briefingReports[dk] : null;
      if (!rep) {
        rep = getOrBuildBriefingReport(dk);
      }

      const ov = (rep && rep.overall) || {};
      const gc = ov.grandCensus || {};
      const hlCases = (rep && rep.highlightCases) || [];

      const valBenhCu = Number(gc.benhCu || 0);
      const valVao = Number(gc.vao || (Number(gc.vaoKK || 0) + Number(gc.vaoKhac || 0)));
      const valRa = Number(gc.ra || (Number(gc.raRH || 0) + Number(gc.raKhac || 0)));
      const valTuVong = Number(gc.tuVong || 0);
      const valChuyen = Number(gc.chuyen || Number(gc.raKhac || 0));
      const valMo = Number(gc.mo || (Number(gc.moCT || 0) + Number(gc.moCC || 0)));
      const valMoCC = Number(gc.moCC || 0);
      const valMoCT = Number(gc.moCT || 0);
      const valHienCo = Number(gc.hienCo || 0);
      const valBhyt = Number(gc.bhyt || 0);

      sumBenhCu += valBenhCu;
      sumVao += valVao;
      sumRa += valRa;
      sumTuVong += valTuVong;
      sumChuyen += valChuyen;
      sumMo += valMo;
      sumMoCC += valMoCC;
      sumMoCT += valMoCT;
      sumHienCo += valHienCo;
      sumBhyt += valBhyt;

      const docsDuty = Array.isArray(ov.doctorsOnDuty) ? ov.doctorsOnDuty : [];
      docsDuty.forEach(docName => {
        const cleanName = String(docName).replace('BS.', '').replace('BS', '').trim();
        if (cleanName) {
          if (!doctorDutyCount[cleanName]) {
            doctorDutyCount[cleanName] = { name: cleanName, shifts: 0, dates: [] };
          }
          doctorDutyCount[cleanName].shifts += 1;
          doctorDutyCount[cleanName].dates.push(dk);
        }
      });

      hlCases.forEach(c => {
        const cat = (c.category || '').toUpperCase();
        if (cat.includes('MỔ') || cat.includes('MO_CC') || c.categoryKey === 'MO_CC') {
          emergencySurgeries.push({
            dateKey: dk,
            ...c
          });
        }
        if (cat.includes('TỬ VONG') || cat.includes('TU_VONG') || cat.includes('XIN VỀ') || cat.includes('XIN_VE') || c.categoryKey === 'TU_VONG' || c.categoryKey === 'XIN_VE') {
          fatalitiesAndCritical.push({
            dateKey: dk,
            ...c
          });
        }
      });

      days.push({
        dateKey: dk,
        dayName: getDayNameVN(dk),
        benhCu: valBenhCu,
        vao: valVao,
        ra: valRa,
        tuVong: valTuVong,
        chuyen: valChuyen,
        mo: valMo,
        moCC: valMoCC,
        moCT: valMoCT,
        hienCo: valHienCo,
        bhyt: valBhyt,
        doctorsOnDuty: docsDuty.join(' – '),
        highlightCount: hlCases.length,
        hasData: Boolean(db.briefingReports && db.briefingReports[dk])
      });
    }

    const daysCount = Math.max(1, dateKeys.length);
    const averages = {
      avgHienCo: Math.round((sumHienCo / daysCount) * 10) / 10,
      avgVao: Math.round((sumVao / daysCount) * 10) / 10,
      avgRa: Math.round((sumRa / daysCount) * 10) / 10,
      avgMo: Math.round((sumMo / daysCount) * 10) / 10
    };

    const totals = {
      totalVao: sumVao,
      totalRa: sumRa,
      totalTuVong: sumTuVong,
      totalChuyen: sumChuyen,
      totalMo: sumMo,
      totalMoCC: sumMoCC,
      totalMoCT: sumMoCT,
      daysCount
    };

    const doctorDutySummary = Object.values(doctorDutyCount).sort((a, b) => b.shifts - a.shifts);

    return {
      startDate,
      endDate,
      periodLabel: periodLabel || `Từ ${startDate} đến ${endDate}`,
      days,
      totals,
      averages,
      emergencySurgeries,
      fatalitiesAndCritical,
      doctorDutySummary
    };
  }

  function generateBriefingPeriodExcel(summary) {
    const wb = XLSX.utils.book_new();

    // Sheet 1: Tong_Hop_So_Lieu
    const rows1 = [
      ['BỆNH VIỆN ĐA KHOA TRUNG TÂM TỈNH GIA LAI - KHOA NGOẠI THẦN KINH - CỘT SỐNG'],
      [`BÁO CÁO TỔNG HỢP SỐ LIỆU GIAO BAN (${summary.periodLabel})`],
      [],
      ['STT', 'Ngày', 'Thứ', 'Bệnh cũ', 'Vào', 'Ra', 'Tử vong', 'Chuyển', 'Mổ', 'Hiện có', 'Bảo hiểm', 'BS Trực đêm', 'Số ca trọng điểm']
    ];

    summary.days.forEach((d, idx) => {
      rows1.push([
        idx + 1,
        d.dateKey,
        d.dayName,
        d.benhCu,
        d.vao,
        d.ra,
        d.tuVong,
        d.chuyen,
        d.mo,
        d.hienCo,
        d.bhyt,
        d.doctorsOnDuty,
        d.highlightCount
      ]);
    });

    // Totals & Averages
    rows1.push([
      '',
      'TỔNG CỘNG',
      '-',
      '-',
      summary.totals.totalVao,
      summary.totals.totalRa,
      summary.totals.totalTuVong,
      summary.totals.totalChuyen,
      summary.totals.totalMo,
      '-',
      '-',
      '-',
      summary.emergencySurgeries.length + summary.fatalitiesAndCritical.length
    ]);

    rows1.push([
      '',
      'TRUNG BÌNH/NGÀY',
      '-',
      '-',
      summary.averages.avgVao,
      summary.averages.avgRa,
      '-',
      '-',
      summary.averages.avgMo,
      summary.averages.avgHienCo,
      '-',
      '-',
      '-'
    ]);

    const ws1 = XLSX.utils.aoa_to_sheet(rows1);
    ws1['!cols'] = [
      { wch: 6 },
      { wch: 14 },
      { wch: 12 },
      { wch: 10 },
      { wch: 10 },
      { wch: 10 },
      { wch: 10 },
      { wch: 10 },
      { wch: 10 },
      { wch: 12 },
      { wch: 10 },
      { wch: 30 },
      { wch: 16 }
    ];
    XLSX.utils.book_append_sheet(wb, ws1, 'Tong_Hop_So_Lieu');

    // Sheet 2: Danh_Sach_Mo_Cap_Cuu
    const rows2 = [
      [`DANH SÁCH CA MỔ CẤP CỨU (${summary.periodLabel}) - TỔNG: ${summary.emergencySurgeries.length} CA`],
      [],
      ['STT', 'Ngày', 'Phòng', 'Họ tên bệnh nhân', 'Tuổi', 'Giới tính', 'Địa chỉ', 'Ngày vào viện', 'Ngày phẫu thuật', 'Chẩn đoán', 'Kíp mổ / PTV', 'Diễn biến ca trực']
    ];

    summary.emergencySurgeries.forEach((c, idx) => {
      rows2.push([
        idx + 1,
        c.dateKey,
        c.roomName || c.roomKey || '',
        c.hoten || '',
        c.tuoi || '',
        c.gioiTinh || 'NAM',
        c.diaChi || '',
        c.ngayVaoVien || '',
        c.ngayPhauThuat || '',
        c.chanDoan || '',
        c.kipMo || '',
        c.dienBien || ''
      ]);
    });

    const ws2 = XLSX.utils.aoa_to_sheet(rows2);
    ws2['!cols'] = [
      { wch: 6 },
      { wch: 14 },
      { wch: 16 },
      { wch: 24 },
      { wch: 8 },
      { wch: 10 },
      { wch: 30 },
      { wch: 14 },
      { wch: 14 },
      { wch: 45 },
      { wch: 25 },
      { wch: 35 }
    ];
    XLSX.utils.book_append_sheet(wb, ws2, 'Danh_Sach_Mo_Cap_Cuu');

    // Sheet 3: Tu_Vong_Va_Xin_Ve
    const rows3 = [
      [`DANH SÁCH CA TỬ VONG & NẶNG XIN VỀ (${summary.periodLabel}) - TỔNG: ${summary.fatalitiesAndCritical.length} CA`],
      [],
      ['STT', 'Ngày', 'Phòng', 'Phân loại', 'Họ tên bệnh nhân', 'Tuổi', 'Giới tính', 'Địa chỉ', 'Ngày vào viện', 'Ngày xin về / Tử vong', 'Chẩn đoán', 'Diễn biến / Ghi chú']
    ];

    summary.fatalitiesAndCritical.forEach((c, idx) => {
      rows3.push([
        idx + 1,
        c.dateKey,
        c.roomName || c.roomKey || '',
        c.category || '',
        c.hoten || '',
        c.tuoi || '',
        c.gioiTinh || 'NAM',
        c.diaChi || '',
        c.ngayVaoVien || '',
        c.ngayXinVe || c.dateKey,
        c.chanDoan || '',
        c.dienBien || ''
      ]);
    });

    const ws3 = XLSX.utils.aoa_to_sheet(rows3);
    ws3['!cols'] = [
      { wch: 6 },
      { wch: 14 },
      { wch: 16 },
      { wch: 24 },
      { wch: 24 },
      { wch: 8 },
      { wch: 10 },
      { wch: 30 },
      { wch: 14 },
      { wch: 16 },
      { wch: 45 },
      { wch: 35 }
    ];
    XLSX.utils.book_append_sheet(wb, ws3, 'Tu_Vong_Va_Xin_Ve');

    // Sheet 4: Lich_Truc_Bac_Si
    const rows4 = [
      [`THỐNG KÊ KÍP TRỰC BÁC SĨ (${summary.periodLabel})`],
      [],
      ['STT', 'Bác sĩ trực', 'Tổng số ca trực', 'Chi tiết các ngày trực']
    ];

    summary.doctorDutySummary.forEach((doc, idx) => {
      rows4.push([
        idx + 1,
        doc.name,
        doc.shifts,
        (doc.dates || []).join(', ')
      ]);
    });

    const ws4 = XLSX.utils.aoa_to_sheet(rows4);
    ws4['!cols'] = [
      { wch: 6 },
      { wch: 24 },
      { wch: 16 },
      { wch: 50 }
    ];
    XLSX.utils.book_append_sheet(wb, ws4, 'Lich_Truc_Bac_Si');

    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  }

  // GET /api/briefing-report
  if (req.method === 'GET' && pathname === '/api/briefing-report') {
    const reqUrl = new URL(req.url, 'http://localhost');
    const qDate = reqUrl.searchParams.get('date') || getDateKey(new Date());
    const report = getOrBuildBriefingReport(qDate);
    const dutyDocsShort = getDutyDoctorsAbbr(qDate);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      ok: true,
      dateKey: qDate,
      report,
      doctors: db.doctors || [],
      dutyDoctorsAbbr: dutyDocsShort.join(' – '),
      inpatientList: getAllInpatientsList(),
      tk4Consultations: getTk4SurgicalConsultations(qDate),
      availableDates: Object.keys(db.briefingReports || {})
    }));
    return;
  }

  // POST /api/briefing-report
  if (req.method === 'POST' && pathname === '/api/briefing-report') {
    const body = await readBody(req);
    const { dateKey, roomKey, roomReport, overall, highlightCases, action, targetDate: reqTargetDate } = body;
    const targetDate = reqTargetDate || dateKey || getDateKey(new Date());
    const report = getOrBuildBriefingReport(targetDate);

    if (action === 'SAVE_TK4_CONSULTATION') {
      const { mabn, postConsultDiagnosis, surgeryMethod, decision, advancePayment, isConsulted } = body;
      const tk4 = db.wardRounds && db.wardRounds.tk4;
      if (tk4 && tk4.patientRecords && tk4.patientRecords[mabn]) {
        const rec = tk4.patientRecords[mabn];
        if (!rec.surgicalConsultationsByDate) rec.surgicalConsultationsByDate = {};
        const scObj = {
          isConsulted: isConsulted !== undefined ? Boolean(isConsulted) : true,
          dateKey: targetDate,
          postConsultDiagnosis: String(postConsultDiagnosis !== undefined ? postConsultDiagnosis : (rec.chanDoanHis || '')).trim(),
          surgeryMethod: String(surgeryMethod || '').trim(),
          decision: String(decision || 'Đồng ý').trim(),
          advancePayment: String(advancePayment || '').trim(),
          updatedAt: new Date().toISOString()
        };
        rec.surgicalConsultationsByDate[targetDate] = scObj;
        rec.surgicalConsultation = scObj;
        saveDb();
        broadcastState(`🔪 Đã lưu hội chẩn mổ Thần kinh 4 cho BN ${rec.hoten}`);
      }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true, tk4Consultations: getTk4SurgicalConsultations(targetDate) }));
      return;
    }

    if (action === 'DELETE_TK4_CONSULTATION') {
      const { mabn } = body;
      const tk4 = db.wardRounds && db.wardRounds.tk4;
      if (tk4 && tk4.patientRecords && tk4.patientRecords[mabn]) {
        const rec = tk4.patientRecords[mabn];
        if (rec.surgicalConsultationsByDate) {
          delete rec.surgicalConsultationsByDate[targetDate];
        }
        delete rec.surgicalConsultation;
        saveDb();
        broadcastState(`🗑️ Đã xóa BN ${rec.hoten} khỏi danh sách hội chẩn mổ Thần kinh 4`);
      }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true, tk4Consultations: getTk4SurgicalConsultations(targetDate) }));
      return;
    }

    if (roomKey && roomKey !== 'all') {
      if (roomReport && typeof roomReport === 'object') {
        report.roomReports[roomKey] = {
          ...report.roomReports[roomKey],
          ...roomReport,
          status: 'SUBMITTED',
          updatedAt: new Date().toISOString()
        };
        syncRoomKeyCasesToMaster(report, roomKey, report.roomReports[roomKey]);
        recalculateGrandCensus(report);
        broadcastState(`📋 [${report.roomReports[roomKey].roomName}] đã báo cáo giao ban ngày ${targetDate}`);
      }
    } else {
      if (overall && typeof overall === 'object') {
        report.overall = { ...report.overall, ...overall };
      }
      if (Array.isArray(highlightCases)) {
        report.highlightCases = highlightCases;
      }
      recalculateGrandCensus(report);
      broadcastState(`👨‍⚕️ Đã cập nhật & duyệt Báo cáo giao ban toàn khoa ngày ${targetDate}`);
    }

    saveDb();
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true, report, tk4Consultations: getTk4SurgicalConsultations(targetDate) }));
    return;
  }

  // POST /api/upload-clinical-image
  if (req.method === 'POST' && pathname === '/api/upload-clinical-image') {
    const { caseId, dateKey, fileName, base64Data, title, caption } = await readBody(req);
    if (!base64Data) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: 'Thiếu dữ liệu hình ảnh!' }));
      return;
    }

    const targetDate = dateKey || getDateKey(new Date());
    const dateDir = path.join(CLINICAL_UPLOAD_DIR, targetDate);
    if (!fs.existsSync(dateDir)) {
      fs.mkdirSync(dateDir, { recursive: true });
    }

    const matches = base64Data.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
    const rawBase64 = matches ? matches[2] : base64Data;
    const buffer = Buffer.from(rawBase64, 'base64');

    const cleanExt = (fileName && path.extname(fileName)) ? path.extname(fileName).toLowerCase() : '.png';
    const ext = ['.jpg', '.jpeg', '.png', '.webp'].includes(cleanExt) ? cleanExt : '.png';
    const safeName = `img_${Date.now()}_${Math.random().toString(36).slice(2, 7)}${ext}`;
    const filePath = path.join(dateDir, safeName);
    fs.writeFileSync(filePath, buffer);

    const imageUrl = `/uploads_clinical/${targetDate}/${safeName}`;
    const imgObj = {
      id: `img-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      title: String(title || 'Hình ảnh cận lâm sàng').trim(),
      caption: String(caption || '').trim(),
      url: imageUrl,
      uploadedAt: new Date().toISOString()
    };

    if (caseId && db.briefingReports && db.briefingReports[targetDate]) {
      const report = db.briefingReports[targetDate];
      const targetCase = (report.highlightCases || []).find(c => c.id === caseId);
      if (targetCase) {
        if (!Array.isArray(targetCase.images)) targetCase.images = [];
        targetCase.images.push(imgObj);
        saveDb();
        broadcastState(`🖼️ Đã đính kèm ảnh cận lâm sàng cho BN ${targetCase.hoten}`);
      }
    }

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true, image: imgObj, caseId }));
    return;
  }

  // POST /api/delete-clinical-image
  if (req.method === 'POST' && pathname === '/api/delete-clinical-image') {
    const { caseId, imageId, dateKey } = await readBody(req);
    const targetDate = dateKey || getDateKey(new Date());
    if (caseId && imageId && db.briefingReports && db.briefingReports[targetDate]) {
      const report = db.briefingReports[targetDate];
      const targetCase = (report.highlightCases || []).find(c => c.id === caseId);
      if (targetCase && Array.isArray(targetCase.images)) {
        const removed = targetCase.images.filter(img => img.id === imageId);
        targetCase.images = targetCase.images.filter(img => img.id !== imageId);
        saveDb();
        // Try unlink from disk if local
        for (const rem of removed) {
          if (rem.url && rem.url.startsWith('/uploads_clinical/')) {
            const relPath = rem.url.replace('/uploads_clinical/', '');
            const localFile = path.join(CLINICAL_UPLOAD_DIR, relPath);
            if (fs.existsSync(localFile)) {
              try { fs.unlinkSync(localFile); } catch (e) { /* ignore */ }
            }
          }
        }
        broadcastState(`🗑️ Đã xóa ảnh cận lâm sàng của BN ${targetCase.hoten}`);
      }
    }
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // POST /api/briefing-auto-fetch-his
  if (req.method === 'POST' && pathname === '/api/briefing-auto-fetch-his') {
    const { dateKey, roomKey } = await readBody(req);
    const targetDate = dateKey || getDateKey(new Date());
    const freshDraft = buildBriefingDraftFromHis(targetDate);

    if (roomKey && roomKey !== 'all') {
      const roomDraft = freshDraft.roomReports[roomKey];
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true, roomKey, roomReport: roomDraft }));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true, report: freshDraft }));
    return;
  }

  // GET /api/export-briefing-pptx?date=YYYY-MM-DD
  if (req.method === 'GET' && pathname === '/api/export-briefing-pptx') {
    const reqUrl = new URL(req.url, 'http://localhost');
    const qDate = reqUrl.searchParams.get('date') || getDateKey(new Date());

    try {
      const database = loadDb();
      if (!database.briefingReports) database.briefingReports = {};
      if (!database.briefingReports[qDate]) {
        database.briefingReports[qDate] = getOrBuildBriefingReport(qDate);
        saveDb(database);
      }
    } catch (e) {
      console.warn('Could not auto-persist draft before PPTX export:', e);
    }

    const tempPptx = path.join(ROOT, `briefing_${qDate}_${Date.now()}.pptx`);
    const scriptPath = path.join(ROOT, 'scripts', 'generate_briefing_pptx.py');
    const pythonCmd = `python "${scriptPath}" --date ${qDate} --out "${tempPptx}"`;

    exec(pythonCmd, (err, stdout, stderr) => {
      if (err || !fs.existsSync(tempPptx)) {
        console.error('PPTX export error:', err, stderr);
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: 'Không thể tạo file PowerPoint: ' + (stderr || (err && err.message)) }));
        return;
      }
      res.writeHead(200, {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'Content-Disposition': `attachment; filename="Bao_Cao_Giao_Ban_${qDate}.pptx"`,
        'Cache-Control': 'no-cache'
      });
      const readStream = fs.createReadStream(tempPptx);
      readStream.pipe(res);
      readStream.on('close', () => {
        try { fs.unlinkSync(tempPptx); } catch (e) {}
      });
    });
    return;
  }

  // GET /api/export-briefing-excel?date=YYYY-MM-DD
  if (req.method === 'GET' && pathname === '/api/export-briefing-excel') {
    const reqUrl = new URL(req.url, 'http://localhost');
    const qDate = reqUrl.searchParams.get('date') || getDateKey(new Date());
    try {
      const buffer = generateBriefingDailyExcel(qDate);
      res.writeHead(200, {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="Bao_Cao_Giao_Ban_${qDate}.xlsx"`,
        'Cache-Control': 'no-cache'
      });
      res.end(buffer);
    } catch (err) {
      console.error('Daily excel export error:', err);
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: 'Không thể tạo file Excel: ' + err.message }));
    }
    return;
  }

  // GET /api/briefing-period-summary
  if (req.method === 'GET' && pathname === '/api/briefing-period-summary') {
    const reqUrl = new URL(req.url, 'http://localhost');
    const mode = reqUrl.searchParams.get('mode') || 'month'; // 'month' | 'week' | 'custom'
    let startDate = reqUrl.searchParams.get('startDate');
    let endDate = reqUrl.searchParams.get('endDate');
    let label = reqUrl.searchParams.get('label');

    const now = new Date();
    if (mode === 'month') {
      const year = Number(reqUrl.searchParams.get('year')) || now.getFullYear();
      const month = Number(reqUrl.searchParams.get('month')) || (now.getMonth() + 1);
      const endD = new Date(year, month, 0); // last day of month
      startDate = `${year}-${String(month).padStart(2, '0')}-01`;
      endDate = `${year}-${String(month).padStart(2, '0')}-${String(endD.getDate()).padStart(2, '0')}`;
      label = `Tháng ${String(month).padStart(2, '0')}/${year}`;
    } else if (mode === 'week') {
      if (!startDate) {
        const d = new Date();
        const day = d.getDay();
        const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Monday
        const monday = new Date(d.setDate(diff));
        const sunday = new Date(d.setDate(diff + 6));
        startDate = getDateKey(monday);
        endDate = getDateKey(sunday);
        label = `Tuần từ ${startDate} đến ${endDate}`;
      }
    }

    try {
      const summary = getBriefingPeriodSummary(startDate, endDate, label);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true, summary }));
    } catch (err) {
      console.error('Period summary error:', err);
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: 'Lỗi tổng hợp số liệu: ' + err.message }));
    }
    return;
  }

  // GET /api/export-briefing-period-excel
  if (req.method === 'GET' && pathname === '/api/export-briefing-period-excel') {
    const reqUrl = new URL(req.url, 'http://localhost');
    const mode = reqUrl.searchParams.get('mode') || 'month';
    let startDate = reqUrl.searchParams.get('startDate');
    let endDate = reqUrl.searchParams.get('endDate');
    let label = reqUrl.searchParams.get('label');

    const now = new Date();
    if (mode === 'month') {
      const year = Number(reqUrl.searchParams.get('year')) || now.getFullYear();
      const month = Number(reqUrl.searchParams.get('month')) || (now.getMonth() + 1);
      const endD = new Date(year, month, 0);
      startDate = `${year}-${String(month).padStart(2, '0')}-01`;
      endDate = `${year}-${String(month).padStart(2, '0')}-${String(endD.getDate()).padStart(2, '0')}`;
      label = `Tháng ${String(month).padStart(2, '0')}/${year}`;
    } else if (mode === 'week') {
      if (!startDate) {
        const d = new Date();
        const day = d.getDay();
        const diff = d.getDate() - day + (day === 0 ? -6 : 1);
        const monday = new Date(d.setDate(diff));
        const sunday = new Date(d.setDate(diff + 6));
        startDate = getDateKey(monday);
        endDate = getDateKey(sunday);
      }
      if (!label) label = `Tuần từ ${startDate} đến ${endDate}`;
    }

    try {
      const summary = getBriefingPeriodSummary(startDate, endDate, label);
      const buffer = generateBriefingPeriodExcel(summary);
      const cleanLabel = (label || 'Ky_Bao_Cao').replace(/[^a-zA-Z0-9_\-]/g, '_');
      res.writeHead(200, {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="Tong_Hop_Giao_Ban_${cleanLabel}.xlsx"`,
        'Cache-Control': 'no-cache'
      });
      res.end(buffer);
    } catch (err) {
      console.error('Period excel export error:', err);
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: 'Không thể tạo file Excel tổng hợp: ' + err.message }));
    }
    return;
  }

  // Lightweight ping endpoint for 24/7 Keep-Alive
  if (pathname === '/api/ping') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true, status: 'awake', ts: Date.now() }));
    return;
  }

  // Auto-detect public cloud URL (e.g. https://tkcs.onrender.com) if not set in env
  const reqHost = req.headers['x-forwarded-host'] || req.headers.host || '';
  if (reqHost && !reqHost.includes('localhost') && !reqHost.includes('127.0.0.1')) {
    detectedPublicUrl = `https://${reqHost}`;
  }

  // Static file serving with clean routes for Home & Subpages
  let cleanRoute = pathname;
  if (cleanRoute === '/') cleanRoute = '/index.html';
  else if (cleanRoute === '/quan-ly-user') cleanRoute = '/quan-ly-user.html';
  else if (cleanRoute === '/hanh-chinh-khoa') cleanRoute = '/hanh-chinh-khoa.html';
  else if (cleanRoute === '/di-buong-hang-ngay' || cleanRoute === '/di-buong') cleanRoute = '/di-buong-hang-ngay.html';
  else if (cleanRoute === '/bao-cao-giao-ban' || cleanRoute === '/giao-ban') cleanRoute = '/bao-cao-giao-ban.html';
  else if (cleanRoute === '/dang-nhap' || cleanRoute === '/login') cleanRoute = '/dang-nhap.html';

  // Protect sensitive credential and session files from direct HTTP static download
  if (cleanRoute === '/users.json' || cleanRoute === '/auth_sessions.json') {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('403 Forbidden: Truy cập tệp xác thực bị từ chối.');
    return;
  }

  const filePath = path.join(ROOT, cleanRoute);
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

// ============================================================================
// 24/7 AUTO KEEP-AWAKE (Giữ máy chủ Render luôn thức - dùng ~720-744h / 750h miễn phí mỗi tháng)
// ============================================================================
let detectedPublicUrl = process.env.RENDER_EXTERNAL_URL || '';

// 1. Giữ luồng SSE luôn thông suốt mỗi 25 giây
setInterval(() => {
  for (const res of sseClients) {
    try {
      res.write(`: keepalive ${Date.now()}\n\n`);
    } catch (e) {
      sseClients.delete(res);
    }
  }
}, 25 * 1000);

// 2. Tự động gõ cửa (Self-Ping) qua Internet mỗi 10 phút (< 15 phút giới hạn nghỉ của Render)
setInterval(async () => {
  const targetOrigin = process.env.RENDER_EXTERNAL_URL || detectedPublicUrl;
  if (!targetOrigin) return;
  try {
    const cleanUrl = targetOrigin.replace(/\/+$/, '') + '/api/ping';
    await fetch(cleanUrl, { headers: { 'User-Agent': 'TKCS-KeepAlive-Ping' } });
  } catch (e) {
    // Ignore transient network errors
  }
}, 10 * 60 * 1000);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Realtime Timeline Server running at http://localhost:${PORT}`);
});

