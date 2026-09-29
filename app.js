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
let windowOffsetMinutes = 0;
let selectedSurgeryDocIds = new Set();

function getNowEpochMinutes() {
  return Math.floor(Date.now() / 60000);
}

function formatHHMM(epochMin) {
  const d = new Date(epochMin * 60000);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

function formatDateVN(epochMin) {
  const d = new Date(epochMin * 60000);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function getDateKey(dateObj) {
  const yyyy = dateObj.getFullYear();
  const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
  const dd = String(dateObj.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function addDaysToKey(dateKey, offsetDays) {
  const [y, m, d] = dateKey.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + offsetDays);
  return getDateKey(dt);
}

function timeStringToEpochMin(hhmmStr, refEpochMin) {
  if (!hhmmStr || !hhmmStr.includes(':')) return null;
  const [hh, mm] = hhmmStr.split(':').map(Number);
  const refDate = new Date(refEpochMin * 60000);
  const target = new Date(refDate.getFullYear(), refDate.getMonth(), refDate.getDate(), hh, mm, 0, 0);
  return Math.floor(target.getTime() / 60000);
}

function dateAndTimeToEpochMin(dateKeyStr, hhmmStr) {
  if (!dateKeyStr || !hhmmStr) return getNowEpochMinutes();
  const [y, m, d] = dateKeyStr.split('-').map(Number);
  const [hh, mm] = hhmmStr.split(':').map(Number);
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

function getAllowedIntervalsForDate(doc, dateKey) {
  const [y, m, d] = dateKey.split('-').map(Number);
  const dayStartMs = new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
  const dayStartMin = Math.floor(dayStartMs / 60000);
  const dayOfWeek = new Date(y, m - 1, d).getDay();
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

  const prevDateKey = addDaysToKey(dateKey, -1);
  const prevShift = (doc.scheduleByDate && doc.scheduleByDate[prevDateKey]) || 'LAM_NGAY';
  const todayShift = (doc.scheduleByDate && doc.scheduleByDate[dateKey]) || 'TRUC';

  const intervals = [];

  if (prevShift === 'TRUC') {
    intervals.push([dayStartMin + 0, dayStartMin + 420]);
  }

  if (todayShift === 'TRUC') {
    intervals.push([dayStartMin + 420, dayStartMin + 1440]);
  } else if (todayShift === 'RA_TRUC') {
    if (!isWeekend) {
      intervals.push([dayStartMin + 420, dayStartMin + 690]);
    }
  } else if (todayShift === 'LAM_NGAY') {
    intervals.push([dayStartMin + 420, dayStartMin + 690]);
    intervals.push([dayStartMin + 810, dayStartMin + 1020]);
  } else if (todayShift === 'NGHI_SANG') {
    intervals.push([dayStartMin + 810, dayStartMin + 1020]);
  } else if (todayShift === 'NGHI_CHIEU') {
    intervals.push([dayStartMin + 420, dayStartMin + 690]);
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
  const dt = new Date(epochMin * 60000);
  const dateKey = getDateKey(dt);
  const prevKey = addDaysToKey(dateKey, -1);
  const hh = dt.getHours();

  const prevShift = (doc.scheduleByDate && doc.scheduleByDate[prevKey]) || 'LAM_NGAY';
  const todayShift = (doc.scheduleByDate && doc.scheduleByDate[dateKey]) || 'TRUC';

  if (hh < 7) {
    if (prevShift === 'TRUC') {
      return {
        badgeText: 'Trực',
        badgeCls: 'badge-truc',
        subText: 'Đang trực'
      };
    }
    const meta = SHIFT_METADATA[todayShift] || { label: todayShift, badgeCls: 'badge-off' };
    return {
      badgeText: meta.label,
      badgeCls: 'badge-off',
      subText: 'Ngoài giờ làm việc (Chưa đến 07:00)'
    };
  }

  if (todayShift === 'RA_TRUC') {
    const dayOfWeek = dt.getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    const minsOfDay = hh * 60 + dt.getMinutes();
    if (!isWeekend && minsOfDay < 11 * 60 + 30) {
      return {
        badgeText: 'Ra trực',
        badgeCls: 'badge-ratruc',
        subText: 'Đang trực từ hôm trước'
      };
    }
    return {
      badgeText: 'Ra trực',
      badgeCls: 'badge-ratruc',
      subText: isWeekend ? 'Đã hết ca trực lúc 07:00 (Cuối tuần)' : 'Đã hết giờ ra trực (Sau 11:30)'
    };
  }

  const meta = SHIFT_METADATA[todayShift] || { label: todayShift, badgeCls: 'badge-truc', desc: '' };
  return {
    badgeText: meta.label,
    badgeCls: meta.badgeCls,
    subText: meta.desc
  };
}

// Quy tắc số 6 của đại ca:
// Sắp xếp danh sách Bác sĩ theo thứ tự ưu tiên:
// 1. Các user CÓ THỂ SỬ DỤNG ĐƯỢC (`isAvail`) đứng trước!
//    - Trong đó: Các bác sĩ tại phòng đang chọn (`assignedRoom === targetRoom`) đứng trước!
//    - Sau đó: Các bác sĩ phòng khác, xếp theo thứ tự từ lớn tới nhỏ (`seniority 1 -> 14`)
// 2. Các user đang được chính phòng đang chọn sử dụng (`active.roomName === targetRoom`) đứng kế tiếp (để tiện bấm Trả user)
// 3. Các user KHÔNG SỬ DỤNG ĐƯỢC đứng sau (cũng ưu tiên bác sĩ thuộc phòng đó trước, rồi theo `seniority 1 -> 14`)
function sortDoctorsByPriorityAndRoom(doctorsList, targetRoom, checkEpochMin) {
  return [...doctorsList].sort((a, b) => {
    const actA = getActiveUsageAt(a, checkEpochMin);
    const actB = getActiveUsageAt(b, checkEpochMin);
    const availA = !actA && isDoctorAllowedAtMinute(a, checkEpochMin);
    const availB = !actB && isDoctorAllowedAtMinute(b, checkEpochMin);

    // 1. Có thể sử dụng được đứng trước
    if (availA !== availB) {
      return availA ? -1 : 1;
    }

    // 2. Nếu cả hai cùng "Không sử dụng được", ưu tiên bác sĩ đang được chính targetRoom giữ lên trước để dễ bấm Trả user
    if (!availA && !availB) {
      const ownedByRoomA = actA && actA.roomName === targetRoom;
      const ownedByRoomB = actB && actB.roomName === targetRoom;
      if (ownedByRoomA !== ownedByRoomB) {
        return ownedByRoomA ? -1 : 1;
      }
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
    const icon = room.isSurgery ? '🩺' : '🏢';

    const countLabel = room.isSurgery
      ? count === 0
        ? '0 user đang đi mổ'
        : `${count} đang mổ (${activeDocsInRoom.map((d) => d.shortName || d.handle).join(', ')})`
      : count === 0
      ? '0 user đang sử dụng'
      : `${count} user đang sử dụng (${activeDocsInRoom.map((d) => d.shortName || d.handle).join(', ')})`;

    return `
      <div
        class="room-card ${hasActive ? 'has-active' : ''} ${isSelected ? 'selected' : ''}"
        data-room-name="${room.name}"
        role="button"
        tabindex="0"
      >
        <div class="room-title-row">
          <div class="room-title">
            <span class="room-icon">${icon}</span>
            <span>${room.name}</span>
          </div>
          ${isSelected ? `<span class="room-selected-pill">✓ Đang chọn</span>` : ''}
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

      let statusBadgeHtml = '';
      let statusSubHtml = '';
      let actionBtnHtml = '';

      if (activeUsage) {
        const isGoingSurgery = activeUsage.roomName === 'Đang mổ';
        const isSameRoomOwner = selectedRoomName === activeUsage.roomName;
        const endStr = activeUsage.endMin !== null ? ` → ${formatHHMM(activeUsage.endMin)}` : '';

        statusBadgeHtml = `<span class="status-badge unavailable">● Không sử dụng được</span>`;
        statusSubHtml = isGoingSurgery
          ? `<span class="status-subtext">🩺 <b>Đang đi mổ</b> (${formatHHMM(activeUsage.startMin)}${endStr})</span>`
          : `<span class="status-subtext">Đang dùng tại <b>${activeUsage.roomName}</b> (${formatHHMM(
              activeUsage.startMin
            )}${endStr})</span>`;

        if (isSameRoomOwner) {
          actionBtnHtml = `
            <button type="button" class="btn-action-release" data-action="release-user" data-doc-id="${doc.id}">
              ${isGoingSurgery ? 'Mổ xong ✕' : 'Trả user ✕'}
            </button>
          `;
        } else {
          actionBtnHtml = `
            <button
              type="button"
              class="btn-action-disabled"
              disabled
              title="Chỉ phòng [${activeUsage.roomName}] mới được trả User này"
            >
              Đang ở ${activeUsage.roomName}
            </button>
          `;
        }
      } else if (allowedRightNow) {
        statusBadgeHtml = `<span class="status-badge available">● Có thể sử dụng</span>`;
        statusSubHtml = `<span class="status-subtext">${shiftInfo.subText}</span>`;
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
        statusBadgeHtml = `<span class="status-badge unavailable">● Không sử dụng được</span>`;
        statusSubHtml = `<span class="status-subtext">${shiftInfo.subText}</span>`;
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

          return `
            <div
              class="usage-block"
              style="left: ${leftPct}%; width: ${widthPct}%; z-index: 4;"
              title="${u.roomName}: ${formatHHMM(u.startMin)} -> ${
            u.endMin !== null ? formatHHMM(u.endMin) : 'Đang sử dụng'
          }"
            >
              <strong>${u.roomName}</strong>
              <span>${timeLabel}</span>
            </div>
          `;
        })
        .join('');

      const captionsHtml = visibleUsages
        .map((u) => {
          const endStr = u.endMin !== null ? formatHHMM(u.endMin) : 'Đang dùng';
          return `<span class="usage-caption-item">${u.roomName} · <b>${formatHHMM(
            u.startMin
          )} &rarr; ${endStr}</b></span>`;
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
  renderGlobal60mWarnings();
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
    }
    return data;
  } catch (err) {
    console.error('API Error:', err);
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

  document.getElementById('receive-start-time').value = formatHHMM(nowMin);
  document.getElementById('receive-end-time').value = ''; // Mặc định không có thời gian kết thúc

  document.querySelectorAll('#receive-quick-duration-group .duration-chip').forEach((btn) => {
    btn.classList.remove('active');
  });

  document.getElementById('receive-time-dialog').showModal();
}

// Box 2: Open Enlarged "+ Báo mổ" Dialog
function openQuickSurgeryDialog() {
  selectedSurgeryDocIds.clear();
  const nowMin = getNowEpochMinutes();

  const sortedDoctors = [...dbState.doctors].sort(
    (a, b) => (a.seniority || 999) - (b.seniority || 999)
  );

  const gridEl = document.getElementById('surgery-short-name-grid');
  gridEl.innerHTML = sortedDoctors
    .map((doc) => {
      const sName = doc.shortName || doc.name.split(' ').pop();
      return `
        <button type="button" class="short-name-chip" data-surg-doc-id="${doc.id}">
          ${sName}
        </button>
      `;
    })
    .join('');

  document.getElementById('surgery-start-time').value = formatHHMM(nowMin);
  document.getElementById('surgery-end-time').value = '';

  document.getElementById('surgery-quick-dialog').showModal();
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
    const isSameRoom = doc.assignedRoom === roomName;

    if (!activeAtTarget && allowedAtTarget) {
      availableList.push({
        doc,
        isSameRoom,
        reason: `${shiftInfo.badgeText} — ${shiftInfo.subText}`
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
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:#64748b; padding: 1.2rem;">Chưa có dữ liệu lịch sử phù hợp bộ lọc.</td></tr>`;
    return;
  }

  tbody.innerHTML = allRecords
    .map((rec) => {
      const endLabel = rec.usage.endMin !== null ? formatHHMM(rec.usage.endMin) : 'Đang sử dụng';
      const statusPill = rec.activeNow
        ? `<span class="status-badge unavailable" style="font-size:0.72rem; padding:0.15rem 0.5rem;">Đang hoạt động</span>`
        : `<span class="status-badge available" style="font-size:0.72rem; padding:0.15rem 0.5rem;">Đã kết thúc</span>`;

      return `
        <tr>
          <td><strong>${rec.doc.name}</strong> <span style="color:#64748b;">(${rec.doc.handle})</span></td>
          <td><b>${rec.usage.roomName}</b></td>
          <td>${rec.dateLabel} <b>${formatHHMM(rec.usage.startMin)}</b></td>
          <td><b>${endLabel}</b></td>
          <td>${rec.durationMins} phút</td>
          <td>${statusPill}</td>
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
  if (dateInput) dateInput.value = todayStr;

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

  // Timeline Row Actions
  document.getElementById('timeline-rows-container')?.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const action = btn.getAttribute('data-action');
    const docId = btn.getAttribute('data-doc-id');

    if (action === 'open-receive-box') {
      openReceiveTimeDialog(docId);
    } else if (action === 'release-user') {
      postApi('/api/release', { docId, requestRoomName: selectedRoomName });
    }
  });

  // Quick Duration Buttons (5 - 10 - 20 - 30 - 60 phút) in Receive Box
  document.getElementById('receive-quick-duration-group')?.addEventListener('click', (e) => {
    const chip = e.target.closest('button[data-duration-mins]');
    if (!chip) return;

    document.querySelectorAll('#receive-quick-duration-group .duration-chip').forEach((b) => {
      b.classList.toggle('active', b === chip);
    });

    const mins = Number(chip.getAttribute('data-duration-mins'));
    const endInput = document.getElementById('receive-end-time');
    if (mins === 0) {
      endInput.value = '';
      return;
    }

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

    windowOffsetMinutes = 0;
    postApi('/api/receive', {
      docId,
      roomName: selectedRoomName,
      startMin,
      endMin
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

  document.getElementById('surgery-quick-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    if (selectedSurgeryDocIds.size === 0) {
      showToast('⚠️ Vui lòng bấm chọn ít nhất 1 bác sĩ đi mổ!');
      return;
    }

    const nowMin = getNowEpochMinutes();
    const startStr = document.getElementById('surgery-start-time').value;
    const endStr = document.getElementById('surgery-end-time').value;

    const startMin = timeStringToEpochMin(startStr, nowMin) ?? nowMin;
    let endMin = timeStringToEpochMin(endStr, nowMin);
    if (endMin !== null && endMin <= startMin) {
      endMin += 1440;
    }

    windowOffsetMinutes = 0;
    postApi('/api/receive', {
      docIds: Array.from(selectedSurgeryDocIds),
      roomName: 'Đang mổ',
      startMin,
      endMin
    });
    surgeryDialog.close();
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
      postApi('/api/release', { docId: relBtn.getAttribute('data-release-now-doc') });
    }
  });
});
