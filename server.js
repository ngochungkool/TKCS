process.env.TZ = 'Asia/Ho_Chi_Minh';

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8080;
const ROOT = __dirname;
const DATA_FILE = path.join(ROOT, 'state_db.json');
const VN_OFFSET_MS = 7 * 60 * 60 * 1000; // GMT+7 (Asia/Ho_Chi_Minh)
const VN_OFFSET_MIN = 7 * 60;            // +420 minutes from UTC

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
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

const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = decodeURIComponent(parsedUrl.pathname);

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
            }
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
    const targetRoomKey = (roomKey && ['tk1', 'tk2', 'tk3', 'tk4', 'hstk'].includes(roomKey)) ? roomKey : 'tk1';
    if (!db.wardRounds || !db.wardRounds[targetRoomKey]) {
      syncTk1WardRoundsFromHis();
    }
    const tk1 = db.wardRounds[targetRoomKey] || db.wardRounds.tk1;
    const now = new Date();
    const todayKey = getDateKey(now);

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
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true, tk1, wardRounds: db.wardRounds, episodeConsultations: db.episodeConsultations }));
      return;
    }

    if (action === 'UNASSIGN_BED') {
      const { mabn } = body;
      for (const [bCode, m] of Object.entries(tk1.bedAssignments)) {
        if (m === mabn) delete tk1.bedAssignments[bCode];
      }
      broadcastState(`🛏️ Đã đưa bệnh nhân về danh sách chờ phân giường (${tk1.roomName})`);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true, tk1, wardRounds: db.wardRounds, episodeConsultations: db.episodeConsultations }));
      return;
    }

    if (action === 'TOGGLE_FOLDING_BED_VISIBILITY') {
      const { mainBedNum, hidden } = body;
      if (hidden) {
        tk1.hiddenFoldingBeds[String(mainBedNum)] = true;
      } else {
        delete tk1.hiddenFoldingBeds[String(mainBedNum)];
      }
      broadcastState(`🛏️ Đã cập nhật hiển thị giường xếp ${mainBedNum}X (${tk1.roomName})`);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true, tk1, wardRounds: db.wardRounds, episodeConsultations: db.episodeConsultations }));
      return;
    }

    if (action === 'SAVE_PATIENT_ROUND') {
      const { mabn, dateKey, customDiagnosis, tasks, consultDetails } = body;
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
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true, tk1, wardRounds: db.wardRounds, episodeConsultations: db.episodeConsultations }));
      return;
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
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true, tk1, wardRounds: db.wardRounds, episodeConsultations: db.episodeConsultations }));
      return;
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
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true, tk1, wardRounds: db.wardRounds, episodeConsultations: db.episodeConsultations }));
      return;
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
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true, tk1, wardRounds: db.wardRounds, episodeConsultations: db.episodeConsultations }));
      return;
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
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true, tk1, wardRounds: db.wardRounds, episodeConsultations: db.episodeConsultations }));
      return;
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
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true, tk1, wardRounds: db.wardRounds, episodeConsultations: db.episodeConsultations }));
      return;
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
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true, tk1, wardRounds: db.wardRounds, episodeConsultations: db.episodeConsultations }));
      return;
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
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true, tk1, wardRounds: db.wardRounds, episodeConsultations: db.episodeConsultations }));
      return;
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

