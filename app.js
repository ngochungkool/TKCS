/**
 * Hệ thống Quản lý & Điều phối User Bác sĩ | Khoa Ngoại Thần Kinh - Cột Sống
 * Bệnh viện Đa khoa Trung tâm tỉnh Gia Lai
 * - Đồng bộ tức thì qua Server-Sent Events (/api/stream, <50ms) + Chu kỳ quét 1 giây (1000ms)
 * - Sắp xếp ưu tiên: User Có thể sử dụng đứng trước -> Bác sĩ tại phòng đang chọn đứng trước -> Bác sĩ lớn hơn đứng trước (1..14)
 * - Box Nhận sử dụng: Chọn nhanh 5 - 10 - 20 - 30 - 60 phút
 * - Box Báo mổ to rõ cho điện thoại
 * - Tra cứu khả năng sử dụng theo phòng & thời gian nhất định + Tra cứu lịch sử
 */

const DEPT_ROOMS = [
  { id: 'room-1', name: 'Thần kinh 1' },
  { id: 'room-2', name: 'Thần kinh 2' },
  { id: 'room-3', name: 'Thần kinh 3' },
  { id: 'room-4', name: 'Thần kinh 4' },
  { id: 'room-5', name: 'Hồi sức thần kinh' }
];

const ROOMS = [
  ...DEPT_ROOMS,
  { id: 'slot-surgery', name: 'Đang mổ', isSurgery: true }
];

const SHIFT_METADATA = {
  TRUC:       { label: 'Trực',       badgeCls: 'badge-truc',    desc: 'Đang trực' },
  RA_TRUC:    { label: 'Ra trực',    badgeCls: 'badge-ratruc',  desc: 'Đang trực từ hôm trước' },
  LAM_NGAY:   { label: 'Làm ngày',   badgeCls: 'badge-lamngay', desc: 'Làm hành chính (07:00–11:30, 13:30–17:00)' },
  PHONG_KHAM: { label: 'Phòng khám', badgeCls: 'badge-off',     desc: 'Ngồi phòng khám (Nghỉ nội trú)' },
  NGHI:       { label: 'Nghỉ',       badgeCls: 'badge-off',     desc: 'Đang nghỉ' },
  NGHI_SANG:  { label: 'Nghỉ sáng',  badgeCls: 'badge-off',     desc: 'Nghỉ sáng (Mở chiều 13:30–17:00)' },
  NGHI_CHIEU: { label: 'Nghỉ chiều', badgeCls: 'badge-off',     desc: 'Nghỉ chiều (Mở sáng 07:00–11:30)' }
};

let dbState = {
  rooms: ROOMS.map((r) => r.name),
  doctors: []
};

let selectedRoomName = 'Thần kinh 1';
const VN_OFFSET_MS = 7 * 60 * 60 * 1000; // GMT+7 (Asia/Ho_Chi_Minh)

let windowOffsetMinutes = 0;
let selectedSurgeryDocIds = new Set();

function getNowEpochMinutes() {
  return Math.floor(Date.now() / 60000);
}

function formatHHMM(epochMin) {
  if (typeof epochMin !== 'number' || isNaN(epochMin)) return '';
  const vnDate = new Date(epochMin * 60000 + VN_OFFSET_MS);
  const hh = String(vnDate.getUTCHours()).padStart(2, '0');
  const mm = String(vnDate.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

function formatDateVN(epochMin) {
  if (typeof epochMin !== 'number' || isNaN(epochMin)) return '';
  const vnDate = new Date(epochMin * 60000 + VN_OFFSET_MS);
  const dd = String(vnDate.getUTCDate()).padStart(2, '0');
  const mm = String(vnDate.getUTCMonth() + 1).padStart(2, '0');
  const yyyy = vnDate.getUTCFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function getCurrentStaffAuth() {
  let authUser = null;
  if (window.TKCSAuth && typeof window.TKCSAuth.getUser === 'function') {
    authUser = window.TKCSAuth.getUser();
  }
  if (!authUser) {
    try {
      authUser = JSON.parse(localStorage.getItem('auth_user') || 'null');
    } catch (e) {}
  }

  const staffName = (authUser?.name || authUser?.fullName || '').trim();
  let staffRole = (authUser?.title || authUser?.position || authUser?.specialty || '').trim();
  if (!staffRole) {
    if (authUser?.role === 'admin') staffRole = 'Quản trị viên';
    else if (authUser?.role === 'doctor') staffRole = 'Bác sĩ';
    else if (authUser?.role === 'nurse') staffRole = 'Điều dưỡng';
    else staffRole = 'Điều dưỡng';
  }

  return {
    staffName,
    staffRole
  };
}

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

function normalize24hTimeStr(raw, fallbackEmpty = true) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (!digits) return fallbackEmpty ? '' : '08:00';
  let hh = 0, mm = 0;
  if (digits.length <= 2) {
    hh = Math.min(23, Number(digits));
    mm = 0;
  } else if (digits.length === 3) {
    hh = Math.min(23, Number(digits.slice(0, 1)));
    mm = Math.min(59, Number(digits.slice(1, 3)));
  } else {
    hh = Math.min(23, Number(digits.slice(0, 2)));
    mm = Math.min(59, Number(digits.slice(2, 4)));
  }
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function timeStringToEpochMin(hhmmStr, refEpochMin) {
  const normalized = normalize24hTimeStr(hhmmStr, true);
  if (!normalized || !normalized.includes(':')) return null;
  const [hh, mm] = normalized.split(':').map(Number);
  const refDate = new Date(refEpochMin * 60000);
  const target = new Date(refDate.getFullYear(), refDate.getMonth(), refDate.getDate(), hh, mm, 0, 0);
  return Math.floor(target.getTime() / 60000);
}

function dateAndTimeToEpochMin(dateKeyStr, hhmmStr) {
  const normalized = normalize24hTimeStr(hhmmStr, false);
  if (!dateKeyStr || !normalized) return getNowEpochMinutes();
  const [y, m, d] = dateKeyStr.split('-').map(Number);
  const [hh, mm] = normalized.split(':').map(Number);
  return Math.floor(new Date(y, m - 1, d, hh, mm, 0, 0).getTime() / 60000);
}

function showToast(msg) {
  const container = document.getElementById('toast-container');
  if (!container || !msg) return;
  const el = document.createElement('div');
  el.className = 'toast-msg';
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

function isUsageActiveAt(u, epochMin) {
  if (u.releasedEarly) return false;
  if (u.endMin === null) return epochMin >= u.startMin;
  return epochMin >= u.startMin && epochMin < u.endMin;
}

function getActiveUsageAt(doc, epochMin) {
  return (doc.usages || []).find((u) => isUsageActiveAt(u, epochMin));
}

function getActiveUsage(doc) {
  return getActiveUsageAt(doc, getNowEpochMinutes());
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

function getAllowedIntervalsForDate(doc, dateKey) {
  const [y, m, d] = String(dateKey).split('-').map(Number);
  const dayStartMs = Date.UTC(y, m - 1, d, 0, 0, 0, 0) - VN_OFFSET_MS;
  const dayStartMin = Math.floor(dayStartMs / 60000);
  const dayOfWeek = new Date(Date.UTC(y, m - 1, d, 12, 0, 0)).getUTCDay();
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

  const prevDateKey = addDaysToKey(dateKey, -1);
  const prevShift = getEffectiveShiftForDate(doc, prevDateKey);
  const todayShift = getEffectiveShiftForDate(doc, dateKey);

  const intervals = [];

  // 1. Nửa sau ca trực hôm qua (tua 07:00 hôm qua -> 07:00 hôm nay):
  if (prevShift === 'TRUC') {
    intervals.push([dayStartMin + 0, dayStartMin + 420]); // 00:00 -> 07:00
  }

  // 2. Ca làm việc trong ngày hôm nay:
  if (todayShift === 'TRUC') {
    // Tua trực bắt đầu từ 07:00 sáng hôm nay đến hết ngày hôm nay (tiếp tục sang sáng hôm sau)
    intervals.push([dayStartMin + 420, dayStartMin + 1440]); // 07:00 -> 24:00
  } else if (todayShift === 'RA_TRUC') {
    // Sau 07:00: Ra trực buổi sáng ngày thường (giao ban & giải quyết hồ sơ bệnh án)
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

function getAllowedIntervalsInWindow(doc, windowStart, windowEnd) {
  const startKey = getDateKey(new Date(windowStart * 60000));
  const endKey = getDateKey(new Date(windowEnd * 60000));
  const keys = startKey === endKey ? [startKey] : [startKey, endKey];

  const all = [];
  for (const k of keys) {
    all.push(...getAllowedIntervalsForDate(doc, k));
  }
  return all;
}

function isDoctorAllowedAtMinute(doc, epochMin) {
  const dateKey = getDateKey(new Date(epochMin * 60000));
  const intervals = getAllowedIntervalsForDate(doc, dateKey);
  return intervals.some(([s, e]) => epochMin >= s && epochMin < e);
}

function getDoctorShiftInfoAtMinute(doc, epochMin) {
  const dateKey = getDateKey(new Date(epochMin * 60000));
  const prevKey = addDaysToKey(dateKey, -1);
  const dt = new Date(epochMin * 60000 + VN_OFFSET_MS);
  const hh = dt.getUTCHours();
  const mm = dt.getUTCMinutes();
  const minsOfDay = hh * 60 + mm;
  const dayOfWeek = dt.getUTCDay();
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

  const prevShift = (doc.scheduleByDate && doc.scheduleByDate[prevKey]) || '';
  const todayShift = (doc.scheduleByDate && doc.scheduleByDate[dateKey]) || '';
  const effectiveTodayShift = todayShift || (prevShift === 'TRUC' ? 'RA_TRUC' : 'LAM_NGAY');

  // TRƯỜNG HỢP 1: TRƯỚC 07:00 SÁNG (00:00 - 06:59)
  // Thuộc về ca trực của ngày hôm qua (bắt đầu từ 07:00 hôm qua đến 07:00 hôm nay)
  if (minsOfDay < 420) {
    if (prevShift === 'TRUC') {
      return {
        badgeText: 'Trực',
        badgeCls: 'badge-truc',
        subText: 'Đang trực (tua 07:00 hôm qua – 07:00 hôm nay)'
      };
    }
    return {
      badgeText: 'Ngoài giờ',
      badgeCls: 'badge-off',
      subText: 'Ngoài giờ làm việc (Trước 07:00)'
    };
  }

  // TRƯỜNG HỢP 2: TỪ 07:00 SÁNG TRỞ ĐI (07:00 - 23:59)
  // 2.1. Bác sĩ hôm nay TRỰC (bắt đầu từ 07:00 hôm nay đến 07:00 hôm sau):
  if (effectiveTodayShift === 'TRUC') {
    return {
      badgeText: 'Trực',
      badgeCls: 'badge-truc',
      subText: 'Đang trực (tua 07:00 hôm nay – 07:00 hôm sau)'
    };
  }

  // 2.2. Bác sĩ ra trực (hoặc trực hôm qua nhưng hôm nay không có lịch khác):
  if (effectiveTodayShift === 'RA_TRUC') {
    if (!isWeekend && minsOfDay < 690) { // Trước 11:30 ngày thường
      return {
        badgeText: 'Ra trực',
        badgeCls: 'badge-ratruc',
        subText: 'Ra trực (Giao ban & làm việc 07:00 – 11:30)'
      };
    }
    return {
      badgeText: 'Ra trực',
      badgeCls: 'badge-ratruc',
      subText: isWeekend ? 'Đã hết ca trực lúc 07:00 (Cuối tuần)' : 'Đã hết giờ ra trực (Sau 11:30)'
    };
  }

  // 2.3. Các ca làm việc khác trong ngày:
  const meta = SHIFT_METADATA[effectiveTodayShift] || { label: effectiveTodayShift, badgeCls: 'badge-off', desc: '' };
  return {
    badgeText: meta.label,
    badgeCls: meta.badgeCls,
    subText: meta.desc
  };
}

// Quy tắc số 6 của đại ca:
// Sắp xếp danh sách Bác sĩ theo thứ tự ưu tiên:
// 1. User ĐANG ĐƯỢC CHÍNH PHÒNG NÀY SỬ DỤNG -> ƯU TIÊN SỐ 1 LÊN ĐẦU TIÊN (để tiện quan sát & bấm Trả user)
// 2. Các user CÓ THỂ SỬ DỤNG ĐƯỢC (`isAvail`) đứng tiếp theo
//    - Ưu tiên Bác sĩ thuộc phòng đó (`assignedRoom === targetRoom`) trước
//    - Sau đó: Xếp theo seniority 1 -> 14
// 3. Các user KHÔNG SỬ DỤNG ĐƯỢC (đang dùng phòng khác, đang mổ, ngoài giờ trực) đứng sau cùng
//    - Ưu tiên bác sĩ thuộc phòng đó trước, rồi theo seniority 1 -> 14
function sortDoctorsByPriorityAndRoom(doctorsList, targetRoom, checkEpochMin) {
  return [...doctorsList].sort((a, b) => {
    const actA = getActiveUsageAt(a, checkEpochMin);
    const actB = getActiveUsageAt(b, checkEpochMin);

    // 1. Ưu tiên số 1: User đang sử dụng tại chính phòng đó lên đầu tiên
    const ownedByRoomA = Boolean(actA && actA.roomName === targetRoom);
    const ownedByRoomB = Boolean(actB && actB.roomName === targetRoom);
    if (ownedByRoomA !== ownedByRoomB) {
      return ownedByRoomA ? -1 : 1;
    }

    // Khi báo mổ: Bác sĩ trong giờ nghỉ vẫn có thể tham gia mổ (BHYT không xuất toán)
    const availA = targetRoom === 'Đang mổ' ? !actA : (!actA && isDoctorAllowedAtMinute(a, checkEpochMin));
    const availB = targetRoom === 'Đang mổ' ? !actB : (!actB && isDoctorAllowedAtMinute(b, checkEpochMin));

    // 2. Các user có thể sử dụng được đứng tiếp theo
    if (availA !== availB) {
      return availA ? -1 : 1;
    }

    // 3. Bác sĩ thường xuyên công tác tại phòng đó (`assignedRoom === targetRoom`) đứng trước
    const inRoomA = a.assignedRoom === targetRoom;
    const inRoomB = b.assignedRoom === targetRoom;
    if (inRoomA !== inRoomB) {
      return inRoomA ? -1 : 1;
    }

    // 4. Mặc định bác sĩ lớn hơn nằm ở phía trên (seniority 1 -> 14)
    return (a.seniority || 999) - (b.seniority || 999);
  });
}

function getTimelineWindow() {
  const nowMin = getNowEpochMinutes();
  const baseStart = Math.floor((nowMin - 145) / 5) * 5 + Math.round(windowOffsetMinutes || 0);
  return {
    nowMin,
    windowStart: baseStart,
    windowEnd: baseStart + 180,
    duration: 180
  };
}

// Update Realtime Clock in Top-Right Header
function renderHeaderClock() {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');

  const clockEl = document.getElementById('header-clock-time');
  if (clockEl) {
    clockEl.textContent = `${hh}:${mm}:${ss}`;
  }

  const daysVN = ['Chủ Nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];
  const dayName = daysVN[now.getDay()];
  const dateStr = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(
    2,
    '0'
  )}/${now.getFullYear()}`;

  const dateEl = document.getElementById('header-clock-date');
  if (dateEl) {
    dateEl.textContent = `${dayName}, ${dateStr}`;
  }

  const liveBtn = document.getElementById('btn-jump-now');
  if (liveBtn) {
    const isLiveNow = Math.round(windowOffsetMinutes) === 0;
    liveBtn.classList.toggle('is-live', isLiveNow);
  }
}

// Render Surgery Conflict Alerts for Ward Rooms
function renderSurgeryRoomAlerts() {
  const container = document.getElementById('surgery-room-alert-container');
  if (!container) return;

  const alerts = (dbState.surgeryAlerts || []).filter((a) => !a.acknowledged);
  if (alerts.length === 0) {
    container.innerHTML = '';
    return;
  }

  // Filter alerts relevant to current selectedRoomName, or show all if in "Đang mổ" / "ALL"
  const relevantAlerts = alerts.filter(
    (a) => selectedRoomName === 'ALL' || selectedRoomName === 'Đang mổ' || a.roomName === selectedRoomName
  );

  if (relevantAlerts.length === 0) {
    container.innerHTML = '';
    return;
  }

  container.innerHTML = relevantAlerts
    .map(
      (a) => `
      <div class="surgery-conflict-alert-card" style="background: linear-gradient(135deg, #fff1f2, #ffe4e6); border: 2px solid #e11d48; border-radius: 10px; padding: 0.85rem 1.15rem; margin-bottom: 0.65rem; display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 0.75rem; box-shadow: 0 4px 12px rgba(225,29,72,0.15);">
        <div style="flex: 1; min-width: 260px;">
          <div style="font-weight: 800; color: #9f1239; font-size: 0.95rem; display: flex; align-items: center; gap: 8px;">
            <span style="font-size: 1.25rem;">🚨</span>
            <span>CẢNH BÁO BÁO MỔ TRÙNG GIỜ — PHÒNG [${a.roomName}]</span>
          </div>
          <div style="font-size: 0.88rem; color: #881337; margin-top: 4px; line-height: 1.45;">
            Bác sĩ <b>${a.docName}</b> (${a.handle}) đã được báo mổ vào lúc <b>${a.startTimeStr}</b> (do <i>${a.reportedRole || 'Kíp mổ'} ${a.reportedBy || ''}</i> báo).
            <br>Tài khoản tại <b>[${a.roomName}]</b> đã chuyển sang phòng mổ. Phòng vui lòng chuyển giao hồ sơ hoặc chọn tài khoản bác sĩ khác!
          </div>
        </div>
        <div style="display: flex; gap: 0.5rem; align-items: center;">
          <button type="button" class="btn-ack-surgery-alert" data-ack-alert-id="${a.id}" style="background: #e11d48; color: #ffffff; border: none; padding: 8px 14px; border-radius: 8px; font-weight: 700; font-size: 0.84rem; cursor: pointer; display: flex; align-items: center; gap: 6px; box-shadow: 0 2px 6px rgba(225,29,72,0.3);">
            <span>Đã tiếp nhận</span> ✕
          </button>
        </div>
      </div>
    `
    )
    .join('');
}

// Render Global 60m + 5m Countdown Alert Banner
function renderGlobal60mWarnings() {
  const container = document.getElementById('global-60m-warning-container');
  if (!container) return;

  const nowMin = getNowEpochMinutes();
  const warnedDocs = dbState.doctors.filter((d) => {
    const act = getActiveUsage(d);
    return act && act.warnedAtMin !== null && act.warnedAtMin !== undefined;
  });

  if (warnedDocs.length === 0) {
    container.innerHTML = '';
    return;
  }

  container.innerHTML = warnedDocs
    .map((doc) => {
      const act = getActiveUsage(doc);
      const remainMins = Math.max(0, 5 - (nowMin - act.warnedAtMin));
      return `
        <div style="background: #fff1f2; border: 2px solid #e11d48; border-radius: 10px; padding: 0.75rem 1.05rem; margin-bottom: 0.45rem; display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 0.75rem;">
          <div>
            <div style="font-weight: 800; color: #9f1239; font-size: 0.9rem;">
              🔔 CẢNH BÁO QUÁ 60 PHÚT SỬ DỤNG USER: ${doc.name} (${doc.handle}) — Tại [${act.roomName}]
            </div>
            <div style="font-size: 0.81rem; color: #881337;">
              Bác sĩ còn làm việc nữa không? Tự động trả User sau <b>${remainMins} phút</b> nếu không xác nhận!
            </div>
          </div>
          <div style="display: flex; gap: 0.5rem;">
            <button type="button" class="btn-primary-sm" style="background: #15803d;" data-confirm-keep-doc="${doc.id}">
              ✅ Có, vẫn đang làm việc
            </button>
            <button type="button" class="btn-action-release" data-release-now-doc="${doc.id}">
              🔓 Trả User ngay
            </button>
          </div>
        </div>
      `;
    })
    .join('');
}

function getRoomIconHtml(room) {
  if (room.isSurgery || room.name === 'Đang mổ') {
    return `<span class="room-icon room-icon-surgery" title="Dao mổ"><svg xmlns="http://www.w3.org/2000/svg" width="1.18em" height="1.18em" viewBox="0 0 32 32" style="display:inline-block;vertical-align:-0.18em;"><path fill="currentColor" d="M28.83 5.17a4.1 4.1 0 0 0-5.66 0L.34 28h9.25a5 5 0 0 0 3.53-1.46l15.71-15.71a4 4 0 0 0 0-5.66M12.29 18.88l2.09-2.09l2.83 2.83l-2.09 2.09Zm-.58 6.24a3 3 0 0 1-2.12.88H5.17l5.71-5.71l2.83 2.83Zm15.7-15.71l-8.79 8.8l-2.83-2.83l8.8-8.79a2 2 0 0 1 2.82 0a2 2 0 0 1 0 2.82"/></svg></span>`;
  }
  if (room.name === 'Hồi sức thần kinh') {
    return `<span class="room-icon room-icon-hstk" title="Đèn cấp cứu">🚨</span>`;
  }
  if (room.name === 'Thần kinh 1') {
    return `<span class="room-icon room-icon-num" title="Số 1">1</span>`;
  }
  if (room.name === 'Thần kinh 2') {
    return `<span class="room-icon room-icon-num" title="Số 2">2</span>`;
  }
  if (room.name === 'Thần kinh 3') {
    return `<span class="room-icon room-icon-num" title="Số 3">3</span>`;
  }
  if (room.name === 'Thần kinh 4') {
    return `<span class="room-icon room-icon-num" title="Số 4">4</span>`;
  }
  return `<span class="room-icon">🏢</span>`;
}

// Render 5 Department Rooms + "Đang mổ" Card (with large "+ Báo mổ" button)
function renderRoomsGrid() {
  const container = document.getElementById('rooms-grid-container');
  if (!container) return;

  container.innerHTML = ROOMS.map((room) => {
    const activeDocsInRoom = dbState.doctors.filter((doc) => {
      const active = getActiveUsage(doc);
      return active && active.roomName === room.name;
    });

    const count = activeDocsInRoom.length;
    const hasActive = count > 0;
    const isSelected = room.name === selectedRoomName;
    const iconHtml = getRoomIconHtml(room);

    const countLabel = room.isSurgery
      ? count === 0
        ? '0 user đang đi mổ'
        : `${count} đang mổ (${activeDocsInRoom.map((d) => d.shortName || d.handle).join(', ')})`
      : count === 0
      ? '0 user đang sử dụng'
      : `${count} user đang sử dụng (${activeDocsInRoom.map((d) => d.shortName || d.handle).join(', ')})`;

    const hasUnackAlert = (dbState.surgeryAlerts || []).some(
      (a) => !a.acknowledged && a.roomName === room.name
    );
    const alertBadge = hasUnackAlert
      ? `<span class="room-alert-badge" style="background:#e11d48;color:#fff;font-size:0.72rem;font-weight:800;padding:2px 7px;border-radius:999px;margin-left:6px;animation:pulseAlert 1.5s infinite;box-shadow:0 0 8px rgba(225,29,72,0.6);" title="Có bác sĩ phòng này vừa chuyển sang phòng mổ">🚨 BS Đi Mổ!</span>`
      : '';

    return `
      <div
        class="room-card ${hasActive ? 'has-active' : ''} ${isSelected ? 'selected' : ''}"
        data-room-name="${room.name}"
        role="button"
        tabindex="0"
      >
        <div class="room-title-row">
          <div class="room-title">
            ${iconHtml}
            <span>${room.name}</span>
            ${alertBadge}
          </div>
          ${isSelected ? `<span class="room-selected-pill" title="Đang chọn phòng này"><i class="fa-solid fa-check"></i></span>` : ''}
        </div>
        <div class="room-count ${hasActive ? 'active-text' : ''}">
          ${countLabel}
        </div>
      </div>
    `;
  }).join('');
}

function renderTimeAxisHeader(windowStart, windowEnd, nowMin) {
  const rangeEl = document.getElementById('window-range-text');
  if (rangeEl) {
    rangeEl.innerHTML = `<strong>${formatHHMM(windowStart)}–${formatHHMM(windowEnd)}</strong> · ${formatDateVN(
      nowMin
    )} · 3 giờ`;
  }

  const axisEl = document.getElementById('time-axis-header');
  if (!axisEl) return;

  const firstTick = Math.ceil(windowStart / 15) * 15;
  const ticks = [];
  for (let i = 0; i < 12; i++) {
    ticks.push(firstTick + i * 15);
  }

  axisEl.innerHTML = ticks.map((tMin) => `<div class="time-tick-label">${formatHHMM(tMin)}</div>`).join('');
}

// Render Live Working Staff Activity Banner
function renderWorkingStaffBanner() {
  const container = document.getElementById('working-staff-banner');
  if (!container) return;

  const nowMin = getNowEpochMinutes();
  const activeEntries = [];
  const recentEntries = [];

  for (const doc of dbState.doctors || []) {
    const active = getActiveUsage(doc);
    if (active) {
      activeEntries.push({ doc, usage: active });
    }

    const finished = (doc.usages || []).filter((u) => u.endMin !== null && !isUsageActiveAt(u, nowMin));
    for (const f of finished) {
      recentEntries.push({ doc, usage: f });
    }
  }

  // Sort recent entries newest first
  recentEntries.sort((a, b) => (b.usage.endMin || 0) - (a.usage.endMin || 0));

  let itemsHtml = '';

  if (activeEntries.length > 0) {
    itemsHtml += activeEntries
      .map(({ doc, usage }) => {
        const staffRole = usage.receivedRole || 'Điều dưỡng';
        const staffName = usage.receivedBy || 'chưa ghi danh';
        const endStr = usage.endMin !== null ? ` (dự kiến đến ${formatHHMM(usage.endMin)})` : ' (Đang làm việc)';
        return `
          <div class="staff-activity-item is-active">
            <span class="staff-activity-dot dot-active"></span>
            <div class="staff-activity-text">
              <b>${staffRole} ${staffName}</b> đã nhận user <b>BS ${doc.shortName || doc.name}</b> vào <b>${usage.roomName}</b> lúc <b>${formatHHMM(usage.startMin)}</b>${endStr}
            </div>
          </div>
        `;
      })
      .join('');
  }

  const recentSlice = recentEntries.slice(0, activeEntries.length > 0 ? 3 : 5);
  if (recentSlice.length > 0) {
    itemsHtml += recentSlice
      .map(({ doc, usage }) => {
        const recRole = usage.receivedRole || 'Điều dưỡng';
        const recName = usage.receivedBy || 'chưa ghi danh';
        const relRole = usage.releasedRole || recRole;
        const relName = usage.releasedBy || recName;
        const byReleasedStr = usage.releasedBy && usage.releasedBy !== usage.receivedBy ? ` (bởi ${relRole} ${relName})` : '';
        return `
          <div class="staff-activity-item is-finished">
            <span class="staff-activity-dot dot-finished"></span>
            <div class="staff-activity-text">
              <b>${recRole} ${recName}</b> đã nhận user <b>BS ${doc.shortName || doc.name}</b> vào <b>${usage.roomName}</b> lúc <b>${formatHHMM(usage.startMin)}</b> — Trả lúc <b>${formatHHMM(usage.endMin)}</b>${byReleasedStr}
            </div>
          </div>
        `;
      })
      .join('');
  }

  if (!itemsHtml) {
    itemsHtml = `<div class="staff-empty-hint">ℹ️ Chưa có phiên nhận User Bác sĩ nào được ghi nhận. Tất cả tài khoản đang ở trạng thái sẵn sàng.</div>`;
  }

  container.innerHTML = `
    <div class="staff-banner-header">
      <div class="staff-banner-title">
        <i class="fa-solid fa-users-viewfinder"></i>
        <span>Nhật ký nhân sự đang làm việc với User Bác sĩ</span>
      </div>
      <span class="staff-banner-badge">
        ${activeEntries.length > 0 ? `🟢 ${activeEntries.length} Bác sĩ đang sử dụng` : '⚪ Tất cả User sẵn sàng'}
      </span>
    </div>
    <div class="staff-activity-grid">
      ${itemsHtml}
    </div>
  `;
}

// Render Timeline Rows (Sorted by Rule 6: Available first -> Doctors of selectedRoomName first -> Seniority 1..14)
function renderTimelineRows() {
  const { nowMin, windowStart, windowEnd, duration } = getTimelineWindow();
  renderTimeAxisHeader(windowStart, windowEnd, nowMin);

  const container = document.getElementById('timeline-rows-container');
  if (!container) return;

  const nowPctRaw = ((nowMin - windowStart) / duration) * 100;
  const nowPctClamped = Math.max(0, Math.min(100, nowPctRaw));
  const showNowMarker = nowMin >= windowStart && nowMin <= windowEnd;

  const sortedDoctors = sortDoctorsByPriorityAndRoom(dbState.doctors, selectedRoomName, nowMin);

  container.innerHTML = sortedDoctors
    .map((doc) => {
      const activeUsage = getActiveUsage(doc);
      const allowedRightNow = isDoctorAllowedAtMinute(doc, nowMin);
      const shiftInfo = getDoctorShiftInfoAtMinute(doc, nowMin);
      const isRoomMatch = doc.assignedRoom === selectedRoomName;

      // Find most recent finished usage
      const finishedUsages = (doc.usages || []).filter((u) => u.endMin !== null && !isUsageActiveAt(u, nowMin));
      finishedUsages.sort((a, b) => (b.endMin || 0) - (a.endMin || 0));
      const recentUsage = finishedUsages[0];

      let staffInfoHtml = '';
      if (activeUsage) {
        const staffName = activeUsage.receivedBy || 'chưa ghi danh';
        const staffRole = activeUsage.receivedRole || 'ĐD';
        staffInfoHtml = `
          <div class="doc-staff-info active" title="Nhân sự đang sử dụng">
            <i class="fa-solid fa-user-check"></i>
            <span><b>${staffRole} ${staffName}</b> nhận vào <b>${activeUsage.roomName}</b> lúc <b>${formatHHMM(activeUsage.startMin)}</b></span>
          </div>
        `;
      } else if (recentUsage) {
        const recStaff = recentUsage.receivedBy ? `${recentUsage.receivedRole || 'ĐD'} ${recentUsage.receivedBy}` : 'ĐD';
        const relStaff = recentUsage.releasedBy ? `${recentUsage.releasedRole || 'ĐD'} ${recentUsage.releasedBy}` : recStaff;
        staffInfoHtml = `
          <div class="doc-staff-info finished" title="Lần sử dụng gần nhất">
            <i class="fa-solid fa-clock-rotate-left"></i>
            <span>${recStaff} nhận ${formatHHMM(recentUsage.startMin)} · Trả lúc <b>${formatHHMM(recentUsage.endMin)}</b></span>
          </div>
        `;
      }

      let statusBadgeHtml = '';
      let statusSubHtml = '';
      let actionBtnHtml = '';

      if (activeUsage) {
        const isGoingSurgery = activeUsage.roomName === 'Đang mổ';
        const isSameRoomOwner = selectedRoomName === activeUsage.roomName;
        const endStr = activeUsage.endMin !== null ? ` → ${formatHHMM(activeUsage.endMin)}` : '';

        statusBadgeHtml = `<span class="status-badge unavailable">● ${isGoingSurgery ? 'Đang mổ' : activeUsage.roomName}</span>`;
        statusSubHtml = `<span class="status-subtext time-concise">${formatHHMM(activeUsage.startMin)}${endStr}</span>`;

        if (isGoingSurgery) {
          actionBtnHtml = `
            <div style="display:flex;gap:4px;align-items:center;justify-content:flex-end;flex-wrap:wrap;">
              <button type="button" class="btn-action-release" data-action="release-user" data-doc-id="${doc.id}" title="Đánh dấu ca mổ đã hoàn thành">
                Mổ xong ✕
              </button>
              <button
                type="button"
                class="btn-action-edit-surg"
                data-action="open-edit-surgery-time"
                data-doc-id="${doc.id}"
                data-usage-id="${activeUsage.id}"
                title="Chỉnh sửa giờ bắt đầu / giờ kết thúc ca mổ"
                style="background: #ffffff; border: 1.5px solid #0284c7; color: #0284c7; padding: 5px 9px; border-radius: 6px; font-size: 0.78rem; font-weight: 700; cursor: pointer; display: inline-flex; align-items: center; gap: 4px;"
              >
                ✏️ Sửa giờ
              </button>
            </div>
          `;
        } else if (isSameRoomOwner) {
          actionBtnHtml = `
            <div style="display:flex;gap:4px;align-items:center;justify-content:flex-end;flex-wrap:wrap;">
              <button type="button" class="btn-action-release" data-action="release-user" data-doc-id="${doc.id}">
                Trả user ✕
              </button>
              <button
                type="button"
                class="btn-action-edit-surg"
                data-action="open-edit-surgery-time"
                data-doc-id="${doc.id}"
                data-usage-id="${activeUsage.id}"
                title="Chỉnh sửa giờ nhận / giờ trả User"
                style="background: #ffffff; border: 1.5px solid #0284c7; color: #0284c7; padding: 5px 9px; border-radius: 6px; font-size: 0.78rem; font-weight: 700; cursor: pointer; display: inline-flex; align-items: center; gap: 4px;"
              >
                ✏️ Sửa giờ
              </button>
            </div>
          `;
        } else {
          actionBtnHtml = `
            <div style="display:flex;gap:4px;align-items:center;justify-content:flex-end;flex-wrap:wrap;">
              <button
                type="button"
                class="btn-action-disabled"
                disabled
                title="Chỉ phòng [${activeUsage.roomName}] mới được trả User này"
              >
                Đang ở ${activeUsage.roomName}
              </button>
              <button
                type="button"
                class="btn-action-edit-surg"
                data-action="open-edit-surgery-time"
                data-doc-id="${doc.id}"
                data-usage-id="${activeUsage.id}"
                title="Chỉnh sửa giờ nhận / giờ trả User"
                style="background: #ffffff; border: 1.5px solid #0284c7; color: #0284c7; padding: 5px 9px; border-radius: 6px; font-size: 0.78rem; font-weight: 700; cursor: pointer; display: inline-flex; align-items: center; gap: 4px;"
              >
                ✏️ Sửa
              </button>
            </div>
          `;
        }
      } else if (selectedRoomName === 'Đang mổ') {
        const isOffDuty = !allowedRightNow;
        statusBadgeHtml = `<span class="status-badge available" style="background: #e0f2fe; color: #0369a1; border-color: #7dd3fc;">● Sẵn sàng mổ</span>`;
        statusSubHtml = `<span class="status-subtext time-concise">${isOffDuty ? 'Giờ nghỉ (Không xuất toán)' : 'Phòng mổ'}</span>`;
        actionBtnHtml = `
          <button
            type="button"
            class="btn-action-receive"
            data-action="open-surgery-for-doc"
            data-doc-id="${doc.id}"
            title="Báo mổ cho BS ${doc.shortName || doc.name} (BHYT không xuất toán khi mổ)"
            style="background: linear-gradient(135deg, #0284c7, #2563eb); border-color: #0284c7; color: #ffffff;"
          >
            🩺 Báo mổ &rarr;
          </button>
        `;
      } else if (allowedRightNow) {
        statusBadgeHtml = `<span class="status-badge available">● Có thể dùng</span>`;
        const todayDateKey = getDateKey(new Date(nowMin * 60000));
        const prevDateKey = addDaysToKey(todayDateKey, -1);
        const dt = new Date(nowMin * 60000 + VN_OFFSET_MS);
        const minsOfDay = dt.getUTCHours() * 60 + dt.getUTCMinutes();
        const todayShift = (doc.scheduleByDate && doc.scheduleByDate[todayDateKey]) || '';
        const prevShift = (doc.scheduleByDate && doc.scheduleByDate[prevDateKey]) || '';

        let timeRange = '07:00 – 11:30';
        if (minsOfDay >= 420 && todayShift === 'TRUC') {
          timeRange = '07:00 – 07:00 hôm sau';
        } else if (minsOfDay < 420 && prevShift === 'TRUC') {
          timeRange = '07:00 hôm qua – 07:00 hôm nay';
        } else {
          const intervals = getAllowedIntervalsForDate(doc, todayDateKey);
          const activeIv = intervals.find(([s, e]) => nowMin >= s && nowMin < e);
          if (activeIv) {
            if (activeIv[1] % 1440 === 0 && todayShift === 'TRUC') {
              timeRange = `${formatHHMM(activeIv[0])} – 07:00 hôm sau`;
            } else {
              timeRange = `${formatHHMM(activeIv[0])} – ${formatHHMM(activeIv[1])}`;
            }
          }
        }
        statusSubHtml = `<span class="status-subtext time-concise">${timeRange}</span>`;
        actionBtnHtml = `
          <button
            type="button"
            class="btn-action-receive"
            data-action="open-receive-box"
            data-doc-id="${doc.id}"
            title="Nhận sử dụng cho [${selectedRoomName}]"
          >
            Nhận sử dụng &rarr;
          </button>
        `;
      } else {
        statusBadgeHtml = `<span class="status-badge unavailable">● Không dùng</span>`;
        const dt = new Date(nowMin * 60000 + VN_OFFSET_MS);
        const minsOfDay = dt.getUTCHours() * 60 + dt.getUTCMinutes();
        let unavailTime = 'Ngoài giờ';
        if (minsOfDay >= 11 * 60 + 30 && minsOfDay < 13 * 60 + 30) {
          unavailTime = '11:30 – 13:30';
        } else if (minsOfDay >= 17 * 60) {
          unavailTime = 'Sau 17:00';
        } else if (minsOfDay < 7 * 60) {
          unavailTime = 'Trước 07:00';
        }
        statusSubHtml = `<span class="status-subtext time-unavailable">${unavailTime}</span>`;
        actionBtnHtml = `<button type="button" class="btn-action-disabled" disabled>Không khả dụng</button>`;
      }

      const pastEndMin = Math.min(nowMin, windowEnd);
      const pastWidthPct = Math.max(0, ((pastEndMin - windowStart) / duration) * 100);

      const allowedIntervals = getAllowedIntervalsInWindow(doc, windowStart, pastEndMin);
      const greenSegmentsHtml = allowedIntervals
        .map(([ivStart, ivEnd]) => {
          const segStart = Math.max(windowStart, ivStart);
          const segEnd = Math.min(pastEndMin, ivEnd);
          if (segEnd <= segStart) return '';
          const leftPct = ((segStart - windowStart) / duration) * 100;
          const widthPct = ((segEnd - segStart) / duration) * 100;
          return `<div class="track-available-fill" style="left: ${leftPct}%; width: ${widthPct}%; z-index: 2;"></div>`;
        })
        .join('');

      const visibleUsages = (doc.usages || []).filter((u) => {
        const effectiveEnd = u.endMin !== null ? u.endMin : nowMin;
        return effectiveEnd > windowStart && u.startMin < windowEnd;
      });

      const usageBlocksHtml = visibleUsages
        .map((u) => {
          const effectiveEnd =
            u.endMin !== null ? Math.max(u.startMin + 2, u.endMin) : Math.max(u.startMin + 2, nowMin);
          const clampedStart = Math.max(windowStart, u.startMin);
          const clampedEnd = Math.min(windowEnd, effectiveEnd);

          const leftPct = ((clampedStart - windowStart) / duration) * 100;
          const widthPct = Math.max(2.5, ((clampedEnd - clampedStart) / duration) * 100);
          const timeLabel = `${formatHHMM(u.startMin)} &rarr; ${
            u.endMin !== null ? formatHHMM(u.endMin) : 'Nay'
          }`;

          const isSurg = u.roomName === 'Đang mổ';
          return `
            <div
              class="usage-block ${isSurg ? 'usage-block-surgery' : ''}"
              style="left: ${leftPct}%; width: ${widthPct}%; z-index: 4; cursor: pointer;"
              data-action="open-edit-surgery-time"
              data-doc-id="${doc.id}"
              data-usage-id="${u.id}"
              title="${u.roomName}: ${formatHHMM(u.startMin)} -> ${
            u.endMin !== null ? formatHHMM(u.endMin) : 'Đang sử dụng'
          } (Bấm để chỉnh sửa giờ)"
            >
              <strong>${u.roomName}</strong>
              <span>${timeLabel} ✏️</span>
            </div>
          `;
        })
        .join('');

      const captionsHtml = visibleUsages
        .map((u) => {
          const endStr = u.endMin !== null ? formatHHMM(u.endMin) : 'Đang dùng';
          const isSurg = u.roomName === 'Đang mổ';
          const editBtn = ` <button type="button" class="btn-mini-edit-surg" data-action="open-edit-surgery-time" data-doc-id="${doc.id}" data-usage-id="${u.id}" style="background:none;border:none;color:#0284c7;cursor:pointer;font-weight:700;padding:0 3px;" title="Chỉnh sửa giờ">✏️</button>`;
          return `<span class="usage-caption-item ${isSurg ? 'caption-surgery' : ''}">${u.roomName} · <b>${formatHHMM(
            u.startMin
          )} &rarr; ${endStr}</b>${editBtn}</span>`;
        })
        .join('');

      const gridCellsHtml = Array.from({ length: 12 })
        .map(() => `<div class="track-grid-cell"></div>`)
        .join('');

      return `
        <div class="timeline-row">
          <!-- Col 1: Doctor / User -->
          <div class="doc-info-cell">
            <div class="doc-name-line">
              <span class="doc-fullname">${doc.name}</span>
              <span class="${shiftInfo.badgeCls}">${shiftInfo.badgeText}</span>
            </div>
            <div class="doc-handle-line">
              <span class="doc-handle">${doc.handle}</span>
              <span class="doc-room-sep">·</span>
              <span class="doc-assigned-room ${isRoomMatch ? 'match-selected' : ''}">${doc.assignedRoom}</span>
            </div>
            ${staffInfoHtml}
          </div>

          <!-- Col 2: Current Status -->
          <div class="status-cell">
            ${statusBadgeHtml}
            ${statusSubHtml}
          </div>

          <!-- Col 3: Action -->
          <div class="action-cell">
            ${actionBtnHtml}
          </div>

          <!-- Col 4: Timeline Bar -->
          <div class="timeline-track-wrapper">
            <div class="timeline-track">
              <div class="track-offduty-fill" style="width: ${pastWidthPct}%; z-index: 1;"></div>
              ${greenSegmentsHtml}
              <div class="track-grid-lines" style="z-index: 3;">${gridCellsHtml}</div>
              ${usageBlocksHtml}
              ${
                showNowMarker
                  ? `<div class="current-time-marker" style="left: ${nowPctClamped}%;"></div>`
                  : ''
              }
            </div>
            <div class="usage-caption-list">
              ${captionsHtml}
            </div>
          </div>
        </div>
      `;
    })
    .join('');
}

function renderAll() {
  renderHeaderClock();
  renderSurgeryRoomAlerts();
  renderGlobal60mWarnings();
  renderWorkingStaffBanner();
  renderRoomsGrid();
  renderTimelineRows();
}

async function postApi(endpoint, payload) {
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!data.ok && data.error) {
      showToast(`⚠️ ${data.error}`);
    } else if (data.db) {
      dbState = data.db;
      renderAll();
      if (payload && payload.roomName === 'Đang mổ') {
        showToast('🩺 Đã báo mổ thành công!');
      } else if (endpoint === '/api/release') {
        showToast('🔓 Đã hoàn thành và trả tài khoản!');
      } else if (endpoint === '/api/receive') {
        showToast('✅ Đã nhận sử dụng thành công!');
      }
    }
    return data;
  } catch (err) {
    console.error('API Error:', err);
    showToast('❌ Lỗi kết nối máy chủ');
  }
}

// Box 1: Open Receive Time Box
function openReceiveTimeDialog(docId) {
  const doc = dbState.doctors.find((d) => d.id === docId);
  if (!doc) return;

  const nowMin = getNowEpochMinutes();
  document.getElementById('receive-target-doc-id').value = doc.id;
  document.getElementById('receive-dialog-title').textContent = `Nhận sử dụng: ${doc.name}`;
  document.getElementById('receive-dialog-summary').innerHTML = `
    Phòng nhận: <strong>${selectedRoomName}</strong> • Tài khoản: <b>${doc.handle}</b>
  `;

  const staff = getCurrentStaffAuth();
  const staffEl = document.getElementById('receive-dialog-staff');
  if (staffEl) {
    if (staff.staffName) {
      staffEl.innerHTML = `<i class="fa-solid fa-user-check"></i> Nhân sự thao tác: <b>${staff.staffRole} ${staff.staffName}</b>`;
    } else {
      staffEl.innerHTML = `<i class="fa-solid fa-user-clock"></i> Nhân sự thao tác: <i>Chưa đăng nhập (sẽ ghi nhận theo ca trực)</i>`;
    }
  }

  document.getElementById('receive-start-time').value = formatHHMM(nowMin);
  document.getElementById('receive-end-time').value = ''; // Mặc định không có thời gian kết thúc

  document.querySelectorAll('#receive-quick-duration-group .duration-chip').forEach((btn) => {
    btn.classList.remove('active');
  });

  document.getElementById('receive-time-dialog').showModal();
}

// Helper update overnight hint in quick surgery dialog
function updateSurgeryOvernightHint() {
  const startVal = normalize24hTimeStr(document.getElementById('surgery-start-time')?.value, false);
  const endVal = normalize24hTimeStr(document.getElementById('surgery-end-time')?.value, false);
  const hintEl = document.getElementById('surgery-overnight-hint');
  const hintStart = document.getElementById('surgery-hint-start');
  const hintEnd = document.getElementById('surgery-hint-end');

  if (!hintEl) return;
  if (startVal && endVal && endVal <= startVal) {
    if (hintStart) hintStart.textContent = startVal;
    if (hintEnd) hintEnd.textContent = endVal;
    hintEl.style.display = 'block';
  } else {
    hintEl.style.display = 'none';
  }
}

// Helper update overnight hint in edit usage dialog
function updateEditUsageOvernightHint() {
  const startVal = normalize24hTimeStr(document.getElementById('edit-surg-start-time')?.value, false);
  const endVal = normalize24hTimeStr(document.getElementById('edit-surg-end-time')?.value, false);
  const hintEl = document.getElementById('edit-surg-overnight-hint');
  const hintStart = document.getElementById('edit-surg-hint-start');
  const hintEnd = document.getElementById('edit-surg-hint-end');

  if (!hintEl) return;
  if (startVal && endVal && endVal <= startVal) {
    if (hintStart) hintStart.textContent = startVal;
    if (hintEnd) hintEnd.textContent = endVal;
    hintEl.style.display = 'block';
  } else {
    hintEl.style.display = 'none';
  }
}

// Box 2: Open Enlarged "+ Báo mổ" Dialog
function openQuickSurgeryDialog(preselectedDocId = null) {
  selectedSurgeryDocIds.clear();
  if (preselectedDocId) {
    selectedSurgeryDocIds.add(preselectedDocId);
  }
  const nowMin = getNowEpochMinutes();
  const now = new Date(nowMin * 60000);
  const todayKey = getDateKey(now);
  const yesterdayKey = addDaysToKey(todayKey, -1);

  const sortedDoctors = [...dbState.doctors].sort(
    (a, b) => (a.seniority || 999) - (b.seniority || 999)
  );

  const gridEl = document.getElementById('surgery-short-name-grid');
  gridEl.innerHTML = sortedDoctors
    .map((doc) => {
      const sName = doc.shortName || doc.name.split(' ').pop();
      const isActive = selectedSurgeryDocIds.has(doc.id);
      return `
        <button type="button" class="short-name-chip ${isActive ? 'active' : ''}" data-surg-doc-id="${doc.id}">
          ${sName}
        </button>
      `;
    })
    .join('');

  const dateInput = document.getElementById('surgery-date');
  if (dateInput) {
    dateInput.value = todayKey;
  }
  const btnToday = document.getElementById('btn-surg-date-today');
  const btnYesterday = document.getElementById('btn-surg-date-yesterday');
  if (btnToday && btnYesterday) {
    btnToday.style.background = '#e0f2fe';
    btnToday.style.color = '#0284c7';
    btnToday.style.borderColor = '#0284c7';
    btnYesterday.style.background = '#fff';
    btnYesterday.style.color = '#475569';
    btnYesterday.style.borderColor = '#cbd5e1';
  }

  document.getElementById('surgery-start-time').value = formatHHMM(nowMin);
  document.getElementById('surgery-end-time').value = '';
  updateSurgeryOvernightHint();

  document.getElementById('surgery-quick-dialog').showModal();
}

// Box 2B: Open Edit Usage / Surgery Time Dialog
function openEditSurgeryTimeDialog(docId, usageId = null) {
  const doc = dbState.doctors.find((d) => d.id === docId);
  if (!doc) return;

  const dialog = document.getElementById('edit-surgery-time-dialog');
  if (!dialog) return;

  let targetUsage = null;
  if (usageId) {
    targetUsage = (doc.usages || []).find((u) => u.id === usageId);
  }
  if (!targetUsage) {
    const act = getActiveUsage(doc);
    if (act) {
      targetUsage = act;
    } else {
      const allUsages = doc.usages || [];
      if (allUsages.length > 0) targetUsage = allUsages[allUsages.length - 1];
    }
  }

  if (!targetUsage) {
    showToast('⚠️ Không tìm thấy phiên sử dụng của bác sĩ!');
    return;
  }

  const docIdInput = document.getElementById('edit-surg-doc-id');
  const usageIdInput = document.getElementById('edit-surg-usage-id');
  if (docIdInput) docIdInput.value = doc.id;
  if (usageIdInput) usageIdInput.value = targetUsage.id || '';

  const roomSelect = document.getElementById('edit-surg-room-select');
  if (roomSelect) {
    roomSelect.value = targetUsage.roomName || 'Đang mổ';
  }

  const isSurg = targetUsage.roomName === 'Đang mổ';
  const modalTitle = document.getElementById('edit-usage-modal-title');
  if (modalTitle) {
    modalTitle.innerHTML = `<span>✏️</span> Chỉnh sửa giờ sử dụng User`;
  }

  const summaryEl = document.getElementById('edit-surg-doc-summary');
  if (summaryEl) {
    const staffText = targetUsage.receivedBy
      ? `${targetUsage.receivedRole || 'ĐD'} ${targetUsage.receivedBy}`
      : (isSurg ? 'Kíp phẫu thuật' : 'Chưa ghi danh');
    const statusText = targetUsage.endMin !== null
      ? `Đã kết thúc (${formatHHMM(targetUsage.endMin)})`
      : (isSurg ? 'Đang mổ' : 'Đang sử dụng');
    summaryEl.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;">
        <span style="font-size:1.4rem;">${isSurg ? '🩺' : '📋'}</span>
        <div>
          <div style="font-weight:800;color:#0369a1;font-size:0.95rem;">BS ${doc.name} (${doc.handle})</div>
          <div style="font-size:0.8rem;color:#64748b;">Phòng: <b>${targetUsage.roomName}</b> · Người nhận: <b>${staffText}</b> · Trạng thái: <b>${statusText}</b></div>
        </div>
      </div>
    `;
  }

  // Gắn ngày bắt đầu từ phiên sử dụng thực tế (thay vì luôn dùng ngày hôm nay)
  const usageDateStr = getDateKey(new Date(targetUsage.startMin * 60000));
  const editDateInput = document.getElementById('edit-surg-date');
  if (editDateInput) editDateInput.value = usageDateStr;

  const todayKey = getDateKey(new Date());
  const btnToday = document.getElementById('btn-edit-surg-today');
  const btnYesterday = document.getElementById('btn-edit-surg-yesterday');
  if (btnToday && btnYesterday) {
    const isToday = usageDateStr === todayKey;
    btnToday.style.background = isToday ? '#e0f2fe' : '#fff';
    btnToday.style.color = isToday ? '#0284c7' : '#475569';
    btnToday.style.borderColor = isToday ? '#0284c7' : '#cbd5e1';
    btnYesterday.style.background = !isToday ? '#e0f2fe' : '#fff';
    btnYesterday.style.color = !isToday ? '#0284c7' : '#475569';
    btnYesterday.style.borderColor = !isToday ? '#0284c7' : '#cbd5e1';
  }

  const startInput = document.getElementById('edit-surg-start-time');
  const endInput = document.getElementById('edit-surg-end-time');

  if (startInput) startInput.value = formatHHMM(targetUsage.startMin);
  if (endInput) endInput.value = targetUsage.endMin !== null ? formatHHMM(targetUsage.endMin) : '';
  updateEditUsageOvernightHint();

  dialog.showModal();
  if (startInput) {
    startInput.focus();
    startInput.select();
  }
}

// Box 3: Render Availability Lookup by Room & Specific Time
function renderAvailabilityLookupResults() {
  const roomName = document.getElementById('lookup-room-select')?.value || selectedRoomName;
  const dateStr = document.getElementById('lookup-date-input')?.value || getDateKey(new Date());
  const timeStr = document.getElementById('lookup-time-input')?.value || formatHHMM(getNowEpochMinutes());

  const targetEpochMin = dateAndTimeToEpochMin(dateStr, timeStr);
  const sortedDocs = sortDoctorsByPriorityAndRoom(dbState.doctors, roomName, targetEpochMin);

  const availableList = [];
  const unavailableList = [];

  for (const doc of sortedDocs) {
    const activeAtTarget = getActiveUsageAt(doc, targetEpochMin);
    const allowedAtTarget = isDoctorAllowedAtMinute(doc, targetEpochMin);
    const shiftInfo = getDoctorShiftInfoAtMinute(doc, targetEpochMin);
    const isSurgeryRoom = roomName === 'Đang mổ';
    const isAvail = isSurgeryRoom ? !activeAtTarget : (!activeAtTarget && allowedAtTarget);

    if (isAvail) {
      const reason = isSurgeryRoom && !allowedAtTarget
        ? `Sẵn sàng mổ (${shiftInfo.badgeText} - Không xuất toán BHYT)`
        : `${shiftInfo.badgeText} — ${shiftInfo.subText}`;
      availableList.push({
        doc,
        isSameRoom,
        reason
      });
    } else {
      let reason = shiftInfo.subText;
      if (activeAtTarget) {
        const endLabel = activeAtTarget.endMin !== null ? formatHHMM(activeAtTarget.endMin) : 'Chưa trả';
        reason =
          activeAtTarget.roomName === 'Đang mổ'
            ? `Đang đi mổ (${formatHHMM(activeAtTarget.startMin)} → ${endLabel})`
            : `Đang dùng tại ${activeAtTarget.roomName} (${formatHHMM(activeAtTarget.startMin)} → ${endLabel})`;
      }
      unavailableList.push({
        doc,
        isSameRoom,
        reason
      });
    }
  }

  const container = document.getElementById('availability-lookup-results');
  if (!container) return;

  container.innerHTML = `
    <div class="lookup-group-title" style="color: #15803d;">
      🟢 Có thể sử dụng cho [${roomName}] lúc ${timeStr} (${availableList.length} bác sĩ):
    </div>
    ${
      availableList.length === 0
        ? `<div style="font-size: 0.82rem; color: #64748b; margin-bottom: 0.8rem;">Không có bác sĩ nào khả dụng vào thời điểm này.</div>`
        : availableList
            .map(
              (item) => `
          <div class="lookup-doc-item avail-item">
            <div>
              <strong>${item.doc.name}</strong> <span style="color:#475569;">(${item.doc.handle})</span>
              <span class="doc-assigned-room ${item.isSameRoom ? 'match-selected' : ''}" style="margin-left:0.35rem;">
                ${item.doc.assignedRoom}
              </span>
            </div>
            <div style="font-size: 0.8rem; color: #15803d; font-weight: 600;">${item.reason}</div>
          </div>
        `
            )
            .join('')
    }

    <div class="lookup-group-title" style="color: #b91c1c; margin-top: 0.85rem;">
      🔴 Không sử dụng được lúc ${timeStr} (${unavailableList.length} bác sĩ):
    </div>
    ${unavailableList
      .map(
        (item) => `
        <div class="lookup-doc-item unavail-item">
          <div>
            <strong>${item.doc.name}</strong> <span style="color:#475569;">(${item.doc.handle})</span>
            <span style="font-size: 0.78rem; color: #64748b; margin-left:0.35rem;">· ${item.doc.assignedRoom}</span>
          </div>
          <div style="font-size: 0.8rem; color: #b91c1c; font-weight: 600;">${item.reason}</div>
        </div>
      `
      )
      .join('')}
  `;
}

// Box 4: Render Usage History Lookup
function renderHistoryLookupTable() {
  const roomFilter = document.getElementById('history-room-filter')?.value || 'ALL';
  const docFilter = document.getElementById('history-doc-filter')?.value || 'ALL';
  const dateFilter = document.getElementById('history-date-filter')?.value || '';

  const nowMin = getNowEpochMinutes();
  const allRecords = [];

  for (const doc of dbState.doctors) {
    if (docFilter !== 'ALL' && doc.id !== docFilter) continue;
    for (const u of doc.usages || []) {
      if (roomFilter !== 'ALL' && u.roomName !== roomFilter) continue;
      const usageDateKey = getDateKey(new Date(u.startMin * 60000));
      if (dateFilter && usageDateKey !== dateFilter) continue;

      const activeNow = isUsageActiveAt(u, nowMin);
      const effectiveEnd = u.endMin !== null ? u.endMin : nowMin;
      const durationMins = Math.max(1, effectiveEnd - u.startMin);

      allRecords.push({
        doc,
        usage: u,
        activeNow,
        durationMins,
        dateLabel: formatDateVN(u.startMin)
      });
    }
  }

  // Sort newest first
  allRecords.sort((a, b) => b.usage.startMin - a.usage.startMin);

  const tbody = document.getElementById('history-table-body');
  if (!tbody) return;

  if (allRecords.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; color:#64748b; padding: 1.2rem;">Chưa có dữ liệu lịch sử phù hợp bộ lọc.</td></tr>`;
    return;
  }

  tbody.innerHTML = allRecords
    .map((rec) => {
      const endLabel = rec.usage.endMin !== null ? formatHHMM(rec.usage.endMin) : 'Đang sử dụng';
      const statusPill = rec.activeNow
        ? `<span class="status-badge unavailable" style="font-size:0.72rem; padding:0.15rem 0.5rem;">Đang hoạt động</span>`
        : `<span class="status-badge available" style="font-size:0.72rem; padding:0.15rem 0.5rem;">Đã kết thúc</span>`;

      let staffInfo = rec.usage.receivedBy
        ? `<b>${rec.usage.receivedRole || 'ĐD'} ${rec.usage.receivedBy}</b>`
        : '<span style="color:#94a3b8;">—</span>';
      if (rec.usage.releasedBy) {
        staffInfo += `<br><span style="font-size:0.74rem; color:#64748b;">Trả: ${rec.usage.releasedRole || 'ĐD'} ${rec.usage.releasedBy}</span>`;
      }

      return `
        <tr>
          <td><strong>${rec.doc.name}</strong> <span style="color:#64748b;">(${rec.doc.handle})</span></td>
          <td><b>${rec.usage.roomName}</b></td>
          <td>${staffInfo}</td>
          <td>${rec.dateLabel} <b>${formatHHMM(rec.usage.startMin)}</b></td>
          <td><b>${endLabel}</b></td>
          <td>${rec.durationMins} phút</td>
          <td>${statusPill}</td>
          <td style="text-align: center;">
            <button
              type="button"
              class="btn-secondary"
              data-action="open-edit-surgery-time"
              data-doc-id="${rec.doc.id}"
              data-usage-id="${rec.usage.id}"
              style="font-size: 0.76rem; padding: 3px 8px; border-color: #0284c7; color: #0284c7; font-weight: 700; cursor: pointer; border-radius: 4px;"
              title="Chỉnh sửa giờ của phiên sử dụng này"
            >
              ✏️ Sửa
            </button>
          </td>
        </tr>
      `;
    })
    .join('');
}

function connectRealtimeServer() {
  fetch('/api/state')
    .then((r) => r.json())
    .then((data) => {
      if (data && data.db) {
        dbState = data.db;
        renderAll();
      }
    })
    .catch((err) => console.warn('Initial fetch error:', err));

  const evtSource = new EventSource('/api/stream');
  evtSource.onmessage = (event) => {
    try {
      const payload = JSON.parse(event.data);
      if (payload.db) {
        dbState = payload.db;
        renderAll();
      }
      if (payload.eventNote) {
        showToast(payload.eventNote);
      }
    } catch (e) {
      console.warn('SSE parse error:', e);
    }
  };
}

function setupTimelineDragToPan() {
  const dragArea = document.getElementById('timeline-drag-area');
  if (!dragArea) return;

  let isDragging = false;
  let startX = 0;
  let startOffset = 0;

  dragArea.addEventListener('mousedown', (e) => {
    if (e.target.closest('button, select, input')) return;
    isDragging = true;
    startX = e.clientX;
    startOffset = windowOffsetMinutes;
    dragArea.classList.add('is-dragging');
  });

  window.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const deltaX = e.clientX - startX;
    const deltaMinutes = -Math.round(deltaX / 3.5);
    windowOffsetMinutes = startOffset + deltaMinutes;
    renderAll();
  });

  window.addEventListener('mouseup', () => {
    if (isDragging) {
      isDragging = false;
      dragArea.classList.remove('is-dragging');
    }
  });
}

document.addEventListener('DOMContentLoaded', () => {
  const todayStr = getDateKey(new Date());
  const dateInput = document.getElementById('view-date-picker');
  if (dateInput) {
    dateInput.value = todayStr;
    dateInput.addEventListener('change', () => {
      const picked = dateInput.value;
      if (!picked) return;
      if (picked === todayStr) {
        windowOffsetMinutes = 0;
      } else {
        const targetMin = dateAndTimeToEpochMin(picked, '07:00');
        const nowMin = getNowEpochMinutes();
        windowOffsetMinutes = targetMin - (nowMin - 15);
      }
      renderAll();
    });
  }

  connectRealtimeServer();
  setupTimelineDragToPan();

  setInterval(() => {
    renderAll();
  }, 1000);

  // Timeline navigation
  document.getElementById('btn-shift-left')?.addEventListener('click', () => {
    windowOffsetMinutes -= 30;
    renderAll();
  });

  document.getElementById('btn-shift-right')?.addEventListener('click', () => {
    windowOffsetMinutes += 30;
    renderAll();
  });

  document.getElementById('btn-jump-now')?.addEventListener('click', () => {
    windowOffsetMinutes = 0;
    if (dateInput) dateInput.value = getDateKey(new Date());
    renderAll();
    showToast('🔴 LIVE: Đã đưa dòng thời gian về thời điểm hiện tại');
  });

  // Header "+ BÁO MỔ" button
  document.getElementById('btn-header-bao-mo')?.addEventListener('click', () => {
    openQuickSurgeryDialog();
  });

  // Top 5 Rooms + Đang mổ Click
  document.getElementById('rooms-grid-container')?.addEventListener('click', (e) => {
    const card = e.target.closest('[data-room-name]');
    if (!card) return;
    selectedRoomName = card.getAttribute('data-room-name');
    renderAll();
  });

  // Timeline Row Actions & Surgery Time Editing
  document.getElementById('timeline-rows-container')?.addEventListener('click', (e) => {
    // 1. Click on surgery edit triggers (button, caption, or usage block)
    const editTarget = e.target.closest('[data-action="open-edit-surgery-time"]');
    if (editTarget) {
      e.stopPropagation();
      const docId = editTarget.getAttribute('data-doc-id');
      const usageId = editTarget.getAttribute('data-usage-id');
      openEditSurgeryTimeDialog(docId, usageId);
      return;
    }

    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const action = btn.getAttribute('data-action');
    const docId = btn.getAttribute('data-doc-id');

    if (action === 'open-receive-box') {
      openReceiveTimeDialog(docId);
    } else if (action === 'open-surgery-for-doc') {
      openQuickSurgeryDialog(docId);
    } else if (action === 'release-user') {
      const { staffName, staffRole } = getCurrentStaffAuth();
      postApi('/api/release', { docId, requestRoomName: selectedRoomName, staffName, staffRole });
    }
  });

  // Global acknowledge surgery alert button click
  document.addEventListener('click', (e) => {
    const ackBtn = e.target.closest('[data-ack-alert-id]');
    if (ackBtn) {
      const alertId = ackBtn.getAttribute('data-ack-alert-id');
      postApi('/api/acknowledge-surgery-alert', { alertId });
    }
  });

  // Quick Duration Buttons (5 - 10 - 20 - 30 - 60 phút) in Receive Box
  document.getElementById('receive-quick-duration-group')?.addEventListener('click', (e) => {
    const chip = e.target.closest('button[data-duration-mins]');
    if (!chip) return;

    const endInput = document.getElementById('receive-end-time');
    const wasActive = chip.classList.contains('active');

    document.querySelectorAll('#receive-quick-duration-group .duration-chip').forEach((b) => {
      b.classList.remove('active');
    });

    if (wasActive) {
      endInput.value = '';
      return;
    }

    chip.classList.add('active');
    const mins = Number(chip.getAttribute('data-duration-mins'));
    const nowMin = getNowEpochMinutes();
    const startStr = document.getElementById('receive-start-time').value;
    const startEpoch = timeStringToEpochMin(startStr, nowMin) ?? nowMin;
    endInput.value = formatHHMM(startEpoch + mins);
  });

  // Box 1: Receive User Submit
  const receiveDialog = document.getElementById('receive-time-dialog');
  document.getElementById('btn-close-receive-dialog')?.addEventListener('click', () => receiveDialog.close());
  document.getElementById('btn-cancel-receive-dialog')?.addEventListener('click', () => receiveDialog.close());

  document.getElementById('receive-time-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const docId = document.getElementById('receive-target-doc-id').value;
    const nowMin = getNowEpochMinutes();
    const startStr = document.getElementById('receive-start-time').value;
    const endStr = document.getElementById('receive-end-time').value;

    const startMin = timeStringToEpochMin(startStr, nowMin) ?? nowMin;
    let endMin = timeStringToEpochMin(endStr, nowMin);
    if (endMin !== null && endMin <= startMin) {
      endMin += 1440;
    }

    const { staffName, staffRole } = getCurrentStaffAuth();
    windowOffsetMinutes = 0;
    postApi('/api/receive', {
      docId,
      roomName: selectedRoomName,
      startMin,
      endMin,
      staffName,
      staffRole
    });
    receiveDialog.close();
  });

  // Box 2: Quick "+ Báo mổ" Dialog
  const surgeryDialog = document.getElementById('surgery-quick-dialog');
  document.getElementById('btn-close-surgery-dialog')?.addEventListener('click', () => surgeryDialog.close());
  document.getElementById('btn-cancel-surgery-dialog')?.addEventListener('click', () => surgeryDialog.close());

  document.getElementById('surgery-short-name-grid')?.addEventListener('click', (e) => {
    const chip = e.target.closest('button[data-surg-doc-id]');
    if (!chip) return;
    const id = chip.getAttribute('data-surg-doc-id');
    if (selectedSurgeryDocIds.has(id)) {
      selectedSurgeryDocIds.delete(id);
      chip.classList.remove('active');
    } else {
      selectedSurgeryDocIds.add(id);
      chip.classList.add('active');
    }
  });

  // Wire quick date toggle buttons for Báo mổ nhanh
  document.getElementById('btn-surg-date-today')?.addEventListener('click', () => {
    const todayKey = getDateKey(new Date());
    const dateInput = document.getElementById('surgery-date');
    if (dateInput) dateInput.value = todayKey;
    const btnT = document.getElementById('btn-surg-date-today');
    const btnY = document.getElementById('btn-surg-date-yesterday');
    if (btnT && btnY) {
      btnT.style.background = '#e0f2fe';
      btnT.style.color = '#0284c7';
      btnT.style.borderColor = '#0284c7';
      btnY.style.background = '#fff';
      btnY.style.color = '#475569';
      btnY.style.borderColor = '#cbd5e1';
    }
  });

  document.getElementById('btn-surg-date-yesterday')?.addEventListener('click', () => {
    const yesterdayKey = addDaysToKey(getDateKey(new Date()), -1);
    const dateInput = document.getElementById('surgery-date');
    if (dateInput) dateInput.value = yesterdayKey;
    const btnT = document.getElementById('btn-surg-date-today');
    const btnY = document.getElementById('btn-surg-date-yesterday');
    if (btnT && btnY) {
      btnY.style.background = '#e0f2fe';
      btnY.style.color = '#0284c7';
      btnY.style.borderColor = '#0284c7';
      btnT.style.background = '#fff';
      btnT.style.color = '#475569';
      btnT.style.borderColor = '#cbd5e1';
    }
  });

  // Wire quick date toggle buttons for Sửa giờ
  document.getElementById('btn-edit-surg-today')?.addEventListener('click', () => {
    const todayKey = getDateKey(new Date());
    const dateInput = document.getElementById('edit-surg-date');
    if (dateInput) dateInput.value = todayKey;
    const btnT = document.getElementById('btn-edit-surg-today');
    const btnY = document.getElementById('btn-edit-surg-yesterday');
    if (btnT && btnY) {
      btnT.style.background = '#e0f2fe';
      btnT.style.color = '#0284c7';
      btnT.style.borderColor = '#0284c7';
      btnY.style.background = '#fff';
      btnY.style.color = '#475569';
      btnY.style.borderColor = '#cbd5e1';
    }
  });

  document.getElementById('btn-edit-surg-yesterday')?.addEventListener('click', () => {
    const yesterdayKey = addDaysToKey(getDateKey(new Date()), -1);
    const dateInput = document.getElementById('edit-surg-date');
    if (dateInput) dateInput.value = yesterdayKey;
    const btnT = document.getElementById('btn-edit-surg-today');
    const btnY = document.getElementById('btn-edit-surg-yesterday');
    if (btnT && btnY) {
      btnY.style.background = '#e0f2fe';
      btnY.style.color = '#0284c7';
      btnY.style.borderColor = '#0284c7';
      btnT.style.background = '#fff';
      btnT.style.color = '#475569';
      btnT.style.borderColor = '#cbd5e1';
    }
  });

  document.getElementById('surgery-start-time')?.addEventListener('input', updateSurgeryOvernightHint);
  document.getElementById('surgery-end-time')?.addEventListener('input', updateSurgeryOvernightHint);
  document.getElementById('edit-surg-start-time')?.addEventListener('input', updateEditUsageOvernightHint);
  document.getElementById('edit-surg-end-time')?.addEventListener('input', updateEditUsageOvernightHint);

  document.getElementById('surgery-quick-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    if (selectedSurgeryDocIds.size === 0) {
      showToast('⚠️ Vui lòng bấm chọn ít nhất 1 bác sĩ đi mổ!');
      return;
    }

    const nowMin = getNowEpochMinutes();
    const todayKey = getDateKey(new Date(nowMin * 60000));
    let surgDateKey = document.getElementById('surgery-date')?.value || todayKey;
    const startStr = document.getElementById('surgery-start-time').value.trim();
    const endStr = document.getElementById('surgery-end-time').value.trim();

    let startMin = dateAndTimeToEpochMin(surgDateKey, startStr);
    let endMin = endStr ? dateAndTimeToEpochMin(surgDateKey, endStr) : null;
    if (endMin !== null && endMin <= startMin) {
      endMin += 1440; // Ca mổ qua đêm sang ngày tiếp theo
    }

    // Smart auto-anchor: Nếu nhập vào buổi sáng sớm (trước 08h), để ngày hôm nay
    // nhưng giờ bắt đầu là ban đêm (>= 18h) và giờ kết thúc <= hiện tại + 60p:
    // Chắc chắn là ca mổ của đêm hôm qua!
    const dtNow = new Date(nowMin * 60000 + VN_OFFSET_MS);
    const curHour = dtNow.getUTCHours();
    if (curHour < 8 && surgDateKey === todayKey && startMin > nowMin) {
      startMin -= 1440;
      if (endMin !== null) endMin -= 1440;
    }

    const { staffName, staffRole } = getCurrentStaffAuth();
    windowOffsetMinutes = 0;
    postApi('/api/receive', {
      docIds: Array.from(selectedSurgeryDocIds),
      roomName: 'Đang mổ',
      startMin,
      endMin,
      staffName,
      staffRole
    });
    surgeryDialog.close();
  });

  // Box 2B: Edit Surgery Time Dialog Handlers
  const editSurgeryDialog = document.getElementById('edit-surgery-time-dialog');
  document.getElementById('btn-close-edit-surgery-dialog')?.addEventListener('click', () => editSurgeryDialog?.close());
  document.getElementById('btn-cancel-edit-surgery-dialog')?.addEventListener('click', () => editSurgeryDialog?.close());

  document.getElementById('btn-set-surg-end-now')?.addEventListener('click', () => {
    const endInput = document.getElementById('edit-surg-end-time');
    if (endInput) {
      endInput.value = formatHHMM(getNowEpochMinutes());
      updateEditUsageOvernightHint();
    }
  });

  document.getElementById('btn-clear-surg-end')?.addEventListener('click', () => {
    const endInput = document.getElementById('edit-surg-end-time');
    if (endInput) {
      endInput.value = '';
      updateEditUsageOvernightHint();
    }
  });

  document.getElementById('edit-surgery-time-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const docId = document.getElementById('edit-surg-doc-id').value;
    const usageId = document.getElementById('edit-surg-usage-id').value;
    const roomName = document.getElementById('edit-surg-room-select')?.value;
    const editDateKey = document.getElementById('edit-surg-date')?.value || getDateKey(new Date());
    const startStr = document.getElementById('edit-surg-start-time').value.trim();
    const endStr = document.getElementById('edit-surg-end-time').value.trim();

    if (!startStr) {
      showToast('⚠️ Vui lòng nhập giờ bắt đầu!');
      return;
    }

    const startMin = dateAndTimeToEpochMin(editDateKey, startStr);
    let endMin = endStr ? dateAndTimeToEpochMin(editDateKey, endStr) : null;
    if (endMin !== null && endMin <= startMin) {
      endMin += 1440; // qua đêm
    }

    const { staffName, staffRole } = getCurrentStaffAuth();
    postApi('/api/update-usage-time', {
      docId,
      usageId,
      roomName,
      startMin,
      endMin,
      startStr,
      endStr,
      staffName,
      staffRole
    });

    editSurgeryDialog?.close();
  });

  // Click on Sửa button in history table
  document.getElementById('history-table-body')?.addEventListener('click', (e) => {
    const editBtn = e.target.closest('[data-action="open-edit-surgery-time"]');
    if (editBtn) {
      const docId = editBtn.getAttribute('data-doc-id');
      const usageId = editBtn.getAttribute('data-usage-id');
      openEditSurgeryTimeDialog(docId, usageId);
    }
  });

  // Box 3: Availability Lookup Dialog
  const availDialog = document.getElementById('availability-lookup-dialog');
  document.getElementById('btn-open-availability-lookup')?.addEventListener('click', () => {
    const roomSel = document.getElementById('lookup-room-select');
    if (roomSel) {
      roomSel.innerHTML = DEPT_ROOMS.map(
        (r) => `<option value="${r.name}" ${r.name === selectedRoomName ? 'selected' : ''}>${r.name}</option>`
      ).join('');
    }
    document.getElementById('lookup-date-input').value = getDateKey(new Date());
    document.getElementById('lookup-time-input').value = formatHHMM(getNowEpochMinutes());
    renderAvailabilityLookupResults();
    availDialog.showModal();
  });
  document.getElementById('btn-close-availability-dialog')?.addEventListener('click', () => availDialog.close());
  document.getElementById('btn-done-availability-dialog')?.addEventListener('click', () => availDialog.close());

  ['lookup-room-select', 'lookup-date-input', 'lookup-time-input'].forEach((id) => {
    document.getElementById(id)?.addEventListener('change', renderAvailabilityLookupResults);
    document.getElementById(id)?.addEventListener('input', renderAvailabilityLookupResults);
  });

  // Box 4: History Lookup Dialog
  const historyDialog = document.getElementById('history-lookup-dialog');
  document.getElementById('btn-open-history-lookup')?.addEventListener('click', () => {
    const roomSel = document.getElementById('history-room-filter');
    if (roomSel) {
      roomSel.innerHTML =
        `<option value="ALL">Tất cả các phòng &amp; Đang mổ</option>` +
        ROOMS.map((r) => `<option value="${r.name}">${r.name}</option>`).join('');
    }
    const docSel = document.getElementById('history-doc-filter');
    if (docSel) {
      const sortedDocs = [...dbState.doctors].sort((a, b) => (a.seniority || 999) - (b.seniority || 999));
      docSel.innerHTML =
        `<option value="ALL">Tất cả 14 bác sĩ</option>` +
        sortedDocs.map((d) => `<option value="${d.id}">${d.name} (${d.handle})</option>`).join('');
    }
    document.getElementById('history-date-filter').value = getDateKey(new Date());
    renderHistoryLookupTable();
    historyDialog.showModal();
  });
  document.getElementById('btn-close-history-dialog')?.addEventListener('click', () => historyDialog.close());
  document.getElementById('btn-done-history-dialog')?.addEventListener('click', () => historyDialog.close());

  ['history-room-filter', 'history-doc-filter', 'history-date-filter'].forEach((id) => {
    document.getElementById(id)?.addEventListener('change', renderHistoryLookupTable);
  });

  // Global 60m Warning Banner Actions
  document.getElementById('global-60m-warning-container')?.addEventListener('click', (e) => {
    const keepBtn = e.target.closest('button[data-confirm-keep-doc]');
    if (keepBtn) {
      postApi('/api/confirm-keep', { docId: keepBtn.getAttribute('data-confirm-keep-doc') });
      return;
    }
    const relBtn = e.target.closest('button[data-release-now-doc]');
    if (relBtn) {
      const { staffName, staffRole } = getCurrentStaffAuth();
      postApi('/api/release', { docId: relBtn.getAttribute('data-release-now-doc'), staffName, staffRole });
    }
  });

  // Bind 24-hour HH:mm auto-formatting to all .time-input-24h inputs
  document.querySelectorAll('.time-input-24h').forEach((inp) => {
    inp.addEventListener('input', () => {
      const digits = inp.value.replace(/\D/g, '').slice(0, 4);
      if (digits.length >= 3) {
        const hh = Math.min(23, Number(digits.slice(0, 2)));
        const mm = Math.min(59, Number(digits.slice(2, 4)));
        inp.value = `${String(hh).padStart(2, '0')}:${String(mm).padStart(digits.length - 2, '0')}`;
      } else {
        inp.value = digits;
      }
    });
    inp.addEventListener('blur', () => {
      if (inp.value.trim()) {
        inp.value = normalize24hTimeStr(inp.value, true);
      }
    });
  });

  // Box 5: User Guide Dialog
  const guideDialog = document.getElementById('user-guide-dialog');
  document.getElementById('btn-open-user-guide')?.addEventListener('click', () => {
    guideDialog?.showModal();
  });
  document.getElementById('btn-close-user-guide')?.addEventListener('click', () => guideDialog?.close());
  document.getElementById('btn-done-user-guide')?.addEventListener('click', () => guideDialog?.close());

  // Manual Theme Toggle: Chuyển đổi thủ công Sáng / Tối (Trực đêm)
  function updateThemeToggleButton() {
    const isDark = document.body.classList.contains('dark-theme');
    const iconEl = document.getElementById('theme-toggle-icon');
    const textEl = document.getElementById('theme-toggle-text');
    if (iconEl) iconEl.textContent = isDark ? '☀️' : '🌙';
    if (textEl) textEl.textContent = isDark ? 'Ban ngày' : 'Trực đêm';
    const btn = document.getElementById('btn-theme-toggle');
    if (btn) btn.title = isDark ? 'Chuyển sang chế độ Sáng (Ban ngày)' : 'Chuyển sang chế độ Tối (Trực đêm)';
  }

  // Khôi phục trạng thái giao diện đã lưu
  try {
    const savedTheme = localStorage.getItem('tkcs_theme');
    if (savedTheme === 'dark') {
      document.body.classList.add('dark-theme');
    } else {
      document.body.classList.remove('dark-theme');
    }
  } catch (e) {}
  updateThemeToggleButton();

  document.getElementById('btn-theme-toggle')?.addEventListener('click', () => {
    const isDark = document.body.classList.toggle('dark-theme');
    try {
      localStorage.setItem('tkcs_theme', isDark ? 'dark' : 'light');
    } catch (e) {}
    updateThemeToggleButton();
    showToast(isDark ? '🌙 Đã bật chế độ Trực đêm (Giao diện Tối)' : '☀️ Đã chuyển sang chế độ Ban ngày (Giao diện Sáng)');
  });
});
