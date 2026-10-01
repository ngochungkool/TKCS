/**
 * MODULE ĐI BUỒNG HẰNG NGÀY — PHÒNG THẦN KINH 1
 * Khoa Ngoại Thần Kinh - Cột Sống | BVĐK Trung Tâm Tỉnh Gia Lai
 */

(function () {
  const TK1_QUICK_OPTIONS = {
    xetNghiem: [
      'Công thức máu',
      'Chức năng đông máu',
      'Điện giải đồ',
      'Sinh hoá',
      'Glucose máu',
      'Khác'
    ],
    ct: [
      'Sọ não',
      'Cột sống cổ',
      'Lồng ngực',
      'Cột sống lưng',
      'Bụng',
      'Mạch máu não'
    ],
    xquang: [
      'X-quang ngực thẳng',
      'X-quang cột sống cổ',
      'X-quang cột sống lưng',
      'X-quang khung chậu',
      'X-quang xương chi',
      'Siêu âm bụng'
    ],
    sieuAm: [],
    hoiChan: [
      'Chấn thương',
      'Răng Hàm Mặt',
      'Tai Mũi Họng',
      'Mắt',
      'Lồng ngực',
      'Đột Quỵ',
      'Nội tiết'
    ]
  };

  const CLINIC_BY_SPECIALTY = {
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

  const ROOM_LAYOUT_CONFIGS = {
    tk1:  { wingA: [1, 9],  wingB: [10, 24], extraTasks: [] },
    tk2:  { wingA: [1, 11], wingB: [12, 25], extraTasks: ['Rút dẫn lưu', 'Rút sonde tiểu', 'Cắt chỉ'] },
    tk3:  { wingA: [1, 9],  wingB: [10, 24], extraTasks: [] },
    tk4:  { wingA: [1, 9],  wingB: [10, 24], extraTasks: [] },
    hstk: { wingA: [1, 9],  wingB: [10, 24], extraTasks: [] }
  };

  function getCurrentRoomConfig() {
    return ROOM_LAYOUT_CONFIGS[currentRoomKey] || ROOM_LAYOUT_CONFIGS.tk1;
  }

  let currentRoomKey = 'tk1';
  let allRoomsState = {};
  let tk1State = {
    roomKey: 'tk1',
    roomName: 'Thần kinh 1',
    bedAssignments: {},
    hiddenFoldingBeds: {},
    patientRecords: {},
    latestExcelMabns: [],
    acknowledgedMissingMabns: {},
    lastDeletedAction: null,
    lastExcelUploadTime: null
  };
  let lastExcelUploadTimeGlobal = '';
  let globalEpisodeConsultations = {};
  let wingCollapsed = { A: false, B: false };
  let activeSummaryTab = 'xn-cdha';
  let activeModalMabn = null;
  // Chế độ bấm chọn nhanh 1 BN chưa phân giường rồi bấm trực tiếp vào ô giường bên dưới
  let quickAssignSelectedMabn = null;

  let selectedDateKey = getTodayKey();
  function getSelectedDateKey() {
    return selectedDateKey || getTodayKey();
  }

  function formatDateDisplayVN(dateKey) {
    if (!dateKey || !dateKey.includes('-')) return dateKey || '';
    const [y, m, d] = dateKey.split('-');
    return `${d}/${m}/${y}`;
  }

  function formatCtLabel(item) {
    if (!item) return '';
    const trimmed = String(item).trim();
    if (trimmed.toLowerCase().startsWith('ct')) return trimmed;
    return `CT ${trimmed.charAt(0).toLowerCase() + trimmed.slice(1)}`;
  }

  let modalDraftTasks = {
    xetNghiem: [],
    ct: [],
    xquang: [],
    sieuAm: [],
    hoiChan: [],
    thuThuat: [],
    note: ''
  };

  function getTodayKey() {
    const dt = new Date();
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
  }

  function parseDateKeyToDayNumber(dateKey) {
    if (!dateKey || !dateKey.includes('-')) return 0;
    const [y, m, d] = dateKey.split('-').map(Number);
    return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
  }

  function formatRelativePastDayLabel(pastDateKey) {
    const todayNum = parseDateKeyToDayNumber(getTodayKey());
    const pastNum = parseDateKeyToDayNumber(pastDateKey);
    const diffDays = todayNum - pastNum;
    if (diffDays <= 0) return 'Hôm nay';
    if (diffDays === 1) return 'Hôm qua';
    return `Cách đây ${diffDays} ngày`;
  }

  function getClinicNameForSpecialty(spec) {
    if (!spec) return '';
    return CLINIC_BY_SPECIALTY[spec] || `Phòng khám ${spec}`;
  }

  function formatFollowUpAppointmentText(rec) {
    const cd = rec.consultDetails || {};
    const dis = rec.discharge || {};
    const curDateKey = getSelectedDateKey();
    const spec = cd.specialty || (rec.tasksByDate?.[curDateKey]?.hoiChan?.[0] || '');

    // Yêu cầu: Không tự động nhận là tái khám PK ngoại thần kinh sau 7 ngày, chỉ nhận tự động của các ca có hội chẩn
    if (!spec) {
      return 'Không hẹn tái khám';
    }

    const days = dis.followUpDays || cd.followUpDays || '7';
    const clinic = dis.followUpClinic || cd.followUpClinic || getClinicNameForSpecialty(spec);
    const numDays = Number(days) || 7;
    const targetDt = new Date();
    targetDt.setDate(targetDt.getDate() + numDays);
    const dd = String(targetDt.getDate()).padStart(2, '0');
    const mm = String(targetDt.getMonth() + 1).padStart(2, '0');
    const yyyy = targetDt.getFullYear();

    return `Hẹn tái khám sau ${numDays} ngày (${dd}/${mm}/${yyyy}) tại ${clinic}`;
  }

  function getBedOfPatient(mabn) {
    for (const [bCode, m] of Object.entries(tk1State.bedAssignments || {})) {
      if (m === mabn) return bCode;
    }
    return null;
  }

  function formatBedLabel(bedCode) {
    if (!bedCode) return 'Chưa phân giường';
    const str = String(bedCode);
    if (str.endsWith('X')) {
      return `Xếp ${str.replace('X', '')}`;
    }
    return `${str}`;
  }

  function buildAllBedOptionsHtml(currentMabn) {
    const { wingA, wingB } = getCurrentRoomConfig();
    const endA = wingA[1];
    const endB = wingB[1];
    const options = [];
    for (let i = 1; i <= endB; i++) {
      const mainCode = String(i);
      const foldCode = `${i}X`;
      const wingLabel = i <= endA ? 'Dãy A' : 'Dãy B';

      for (const code of [mainCode, foldCode]) {
        const isFold = code.endsWith('X');
        const occMabn = tk1State.bedAssignments[code];
        const occRec = occMabn ? tk1State.patientRecords[occMabn] : null;
        const isSelf = occMabn === currentMabn;

        let statusNote = 'Trống';
        if (isSelf) {
          statusNote = '✓ Đang nằm giường này';
        } else if (occRec) {
          const dStatus = occRec.discharge?.status;
          if (dStatus === 'MORNING_DISCHARGE') {
            statusNote = `⚠️ Xuất viện sáng nay (${occRec.hoten})`;
          } else if (dStatus === 'SCHEDULED') {
            statusNote = `⚠️ Chờ ra viện (${occRec.hoten})`;
          } else {
            statusNote = `⇄ Đổi giường với: ${occRec.hoten}`;
          }
        }

        const label = isFold
          ? `[${wingLabel}] Giường xếp ${i} — ${statusNote}`
          : `[${wingLabel}] Giường ${String(i).padStart(2, '0')} — ${statusNote}`;

        options.push(`<option value="${code}" ${isSelf ? 'selected' : ''}>${label}</option>`);
      }
    }
    return options.join('');
  }

  async function callTk1Api(payload) {
    try {
      const reqBody = { roomKey: currentRoomKey, ...payload };
      const res = await fetch('/api/ward-rounds/tk1', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reqBody)
      });
      const data = await res.json();
      if (data.needsConfirmDischargeOverwrite) {
        const msg =
          `⚠️ ${formatBedLabel(data.targetBedCode)} đang có bệnh nhân [${data.occupantName}] ở trạng thái ` +
          `${data.occupantDischargeStatus === 'MORNING_DISCHARGE' ? '"Xuất viện sáng nay"' : '"Chờ ra viện"'}.\n\n` +
          `Bạn có xác nhận giải phóng giường này để phân bệnh nhân mới vào không?`;
        if (window.confirm(msg)) {
          return await callTk1Api({ ...reqBody, confirmOverwriteDischarge: true });
        }
        return null;
      }
      if (data.ok) {
        if (data.wardRounds) {
          allRoomsState = data.wardRounds;
        }
        if (data.wardRounds && data.wardRounds[currentRoomKey]) {
          tk1State = data.wardRounds[currentRoomKey];
        } else if (data.tk1) {
          tk1State = data.tk1;
          allRoomsState[currentRoomKey] = data.tk1;
        }
        if (data.lastExcelUploadTime) {
          lastExcelUploadTimeGlobal = data.lastExcelUploadTime;
          tk1State.lastExcelUploadTime = data.lastExcelUploadTime;
          if (allRoomsState) {
            Object.values(allRoomsState).forEach(r => { r.lastExcelUploadTime = data.lastExcelUploadTime; });
          }
        }
        if (data.episodeConsultations) globalEpisodeConsultations = data.episodeConsultations;
        renderTk1Workspace();
      }
      return data;
    } catch (e) {
      console.error('TK1 API error:', e);
      return null;
    }
  }

  function checkClientSideMorningRelease() {
    const now = new Date();
    const todayKey = getTodayKey();
    const hour = now.getHours();
    if (hour < 7) return;

    for (const [, mabn] of Object.entries(tk1State.bedAssignments || {})) {
      const rec = tk1State.patientRecords[mabn];
      if (rec && rec.discharge && (rec.discharge.status === 'SCHEDULED' || rec.discharge.status === 'MORNING_DISCHARGE')) {
        if (rec.discharge.markedDate && rec.discharge.markedDate < todayKey) {
          if (hour >= 9) {
            callTk1Api({ action: 'RELEASE_DISCHARGED_BED_NOW', mabn });
          } else if (hour >= 7 && rec.discharge.status !== 'MORNING_DISCHARGE') {
            rec.discharge.status = 'MORNING_DISCHARGE';
            callTk1Api({
              action: 'SET_DISCHARGE',
              mabn,
              status: 'MORNING_DISCHARGE',
              followUpDays: rec.discharge.followUpDays,
              followUpClinic: rec.discharge.followUpClinic
            });
          }
        }
      }
    }
  }

  function getMostRecentHistorySummary(rec) {
    const curDateKey = getSelectedDateKey();
    const dates = Object.keys(rec.tasksByDate || {})
      .filter(d => d < curDateKey)
      .sort((a, b) => (a < b ? 1 : -1));

    for (const dKey of dates) {
      const t = rec.tasksByDate[dKey];
      if (!t) continue;
      const items = [
        ...(t.xetNghiem || []).map(x => `XN: ${x}`),
        ...(t.ct || []).map(x => `CT: ${x}`),
        ...(t.xquang || []).map(x => `XQ: ${x}`),
        ...(t.sieuAm || []).map(x => `SA: ${x}`),
        ...(t.hoiChan || []).map(x => `Hội chẩn: ${x}`),
        ...(t.thuThuat || []).map(x => `${x}`)
      ];
      if (items.length > 0 || t.note) {
        return {
          dateKey: dKey,
          relativeLabel: formatRelativePastDayLabel(dKey),
          items,
          note: t.note || ''
        };
      }
    }
    return null;
  }

  function renderBedPairHtml(bedNumber) {
    const mainCode = String(bedNumber);
    const foldCode = `${bedNumber}X`;
    const mainMabn = tk1State.bedAssignments[mainCode];
    const foldMabn = tk1State.bedAssignments[foldCode];
    const mainRec = mainMabn ? tk1State.patientRecords[mainMabn] : null;
    const foldRec = foldMabn ? tk1State.patientRecords[foldMabn] : null;
    const isFoldHiddenManually = Boolean(tk1State.hiddenFoldingBeds && tk1State.hiddenFoldingBeds[mainCode]);

    const mainCardHtml = renderSingleBedCardHtml(mainCode, bedNumber, false, mainRec, foldRec, isFoldHiddenManually);

    let foldCardHtml = '';
    if (foldRec && !isFoldHiddenManually) {
      foldCardHtml = renderSingleBedCardHtml(foldCode, bedNumber, true, foldRec, null, false);
    }

    return `
      <div class="tk1-bed-pair-wrap" data-bed-pair="${bedNumber}">
        ${mainCardHtml}
        ${foldCardHtml}
      </div>
    `;
  }

  // 5. Không hiển thị chẩn đoán đi cùng ở bảng hiển thị ngoài; chỉ giữ số giường và nút + xếp gọn gàng
  function renderSingleBedCardHtml(bedCode, bedNumber, isFolding, rec, attachedFoldRec, isFoldHiddenManually) {
    const badgeTitle = isFolding ? `Xếp ${bedNumber}` : `${bedNumber}`;
    const quickSelectHint = quickAssignSelectedMabn && tk1State.patientRecords[quickAssignSelectedMabn]
      ? ` · Bấm để xếp [${tk1State.patientRecords[quickAssignSelectedMabn].hoten}] vào đây`
      : '';

    if (!rec) {
      return `
        <div class="tk1-bed-card is-empty" data-empty-bed="${bedCode}" style="${quickAssignSelectedMabn ? 'border-color:#2563eb;background:#eff6ff;cursor:pointer;' : ''}">
          <div class="tk1-bed-top-line" style="margin-bottom: 0;">
            <div class="tk1-bed-badge-group">
              <span class="tk1-bed-num-badge" style="background: ${quickAssignSelectedMabn ? '#2563eb' : '#64748b'}; min-width: 28px; justify-content: center;">${badgeTitle}</span>
              <span style="font-size: 0.8rem; font-weight: 700; color: ${quickAssignSelectedMabn ? '#1d4ed8' : '#64748b'};">
                Trống${quickSelectHint}
              </span>
            </div>
            <div class="tk1-bed-quick-actions">
              <button type="button" class="btn-bed-mini" data-open-assign-to-bed="${bedCode}">
                + Phân BN
              </button>
              <button type="button" class="btn-bed-mini" data-open-assign-to-bed="${bedNumber}X">
                + xếp
              </button>
              ${
                attachedFoldRec && isFoldHiddenManually
                  ? `<button type="button" class="btn-bed-mini" style="background:#f3e8ff;color:#6d28d9;border-color:#d8b4fe;" data-toggle-fold-bed="${bedNumber}" data-fold-hide="0">
                      👁️ Hiện xếp (${attachedFoldRec.hoten})
                    </button>`
                  : ''
              }
            </div>
          </div>
        </div>
      `;
    }

    const dStatus = rec.discharge?.status || 'NONE';
    let cardStatusCls = 'is-occupied';
    let statusBadgeHtml = '';

    if (dStatus === 'MORNING_DISCHARGE') {
      cardStatusCls += ' status-morning-discharge';
      statusBadgeHtml = `<span style="background:#d97706;color:#fff;font-size:0.71rem;font-weight:800;padding:2px 8px;border-radius:999px;">🌅 Xuất viện sáng nay</span>`;
    } else if (dStatus === 'SCHEDULED') {
      cardStatusCls += ' status-scheduled-discharge';
      statusBadgeHtml = `<span style="background:#dc2626;color:#fff;font-size:0.71rem;font-weight:800;padding:2px 8px;border-radius:999px;">🏥 Chờ ra viện</span>`;
    }

    const curDateKey = getSelectedDateKey();
    const todayTasks = (rec.tasksByDate && rec.tasksByDate[curDateKey]) || {};
    const pills = [];
    (todayTasks.xetNghiem || []).forEach(item => pills.push(`<span class="tk1-task-pill pill-xn">🧪 ${item}</span>`));
    (todayTasks.ct || []).forEach(item => pills.push(`<span class="tk1-task-pill pill-ct">🧠 ${formatCtLabel(item)}</span>`));
    (todayTasks.xquang || []).forEach(item => pills.push(`<span class="tk1-task-pill pill-xq">🦴 ${item}</span>`));
    (todayTasks.sieuAm || []).forEach(item => pills.push(`<span class="tk1-task-pill pill-sa">📡 ${item}</span>`));
    (todayTasks.hoiChan || []).forEach(item => pills.push(`<span class="tk1-task-pill pill-hc">👨‍⚕️ HC: ${item}</span>`));
    (todayTasks.thuThuat || []).forEach(item => pills.push(`<span class="tk1-task-pill" style="background:#fef3c7;color:#b45309;border:1px solid #fde68a;">🩹 ${item}</span>`));

    const followUpStr = (dStatus === 'SCHEDULED' || dStatus === 'MORNING_DISCHARGE')
      ? formatFollowUpAppointmentText(rec)
      : '';

    const recentHist = getMostRecentHistorySummary(rec);

    return `
      <div
        class="tk1-bed-card ${cardStatusCls} ${isFolding ? 'is-folding-bed' : ''}"
        data-patient-card-mabn="${rec.mabn}"
        data-occupied-bed="${bedCode}"
      >
        <div class="tk1-bed-top-line" style="margin-bottom:0;">
          <div class="tk1-bed-badge-group">
            <span class="tk1-bed-num-badge" style="min-width: 28px; justify-content: center;">${badgeTitle}</span>
            <span class="tk1-patient-name">${rec.hoten}</span>
            <span class="tk1-patient-meta">· ${rec.tuoi || 'N/A'} · ${rec.ngayVaoStr || '--'}</span>
            ${statusBadgeHtml}
          </div>

          <div class="tk1-bed-quick-actions" onclick="event.stopPropagation();">
            ${
              !isFolding && !attachedFoldRec
                ? `<button type="button" class="btn-bed-mini" title="Thêm bệnh nhân vào giường xếp ${bedNumber}" data-open-assign-to-bed="${bedNumber}X">+ xếp</button>`
                : ''
            }
            ${
              !isFolding && attachedFoldRec && isFoldHiddenManually
                ? `<button type="button" class="btn-bed-mini" style="background:#f3e8ff;color:#6d28d9;border-color:#d8b4fe;" data-toggle-fold-bed="${bedNumber}" data-fold-hide="0">
                    👁️ Hiện xếp (${attachedFoldRec.hoten.split(' ').pop()})
                  </button>`
                : ''
            }
            ${
              isFolding
                ? `<button type="button" class="btn-bed-mini" title="Ẩn giường xếp này" data-toggle-fold-bed="${bedNumber}" data-fold-hide="1">Ẩn xếp</button>`
                : ''
            }
            <button type="button" class="btn-bed-mini" title="Mở sơ đồ Chọn / Đổi giường trực quan" data-quick-move-mabn="${rec.mabn}">
              ⇄ Đổi/Chuyển
            </button>
          </div>
        </div>

        ${
          recentHist
            ? `<div style="font-size:0.74rem;color:#64748b;margin-top:0.25rem;">
                🕒 <strong>Lịch sử (${recentHist.relativeLabel}):</strong> ${recentHist.items.join(', ') || recentHist.note}
              </div>`
            : ''
        }

        ${pills.length > 0 ? `<div class="tk1-card-tags-row">${pills.join('')}</div>` : ''}

        ${
          followUpStr
            ? `<div class="tk1-discharge-banner-inline">
                📅 <strong>Tái khám:</strong> ${followUpStr}
              </div>`
            : ''
        }
      </div>
    `;
  }

  // Render 4 Tab Tổng Hợp Đi Buồng
  function renderTk1SummaryTabs() {
    const xnBody = document.getElementById('tk1-sum-tbody-xn');
    const hcBody = document.getElementById('tk1-sum-tbody-hc');
    const rvBody = document.getElementById('tk1-sum-tbody-rv');
    if (!xnBody || !hcBody || !rvBody) return;

    const curDateKey = getSelectedDateKey();
    const sumTitleEl = document.getElementById('tk1-summary-title');
    if (sumTitleEl) {
      sumTitleEl.textContent = `📋 Tổng hợp đi buồng — Ngày ${formatDateDisplayVN(curDateKey)}`;
    }

    const { wingB } = getCurrentRoomConfig();
    const maxBedNum = wingB[1];
    const assignedEntries = [];
    for (let i = 1; i <= maxBedNum; i++) {
      for (const code of [String(i), `${i}X`]) {
        const mabn = tk1State.bedAssignments[code];
        if (mabn && tk1State.patientRecords[mabn]) {
          assignedEntries.push({ bedCode: code, rec: tk1State.patientRecords[mabn] });
        }
      }
    }

    // 1. Tab Xét nghiệm + CĐHA (Gộp cả Chỉ định XN, CT, XQ, SA, Thủ thuật & Ghi chú đi buồng)
    const xnRows = assignedEntries.filter(({ rec }) => {
      const t = (rec.tasksByDate && rec.tasksByDate[curDateKey]) || {};
      const hasXn = Array.isArray(t.xetNghiem) && t.xetNghiem.length > 0;
      const hasCt = Array.isArray(t.ct) && t.ct.length > 0;
      const hasXq = Array.isArray(t.xquang) && t.xquang.length > 0;
      const hasSa = Array.isArray(t.sieuAm) && t.sieuAm.length > 0;
      const hasThuThuat = Array.isArray(t.thuThuat) && t.thuThuat.length > 0;
      const hasNote = Boolean(t.note && String(t.note).trim());
      return hasXn || hasCt || hasXq || hasSa || hasThuThuat || hasNote;
    });

    document.getElementById('tk1-count-tab-xn').textContent = xnRows.length;
    xnBody.innerHTML = xnRows.length === 0
      ? `<tr><td colspan="4" style="text-align:center;color:#64748b;padding:1.1rem;">Chưa có bệnh nhân nào có chỉ định Xét nghiệm / CĐHA / Ghi chú ngày ${formatDateDisplayVN(curDateKey)}.</td></tr>`
      : xnRows.map(({ bedCode, rec }) => {
          const t = (rec.tasksByDate && rec.tasksByDate[curDateKey]) || {};
          const badges = [
            ...(t.xetNghiem || []).map(x => `<span class="tk1-task-pill pill-xn">🧪 XN: ${x}</span>`),
            ...(t.ct || []).map(x => `<span class="tk1-task-pill pill-ct">🧠 ${formatCtLabel(x)}</span>`),
            ...(t.xquang || []).map(x => `<span class="tk1-task-pill pill-xq">🦴 XQ: ${x}</span>`),
            ...(t.sieuAm || []).map(x => `<span class="tk1-task-pill pill-sa">📡 SA: ${x}</span>`),
            ...(t.thuThuat || []).map(x => `<span class="tk1-task-pill pill-sa" style="background:#fef3c7;border-color:#fcd34d;color:#92400e;">🩹 ${x}</span>`)
          ];
          const badgesHtml = badges.length > 0
            ? `<div style="display:flex;flex-wrap:wrap;gap:4px;">${badges.join(' ')}</div>`
            : `<span style="font-size:0.78rem;color:#94a3b8;font-style:italic;">Không có chỉ định</span>`;
          const noteVal = String(t.note || '').trim();

          return `
            <tr>
              <td><strong>${formatBedLabel(bedCode)}</strong></td>
              <td>
                <a href="javascript:void(0)" onclick="window.TK1Module.openPatientModal('${rec.mabn}')" style="font-weight:800;color:#004aad;text-decoration:none;">
                  ${rec.hoten}
                </a>
                <span style="font-size:0.76rem;color:#64748b;"> · ${rec.tuoi}</span>
              </td>
              <td>${badgesHtml}</td>
              <td>
                <div style="display:flex;align-items:center;gap:6px;">
                  <input
                    type="text"
                    class="date-input"
                    style="flex:1;font-size:0.82rem;font-weight:600;font-family:'Be Vietnam Pro',sans-serif;"
                    value="${noteVal.replace(/"/g, '&quot;')}"
                    placeholder="Ghi chú đi buồng..."
                    id="inline-note-${rec.mabn}"
                    onkeydown="if(event.key==='Enter') window.TK1Module.saveInlineNote('${rec.mabn}')"
                  />
                  <button
                    type="button"
                    class="btn-primary-sm"
                    style="padding:0.38rem 0.75rem;font-size:0.76rem;font-family:'Be Vietnam Pro',sans-serif;"
                    onclick="window.TK1Module.saveInlineNote('${rec.mabn}')"
                  >
                    Lưu
                  </button>
                </div>
              </td>
            </tr>
          `;
        }).join('');

    // 2. Tab Hội chẩn (Chỉ hiện các ca có đăng ký hội chẩn trong ngày được chọn)
    const hcRows = assignedEntries.filter(({ rec }) => {
      const t = (rec.tasksByDate && rec.tasksByDate[curDateKey]) || {};
      return Array.isArray(t.hoiChan) && t.hoiChan.length > 0;
    });

    document.getElementById('tk1-count-tab-hc').textContent = hcRows.length;
    hcBody.innerHTML = hcRows.length === 0
      ? `<tr><td colspan="5" style="text-align:center;color:#64748b;padding:1.1rem;">Chưa có bệnh nhân nào đăng ký Hội chẩn ngày ${formatDateDisplayVN(curDateKey)}.</td></tr>`
      : hcRows.map(({ bedCode, rec }) => {
          const t = (rec.tasksByDate && rec.tasksByDate[curDateKey]) || {};
          const spec = (t.hoiChan && t.hoiChan[0]) || rec.consultDetails?.specialty || 'Chuyên khoa';
          const cDiag = rec.consultDetails?.consultDiagnosis || '';
          const cTreat = rec.consultDetails?.consultTreatment || '';
          const fDays = rec.consultDetails?.followUpDays || '7';
          const autoClinic = getClinicNameForSpecialty(spec);

          return `
            <tr>
              <td><strong>${formatBedLabel(bedCode)}</strong></td>
              <td>
                <a href="javascript:void(0)" onclick="window.TK1Module.openPatientModal('${rec.mabn}')" style="font-weight:800;color:#004aad;text-decoration:none;">
                  ${rec.hoten}
                </a>
                <div style="font-size:0.75rem;color:#64748b;">${rec.tuoi} · ${rec.ngayVaoStr}</div>
              </td>
              <td>
                <span class="tk1-task-pill pill-hc">👨‍⚕️ ${spec}</span>
                <div style="font-size:0.73rem;color:#475569;margin-top:4px;">PK: <b>${autoClinic}</b></div>
              </td>
              <td>
                <input
                  type="text"
                  class="date-input"
                  style="width:100%;margin-bottom:4px;font-size:0.8rem;"
                  placeholder="Chẩn đoán BS hội chẩn..."
                  value="${cDiag.replace(/"/g, '&quot;')}"
                  id="inline-cdiag-${rec.mabn}"
                />
                <input
                  type="text"
                  class="date-input"
                  style="width:100%;font-size:0.82rem;font-weight:700;border-color:#93c5fd;"
                  placeholder="Nhập xử trí của bác sĩ hội chẩn..."
                  value="${cTreat.replace(/"/g, '&quot;')}"
                  id="inline-ctreat-${rec.mabn}"
                />
              </td>
              <td>
                <div style="display:flex;align-items:center;gap:4px;">
                  <input
                    type="number"
                    class="date-input"
                    style="width:62px;text-align:center;"
                    title="Số ngày hẹn tái khám"
                    value="${fDays}"
                    id="inline-fdays-${rec.mabn}"
                  />
                  <span style="font-size:0.75rem;color:#475569;">ngày</span>
                  <button
                    type="button"
                    class="btn-primary-sm"
                    style="padding:0.4rem 0.7rem;font-size:0.76rem;"
                    onclick="window.TK1Module.saveInlineConsult('${rec.mabn}', '${spec.replace(/'/g, "\\'")}')"
                  >
                    Lưu
                  </button>
                </div>
              </td>
            </tr>
          `;
        }).join('');

    // 3. Tab Ra viện
    const rvRows = assignedEntries.filter(({ rec }) => {
      const st = rec.discharge?.status;
      return st === 'SCHEDULED' || st === 'MORNING_DISCHARGE';
    });

    document.getElementById('tk1-count-tab-rv').textContent = rvRows.length;
    rvBody.innerHTML = rvRows.length === 0
      ? `<tr><td colspan="4" style="text-align:center;color:#64748b;padding:1.1rem;">Chưa có bệnh nhân nào trong danh sách Ra viện.</td></tr>`
      : rvRows.map(({ bedCode, rec }) => {
          const isMorning = rec.discharge?.status === 'MORNING_DISCHARGE';
          const followUpText = formatFollowUpAppointmentText(rec);
          const followUpCellHtml = followUpText && followUpText !== 'Không hẹn tái khám'
            ? `📅 ${followUpText}`
            : `<span style="font-size:0.8rem;color:#64748b;">Không hẹn tái khám</span>`;
          return `
            <tr>
              <td><strong>${formatBedLabel(bedCode)}</strong></td>
              <td>
                <a href="javascript:void(0)" onclick="window.TK1Module.openPatientModal('${rec.mabn}')" style="font-weight:800;color:#004aad;text-decoration:none;">
                  ${rec.hoten}
                </a>
                <span style="font-size:0.76rem;color:#64748b;"> · ${rec.tuoi}</span>
              </td>
              <td>
                ${
                  isMorning
                    ? `<span style="background:#d97706;color:#fff;font-size:0.74rem;font-weight:800;padding:3px 9px;border-radius:999px;">🌅 Xuất viện sáng nay</span>`
                    : `<span style="background:#dc2626;color:#fff;font-size:0.74rem;font-weight:800;padding:3px 9px;border-radius:999px;">🏥 Chờ ra viện</span>`
                }
              </td>
              <td style="font-size:0.82rem;font-weight:700;color:#0f766e;">
                ${followUpCellHtml}
              </td>
            </tr>
          `;
        }).join('');

  }

  // 4. Làm gọn lại box chưa được phân giường (dải chip ngang gọn nhẹ + Sơ đồ chọn giường trực quan)
  function renderTk1TopAlerts() {
    const alertContainer = document.getElementById('tk1-top-alerts');
    if (!alertContainer) return;

    const assignedMabnSet = new Set(Object.values(tk1State.bedAssignments || {}));
    const latestExcelSet = new Set(tk1State.latestExcelMabns || []);

    const unassignedPatients = (tk1State.latestExcelMabns || [])
      .map(m => tk1State.patientRecords[m])
      .filter(rec => rec && !assignedMabnSet.has(rec.mabn) && !rec.removed?.isRemoved && rec.discharge?.status !== 'RELEASED_AFTER_9AM' && rec.discharge?.status !== 'DISCHARGED_COMPLETED');

    if (quickAssignSelectedMabn && !unassignedPatients.some(r => r.mabn === quickAssignSelectedMabn)) {
      quickAssignSelectedMabn = null;
    }

    const missingFromExcelPatients = [];
    for (const [bedCode, mabn] of Object.entries(tk1State.bedAssignments || {})) {
      if (!latestExcelSet.has(mabn) && !(tk1State.acknowledgedMissingMabns && tk1State.acknowledgedMissingMabns[mabn])) {
        const rec = tk1State.patientRecords[mabn];
        if (rec) missingFromExcelPatients.push({ bedCode, rec });
      }
    }

    const blocks = [];

    // Thanh Hoàn tác sau khi bấm Xoá (có nút tắt ✕)
    if (tk1State.lastDeletedAction) {
      const del = tk1State.lastDeletedAction;
      blocks.push(`
        <div class="tk1-undo-banner" style="display:flex;align-items:center;justify-content:space-between;gap:0.75rem;padding:0.6rem 1rem;">
          <div style="display:flex;align-items:center;gap:0.5rem;flex:1;">
            <span>🗑️ Đã xoá bệnh nhân <strong>${del.hoten}</strong> (${del.previousBed ? formatBedLabel(del.previousBed) : 'Chưa gán giường'}) — Lý do: <em>${del.reason}</em></span>
          </div>
          <div style="display:flex;align-items:center;gap:0.5rem;flex-shrink:0;">
            <button type="button" class="btn-tk1-undo" id="btn-tk1-undo-delete" title="Hoàn tác đưa bệnh nhân trở lại">
              ↩️ Hoàn tác ngay
            </button>
            <button type="button" class="btn-tk1-dismiss-undo" id="btn-tk1-dismiss-undo" title="Tắt / Đóng thông báo này" style="background:#fee2e2;color:#991b1b;border:1px solid #fca5a5;border-radius:6px;width:28px;height:28px;display:flex;align-items:center;justify-content:center;font-size:1.05rem;font-weight:700;cursor:pointer;line-height:1;">
              ✕
            </button>
          </div>
        </div>
      `);
    }

    // Cảnh báo BN đã từng bấm xoá nhưng vẫn còn trong file Excel HIS
    const removedActivePatients = (tk1State.latestExcelMabns || [])
      .map(m => tk1State.patientRecords[m])
      .filter(r => r && r.removed?.isRemoved);
    if (removedActivePatients.length > 0) {
      blocks.push(`
        <div class="tk1-alert-box" style="padding:0.65rem 0.95rem;background:#fefce8;border:1.5px solid #facc15;">
          <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:0.5rem;">
            <span style="font-size:0.83rem;font-weight:700;color:#854d0e;">
              ⚠️ Có ${removedActivePatients.length} BN đã bấm xoá/chuyển nhưng vẫn còn tên trong file Excel HIS:
              ${removedActivePatients.map(p => `<strong>${p.hoten}</strong> (${p.removed.previousBed ? formatBedLabel(p.removed.previousBed) : 'Chưa giường'})`).join(', ')}
            </span>
            <div style="display:flex;flex-wrap:wrap;gap:0.4rem;">
              ${removedActivePatients.map(p => `
                <button type="button" class="btn-bed-mini" style="background:#fef08a;color:#713f12;border-color:#eab308;font-weight:700;" data-restore-removed-mabn="${p.mabn}">
                  🔄 Khôi phục [${p.hoten.split(' ').pop()}]
                </button>
              `).join('')}
            </div>
          </div>
        </div>
      `);
    }

    // Box gọn cho Bệnh nhân chưa phân giường
    if (unassignedPatients.length > 0) {
      const selectedRec = quickAssignSelectedMabn ? tk1State.patientRecords[quickAssignSelectedMabn] : null;
      blocks.push(`
        <div class="tk1-alert-box" style="padding:0.65rem 0.95rem;">
          <div class="tk1-alert-header" style="margin-bottom:0.45rem;">
            <span>
              ⚠️ Chưa phân giường (${unassignedPatients.length} BN)
              <span style="font-weight:600;color:#78350f;font-size:0.78rem;margin-left:6px;">
                ${
                  selectedRec
                    ? `👉 Đang chọn [${selectedRec.hoten}]: Bấm trực tiếp vào giường trống bên dưới để xếp ngay!`
                    : ``
                }
              </span>
            </span>
            <button type="button" class="btn-bed-mini" id="btn-tk1-auto-assign-empty" style="background:#fef3c7;border-color:#f59e0b;color:#92400e;">
              ⚡ Xếp tự động vào giường trống
            </button>
          </div>
          <div class="tk1-unassigned-list">
            ${unassignedPatients.map(rec => {
              const isSelectedQuick = quickAssignSelectedMabn === rec.mabn;
              return `
                <div class="tk1-unassigned-chip ${isSelectedQuick ? 'selected-for-assign' : ''}">
                  <span
                    style="cursor:pointer;"
                    title="Bấm để chọn nhanh rồi click vào giường trống bên dưới"
                    data-quick-select-unassigned="${rec.mabn}"
                  >
                    👤 ${rec.hoten} <span style="color:#64748b;font-weight:600;">(${rec.tuoi})</span>
                  </span>
                  <button
                    type="button"
                    class="btn-chip-pick-bed"
                    data-open-visual-bed-picker="${rec.mabn}"
                  >
                    Chọn giường
                  </button>
                  <button
                    type="button"
                    class="btn-chip-del-mini"
                    title="Xoá (Chuyển mổ / Chuyển phòng)"
                    data-delete-unassigned-mabn="${rec.mabn}"
                  >✕</button>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      `);
    }

    // Cảnh báo 2: Bệnh nhân đang nằm giường nhưng không còn trong Excel mới nhất
    if (missingFromExcelPatients.length > 0) {
      blocks.push(`
        <div class="tk1-alert-box alert-missing-excel" style="padding:0.65rem 0.95rem;">
          <div class="tk1-alert-header" style="margin-bottom:0.45rem;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;">
            <span>🚨 Không còn trong Excel mới nhất (${missingFromExcelPatients.length} BN):</span>
            <button
              type="button"
              class="btn-bed-mini"
              id="btn-release-all-missing-beds"
              style="background:#be123c;color:#ffffff;border-color:#9f1239;font-weight:700;padding:3px 10px;"
              title="Giải phóng tất cả các giường của bệnh nhân không còn trong Excel"
            >
              🗑️ Xoá tất cả khỏi giường (${missingFromExcelPatients.length} BN)
            </button>
          </div>
          <div class="tk1-unassigned-list">
            ${missingFromExcelPatients.map(({ bedCode, rec }) => `
              <div class="tk1-unassigned-chip" style="border-color:#fda4af;">
                <span><strong>${formatBedLabel(bedCode)}:</strong> ${rec.hoten} (${rec.tuoi})</span>
                <button
                  type="button"
                  class="btn-chip-pick-bed"
                  style="background:#e11d48;"
                  data-missing-excel-decision="REMOVE_FROM_BED"
                  data-missing-mabn="${rec.mabn}"
                >
                  Giải phóng giường
                </button>
                <button
                  type="button"
                  class="btn-bed-mini"
                  data-missing-excel-decision="KEEP_ON_BED"
                  data-missing-mabn="${rec.mabn}"
                >
                  ✓ Giữ lại
                </button>
              </div>
            `).join('')}
          </div>
        </div>
      `);
    }

    alertContainer.innerHTML = blocks.join('');

    const undoBtn = document.getElementById('btn-tk1-undo-delete');
    if (undoBtn) {
      undoBtn.addEventListener('click', () => callTk1Api({ action: 'UNDO_DELETE' }));
    }

    const dismissUndoBtn = document.getElementById('btn-tk1-dismiss-undo');
    if (dismissUndoBtn) {
      dismissUndoBtn.addEventListener('click', async () => {
        delete tk1State.lastDeletedAction;
        renderTk1Workspace();
        await callTk1Api({ action: 'DISMISS_UNDO_DELETE' });
      });
    }

    alertContainer.querySelectorAll('[data-restore-removed-mabn]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const mabn = btn.getAttribute('data-restore-removed-mabn');
        if (mabn) {
          await callTk1Api({ action: 'RESTORE_REMOVED_PATIENT', mabn });
        }
      });
    });

    const btnReleaseAllMissing = document.getElementById('btn-release-all-missing-beds');
    if (btnReleaseAllMissing) {
      btnReleaseAllMissing.addEventListener('click', async () => {
        const missingMabns = missingFromExcelPatients.map(x => x.rec.mabn);
        await callTk1Api({ action: 'RELEASE_ALL_MISSING_EXCEL_PATIENTS', mabns: missingMabns });
      });
    }

    const autoBtn = document.getElementById('btn-tk1-auto-assign-empty');
    if (autoBtn) {
      autoBtn.addEventListener('click', async () => {
        const { wingB } = getCurrentRoomConfig();
        const maxBed = wingB[1];
        for (const rec of unassignedPatients) {
          let freeBed = null;
          for (let b = 1; b <= maxBed; b++) {
            if (!tk1State.bedAssignments[String(b)]) {
              freeBed = String(b);
              break;
            }
          }
          if (!freeBed) {
            for (let b = 1; b <= maxBed; b++) {
              if (!tk1State.bedAssignments[`${b}X`]) {
                freeBed = `${b}X`;
                break;
              }
            }
          }
          if (freeBed) {
            await callTk1Api({ action: 'ASSIGN_OR_MOVE_BED', mabn: rec.mabn, targetBedCode: freeBed });
          }
        }
      });
    }

    alertContainer.querySelectorAll('[data-quick-select-unassigned]').forEach(el => {
      el.addEventListener('click', () => {
        const m = el.getAttribute('data-quick-select-unassigned');
        quickAssignSelectedMabn = quickAssignSelectedMabn === m ? null : m;
        renderTk1Workspace();
      });
    });

    alertContainer.querySelectorAll('[data-open-visual-bed-picker]').forEach(btn => {
      btn.addEventListener('click', () => {
        const mabn = btn.getAttribute('data-open-visual-bed-picker');
        openMoveOrSwapBedDialog(mabn);
      });
    });

    alertContainer.querySelectorAll('[data-delete-unassigned-mabn]').forEach(btn => {
      btn.addEventListener('click', () => {
        const mabn = btn.getAttribute('data-delete-unassigned-mabn');
        callTk1Api({ action: 'DELETE_PATIENT', mabn, reason: 'Chuyển mổ / Chuyển phòng' });
      });
    });

    alertContainer.querySelectorAll('[data-missing-excel-decision]').forEach(btn => {
      btn.addEventListener('click', () => {
        const mabn = btn.getAttribute('data-missing-mabn');
        const decision = btn.getAttribute('data-missing-excel-decision');
        callTk1Api({ action: 'HANDLE_MISSING_EXCEL_PATIENT', mabn, decision });
      });
    });
  }

  function renderTk1Workspace() {
    checkClientSideMorningRelease();
    renderTk1TopAlerts();

    const curDate = getSelectedDateKey();
    document.querySelectorAll('.ward-date-selector').forEach(inp => {
      if (inp.value !== curDate) {
        inp.value = curDate;
      }
    });

    const excelTimeEl = document.getElementById('tk1-excel-time-text');
    if (excelTimeEl) {
      excelTimeEl.textContent = tk1State.lastExcelUploadTime || 'Chưa có thông tin';
    }

    const { wingA, wingB } = getCurrentRoomConfig();
    const [startA, endA] = wingA;
    const [startB, endB] = wingB;
    const totalBedsA = endA - startA + 1;
    const totalBedsB = endB - startB + 1;

    const wingATitle = document.getElementById('tk1-wing-a-title');
    const wingBTitle = document.getElementById('tk1-wing-b-title');
    if (wingATitle) {
      wingATitle.textContent = `DÃY A — GIƯỜNG ${String(startA).padStart(2, '0')} ĐẾN ${String(endA).padStart(2, '0')}`;
    }
    if (wingBTitle) {
      wingBTitle.textContent = `DÃY B — GIƯỜNG ${String(startB).padStart(2, '0')} ĐẾN ${String(endB).padStart(2, '0')}`;
    }

    let countMainA = 0, countFoldA = 0;
    for (let i = startA; i <= endA; i++) {
      if (tk1State.bedAssignments[String(i)]) countMainA++;
      if (tk1State.bedAssignments[`${i}X`]) countFoldA++;
    }
    let countMainB = 0, countFoldB = 0;
    for (let i = startB; i <= endB; i++) {
      if (tk1State.bedAssignments[String(i)]) countMainB++;
      if (tk1State.bedAssignments[`${i}X`]) countFoldB++;
    }

    const wingASub = document.getElementById('tk1-wing-a-sub');
    const wingBSub = document.getElementById('tk1-wing-b-sub');
    if (wingASub) {
      wingASub.textContent = `Đang nằm: ${countMainA}/${totalBedsA}${countFoldA > 0 ? ` (+${countFoldA} xếp)` : ''} · Trống: ${totalBedsA - countMainA}`;
    }
    if (wingBSub) {
      wingBSub.textContent = `Đang nằm: ${countMainB}/${totalBedsB}${countFoldB > 0 ? ` (+${countFoldB} xếp)` : ''} · Trống: ${totalBedsB - countMainB}`;
    }

    const wingABody = document.getElementById('tk1-wing-a-body');
    const wingBBody = document.getElementById('tk1-wing-b-body');

    if (wingABody) {
      const listA = [];
      for (let i = startA; i <= endA; i++) listA.push(renderBedPairHtml(i));
      wingABody.innerHTML = listA.join('');
    }
    if (wingBBody) {
      const listB = [];
      for (let i = startB; i <= endB; i++) listB.push(renderBedPairHtml(i));
      wingBBody.innerHTML = listB.join('');
    }

    const slotEl = document.getElementById('ward-shared-workspace-dom') || document.getElementById('feature-slot-tk1');
    if (slotEl) {
      slotEl.querySelectorAll('[data-empty-bed]').forEach(emptyCard => {
        emptyCard.addEventListener('click', async () => {
          const targetBedCode = emptyCard.getAttribute('data-empty-bed');
          if (quickAssignSelectedMabn) {
            const m = quickAssignSelectedMabn;
            quickAssignSelectedMabn = null;
            await callTk1Api({ action: 'ASSIGN_OR_MOVE_BED', mabn: m, targetBedCode });
          } else {
            openAssignPatientToBedPrompt(targetBedCode);
          }
        });
      });

      slotEl.querySelectorAll('[data-patient-card-mabn]').forEach(card => {
        card.addEventListener('click', () => {
          const mabn = card.getAttribute('data-patient-card-mabn');
          openPatientModal(mabn);
        });
      });

      slotEl.querySelectorAll('[data-toggle-fold-bed]').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const num = btn.getAttribute('data-toggle-fold-bed');
          const hide = btn.getAttribute('data-fold-hide') === '1';
          callTk1Api({ action: 'TOGGLE_FOLDING_BED_VISIBILITY', mainBedNum: num, hidden: hide });
        });
      });

      slotEl.querySelectorAll('[data-open-assign-to-bed]').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const targetBedCode = btn.getAttribute('data-open-assign-to-bed');
          if (quickAssignSelectedMabn) {
            const m = quickAssignSelectedMabn;
            quickAssignSelectedMabn = null;
            callTk1Api({ action: 'ASSIGN_OR_MOVE_BED', mabn: m, targetBedCode });
          } else {
            openAssignPatientToBedPrompt(targetBedCode);
          }
        });
      });

      slotEl.querySelectorAll('[data-quick-move-mabn]').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const mabn = btn.getAttribute('data-quick-move-mabn');
          openMoveOrSwapBedDialog(mabn);
        });
      });
    }

    renderTk1SummaryTabs();
  }

  function openAssignPatientToBedPrompt(targetBedCode) {
    const dlg = document.getElementById('tk1-bed-move-dialog');
    const titleEl = document.getElementById('tk1-bed-move-title');
    const bodyEl = document.getElementById('tk1-bed-move-body');
    if (!dlg || !titleEl || !bodyEl) return;

    titleEl.textContent = `Chọn bệnh nhân xếp vào ${formatBedLabel(targetBedCode)}`;
    const allActivePatients = Object.values(tk1State.patientRecords || {})
      .filter(r => !r.removed?.isRemoved);

    let isAssignedCollapsed = true;

    function renderAssignDialog(searchTerm = '') {
      const term = searchTerm.toLowerCase().trim();
      const filtered = allActivePatients.filter(p => !term || (p.hoten && p.hoten.toLowerCase().includes(term)));

      const unassignedList = filtered
        .filter(p => !getBedOfPatient(p.mabn))
        .sort((a, b) => a.hoten.localeCompare(b.hoten, 'vi'));

      const assignedList = filtered
        .filter(p => Boolean(getBedOfPatient(p.mabn)))
        .sort((a, b) => {
          const bedA = getBedOfPatient(a.mabn);
          const bedB = getBedOfPatient(b.mabn);
          return bedA.localeCompare(bedB, undefined, { numeric: true });
        });

      const showAssigned = term.length > 0 ? true : !isAssignedCollapsed;

      bodyEl.innerHTML = `
        <div style="margin-bottom:0.75rem;">
          <input
            type="text"
            id="tk1-assign-search-input"
            value="${searchTerm.replace(/"/g, '&quot;')}"
            placeholder="🔍 Tìm kiếm bệnh nhân theo tên..."
            style="width:100%;height:38px;padding:6px 12px;border:1.5px solid #94a3b8;border-radius:8px;font-size:0.86rem;font-weight:600;font-family:'Be Vietnam Pro',sans-serif;outline:none;"
          />
        </div>

        <div style="font-size:0.83rem;color:#475569;margin-bottom:0.6rem;">
          Bấm chọn 1 bệnh nhân để xếp ngay vào <strong>${formatBedLabel(targetBedCode)}</strong>:
        </div>

        <!-- PHẦN 1: BỆNH NHÂN CHƯA CÓ GIƯỜNG (LUÔN MỞ, NỔI BẬT) -->
        <div style="margin-bottom:1rem;">
          <div style="font-size:0.85rem;font-weight:800;color:#1e40af;margin-bottom:0.45rem;display:flex;align-items:center;gap:6px;">
            <span>⚠️ Bệnh nhân chưa có giường (${unassignedList.length} BN)</span>
          </div>
          ${
            unassignedList.length > 0
              ? `<div style="display:flex;flex-wrap:wrap;gap:0.45rem;max-height:35vh;overflow-y:auto;">
                  ${unassignedList.map(p => `
                    <button
                      type="button"
                      class="tk1-unassigned-chip"
                      style="cursor:pointer;border-color:#2563eb;background:#eff6ff;"
                      data-pick-patient-for-bed="${p.mabn}"
                    >
                      <span><strong>${p.hoten}</strong> (${p.tuoi})</span>
                      <span class="btn-chip-pick-bed" style="background:#004aad;">Chưa có giường</span>
                    </button>
                  `).join('')}
                </div>`
              : `<div style="font-size:0.8rem;color:#64748b;font-style:italic;padding:4px 0;">Không có bệnh nhân nào chưa có giường${term ? ' khớp từ khoá' : ''}.</div>`
          }
        </div>

        <!-- PHẦN 2: BỆNH NHÂN ĐÃ CÓ GIƯỜNG (THƯỜNG XUYÊN THU GỌN, BẤM ĐỂ MỞ) -->
        <div style="border-top:1px solid #e2e8f0;padding-top:0.75rem;">
          <button
            type="button"
            id="btn-toggle-assigned-section"
            style="width:100%;display:flex;align-items:center;justify-content:space-between;background:#f8fafc;border:1px solid #cbd5e1;border-radius:8px;padding:8px 12px;cursor:pointer;font-family:'Be Vietnam Pro',sans-serif;font-size:0.83rem;font-weight:700;color:#334155;"
          >
            <span>🛏️ Đã có giường (${assignedList.length} BN — Đổi sang ${formatBedLabel(targetBedCode)})</span>
            <span style="font-size:0.8rem;color:#64748b;">${showAssigned ? '▾ Thu gọn' : '▸ Bấm để mở rộng'}</span>
          </button>
          
          <div id="tk1-assign-assigned-wrap" style="display:${showAssigned ? 'flex' : 'none'};flex-wrap:wrap;gap:0.45rem;margin-top:0.6rem;max-height:35vh;overflow-y:auto;padding:2px;">
            ${
              assignedList.length > 0
                ? assignedList.map(p => {
                    const curBed = getBedOfPatient(p.mabn);
                    return `
                      <button
                        type="button"
                        class="tk1-unassigned-chip"
                        style="cursor:pointer;border-color:#cbd5e1;background:#f8fafc;"
                        data-pick-patient-for-bed="${p.mabn}"
                      >
                        <span><strong>${p.hoten}</strong> (${p.tuoi})</span>
                        <span class="btn-chip-pick-bed" style="background:#64748b;">${formatBedLabel(curBed)}</span>
                      </button>
                    `;
                  }).join('')
                : `<div style="font-size:0.8rem;color:#64748b;font-style:italic;padding:4px 0;">Không có bệnh nhân nào${term ? ' khớp từ khoá' : ''}.</div>`
            }
          </div>
        </div>
      `;

      const searchInp = document.getElementById('tk1-assign-search-input');
      if (searchInp) {
        searchInp.focus();
        searchInp.selectionStart = searchInp.selectionEnd = searchInp.value.length;
        searchInp.addEventListener('input', (e) => {
          renderAssignDialog(e.target.value);
        });
      }

      const toggleBtn = document.getElementById('btn-toggle-assigned-section');
      if (toggleBtn) {
        toggleBtn.addEventListener('click', () => {
          isAssignedCollapsed = !isAssignedCollapsed;
          renderAssignDialog(document.getElementById('tk1-assign-search-input')?.value || '');
        });
      }

      bodyEl.querySelectorAll('[data-pick-patient-for-bed]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const selMabn = btn.getAttribute('data-pick-patient-for-bed');
          await callTk1Api({ action: 'ASSIGN_OR_MOVE_BED', mabn: selMabn, targetBedCode });
          dlg.close();
        });
      });
    }

    renderAssignDialog('');
    dlg.showModal();
  }

  // BOX CHỌN GIƯỜNG TRỰC QUAN: Bỏ chữ "Giường", chỉ giữ lại số (1..maxBed) và nút "+ xếp"
  function renderVisualBedTileHtml(bedNum, currentMabn) {
    const mainCode = String(bedNum);
    const foldCode = `${bedNum}X`;
    const occMabn = tk1State.bedAssignments[mainCode];
    const occRec = occMabn ? tk1State.patientRecords[occMabn] : null;
    const foldMabn = tk1State.bedAssignments[foldCode];
    const foldRec = foldMabn ? tk1State.patientRecords[foldMabn] : null;
    const isSelf = occMabn === currentMabn;

    let tileCls = 'vbed-empty';
    let subText = '🟢 Trống';
    if (isSelf) {
      tileCls = 'vbed-self';
      subText = '✓ Đang nằm';
    } else if (occRec) {
      const dStatus = occRec.discharge?.status;
      if (dStatus === 'MORNING_DISCHARGE' || dStatus === 'SCHEDULED') {
        tileCls = 'vbed-discharging';
        subText = `🟠 ${occRec.hoten}`;
      } else {
        tileCls = 'vbed-occupied';
        subText = `⇄ ${occRec.hoten}`;
      }
    }

    const foldBtnLabel = foldRec
      ? `+ xếp (${foldRec.hoten.split(' ').pop()})`
      : `+ xếp`;

    return `
      <div class="tk1-vbed-tile ${tileCls}" data-vbed-select="${mainCode}">
        <div class="vbed-num-row">
          <span class="vbed-num">${bedNum}</span>
          <button
            type="button"
            class="vbed-fold-btn"
            title="Chọn giường xếp ${bedNum}"
            data-vbed-select-fold="${foldCode}"
          >
            ${foldBtnLabel}
          </button>
        </div>
        <div class="vbed-occ-name">${subText}</div>
      </div>
    `;
  }

  function openMoveOrSwapBedDialog(mabn) {
    const rec = tk1State.patientRecords[mabn];
    if (!rec) return;
    const curBed = getBedOfPatient(mabn);

    const dlg = document.getElementById('tk1-bed-move-dialog');
    const titleEl = document.getElementById('tk1-bed-move-title');
    const bodyEl = document.getElementById('tk1-bed-move-body');
    if (!dlg || !titleEl || !bodyEl) return;

    titleEl.textContent = `Chọn giường: ${rec.hoten} (${curBed ? formatBedLabel(curBed) : 'Chưa phân giường'})`;

    const { wingA, wingB } = getCurrentRoomConfig();
    const [startA, endA] = wingA;
    const [startB, endB] = wingB;

    const tilesA = [];
    for (let i = startA; i <= endA; i++) tilesA.push(renderVisualBedTileHtml(i, mabn));
    const tilesB = [];
    for (let i = startB; i <= endB; i++) tilesB.push(renderVisualBedTileHtml(i, mabn));

    bodyEl.innerHTML = `
      <div style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:0.5rem;margin-bottom:0.65rem;font-size:0.8rem;color:#334155;">
        <div>
          <span style="background:#dcfce7;color:#166534;padding:2px 8px;border-radius:6px;font-weight:700;">🟢 Trống</span>
          <span style="background:#dbeafe;color:#1e40af;padding:2px 8px;border-radius:6px;font-weight:700;margin-left:4px;">🔵 Đổi giường</span>
          <span style="background:#f3e8ff;color:#6d28d9;padding:2px 8px;border-radius:6px;font-weight:700;margin-left:4px;">🟣 + xếp</span>
        </div>
        ${
          curBed
            ? `<button type="button" class="btn-delete-transfer" id="btn-unassign-bed-now" style="font-size:0.75rem;padding:0.3rem 0.65rem;">
                Đưa về DS chưa phân giường
              </button>`
            : ''
        }
      </div>

      <div class="tk1-vbed-wings-wrap">
        <div class="tk1-vbed-wing-box">
          <div class="tk1-vbed-wing-title">
            <span>Dãy A (${startA} – ${endA})</span>
          </div>
          <div class="tk1-vbed-grid grid-wing-a">
            ${tilesA.join('')}
          </div>
        </div>

        <div class="tk1-vbed-wing-box">
          <div class="tk1-vbed-wing-title" style="color:#0f766e;">
            <span>Dãy B (${startB} – ${endB})</span>
          </div>
          <div class="tk1-vbed-grid grid-wing-b">
            ${tilesB.join('')}
          </div>
        </div>
      </div>
    `;

    const btnUnassign = document.getElementById('btn-unassign-bed-now');
    if (btnUnassign) {
      btnUnassign.onclick = async () => {
        await callTk1Api({ action: 'UNASSIGN_BED', mabn });
        dlg.close();
      };
    }

    bodyEl.querySelectorAll('[data-vbed-select-fold]').forEach(fBtn => {
      fBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const foldCode = fBtn.getAttribute('data-vbed-select-fold');
        await callTk1Api({ action: 'ASSIGN_OR_MOVE_BED', mabn, targetBedCode: foldCode });
        dlg.close();
      });
    });

    bodyEl.querySelectorAll('[data-vbed-select]').forEach(tile => {
      tile.addEventListener('click', async () => {
        const targetBedCode = tile.getAttribute('data-vbed-select');
        await callTk1Api({ action: 'ASSIGN_OR_MOVE_BED', mabn, targetBedCode });
        dlg.close();
      });
    });

    dlg.showModal();
  }

  function getOrderedOccupiedBedEntries() {
    const entries = [];
    const { wingB } = getCurrentRoomConfig();
    const maxBed = wingB[1];
    for (let i = 1; i <= maxBed; i++) {
      for (const code of [String(i), `${i}X`]) {
        const m = tk1State.bedAssignments && tk1State.bedAssignments[code];
        if (m && tk1State.patientRecords && tk1State.patientRecords[m]) {
          entries.push({ bedCode: code, mabn: m, rec: tk1State.patientRecords[m] });
        }
      }
    }
    return entries;
  }

  async function navigateModalBed(direction) {
    if (!activeModalMabn) return;
    await saveCurrentModalPatientRound();
    const entries = getOrderedOccupiedBedEntries();
    if (entries.length === 0) return;
    const curIdx = entries.findIndex(e => e.mabn === activeModalMabn);
    let targetIdx = 0;
    if (curIdx >= 0) {
      targetIdx = (curIdx + direction + entries.length) % entries.length;
    }
    const targetEntry = entries[targetIdx];
    if (targetEntry) {
      openPatientModal(targetEntry.mabn);
    }
  }

  function renderModalExtraRoomTasksBar() {
    const barEl = document.getElementById('tk2-extra-tasks-bar');
    if (!barEl) return;
    const { extraTasks } = getCurrentRoomConfig();
    if (!Array.isArray(extraTasks) || extraTasks.length === 0) {
      barEl.style.display = 'none';
      barEl.innerHTML = '';
      return;
    }
    barEl.style.display = 'flex';
    const selectedSet = new Set(modalDraftTasks.thuThuat || []);
    barEl.innerHTML = `
      <span style="font-size:0.79rem;font-weight:800;color:#0f766e;margin-right:4px;">
        🩹 Thủ thuật (Thần kinh 2):
      </span>
      ${extraTasks.map(taskName => {
        const isActive = selectedSet.has(taskName);
        return `
          <button
            type="button"
            data-toggle-tk2-extra-task="${taskName}"
            style="border:1.5px solid ${isActive ? '#0d9488' : '#99f6e4'};background:${isActive ? '#0d9488' : '#ffffff'};color:${isActive ? '#ffffff' : '#0f766e'};border-radius:999px;padding:4px 12px;font-size:0.78rem;font-weight:800;cursor:pointer;font-family:'Be Vietnam Pro',sans-serif;transition:all 0.15s;"
          >
            ${isActive ? '✓ ' : '+ '}${taskName}
          </button>
        `;
      }).join('')}
    `;

    barEl.querySelectorAll('[data-toggle-tk2-extra-task]').forEach(btn => {
      btn.addEventListener('click', () => {
        const val = btn.getAttribute('data-toggle-tk2-extra-task');
        const arr = modalDraftTasks.thuThuat || [];
        if (arr.includes(val)) {
          modalDraftTasks.thuThuat = arr.filter(x => x !== val);
        } else {
          modalDraftTasks.thuThuat = [...arr, val];
        }
        renderModalExtraRoomTasksBar();
        renderModalSelectedTasksPills();
      });
    });
  }

  const MULTI_DD_CATS = [
    { cat: 'xetNghiem', defaultTitle: '🧪 Xét nghiệm', wrapId: 'wrap-dd-xetNghiem', titleId: 'title-dd-xetNghiem', popoverId: 'popover-dd-xetNghiem' },
    { cat: 'ct',        defaultTitle: '🧠 CTScan',     wrapId: 'wrap-dd-ct',        titleId: 'title-dd-ct',        popoverId: 'popover-dd-ct' },
    { cat: 'xquang',    defaultTitle: '🦴 XQ / SA',    wrapId: 'wrap-dd-xquang',    titleId: 'title-dd-xquang',    popoverId: 'popover-dd-xquang' },
    { cat: 'hoiChan',   defaultTitle: '👨‍⚕️ Hội chẩn',   wrapId: 'wrap-dd-hoiChan',   titleId: 'title-dd-hoiChan',   popoverId: 'popover-dd-hoiChan' }
  ];

  function updateMultiDdPopoversAndTitles() {
    for (const item of MULTI_DD_CATS) {
      const { cat, defaultTitle, titleId, popoverId } = item;
      const titleEl = document.getElementById(titleId);
      const popoverEl = document.getElementById(popoverId);
      if (!titleEl || !popoverEl) continue;

      const opts = TK1_QUICK_OPTIONS[cat] || [];
      const currentSelected = modalDraftTasks[cat] || [];
      const count = currentSelected.length;

      titleEl.textContent = count > 0 ? `${defaultTitle} (${count})` : defaultTitle;

      popoverEl.innerHTML = opts.map(opt => {
        let isChecked = false;
        if (cat === 'xquang' && opt === 'X-quang xương chi') {
          isChecked = currentSelected.some(x => x.startsWith('X-quang xương chi'));
        } else if (cat === 'xetNghiem' && opt === 'Khác') {
          const std = opts.filter(x => x !== 'Khác');
          isChecked = currentSelected.some(x => !std.includes(x));
        } else {
          isChecked = currentSelected.includes(opt);
        }

        return `
          <label style="display:flex;align-items:center;gap:8px;padding:6px 9px;border-radius:6px;font-size:0.81rem;font-weight:600;color:#1e293b;cursor:pointer;user-select:none;transition:background 0.15s ease;" onmouseover="this.style.background='#f1f5f9'" onmouseout="this.style.background='transparent'">
            <input
              type="checkbox"
              data-multi-opt-cat="${cat}"
              value="${opt.replace(/"/g, '&quot;')}"
              ${isChecked ? 'checked' : ''}
              style="width:15px;height:15px;accent-color:#2563eb;cursor:pointer;"
            />
            <span>${opt}</span>
          </label>
        `;
      }).join('');

      popoverEl.querySelectorAll('input[type="checkbox"]').forEach(chk => {
        chk.addEventListener('change', () => {
          const optVal = chk.value;
          const checked = chk.checked;
          handleMultiDdOptionToggle(cat, optVal, checked);
        });
      });
    }
  }

  function handleMultiDdOptionToggle(cat, optVal, checked) {
    if (!modalDraftTasks[cat]) modalDraftTasks[cat] = [];

    if (cat === 'xquang' && optVal === 'X-quang xương chi') {
      const wrap = document.getElementById('tk1-custom-xq-wrap');
      const inp = document.getElementById('tk1-custom-xq-input');
      if (checked) {
        if (wrap) wrap.style.display = 'flex';
        const cur = (modalDraftTasks.xquang || []).find(x => x.startsWith('X-quang xương chi'));
        if (!cur) {
          modalDraftTasks.xquang.push('X-quang xương chi');
        }
        if (inp) inp.focus();
      } else {
        modalDraftTasks.xquang = (modalDraftTasks.xquang || []).filter(x => !x.startsWith('X-quang xương chi'));
        if (wrap) wrap.style.display = 'none';
        if (inp) inp.value = '';
      }
    } else if (cat === 'xetNghiem' && optVal === 'Khác') {
      const wrap = document.getElementById('tk1-custom-xn-wrap');
      const inp = document.getElementById('tk1-custom-xn-input');
      const stdOpts = (TK1_QUICK_OPTIONS.xetNghiem || []).filter(x => x !== 'Khác');
      if (checked) {
        if (wrap) wrap.style.display = 'flex';
        if (inp) inp.focus();
      } else {
        modalDraftTasks.xetNghiem = (modalDraftTasks.xetNghiem || []).filter(x => stdOpts.includes(x));
        if (wrap) wrap.style.display = 'none';
        if (inp) inp.value = '';
      }
    } else {
      if (checked) {
        if (!modalDraftTasks[cat].includes(optVal)) {
          modalDraftTasks[cat].push(optVal);
        }
      } else {
        modalDraftTasks[cat] = modalDraftTasks[cat].filter(x => x !== optVal);
      }
    }

    renderModalSelectedTasksPills();
    updateMultiDdPopoversAndTitles();
  }

  function openPatientModal(mabn) {
    const rec = tk1State.patientRecords[mabn];
    if (!rec) return;
    activeModalMabn = mabn;

    const curDateKey = getSelectedDateKey();
    const curBed = getBedOfPatient(mabn);
    const existingToday = (rec.tasksByDate && rec.tasksByDate[curDateKey]) || {};

    modalDraftTasks = {
      xetNghiem: [...(existingToday.xetNghiem || [])],
      ct: [...(existingToday.ct || [])],
      xquang: [...(existingToday.xquang || [])],
      sieuAm: [...(existingToday.sieuAm || [])],
      hoiChan: [...(existingToday.hoiChan || [])],
      thuThuat: [...(existingToday.thuThuat || [])],
      note: existingToday.note || ''
    };

    document.getElementById('tk1-modal-patient-title').textContent = `${formatBedLabel(curBed)} — ${rec.hoten} (${rec.tuoi}) · 📅 ${formatDateDisplayVN(curDateKey)}`;

    // Cập nhật nhãn nút Lui / Tới hiển thị số giường trước & sau
    const entries = getOrderedOccupiedBedEntries();
    const curIdx = entries.findIndex(e => e.mabn === mabn);
    const btnPrev = document.getElementById('btn-tk1-modal-prev-bed');
    const btnNext = document.getElementById('btn-tk1-modal-next-bed');
    if (btnPrev && btnNext) {
      if (entries.length > 1 && curIdx >= 0) {
        const prevEntry = entries[(curIdx - 1 + entries.length) % entries.length];
        const nextEntry = entries[(curIdx + 1) % entries.length];
        btnPrev.textContent = `◀ Lui (${formatBedLabel(prevEntry.bedCode)})`;
        btnPrev.title = `Lui về giường ${formatBedLabel(prevEntry.bedCode)} — ${prevEntry.rec.hoten}`;
        btnNext.textContent = `Tới (${formatBedLabel(nextEntry.bedCode)}) ▶`;
        btnNext.title = `Tới giường ${formatBedLabel(nextEntry.bedCode)} — ${nextEntry.rec.hoten}`;
        btnPrev.style.display = 'inline-flex';
        btnNext.style.display = 'inline-flex';
      } else {
        btnPrev.textContent = `◀ Lui`;
        btnNext.textContent = `Tới ▶`;
      }
    }

    // 1. Khối hành chính chỉ giữ lại: Mã KCB, Tên, Tuổi, Địa chỉ, Đối tượng BHYT hay không (gọn gàng)
    const hasBhyt = Boolean(
      rec.soTheBhyt ||
      String(rec.doiTuong || '').toUpperCase().includes('BHYT')
    );
    const bhytBadge = hasBhyt
      ? `<span style="background:#dcfce7;color:#15803d;border:1px solid #86efac;padding:2px 8px;border-radius:999px;font-weight:800;font-size:0.76rem;">Có BHYT</span>`
      : `<span style="background:#fef3c7;color:#b45309;border:1px solid #fde68a;padding:2px 8px;border-radius:999px;font-weight:800;font-size:0.76rem;">Không BHYT</span>`;

    document.getElementById('tk1-modal-admin-info').innerHTML = `
      <div><span style="color:#64748b;">Mã KCB:</span> <strong style="color:#004aad;">${rec.maKcb || rec.madieutri || rec.mabn || '--'}</strong></div>
      <div><span style="color:#64748b;">Tên:</span> <strong>${rec.hoten}</strong></div>
      <div><span style="color:#64748b;">Tuổi:</span> <strong>${rec.tuoi}</strong></div>
      <div><span style="color:#64748b;">Đối tượng:</span> ${bhytBadge}</div>
      <div style="flex:1 1 100%;border-top:1px dashed #e2e8f0;padding-top:5px;">
        <span style="color:#64748b;">Địa chỉ:</span> <strong>${rec.diaChi || '--'}</strong>
      </div>
    `;

    document.getElementById('tk1-modal-diagnosis-input').value = rec.customDiagnosis || rec.chanDoanHis || '';

    // Khởi tạo ô nhập liệu phụ nếu BN đã có XQ xương chi hoặc XN khác
    const customXnWrap = document.getElementById('tk1-custom-xn-wrap');
    const customXqWrap = document.getElementById('tk1-custom-xq-wrap');
    const inpCustomXn = document.getElementById('tk1-custom-xn-input');
    const inpCustomXq = document.getElementById('tk1-custom-xq-input');

    const xqItem = (modalDraftTasks.xquang || []).find(x => x.startsWith('X-quang xương chi'));
    if (xqItem) {
      if (customXqWrap) customXqWrap.style.display = 'flex';
      const m = xqItem.match(/\((.*?)\)/);
      if (inpCustomXq) inpCustomXq.value = m ? m[1] : '';
    } else {
      if (customXqWrap) customXqWrap.style.display = 'none';
      if (inpCustomXq) inpCustomXq.value = '';
    }

    const stdXn = (TK1_QUICK_OPTIONS.xetNghiem || []).filter(x => x !== 'Khác');
    const customXnVal = (modalDraftTasks.xetNghiem || []).find(x => !stdXn.includes(x));
    if (customXnVal) {
      if (customXnWrap) customXnWrap.style.display = 'flex';
      if (inpCustomXn) inpCustomXn.value = customXnVal;
    } else {
      if (customXnWrap) customXnWrap.style.display = 'none';
      if (inpCustomXn) inpCustomXn.value = '';
    }

    updateMultiDdPopoversAndTitles();

    // 3. Khối lịch sử: Đổi tên "Lần đi buồng gần nhất:" thành "Lịch sử đi buồng: các nhãn công việc gần nhất + nhãn thời gian"
    const recentHist = getMostRecentHistorySummary(rec);
    const histBox = document.getElementById('tk1-modal-history-box');
    if (recentHist) {
      histBox.innerHTML = `
        <div style="display:flex;flex-wrap:wrap;align-items:center;gap:6px;">
          <strong style="color:#0f172a;font-size:0.84rem;">🕒 Lịch sử đi buồng:</strong>
          ${recentHist.items.length > 0 ? recentHist.items.map(i => `<span class="tk1-task-pill pill-xn">${i}</span>`).join('') : ''}
          <span style="background:#dbeafe;color:#1e40af;border:1px solid #93c5fd;border-radius:999px;padding:2px 9px;font-size:0.74rem;font-weight:800;">
            ⏱️ ${recentHist.relativeLabel}
          </span>
        </div>
        ${recentHist.note ? `<div style="margin-top:4px;font-size:0.81rem;color:#475569;">Ghi chú: <em>${recentHist.note}</em></div>` : ''}
      `;
    } else {
      histBox.innerHTML = `
        <div style="display:flex;align-items:center;gap:6px;font-size:0.82rem;color:#64748b;">
          <strong style="color:#0f172a;">🕒 Lịch sử đi buồng:</strong> Chưa có chỉ định ở các ngày trước đó.
        </div>
      `;
    }

    const epKey = rec.episodeKey || rec.maKcb || rec.mabn;
    const curRoomName = tk1State.roomName || 'Thần kinh 1';
    const otherRoomConsults = (globalEpisodeConsultations[epKey] || []).filter(c => c.roomName !== curRoomName);
    const priorConsultEl = document.getElementById('tk1-modal-prior-room-consult');
    if (otherRoomConsults.length > 0) {
      priorConsultEl.style.display = 'block';
      priorConsultEl.innerHTML = `
        <div style="font-size:0.82rem;font-weight:800;color:#0f766e;margin-bottom:4px;">
          🔄 HỘI CHẨN TRƯỚC ĐÓ Ở PHÒNG KHÁC (CÙNG ĐỢT ĐIỀU TRỊ #${epKey}):
        </div>
        ${otherRoomConsults.map(c => `
          <div style="background:#ffffff;border:1px solid #99f6e4;border-radius:8px;padding:6px 10px;font-size:0.81rem;margin-top:4px;">
            <div><strong>Tại phòng: ${c.roomName}</strong> · <span>${formatRelativePastDayLabel(c.dateKey)}</span> · Khoa hội chẩn: <b style="color:#be123c;">${c.specialty}</b></div>
            <div>• <strong>Chẩn đoán hội chẩn:</strong> ${c.consultDiagnosis || '--'}</div>
            <div>• <strong>Xử trí hội chẩn:</strong> ${c.consultTreatment || '--'}</div>
          </div>
        `).join('')}
      `;
    } else {
      priorConsultEl.style.display = 'none';
      priorConsultEl.innerHTML = '';
    }

    renderModalExtraRoomTasksBar();
    renderModalSelectedTasksPills();
    updateModalDischargePreview(rec);

    document.getElementById('tk1-patient-modal').showModal();
  }

  function renderModalSelectedTasksPills() {
    const container = document.getElementById('tk1-modal-selected-tasks');
    if (!container) return;

    const groups = [
      { key: 'xetNghiem', label: '🧪 XN',        cls: 'pill-xn' },
      { key: 'ct',        label: '🧠 CT',        cls: 'pill-ct' },
      { key: 'xquang',    label: '🦴 XQ/SA',     cls: 'pill-xq' },
      { key: 'sieuAm',    label: '📡 SA',        cls: 'pill-sa' },
      { key: 'hoiChan',   label: '👨‍⚕️ Hội chẩn',   cls: 'pill-hc' },
      { key: 'thuThuat',  label: '🩹 Thủ thuật', cls: 'pill-sa' }
    ];

    const htmlParts = [];
    for (const g of groups) {
      for (const item of modalDraftTasks[g.key] || []) {
        const itemLabel = g.key === 'ct' ? formatCtLabel(item) : item;
        htmlParts.push(`
          <span class="tk1-task-pill ${g.cls}" style="padding:4px 10px;font-size:0.78rem;">
            ${g.label}: <b>${itemLabel}</b>
            <button
              type="button"
              style="border:none;background:transparent;cursor:pointer;font-weight:800;margin-left:4px;color:inherit;"
              data-remove-draft-cat="${g.key}"
              data-remove-draft-val="${item.replace(/"/g, '&quot;')}"
            >✕</button>
          </span>
        `);
      }
    }

    container.innerHTML = htmlParts.length > 0
      ? htmlParts.join('')
      : `<span style="font-size:0.8rem;color:#64748b;">Chưa chọn công việc cho ngày được chọn.</span>`;

    container.querySelectorAll('[data-remove-draft-cat]').forEach(btn => {
      btn.addEventListener('click', () => {
        const cat = btn.getAttribute('data-remove-draft-cat');
        const val = btn.getAttribute('data-remove-draft-val');
        modalDraftTasks[cat] = (modalDraftTasks[cat] || []).filter(x => x !== val);

        if (cat === 'xquang' && val.startsWith('X-quang xương chi')) {
          const wrapXq = document.getElementById('tk1-custom-xq-wrap');
          const inpXq = document.getElementById('tk1-custom-xq-input');
          if (wrapXq) wrapXq.style.display = 'none';
          if (inpXq) inpXq.value = '';
        }
        if (cat === 'xetNghiem') {
          const stdOpts = (TK1_QUICK_OPTIONS.xetNghiem || []).filter(x => x !== 'Khác');
          if (!stdOpts.includes(val)) {
            const wrapXn = document.getElementById('tk1-custom-xn-wrap');
            const inpXn = document.getElementById('tk1-custom-xn-input');
            if (wrapXn) wrapXn.style.display = 'none';
            if (inpXn) inpXn.value = '';
          }
        }

        renderModalExtraRoomTasksBar();
        renderModalSelectedTasksPills();
        updateMultiDdPopoversAndTitles();
      });
    });

    const noteInp = document.getElementById('tk1-modal-round-note');
    if (noteInp) noteInp.value = modalDraftTasks.note || '';
  }

  function updateModalDischargePreview(rec) {
    const previewEl = document.getElementById('tk1-modal-discharge-status-bar');
    if (!previewEl || !rec) return;
    const st = rec.discharge?.status || 'NONE';
    const followUpText = formatFollowUpAppointmentText(rec);

    if (st === 'SCHEDULED' || st === 'MORNING_DISCHARGE') {
      const followUpHtml = followUpText && followUpText !== 'Không hẹn tái khám'
        ? `📅 Lời hẹn tái khám: <b>${followUpText}</b>`
        : `<span style="color:#64748b;font-weight:600;">📅 Tái khám: Không hẹn tái khám (chỉ tự động hẹn ca có hội chẩn)</span>`;

      previewEl.style.display = 'flex';
      previewEl.innerHTML = `
        <div>
          <strong>${st === 'MORNING_DISCHARGE' ? '🌅 Trạng thái: XUẤT VIỆN SÁNG NAY (Giữ giường đến 09:00 sáng)' : '🏥 Trạng thái: ĐÃ CHỌN RA VIỆN'}</strong>
          <div style="font-size:0.8rem;margin-top:2px;">
            ${followUpHtml}
          </div>
        </div>
        <div style="display:flex;gap:6px;">
          ${
            st === 'SCHEDULED'
              ? `<button type="button" class="btn-bed-mini" style="background:#fef3c7;border-color:#f59e0b;color:#92400e;" id="btn-modal-switch-morning">🌅 Đặt "Xuất viện sáng nay"</button>`
              : ''
          }
          <button type="button" class="btn-bed-mini" id="btn-modal-cancel-discharge">Huỷ ra viện</button>
        </div>
      `;
      const btnMorning = document.getElementById('btn-modal-switch-morning');
      if (btnMorning) {
        btnMorning.onclick = () => triggerModalDischarge('MORNING_DISCHARGE');
      }
      const btnCancel = document.getElementById('btn-modal-cancel-discharge');
      if (btnCancel) {
        btnCancel.onclick = () => triggerModalDischarge('NONE');
      }
    } else {
      previewEl.style.display = 'none';
      previewEl.innerHTML = '';
    }
  }

  async function saveCurrentModalPatientRound() {
    if (!activeModalMabn) return;
    const rec = tk1State.patientRecords[activeModalMabn] || {};
    const customDiagnosis = document.getElementById('tk1-modal-diagnosis-input').value;

    modalDraftTasks.note = document.getElementById('tk1-modal-round-note').value;

    const curDateKey = getSelectedDateKey();
    // Tự lấy thông tin hội chẩn: chỉ tự động đặt lịch hẹn nếu ca có hội chẩn
    const cd = rec.consultDetails || {};
    const specialty = modalDraftTasks.hoiChan[0] || cd.specialty || '';
    const followUpDays = specialty ? (cd.followUpDays || rec.discharge?.followUpDays || '7') : '';
    const followUpClinic = specialty ? (cd.followUpClinic || getClinicNameForSpecialty(specialty)) : '';

    await callTk1Api({
      action: 'SAVE_PATIENT_ROUND',
      mabn: activeModalMabn,
      dateKey: curDateKey,
      customDiagnosis,
      tasks: modalDraftTasks,
      consultDetails: {
        specialty,
        consultDiagnosis: cd.consultDiagnosis || '',
        consultTreatment: cd.consultTreatment || '',
        followUpDays,
        followUpClinic
      }
    });
  }

  async function triggerModalDischarge(statusMode) {
    if (!activeModalMabn) return;
    await saveCurrentModalPatientRound();
    const rec = tk1State.patientRecords[activeModalMabn] || {};
    const cd = rec.consultDetails || {};
    const specialty = modalDraftTasks.hoiChan[0] || cd.specialty || '';
    const followUpDays = specialty ? (cd.followUpDays || rec.discharge?.followUpDays || '7') : '';
    const followUpClinic = specialty ? (cd.followUpClinic || getClinicNameForSpecialty(specialty)) : '';

    await callTk1Api({
      action: 'SET_DISCHARGE',
      mabn: activeModalMabn,
      status: statusMode,
      followUpDays,
      followUpClinic
    });

    const updatedRec = tk1State.patientRecords[activeModalMabn];
    updateModalDischargePreview(updatedRec);
  }

  function wrapCanvasText(ctx, text, maxWidth) {
    const words = String(text || '').split(/\s+/);
    const lines = [];
    let currentLine = '';
    for (const word of words) {
      const testLine = currentLine ? `${currentLine} ${word}` : word;
      if (ctx.measureText(testLine).width > maxWidth && currentLine) {
        lines.push(currentLine);
        currentLine = word;
      } else {
        currentLine = testLine;
      }
    }
    if (currentLine) lines.push(currentLine);
    return lines.length > 0 ? lines : [''];
  }

  function generateTk1A4PngAndPreview() {
    const curDateKey = getSelectedDateKey();
    const now = new Date();
    const dateStrVN = formatDateDisplayVN(curDateKey);

    const canvasWidth = 1480;
    const minA4Height = 2093;
    const colWidth = 696;
    const leftColX = 36;
    const rightColX = 748;

    const { wingA, wingB } = getCurrentRoomConfig();
    const [startA, endA] = wingA;
    const [startB, endB] = wingB;

    function collectWingItems(startBed, endBed) {
      const items = [];
      for (let i = startBed; i <= endBed; i++) {
        const mainCode = String(i);
        const foldCode = `${i}X`;
        const mRec = tk1State.bedAssignments[mainCode] ? tk1State.patientRecords[tk1State.bedAssignments[mainCode]] : null;
        const fRec = tk1State.bedAssignments[foldCode] ? tk1State.patientRecords[tk1State.bedAssignments[foldCode]] : null;
        const isFoldHidden = Boolean(tk1State.hiddenFoldingBeds && tk1State.hiddenFoldingBeds[mainCode]);

        items.push({ bedCode: mainCode, label: `G.${String(i).padStart(2, '0')}`, isFolding: false, rec: mRec });
        if (fRec && !isFoldHidden) {
          items.push({ bedCode: foldCode, label: `Xếp ${String(i).padStart(2, '0')}`, isFolding: true, rec: fRec });
        }
      }
      return items;
    }

    const wingAItems = collectWingItems(startA, endA);
    const wingBItems = collectWingItems(startB, endB);

    const measureCanvas = document.createElement('canvas');
    const mCtx = measureCanvas.getContext('2d');

    function computeBedBoxLayout(item) {
      const rec = item.rec;
      if (!rec) {
        return { height: 44, taskLines: [], followUpLines: [] };
      }
      mCtx.font = '600 13px "Be Vietnam Pro", sans-serif';

      const t = (rec.tasksByDate && rec.tasksByDate[curDateKey]) || {};
      const taskParts = [
        ...(t.xetNghiem || []).map(x => `[XN] ${x}`),
        ...(t.ct || []).map(x => `[CT] ${formatCtLabel(x)}`),
        ...(t.xquang || []).map(x => `[XQ] ${x}`),
        ...(t.sieuAm || []).map(x => `[SA] ${x}`),
        ...(t.hoiChan || []).map(x => `[HC] ${x}`),
        ...(t.thuThuat || []).map(x => `[TT] ${x}`)
      ];
      if (t.note) taskParts.push(`Ghi chú: ${t.note}`);
      const taskStr = taskParts.length > 0 ? `Công việc: ${taskParts.join('  •  ')}` : '';
      const taskLines = taskStr ? wrapCanvasText(mCtx, taskStr, colWidth - 28) : [];

      const dStatus = rec.discharge?.status || 'NONE';
      const followUpStr = (dStatus === 'SCHEDULED' || dStatus === 'MORNING_DISCHARGE')
        ? `📅 ${formatFollowUpAppointmentText(rec)}`
        : '';
      const followUpLines = followUpStr ? wrapCanvasText(mCtx, followUpStr, colWidth - 28) : [];

      let h = 34;
      if (taskLines.length > 0) h += 4 + taskLines.length * 18;
      if (followUpLines.length > 0) h += 4 + followUpLines.length * 18;
      return {
        height: Math.max(50, h + 8),
        taskLines,
        followUpLines
      };
    }

    const layoutsA = wingAItems.map(it => ({ item: it, layout: computeBedBoxLayout(it) }));
    const layoutsB = wingBItems.map(it => ({ item: it, layout: computeBedBoxLayout(it) }));

    const totalHeightA = layoutsA.reduce((acc, x) => acc + x.layout.height + 8, 0);
    const totalHeightB = layoutsB.reduce((acc, x) => acc + x.layout.height + 8, 0);
    const columnsBlockHeight = Math.max(totalHeightA, totalHeightB);

    const headerHeight = 148;
    const footerPadding = 60;
    const finalCanvasHeight = Math.max(minA4Height, headerHeight + columnsBlockHeight + footerPadding);

    const canvas = document.createElement('canvas');
    canvas.width = canvasWidth;
    canvas.height = finalCanvasHeight;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvasWidth, finalCanvasHeight);

    ctx.fillStyle = '#003b8e';
    ctx.fillRect(0, 0, canvasWidth, 98);

    ctx.fillStyle = '#ffffff';
    ctx.font = '800 14px "Be Vietnam Pro", sans-serif';
    ctx.fillText('BỆNH VIỆN ĐA KHOA TRUNG TÂM TỈNH GIA LAI  |  KHOA NGOẠI THẦN KINH - CỘT SỐNG', 36, 34);

    ctx.font = '800 24px "Be Vietnam Pro", sans-serif';
    ctx.fillText(`BẢNG ĐI BUỒNG HẰNG NGÀY — ${(tk1State.roomName || 'THẦN KINH 1').toUpperCase()} (DÃY A & DÃY B) — NGÀY ${dateStrVN}`, 36, 72);

    ctx.textAlign = 'right';
    ctx.font = '700 14px "Be Vietnam Pro", sans-serif';
    ctx.fillText(`Xuất lúc: ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`, canvasWidth - 36, 68);
    ctx.textAlign = 'left';

    ctx.fillStyle = '#1d4ed8';
    ctx.fillRect(leftColX, 110, colWidth, 34);
    ctx.fillStyle = '#ffffff';
    ctx.font = '800 16px "Montserrat", sans-serif';
    ctx.fillText(`DÃY A — GIƯỜNG ${String(startA).padStart(2, '0')} ĐẾN ${String(endA).padStart(2, '0')}`, leftColX + 14, 133);

    ctx.fillStyle = '#0f766e';
    ctx.fillRect(rightColX, 110, colWidth, 34);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(`DÃY B — GIƯỜNG ${String(startB).padStart(2, '0')} ĐẾN ${String(endB).padStart(2, '0')}`, rightColX + 14, 133);

    function drawWingColumn(entries, startX, startY, accentColor) {
      let curY = startY;
      for (const { item, layout } of entries) {
        const rec = item.rec;
        const boxH = layout.height;

        if (!rec) {
          ctx.fillStyle = '#f8fafc';
          ctx.strokeStyle = '#cbd5e1';
          ctx.lineWidth = 1.2;
          ctx.fillRect(startX, curY, colWidth, boxH);
          ctx.strokeRect(startX, curY, colWidth, boxH);

          ctx.fillStyle = '#64748b';
          ctx.font = '800 14px "Be Vietnam Pro", sans-serif';
          ctx.fillText(`${item.label} — [Trống]`, startX + 12, curY + 27);
          curY += boxH + 8;
          continue;
        }

        const dStatus = rec.discharge?.status || 'NONE';
        if (dStatus === 'MORNING_DISCHARGE') {
          ctx.fillStyle = '#fffbeb';
          ctx.strokeStyle = '#d97706';
        } else if (dStatus === 'SCHEDULED') {
          ctx.fillStyle = '#fff1f2';
          ctx.strokeStyle = '#e11d48';
        } else if (item.isFolding) {
          ctx.fillStyle = '#faf5ff';
          ctx.strokeStyle = '#7c3aed';
        } else {
          ctx.fillStyle = '#ffffff';
          ctx.strokeStyle = '#94a3b8';
        }

        ctx.lineWidth = 1.5;
        ctx.fillRect(startX, curY, colWidth, boxH);
        ctx.strokeRect(startX, curY, colWidth, boxH);

        ctx.fillStyle = dStatus === 'MORNING_DISCHARGE'
          ? '#d97706'
          : dStatus === 'SCHEDULED'
          ? '#e11d48'
          : item.isFolding
          ? '#7c3aed'
          : accentColor;
        ctx.fillRect(startX, curY, 6, boxH);

        ctx.fillStyle = '#0f172a';
        ctx.font = '800 15px "Be Vietnam Pro", sans-serif';
        const headLine = `${item.label}  |  ${rec.hoten} (${rec.tuoi || '--'})  •  ${rec.ngayVaoStr || '--'}`;
        ctx.fillText(headLine, startX + 14, curY + 24);

        if (dStatus === 'MORNING_DISCHARGE' || dStatus === 'SCHEDULED') {
          const badgeTxt = dStatus === 'MORNING_DISCHARGE' ? 'XUẤT VIỆN SÁNG NAY' : 'CHỜ RA VIỆN';
          ctx.fillStyle = dStatus === 'MORNING_DISCHARGE' ? '#d97706' : '#e11d48';
          ctx.font = '800 11px "Be Vietnam Pro", sans-serif';
          ctx.textAlign = 'right';
          ctx.fillText(badgeTxt, startX + colWidth - 12, curY + 23);
          ctx.textAlign = 'left';
        }

        let textY = curY + 44;

        if (layout.taskLines && layout.taskLines.length > 0) {
          ctx.fillStyle = '#1d4ed8';
          ctx.font = '700 13px "Be Vietnam Pro", sans-serif';
          for (const line of layout.taskLines) {
            ctx.fillText(line, startX + 14, textY);
            textY += 18;
          }
        }

        if (layout.followUpLines && layout.followUpLines.length > 0) {
          textY += 2;
          ctx.fillStyle = '#b45309';
          ctx.font = '700 13px "Be Vietnam Pro", sans-serif';
          for (const line of layout.followUpLines) {
            ctx.fillText(line, startX + 14, textY);
            textY += 18;
          }
        }

        curY += boxH + 8;
      }
    }

    drawWingColumn(layoutsA, leftColX, 154, '#004aad');
    drawWingColumn(layoutsB, rightColX, 154, '#0f766e');

    const dataUrl = canvas.toDataURL('image/png');
    const previewImg = document.getElementById('tk1-png-preview-img');
    const downloadLink = document.getElementById('tk1-png-download-link');
    const previewDlg = document.getElementById('tk1-png-preview-dialog');

    const fileName = `Di_Buong_${currentRoomKey.toUpperCase()}_A4_${curDateKey}.png`;
    if (previewImg) previewImg.src = dataUrl;
    if (downloadLink) {
      downloadLink.href = dataUrl;
      downloadLink.download = fileName;
    }
    if (previewDlg) previewDlg.showModal();
  }

  function initTk1Events() {
    const btnWingA = document.getElementById('btn-toggle-wing-a');
    const btnWingB = document.getElementById('btn-toggle-wing-b');

    if (btnWingA) {
      btnWingA.addEventListener('click', () => {
        wingCollapsed.A = !wingCollapsed.A;
        const card = document.getElementById('tk1-wing-card-a');
        const pill = document.getElementById('tk1-wing-a-pill');
        if (card) card.classList.toggle('collapsed', wingCollapsed.A);
        if (pill) pill.textContent = wingCollapsed.A ? '▸ Bấm để mở rộng Dãy A' : '▾ Bấm để thu gọn Dãy A';
      });
    }

    if (btnWingB) {
      btnWingB.addEventListener('click', () => {
        wingCollapsed.B = !wingCollapsed.B;
        const card = document.getElementById('tk1-wing-card-b');
        const pill = document.getElementById('tk1-wing-b-pill');
        if (card) card.classList.toggle('collapsed', wingCollapsed.B);
        if (pill) pill.textContent = wingCollapsed.B ? '▸ Bấm để mở rộng Dãy B' : '▾ Bấm để thu gọn Dãy B';
      });
    }

    const btnToggleAllFold = document.getElementById('btn-tk1-toggle-all-folding');
    if (btnToggleAllFold) {
      btnToggleAllFold.addEventListener('click', async () => {
        const anyHidden = Object.keys(tk1State.hiddenFoldingBeds || {}).length > 0;
        for (let i = 1; i <= 24; i++) {
          if (tk1State.bedAssignments[`${i}X`]) {
            await callTk1Api({ action: 'TOGGLE_FOLDING_BED_VISIBILITY', mainBedNum: i, hidden: !anyHidden });
          }
        }
      });
    }

    const btnPngA4 = document.getElementById('btn-tk1-export-png-a4');
    if (btnPngA4) {
      btnPngA4.addEventListener('click', () => generateTk1A4PngAndPreview());
    }

    const excelInp = document.getElementById('tk1-upload-excel-input');
    if (excelInp) {
      excelInp.addEventListener('change', async (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async () => {
          const base64Data = String(reader.result).split(',')[1];
          await fetch('/api/upload-his-excel', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fileName: file.name, base64Data })
          });
          await fetchTk1InitialState();
        };
        reader.readAsDataURL(file);
      });
    }

    document.querySelectorAll('.ward-date-selector').forEach(input => {
      input.value = getSelectedDateKey();
      input.addEventListener('change', (e) => {
        const val = e.target.value;
        if (val) {
          selectedDateKey = val;
          document.querySelectorAll('.ward-date-selector').forEach(other => {
            other.value = val;
          });
          renderTk1Workspace();
        }
      });
    });

    document.querySelectorAll('.btn-ward-date-today').forEach(btn => {
      btn.addEventListener('click', () => {
        const today = getTodayKey();
        selectedDateKey = today;
        document.querySelectorAll('.ward-date-selector').forEach(other => {
          other.value = today;
        });
        renderTk1Workspace();
      });
    });

    document.querySelectorAll('[data-tk1-sum-tab]').forEach(btn => {
      btn.addEventListener('click', () => {
        activeSummaryTab = btn.getAttribute('data-tk1-sum-tab');
        document.querySelectorAll('[data-tk1-sum-tab]').forEach(b => {
          b.classList.toggle('active', b.getAttribute('data-tk1-sum-tab') === activeSummaryTab);
        });
        document.querySelectorAll('.tk1-sum-tab-panel').forEach(p => {
          p.classList.toggle('active', p.id === `tk1-sum-panel-${activeSummaryTab}`);
        });
      });
    });

    // Xử lý bật / tắt popover danh sách chọn nhanh công việc
    document.querySelectorAll('.tk1-multi-dd-trigger').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const cat = btn.getAttribute('data-dd-cat');
        const popover = document.getElementById(`popover-dd-${cat}`);
        if (!popover) return;
        const isOpen = popover.style.display === 'block';
        document.querySelectorAll('.tk1-multi-dd-popover').forEach(p => { p.style.display = 'none'; });
        if (!isOpen) {
          popover.style.display = 'block';
        }
      });
    });

    // Ngăn chặn sự kiện click bên trong popover làm đóng popover (để tích chọn nhiều mục)
    document.querySelectorAll('.tk1-multi-dd-popover').forEach(p => {
      p.addEventListener('click', (e) => {
        e.stopPropagation();
      });
    });

    // Bấm bên ngoài popover thì đóng tất cả popover
    document.addEventListener('click', () => {
      document.querySelectorAll('.tk1-multi-dd-popover').forEach(p => { p.style.display = 'none'; });
    });

    // Nhập Xét nghiệm khác: Tự động lưu tức thì vào danh sách công việc khi gõ
    const inpCustomXn = document.getElementById('tk1-custom-xn-input');
    const wrapCustomXn = document.getElementById('tk1-custom-xn-wrap');
    const btnCancelXn = document.getElementById('btn-tk1-cancel-custom-xn');

    if (inpCustomXn) {
      inpCustomXn.addEventListener('input', () => {
        const val = inpCustomXn.value.trim();
        const stdOpts = (TK1_QUICK_OPTIONS.xetNghiem || []).filter(x => x !== 'Khác');
        modalDraftTasks.xetNghiem = (modalDraftTasks.xetNghiem || []).filter(x => stdOpts.includes(x));
        if (val) {
          modalDraftTasks.xetNghiem.push(val);
        }
        renderModalSelectedTasksPills();
        updateMultiDdPopoversAndTitles();
      });
    }

    if (btnCancelXn) {
      btnCancelXn.addEventListener('click', () => {
        const stdOpts = (TK1_QUICK_OPTIONS.xetNghiem || []).filter(x => x !== 'Khác');
        modalDraftTasks.xetNghiem = (modalDraftTasks.xetNghiem || []).filter(x => stdOpts.includes(x));
        if (wrapCustomXn) wrapCustomXn.style.display = 'none';
        if (inpCustomXn) inpCustomXn.value = '';
        renderModalSelectedTasksPills();
        updateMultiDdPopoversAndTitles();
      });
    }

    // Nhập X-quang xương chi: Tự động lưu tức thì vào danh sách công việc khi gõ
    const inpCustomXq = document.getElementById('tk1-custom-xq-input');
    const wrapCustomXq = document.getElementById('tk1-custom-xq-wrap');
    const btnCancelXq = document.getElementById('btn-tk1-cancel-custom-xq');

    if (inpCustomXq) {
      inpCustomXq.addEventListener('input', () => {
        const boneName = inpCustomXq.value.trim();
        modalDraftTasks.xquang = (modalDraftTasks.xquang || []).filter(x => !x.startsWith('X-quang xương chi'));
        const label = boneName ? `X-quang xương chi (${boneName})` : 'X-quang xương chi';
        modalDraftTasks.xquang.push(label);
        renderModalSelectedTasksPills();
        updateMultiDdPopoversAndTitles();
      });
    }

    if (btnCancelXq) {
      btnCancelXq.addEventListener('click', () => {
        modalDraftTasks.xquang = (modalDraftTasks.xquang || []).filter(x => !x.startsWith('X-quang xương chi'));
        if (wrapCustomXq) wrapCustomXq.style.display = 'none';
        if (inpCustomXq) inpCustomXq.value = '';
        renderModalSelectedTasksPills();
        updateMultiDdPopoversAndTitles();
      });
    }

    const btnPrevBed = document.getElementById('btn-tk1-modal-prev-bed');
    if (btnPrevBed) {
      btnPrevBed.addEventListener('click', () => navigateModalBed(-1));
    }

    const btnNextBed = document.getElementById('btn-tk1-modal-next-bed');
    if (btnNextBed) {
      btnNextBed.addEventListener('click', () => navigateModalBed(1));
    }

    const btnSaveModal = document.getElementById('btn-tk1-modal-save');
    if (btnSaveModal) {
      btnSaveModal.addEventListener('click', async () => {
        await saveCurrentModalPatientRound();
        document.getElementById('tk1-patient-modal').close();
      });
    }

    const btnDischargeRed = document.getElementById('btn-tk1-modal-discharge-red');
    if (btnDischargeRed) {
      btnDischargeRed.addEventListener('click', async () => {
        await triggerModalDischarge('SCHEDULED');
      });
    }

    const btnDeleteTransfer = document.getElementById('btn-tk1-modal-delete-transfer');
    if (btnDeleteTransfer) {
      btnDeleteTransfer.addEventListener('click', async () => {
        if (!activeModalMabn) return;
        await callTk1Api({ action: 'DELETE_PATIENT', mabn: activeModalMabn, reason: 'Chuyển mổ / Chuyển phòng' });
        document.getElementById('tk1-patient-modal').close();
      });
    }
  }

  async function fetchTk1InitialState() {
    try {
      const res = await fetch(`/api/ward-rounds/tk1?room=${encodeURIComponent(currentRoomKey)}`);
      const data = await res.json();
      if (data && data.ok) {
        if (data.wardRounds) {
          allRoomsState = data.wardRounds;
        }
        if (data.wardRounds && data.wardRounds[currentRoomKey]) {
          tk1State = data.wardRounds[currentRoomKey];
        } else if (data.tk1) {
          tk1State = data.tk1;
          allRoomsState[currentRoomKey] = data.tk1;
        }
        if (data.lastExcelUploadTime) {
          lastExcelUploadTimeGlobal = data.lastExcelUploadTime;
          tk1State.lastExcelUploadTime = data.lastExcelUploadTime;
          if (allRoomsState) {
            Object.values(allRoomsState).forEach(r => { r.lastExcelUploadTime = data.lastExcelUploadTime; });
          }
        }
        if (data.episodeConsultations) globalEpisodeConsultations = data.episodeConsultations;
        renderTk1Workspace();
      }
    } catch (e) {
      console.error('Failed to load ward state:', e);
    }
  }

  window.TK1Module = {
    init() {
      initTk1Events();
      fetchTk1InitialState();
    },
    switchRoom(roomKey) {
      if (!roomKey) return;
      currentRoomKey = roomKey;
      quickAssignSelectedMabn = null;
      if (allRoomsState && allRoomsState[roomKey]) {
        tk1State = allRoomsState[roomKey];
        if (!tk1State.lastExcelUploadTime && lastExcelUploadTimeGlobal) {
          tk1State.lastExcelUploadTime = lastExcelUploadTimeGlobal;
        }
        renderTk1Workspace();
      } else {
        fetchTk1InitialState();
      }
    },
    onServerStateUpdate(dbObj) {
      if (dbObj && dbObj.wardRounds) {
        allRoomsState = dbObj.wardRounds;
        if (dbObj.wardRounds[currentRoomKey]) {
          tk1State = dbObj.wardRounds[currentRoomKey];
        }
        if (dbObj.lastExcelUploadTime) {
          lastExcelUploadTimeGlobal = dbObj.lastExcelUploadTime;
          tk1State.lastExcelUploadTime = dbObj.lastExcelUploadTime;
          if (allRoomsState) {
            Object.values(allRoomsState).forEach(r => { r.lastExcelUploadTime = dbObj.lastExcelUploadTime; });
          }
        }
        if (dbObj.episodeConsultations) globalEpisodeConsultations = dbObj.episodeConsultations;
        renderTk1Workspace();
      }
    },
    openPatientModal,
    async saveInlineConsult(mabn, specialty) {
      const consultDiagnosis = document.getElementById(`inline-cdiag-${mabn}`)?.value || '';
      const consultTreatment = document.getElementById(`inline-ctreat-${mabn}`)?.value || '';
      const followUpDays = document.getElementById(`inline-fdays-${mabn}`)?.value || '7';
      await callTk1Api({
        action: 'UPDATE_CONSULT_TREATMENT',
        mabn,
        specialty,
        consultDiagnosis,
        consultTreatment,
        followUpDays
      });
    },
    async saveInlineNote(mabn) {
      const rec = tk1State.patientRecords[mabn];
      if (!rec) return;
      const curDateKey = getSelectedDateKey();
      const existingToday = (rec.tasksByDate && rec.tasksByDate[curDateKey]) || {};
      const newNote = document.getElementById(`inline-note-${mabn}`)?.value || '';
      await callTk1Api({
        action: 'SAVE_PATIENT_ROUND',
        mabn,
        dateKey: curDateKey,
        customDiagnosis: rec.customDiagnosis || rec.chanDoanHis || '',
        tasks: {
          xetNghiem: existingToday.xetNghiem || [],
          ct: existingToday.ct || [],
          xquang: existingToday.xquang || [],
          sieuAm: existingToday.sieuAm || [],
          hoiChan: existingToday.hoiChan || [],
          thuThuat: existingToday.thuThuat || [],
          note: newNote
        },
        consultDetails: rec.consultDetails
      });
    }
  };
})();
