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
      'Khí máu động mạch',
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
    tk3:  { wingA: [1, 10], wingB: [11, 16], extraTasks: [] },
    tk4:  { wingA: [1, 16], wingB: [17, 31], extraTasks: [] },
    hstk: { wingA: [1, 12], wingB: null,     extraTasks: ['Cai máy thở', 'Đặt NKQ thở máy', 'Rút NKQ', 'Khai khí quản', 'Đặt tĩnh mạch trung tâm'] }
  };

  function cleanPaymentForInput(val) {
    if (!val) return '';
    const str = String(val).trim();
    const match = str.match(/^([\d.,]+)\s*(triệu|trieu|tr)?$/i);
    if (match) return match[1];
    return str;
  }

  function formatPaymentWithMillion(val) {
    if (!val) return '';
    const str = String(val).trim();
    if (!str) return '';
    if (/triệu$/i.test(str)) return str;
    if (/^[\d.,]+$/.test(str)) {
      return `${str} triệu`;
    }
    const m = str.match(/^([\d.,]+)\s*(tr|trieu)$/i);
    if (m) {
      return `${m[1]} triệu`;
    }
    return str;
  }

  function cleanBloodForInput(val) {
    if (!val) return '';
    const str = String(val).trim();
    const match = str.match(/^(\d+)\s*(ml)?$/i);
    if (match) return match[1];
    return str;
  }

  function formatBloodMl(val) {
    if (!val) return '';
    const str = String(val).trim();
    if (!str) return '';
    if (/ml$/i.test(str)) return str;
    if (/^\d+$/.test(str)) return `${str} ml`;
    return str;
  }

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

  function getInitialDateKey() {
    try {
      const qDate = new URLSearchParams(window.location.search).get('date');
      if (qDate && /^\d{4}-\d{2}-\d{2}$/.test(qDate)) return qDate;
    } catch (e) {}
    return getTodayKey();
  }
  let selectedDateKey = getInitialDateKey();
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

  function convertVnDateToIso(vnDateStr) {
    if (!vnDateStr || typeof vnDateStr !== 'string') return '';
    const parts = vnDateStr.trim().split('/');
    if (parts.length === 3) {
      const [d, m, y] = parts;
      if (d && m && y && !isNaN(d) && !isNaN(m) && !isNaN(y)) {
        return `${String(y).padStart(4, '20')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      }
    }
    return '';
  }

  function calculatePostOpDay(surgeryDateStr, targetDateStr) {
    if (!surgeryDateStr) return 1;
    const sNum = parseDateKeyToDayNumber(surgeryDateStr);
    const tNum = parseDateKeyToDayNumber(targetDateStr || getSelectedDateKey());
    const diff = tNum - sNum;
    if (diff <= 0) return 1;
    return diff;
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

  function getPatientSurgicalConsultation(rec, dateKey) {
    if (!rec) return null;
    const dKey = dateKey || getSelectedDateKey();
    if (rec.surgicalConsultationsByDate && rec.surgicalConsultationsByDate[dKey]) {
      return rec.surgicalConsultationsByDate[dKey];
    }
    if (rec.surgicalConsultation && rec.surgicalConsultation.dateKey === dKey) {
      return rec.surgicalConsultation;
    }
    return null;
  }

  // Lấy nhãn và lớp CSS hiển thị theo 4 option kết luận duyệt
  function getDeptConsultTagMeta(decision) {
    const d = (decision || '').trim();
    if (d === 'Đồng ý phẫu thuật' || d === 'Đồng ý') {
      return {
        key: 'agree',
        cls: 'tag-agree',
        text: '✓ Đồng ý phẫu thuật',
        bg: '#dcfce7',
        color: '#15803d',
        border: '#86efac'
      };
    }
    if (d === 'Cần hội ý thêm' || d === 'Hội ý') {
      return {
        key: 'discuss',
        cls: 'tag-discuss',
        text: '💬 Cần hội ý thêm',
        bg: '#fef3c7',
        color: '#b45309',
        border: '#fcd34d'
      };
    }
    if (d === 'Không phẫu thuật' || d === 'Không đồng ý') {
      return {
        key: 'no-surg',
        cls: 'tag-no-surg',
        text: '✕ Không phẫu thuật',
        bg: '#fee2e2',
        color: '#b91c1c',
        border: '#fca5a5'
      };
    }
    if (d === 'Điều trị nội khoa') {
      return {
        key: 'medical',
        cls: 'tag-medical',
        text: '💊 Điều trị nội khoa',
        bg: '#e0e7ff',
        color: '#4338ca',
        border: '#a5b4fc'
      };
    }
    return {
      key: 'pending',
      cls: 'tag-pending',
      text: '⏳ Chờ kết luận',
      bg: '#f1f5f9',
      color: '#475569',
      border: '#cbd5e1'
    };
  }

  function getBedOfPatient(mabn) {
    for (const [bCode, m] of Object.entries(tk1State.bedAssignments || {})) {
      if (m === mabn) return bCode;
    }
    return null;
  }

  function formatBedLabel(bedCode) {
    if (!bedCode) return 'Chưa phân giường';
    const str = String(bedCode).trim();
    const isFold = str.endsWith('X') || str.toLowerCase().startsWith('xếp ');
    const rawCode = str.replace(/^xếp\s+/i, '').replace(/X$/, '');
    const num = parseInt(rawCode, 10);

    if (currentRoomKey === 'tk4') {
      if (!isNaN(num)) {
        if (num >= 1 && num <= 16) {
          return isFold ? `Xếp A${num}` : `A${num}`;
        } else if (num >= 17 && num <= 31) {
          const bNum = num - 16;
          return isFold ? `Xếp B${bNum}` : `B${bNum}`;
        }
      } else if (/^[ab]\d+$/i.test(rawCode)) {
        const upper = rawCode.toUpperCase();
        return isFold ? `Xếp ${upper}` : upper;
      }
    }

    if (isFold) {
      return `Xếp ${rawCode}`;
    }
    return `${str}`;
  }

  function buildAllBedOptionsHtml(currentMabn) {
    const { wingA, wingB } = getCurrentRoomConfig();
    const endA = wingA[1];
    const endB = wingB ? wingB[1] : endA;
    const options = [];
    for (let i = 1; i <= endB; i++) {
      const mainCode = String(i);
      const foldCode = `${i}X`;
      const wingLabel = currentRoomKey === 'tk3'
        ? (i <= endA ? 'Dãy Trên' : 'Dãy Dịch Vụ')
        : (!wingB ? 'Hồi sức' : (i <= endA ? 'Dãy A' : 'Dãy B'));

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

        const bedDisplayName = currentRoomKey === 'tk4'
          ? formatBedLabel(code)
          : (isFold ? `Giường xếp ${i}` : `Giường ${String(i).padStart(2, '0')}`);
        const label = `[${wingLabel}] ${bedDisplayName} — ${statusNote}`;

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
    const badgeTitle = formatBedLabel(bedCode);
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

    let tk2SurgeryBarHtml = '';
    if (currentRoomKey === 'tk2') {
      const isNonSurgical = Boolean(rec.surgeryInfo?.isNonSurgical);
      const sName = (rec.surgeryInfo?.surgeryName || '').trim();
      const sDate = rec.surgeryInfo?.surgeryDate || convertVnDateToIso(rec.ngayVaoStr) || curDateKey;
      const postOpDay = calculatePostOpDay(sDate, curDateKey);

      let diagText = '';
      if (isNonSurgical) {
        diagText = rec.customDiagnosis || rec.chanDoanHis || 'Chưa có chẩn đoán';
      } else {
        diagText = `Hậu phẫu ngày thứ ${postOpDay}${sName ? ` (${sName})` : ' (Chưa nhập tên PT)'}`;
      }

      tk2SurgeryBarHtml = `
        <div class="tk2-card-surgery-bar ${isNonSurgical ? 'is-nonsurgical' : 'is-surgical'}">
          <div style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:700;" title="${diagText.replace(/"/g, '&quot;')}">
            <span style="font-size:0.8rem;margin-right:3px;">${isNonSurgical ? '💊' : '🔪'}</span>${diagText}
          </div>
          <label style="display:inline-flex;align-items:center;gap:4px;margin:0;font-size:0.72rem;font-weight:700;color:${isNonSurgical ? '#dc2626' : '#64748b'};cursor:pointer;white-space:nowrap;flex-shrink:0;" onclick="event.stopPropagation();" title="Đánh dấu bệnh nhân không phẫu thuật">
            <input type="checkbox" class="tk2-card-chk-nonsurgical" data-mabn="${rec.mabn}" ${isNonSurgical ? 'checked' : ''} style="cursor:pointer;" />
            <span>Không phẫu thuật</span>
          </label>
        </div>
      `;
    }

    let deptConsultRoomTagHtml = '';
    const sc = getPatientSurgicalConsultation(rec, curDateKey);
    const isConsulted = Boolean(sc && sc.isConsulted);
    if (isConsulted) {
      const tagMeta = getDeptConsultTagMeta(sc.decision);
      let badgeCls = tagMeta.cls;
      let badgeText = tagMeta.text;

      const methodStr = sc.surgeryMethod ? ` · <strong>PP:</strong> ${sc.surgeryMethod}` : '';
      const diagStr = sc.postConsultDiagnosis ? ` · <strong>CĐ:</strong> ${sc.postConsultDiagnosis}` : '';
      const bloodStr = sc.bloodMl ? ` · <strong>Máu:</strong> ${sc.bloodMl}` : '';
      const payStr = sc.advancePayment ? ` · <strong>Ứng:</strong> ${sc.advancePayment}` : '';

      deptConsultRoomTagHtml = `
        <div class="dept-consult-room-tag" onclick="event.stopPropagation(); window.TK1Module.goToDeptConsultDate('${curDateKey}', '${rec.mabn}')" title="Bệnh nhân có trong danh sách Hội chẩn khoa ngày ${formatDateDisplayVN(curDateKey)} — Bấm để chuyển tới Tab Hội chẩn khoa">
          <div class="dc-tag-main">
            <span class="dc-tag-badge">👨‍⚕️ HC KHOA [${formatDateDisplayVN(curDateKey)}]</span>
            <span class="dc-tag-surg-status ${badgeCls}">${badgeText}</span>
            ${methodStr || diagStr}
            ${bloodStr}
            ${payStr}
          </div>
          <button type="button" class="btn-bed-mini dc-tag-view-btn" onclick="event.stopPropagation(); window.TK1Module.goToDeptConsultDate('${curDateKey}', '${rec.mabn}')" title="Xem ca này trong Tab Hội chẩn khoa">
            Xem HC ➔
          </button>
        </div>
      `;
    }

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
              currentRoomKey === 'tk4'
                ? (function() {
                    const scItem = getPatientSurgicalConsultation(rec, curDateKey);
                    const isAdded = Boolean(scItem && scItem.isConsulted);
                    if (isAdded) {
                      return `<button type="button" class="btn-bed-mini" style="background:#dcfce7;color:#15803d;border-color:#4ade80;font-weight:800;" title="Đã có trong danh sách HC ngày ${formatDateDisplayVN(curDateKey)} — Bấm để sửa ngày/CĐ ban đầu" onclick="event.stopPropagation(); window.TK1Module.openTk4SimpleConsultDialog('${rec.mabn}')">✓ Đã thêm HC</button>`;
                    } else {
                      return `<button type="button" class="btn-bed-mini" style="background:#f0fdf4;color:#166534;border-color:#86efac;font-weight:700;" title="Đưa ca này vào danh sách Hội chẩn khoa" onclick="event.stopPropagation(); window.TK1Module.openTk4SimpleConsultDialog('${rec.mabn}')">➕ Thêm hội chẩn</button>`;
                    }
                  })()
                : ''
            }
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

        ${tk2SurgeryBarHtml}
        ${deptConsultRoomTagHtml}

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
      ? `<tr><td colspan="3" style="text-align:center;color:#64748b;padding:1.1rem;">Chưa có bệnh nhân nào có chỉ định Xét nghiệm / CĐHA / Ghi chú ngày ${formatDateDisplayVN(curDateKey)}.</td></tr>`
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
              <td>
                ${badgesHtml}
                ${
                  noteVal
                    ? `<div style="margin-top:6px;font-size:0.8rem;color:#1e293b;background:#f8fafc;border:1px solid #cbd5e1;border-left:3.5px solid #004aad;padding:4px 9px;border-radius:6px;display:inline-block;max-width:100%;">
                        <strong style="color:#004aad;">📝 Ghi chú:</strong> ${noteVal}
                      </div>`
                    : ''
                }
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

    // 4. Tab Hội chẩn mổ (Khu vực tổng hợp riêng cho Thần kinh 4)
    const hcmTabBtn = document.getElementById('tk1-sum-tab-btn-hcm');
    const hcmCountEl = document.getElementById('tk1-count-tab-hcm');
    const hcmBody = document.getElementById('tk4-sum-tbody-hcm');
    const hcmStatsBanner = document.getElementById('tk4-sum-hcm-stats-banner');

    if (currentRoomKey === 'tk4') {
      if (hcmTabBtn) hcmTabBtn.style.display = 'inline-block';
      const allActivePatients = Object.values(tk1State.patientRecords || {})
        .filter(r => !r.removed?.isRemoved);

      const hcmPatients = allActivePatients.filter(r => {
        const sc = getPatientSurgicalConsultation(r, curDateKey);
        return Boolean(sc && sc.isConsulted);
      }).sort((a, b) => {
        const bA = getBedOfPatient(a.mabn) || '999';
        const bB = getBedOfPatient(b.mabn) || '999';
        return bA.localeCompare(bB, undefined, { numeric: true });
      });

      if (hcmCountEl) hcmCountEl.textContent = hcmPatients.length;

      if (hcmStatsBanner) {
        const total = hcmPatients.length;
        const agree = hcmPatients.filter(r => getPatientSurgicalConsultation(r, curDateKey)?.decision === 'Đồng ý').length;
        const discuss = hcmPatients.filter(r => getPatientSurgicalConsultation(r, curDateKey)?.decision === 'Hội ý').length;
        const disagree = hcmPatients.filter(r => getPatientSurgicalConsultation(r, curDateKey)?.decision === 'Không đồng ý').length;

        hcmStatsBanner.innerHTML = `
          <div style="display:flex;align-items:center;flex-wrap:wrap;gap:10px;">
            <span style="font-weight:800;color:#166534;font-size:0.92rem;">
              🔪 TỔNG HỢP HỘI CHẨN MỔ (${total} ca)
            </span>
            <span style="background:#dcfce7;color:#15803d;border:1px solid #86efac;font-weight:800;padding:3px 10px;border-radius:999px;font-size:0.78rem;">
              ✓ Đồng ý: ${agree} ca
            </span>
            <span style="background:#fef3c7;color:#b45309;border:1px solid #fde68a;font-weight:800;padding:3px 10px;border-radius:999px;font-size:0.78rem;">
              💬 Cần hội ý: ${discuss} ca
            </span>
            <span style="background:#fee2e2;color:#dc2626;border:1px solid #fca5a5;font-weight:800;padding:3px 10px;border-radius:999px;font-size:0.78rem;">
              ✕ Không đồng ý: ${disagree} ca
            </span>
          </div>
          <div style="display:flex;align-items:center;gap:6px;">
            <button type="button" class="btn-bed-mini" onclick="window.TK1Module.openAddPatientToScDialog()" style="background:#ffffff;border-color:#86efac;color:#166534;font-weight:800;">
              ➕ Thêm bệnh nhân
            </button>
            <button type="button" class="btn-bed-mini" onclick="window.print()" style="background:#ffffff;border-color:#86efac;color:#166534;font-weight:700;">
              🖨️ In biên bản HC mổ
            </button>
          </div>
        `;
      }

      if (hcmBody) {
        hcmBody.innerHTML = hcmPatients.length === 0
          ? `<tr><td colspan="7" style="text-align:center;padding:1.6rem;color:#64748b;">Chưa có bệnh nhân nào trong danh sách Hội chẩn mổ ngày ${formatDateDisplayVN(curDateKey)} (Mặc định không có ca nào, bấm "➕ Thêm hội chẩn mổ" trên thẻ giường bệnh để đưa vào danh sách).</td></tr>`
          : hcmPatients.map(rec => {
              const bedCode = getBedOfPatient(rec.mabn);
              const sc = getPatientSurgicalConsultation(rec, curDateKey) || {};
              const dec = sc.decision || 'Chưa duyệt';
              let decBadgeHtml = `<span style="background:#f1f5f9;color:#475569;padding:3px 9px;border-radius:6px;font-weight:800;font-size:0.78rem;">-- Chưa duyệt --</span>`;
              if (dec === 'Đồng ý') {
                decBadgeHtml = `<span style="background:#dcfce7;color:#15803d;border:1px solid #86efac;padding:3px 9px;border-radius:6px;font-weight:800;font-size:0.78rem;">✓ Đồng ý mổ</span>`;
              } else if (dec === 'Hội ý') {
                decBadgeHtml = `<span style="background:#fef3c7;color:#b45309;border:1px solid #fde68a;padding:3px 9px;border-radius:6px;font-weight:800;font-size:0.78rem;">💬 Cần hội ý</span>`;
              } else if (dec === 'Không đồng ý') {
                decBadgeHtml = `<span style="background:#fee2e2;color:#dc2626;border:1px solid #fca5a5;padding:3px 9px;border-radius:6px;font-weight:800;font-size:0.78rem;">✕ Không đồng ý</span>`;
              }

              return `
                <tr>
                  <td><strong>${formatBedLabel(bedCode)}</strong></td>
                  <td>
                    <a href="javascript:void(0)" onclick="window.TK1Module.openPatientModal('${rec.mabn}')" style="font-weight:800;color:#004aad;text-decoration:none;">
                      ${rec.hoten}
                    </a>
                    <div style="font-size:0.75rem;color:#64748b;">${rec.tuoi || '--'} · Vào: ${rec.ngayVaoStr || '--'}</div>
                  </td>
                  <td>
                    <strong style="color:#0f172a;">${sc.postConsultDiagnosis || '<span style="color:#94a3b8;font-weight:normal;font-style:italic;">Chưa nhập CĐ sau HC</span>'}</strong>
                  </td>
                  <td>
                    <span style="font-weight:700;color:#1e40af;">${sc.surgeryMethod || '<span style="color:#94a3b8;font-weight:normal;font-style:italic;">Chưa nhập phương pháp mổ</span>'}</span>
                  </td>
                  <td>${decBadgeHtml}</td>
                  <td>
                    <strong style="color:#b45309;">${sc.advancePayment || '<span style="color:#94a3b8;font-weight:normal;font-style:italic;">--</span>'}</strong>
                    ${sc.bloodMl ? `<div style="font-size:0.75rem;color:#b91c1c;font-weight:700;margin-top:2px;">Máu: ${sc.bloodMl}</div>` : ''}
                  </td>
                  <td style="text-align:center;">
                    <div style="display:flex;align-items:center;justify-content:center;gap:4px;">
                      <button type="button" class="btn-bed-mini" style="background:#f0fdf4;border-color:#86efac;color:#166534;font-weight:800;" data-open-tk4-consult="${rec.mabn}">
                        ✏️ Sửa
                      </button>
                      <button type="button" class="btn-bed-mini" style="background:#fee2e2;border-color:#fca5a5;color:#dc2626;font-weight:700;" data-remove-tk4-consult="${rec.mabn}" title="Xoá ca này khỏi danh sách hội chẩn mổ hôm nay">
                        🗑️
                      </button>
                    </div>
                  </td>
                </tr>
              `;
            }).join('');

        hcmBody.querySelectorAll('[data-open-tk4-consult]').forEach(btn => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const mabn = btn.getAttribute('data-open-tk4-consult');
            if (mabn) openTk4SurgConsultDialog(mabn);
          });
        });

        hcmBody.querySelectorAll('[data-remove-tk4-consult]').forEach(btn => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const mabn = btn.getAttribute('data-remove-tk4-consult');
            if (mabn) removePatientFromSurgicalConsultation(mabn);
          });
        });
      }
    } else {
      if (hcmTabBtn) hcmTabBtn.style.display = 'none';
      if (activeSummaryTab === 'hoi-chan-mo') {
        activeSummaryTab = 'xn-cdha';
        document.querySelectorAll('[data-tk1-sum-tab]').forEach(b => {
          b.classList.toggle('active', b.getAttribute('data-tk1-sum-tab') === 'xn-cdha');
        });
        document.querySelectorAll('.tk1-sum-tab-panel').forEach(p => {
          p.classList.toggle('active', p.id === 'tk1-sum-panel-xn-cdha');
        });
      }
    }
  }

  // =========================================================================
  // HỘI CHẨN KHOA: QUẢN LÝ HỘI CHẨN MỔ HẰNG NGÀY TOÀN KHOA
  // (Đồng bộ đa phòng, thẻ bệnh nhân fit đẹp, quản lý theo ngày, hộp thoại riêng TK4)
  // =========================================================================
  let activeDeptConsultDate = getTodayKey();
  let activeDeptConsultFilterRoom = 'ALL';
  let deptConsultSearchQuery = '';
  let activeTk4SimpleMabn = null;

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // Lấy toàn bộ bệnh nhân đang điều trị từ cả 5 phòng trong khoa
  function getAllActivePatientsAcrossDept() {
    const list = [];
    const roomConfigs = [
      { key: 'tk1', name: 'Thần kinh 1' },
      { key: 'tk2', name: 'Thần kinh 2' },
      { key: 'tk3', name: 'Thần kinh 3' },
      { key: 'tk4', name: 'Thần kinh 4' },
      { key: 'hstk', name: 'Hồi sức thần kinh' }
    ];
    roomConfigs.forEach(r => {
      const rState = allRoomsState[r.key];
      if (!rState || !rState.patientRecords) return;
      Object.values(rState.patientRecords).forEach(rec => {
        if (rec.removed?.isRemoved) return;
        let bedCode = null;
        for (const [b, m] of Object.entries(rState.bedAssignments || {})) {
          if (m === rec.mabn) { bedCode = b; break; }
        }
        list.push({
          ...rec,
          patientRoomKey: r.key,
          patientRoomName: r.name,
          patientBedCode: bedCode
        });
      });
    });
    return list;
  }

  // Lấy danh sách bệnh nhân có hội chẩn theo ngày cụ thể
  function getAllConsultPatientsForDate(dateKey) {
    const allPts = getAllActivePatientsAcrossDept();
    const dKey = dateKey || activeDeptConsultDate;
    return allPts
      .filter(p => {
        const sc = getPatientSurgicalConsultation(p, dKey);
        return Boolean(sc && sc.isConsulted);
      })
      .map(p => ({
        ...p,
        consultData: getPatientSurgicalConsultation(p, dKey)
      }));
  }

  // Thống kê nhanh hội chẩn cho một ngày
  function getDeptConsultStatsForDate(dateKey) {
    const pts = getAllConsultPatientsForDate(dateKey);
    let surg = 0;
    let noSurg = 0;
    let discuss = 0;
    let totalAdvance = 0;
    let totalBlood = 0;

    pts.forEach(p => {
      const c = p.consultData || {};
      const isS = Boolean(c.isSurgical !== undefined ? c.isSurgical : (c.decision === 'Đồng ý' || (c.surgeryMethod && c.surgeryMethod.length > 0)));
      if (isS) surg++;
      else noSurg++;

      if (c.decision === 'Hội ý') discuss++;

      const payNum = parseFloat(String(c.advancePayment || '').replace(/[^\d.]/g, ''));
      if (!isNaN(payNum)) totalAdvance += payNum;

      const bNum = parseFloat(String(c.bloodMl || '').replace(/[^\d.]/g, ''));
      if (!isNaN(bNum)) totalBlood += bNum;
    });

    return {
      total: pts.length,
      surg,
      noSurg,
      discuss,
      totalAdvance,
      totalBlood
    };
  }

  // Render toàn bộ Workspace Hội Chẩn Khoa
  function renderDeptConsultWorkspace() {
    const wsSection = document.getElementById('room-workspace-hoi-chan-khoa');
    if (!wsSection) return;

    // Đảm bảo activeDeptConsultDate hợp lệ
    if (!activeDeptConsultDate) activeDeptConsultDate = getSelectedDateKey();

    // 1. Cập nhật date picker
    const datePicker = document.getElementById('dept-consult-date-picker');
    if (datePicker && datePicker.value !== activeDeptConsultDate) {
      datePicker.value = activeDeptConsultDate;
    }

    // 2. Lấy dữ liệu hội chẩn ngày được chọn
    const consultPts = getAllConsultPatientsForDate(activeDeptConsultDate);
    const stats = getDeptConsultStatsForDate(activeDeptConsultDate);

    // 4. Cập nhật số đếm trên các filter pills
    const cntAll = document.getElementById('dept-filter-cnt-all');
    if (cntAll) cntAll.textContent = stats.total;

    ['tk1', 'tk2', 'tk3', 'tk4', 'hstk'].forEach(rk => {
      const el = document.getElementById(`dept-filter-cnt-${rk}`);
      if (el) {
        el.textContent = consultPts.filter(p => p.patientRoomKey === rk).length;
      }
    });

    document.querySelectorAll('#dept-consult-room-filters .dept-filter-pill').forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-filter-room') === activeDeptConsultFilterRoom);
    });

    // 5. Lọc danh sách bệnh nhân
    const q = (deptConsultSearchQuery || '').toLowerCase().trim();
    const filteredList = consultPts.filter(p => {
      if (activeDeptConsultFilterRoom !== 'ALL' && p.patientRoomKey !== activeDeptConsultFilterRoom) {
        return false;
      }
      if (!q) return true;
      const c = p.consultData || {};
      const bed = p.patientBedCode || '';
      const text = `${p.hoten} ${p.mabn} ${p.tuoi} ${bed} ${p.patientRoomName} ${p.chanDoanHis || ''} ${p.customDiagnosis || ''} ${c.postConsultDiagnosis || ''} ${c.surgeryMethod || ''} ${c.decision || ''}`.toLowerCase();
      return text.includes(q);
    });

    // Sắp xếp: TK4 trước, rồi theo giường
    const roomWeight = { tk4: 1, tk1: 2, tk2: 3, tk3: 4, hstk: 5 };
    filteredList.sort((a, b) => {
      const wA = roomWeight[a.patientRoomKey] || 99;
      const wB = roomWeight[b.patientRoomKey] || 99;
      if (wA !== wB) return wA - wB;
      const bedA = a.patientBedCode || '';
      const bedB = b.patientBedCode || '';
      if (bedA && !bedB) return -1;
      if (!bedA && bedB) return 1;
      if (bedA && bedB) return bedA.localeCompare(bedB, undefined, { numeric: true });
      return a.hoten.localeCompare(b.hoten, 'vi');
    });

    // 6. Render danh sách thẻ
    const containerEl = document.getElementById('dept-consult-cards-container');
    if (!containerEl) return;

    if (consultPts.length === 0) {
      containerEl.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; padding: 3rem 1rem; background: #ffffff; border: 1.5px dashed #86efac; border-radius: 14px;">
          <div style="font-size: 2.4rem; margin-bottom: 8px;">📋</div>
          <div style="font-size: 1.1rem; font-weight: 800; color: #15803d; margin-bottom: 6px;">
            Chưa có bệnh nhân nào trong danh sách Hội chẩn khoa ngày ${formatDateDisplayVN(activeDeptConsultDate)}
          </div>
          <div style="font-size: 0.85rem; color: #64748b; margin-bottom: 16px;">
            Mỗi phòng (TK1, TK2, TK3, HSTK) có nút <strong>"Chọn bệnh hội chẩn khoa"</strong>, riêng Thần kinh 4 có nút <strong>"Thêm hội chẩn"</strong> trên từng bệnh nhân.<br>
            Hoặc bạn có thể bấm nút bên dưới để chọn bệnh nhân ngay tại đây:
          </div>
          <button type="button" class="btn-primary-sm" onclick="window.TK1Module.openSelectPatientForConsultDeptModal('ALL')" style="background:#15803d;border-color:#14532d;padding:0.6rem 1.4rem;font-weight:800;font-size:0.9rem;cursor:pointer;">
            ➕ Chọn bệnh nhân đưa vào Hội chẩn khoa
          </button>
        </div>
      `;
      return;
    }

    if (filteredList.length === 0) {
      containerEl.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; padding: 2rem 1rem; background: #ffffff; border: 1.5px dashed #cbd5e1; border-radius: 14px; color: #64748b;">
          Không tìm thấy bệnh nhân nào khớp với bộ lọc hoặc từ khoá "<strong>${escapeHtml(q)}</strong>".
        </div>
      `;
      return;
    }

    containerEl.innerHTML = filteredList.map(p => renderDeptConsultPatientCard(p)).join('');
  }

  // Render thẻ chi tiết bệnh nhân trong Tab Hội Chẩn Khoa (1 thẻ nằm ngang fit trang)
  function renderDeptConsultPatientCard(p) {
    const c = p.consultData || {};
    const roomKey = p.patientRoomKey || 'tk1';
    const roomCls = `dc-room-${roomKey}`;
    const bedLabel = p.patientBedCode ? formatBedLabel(p.patientBedCode) : 'Chưa xếp giường';
    const dec = c.decision || '';
    const tagMeta = getDeptConsultTagMeta(dec);

    return `
      <div class="dept-consult-card ${tagMeta.cls}" id="dc-card-${p.mabn}">
        <!-- Card Header: Thông tin cơ bản & Tag kết luận dựa trên 4 option -->
        <div class="dc-card-header">
          <div class="dc-card-title-group">
            <span class="dc-room-badge ${roomCls}">${p.patientRoomName}</span>
            <span class="dc-bed-badge">${bedLabel}</span>
            <a href="javascript:void(0)" class="dc-patient-name" onclick="window.TK1Module.openPatientModal('${p.mabn}')" title="Xem hồ sơ bệnh nhân">
              ${p.hoten}
            </a>
            <span class="dc-patient-meta">· ${p.tuoi || '--'} · SVV: <strong>${p.soVaoVien || p.maKcb || p.mabn}</strong> · Vào viện: ${p.ngayVaoStr || '--'}</span>
          </div>
          <div>
            <span class="dc-tag-surg-status ${tagMeta.cls}" id="dc-tag-${p.mabn}">
              ${tagMeta.text}
            </span>
          </div>
        </div>

        <!-- Card Body: Nằm ngang fit toàn bộ độ rộng trang -->
        <div class="dc-card-body">
          <!-- Hàng 1: Chẩn đoán sau hội chẩn, Phương pháp phẫu thuật, Tiền ứng, Máu (trên 1 hàng ngang) -->
          <div class="dc-horizontal-fields-row">
            <div class="dc-field-block">
              <label class="dc-field-label" for="dc-diag-${p.mabn}">
                📝 Chẩn đoán sau hội chẩn:
              </label>
              <input
                type="text"
                class="date-input"
                id="dc-diag-${p.mabn}"
                value="${escapeHtml(c.postConsultDiagnosis || p.customDiagnosis || p.chanDoanHis || '')}"
                placeholder="Nhập chẩn đoán sau khi hội chẩn..."
                style="width:100%;height:35px;font-size:0.85rem;font-weight:700;color:#0f172a;"
              />
            </div>

            <div class="dc-field-block">
              <label class="dc-field-label" for="dc-method-${p.mabn}">
                🔪 Phương pháp phẫu thuật:
              </label>
              <input
                type="text"
                class="date-input"
                id="dc-method-${p.mabn}"
                value="${escapeHtml(c.surgeryMethod || '')}"
                placeholder="VD: Mở sọ bóc u, Cố định CS..."
                style="width:100%;height:35px;font-size:0.83rem;font-weight:700;color:#1e40af;"
              />
            </div>

            <div class="dc-field-block">
              <label class="dc-field-label" for="dc-pay-${p.mabn}">
                💰 Tiền ứng (tr):
              </label>
              <input
                type="text"
                class="date-input"
                id="dc-pay-${p.mabn}"
                value="${cleanPaymentForInput(c.advancePayment)}"
                placeholder="VD: 5..."
                title="Nhập số tiền ứng, đơn vị là triệu VNĐ"
                style="width:100%;height:35px;font-size:0.83rem;font-weight:800;color:#b45309;"
              />
            </div>

            <div class="dc-field-block">
              <label class="dc-field-label" for="dc-blood-${p.mabn}">
                🩸 Máu (ml):
              </label>
              <input
                type="text"
                class="date-input"
                id="dc-blood-${p.mabn}"
                value="${cleanBloodForInput(c.bloodMl)}"
                placeholder="VD: 250..."
                title="Lượng máu cần dự trù (ml)"
                style="width:100%;height:35px;font-size:0.83rem;font-weight:700;color:#b91c1c;"
              />
            </div>
          </div>

          <!-- Hàng 2: KẾT LUẬN HỘI CHẨN (ĐƯA XUỐNG DƯỚI, CHỈ NẰM TRÊN GHI CHÚ) -->
          <div class="dc-field-block">
            <label class="dc-field-label" for="dc-dec-${p.mabn}" style="color:#15803d;font-weight:800;">
              ⚖️ Kết luận hội chẩn (Quyết định):
            </label>
            <select
              class="dc-decision-select"
              id="dc-dec-${p.mabn}"
              onchange="window.TK1Module.onDeptDecisionChange('${p.mabn}', this.value)"
            >
              <option value="" ${!dec ? 'selected' : ''}>-- Chọn kết luận duyệt --</option>
              <option value="Đồng ý phẫu thuật" ${dec === 'Đồng ý phẫu thuật' || dec === 'Đồng ý' ? 'selected' : ''} style="color:#15803d;font-weight:800;">✓ Đồng ý phẫu thuật</option>
              <option value="Cần hội ý thêm" ${dec === 'Cần hội ý thêm' || dec === 'Hội ý' ? 'selected' : ''} style="color:#b45309;font-weight:800;">💬 Cần hội ý thêm</option>
              <option value="Không phẫu thuật" ${dec === 'Không phẫu thuật' || dec === 'Không đồng ý' ? 'selected' : ''} style="color:#dc2626;font-weight:800;">✕ Không phẫu thuật</option>
              <option value="Điều trị nội khoa" ${dec === 'Điều trị nội khoa' ? 'selected' : ''} style="color:#4338ca;font-weight:800;">💊 Điều trị nội khoa</option>
            </select>
          </div>

          <!-- Hàng 3: HƯỚNG XỬ TRÍ / GHI CHÚ (NẰM NGAY DƯỚI KẾT LUẬN) -->
          <div class="dc-field-block">
            <label class="dc-field-label" for="dc-plan-${p.mabn}" style="color:#0369a1;">
              📋 Hướng xử trí / Ghi chú kết luận:
            </label>
            <input
              type="text"
              class="date-input"
              id="dc-plan-${p.mabn}"
              value="${escapeHtml(c.treatmentPlan || p.tasksByDate?.[activeDeptConsultDate]?.note || p.consultDetails?.consultTreatment || '')}"
              placeholder="Hướng chuẩn bị, hội ý chuyên khoa, ghi chú xử trí..."
              style="width:100%;height:34px;font-size:0.83rem;"
            />
          </div>
        </div>

        <!-- Card Footer: Nút Thao tác -->
        <div class="dc-card-footer">
          <button
            type="button"
            class="btn-bed-mini"
            style="background:#fee2e2;color:#dc2626;border-color:#fca5a5;font-weight:700;height:32px;padding:0 9px;"
            onclick="window.TK1Module.removePatientFromDeptConsult('${p.mabn}')"
            title="Xoá ca này khỏi danh sách hội chẩn ngày ${formatDateDisplayVN(activeDeptConsultDate)}"
          >
            🗑️ Xoá khỏi HC
          </button>

          <div style="display:flex;align-items:center;gap:6px;">
            <button
              type="button"
              class="btn-bed-mini"
              style="background:#f1f5f9;color:#334155;border-color:#cbd5e1;font-weight:700;height:32px;padding:0 9px;"
              onclick="window.TK1Module.openPatientModal('${p.mabn}')"
              title="Xem đầy đủ hồ sơ bệnh nhân"
            >
              🔍 Xem BN
            </button>
            <button
              type="button"
              class="btn-primary-sm"
              id="btn-save-dc-${p.mabn}"
              style="background:#15803d;border-color:#14532d;font-weight:800;height:32px;padding:0 14px;cursor:pointer;"
              onclick="window.TK1Module.saveDeptConsultCard('${p.mabn}', this)"
              title="Lưu thông tin hội chẩn ca này và đồng bộ về phòng"
            >
              💾 Lưu
            </button>
          </div>
        </div>
      </div>
    `;
  }

  // Cập nhật tag và viền thẻ ngay khi thay đổi kết luận duyệt
  function onDeptDecisionChange(mabn, newDecision) {
    const tagMeta = getDeptConsultTagMeta(newDecision);
    const tagEl = document.getElementById(`dc-tag-${mabn}`);
    const card = document.getElementById(`dc-card-${mabn}`);
    if (tagEl) {
      tagEl.className = `dc-tag-surg-status ${tagMeta.cls}`;
      tagEl.textContent = tagMeta.text;
    }
    if (card) {
      card.classList.remove('tag-agree', 'tag-discuss', 'tag-no-surg', 'tag-medical', 'tag-pending');
      card.classList.add(tagMeta.cls);
    }
  }

  // Tương thích ngược
  function toggleCardSurgStatus() {}

  // Lưu thẻ hội chẩn trong Tab Hội Chẩn Khoa
  async function saveDeptConsultCard(mabn, btnEl) {
    const dKey = activeDeptConsultDate || getSelectedDateKey();
    const diag = (document.getElementById(`dc-diag-${mabn}`)?.value || '').trim();
    const decision = document.getElementById(`dc-dec-${mabn}`)?.value || '';
    const isSurg = Boolean(decision === 'Đồng ý phẫu thuật' || decision === 'Đồng ý');
    const method = (document.getElementById(`dc-method-${mabn}`)?.value || '').trim();
    const rawPayment = (document.getElementById(`dc-pay-${mabn}`)?.value || '').trim();
    const rawBlood = (document.getElementById(`dc-blood-${mabn}`)?.value || '').trim();
    const treatmentPlan = (document.getElementById(`dc-plan-${mabn}`)?.value || '').trim();

    const payment = formatPaymentWithMillion(rawPayment);
    const bloodMl = formatBloodMl(rawBlood);

    const origText = btnEl ? btnEl.innerHTML : '💾 Lưu';
    if (btnEl) btnEl.innerHTML = '⏳';

    await callTk1Api({
      action: 'SAVE_SURGICAL_CONSULTATION',
      mabn,
      dateKey: dKey,
      postConsultDiagnosis: diag,
      surgeryMethod: method,
      decision,
      advancePayment: payment,
      bloodMl,
      isSurgical: isSurg,
      treatmentPlan,
      isConsulted: true
    });

    // Cập nhật local state
    const consultObj = {
      isConsulted: true,
      isSurgical: isSurg,
      dateKey: dKey,
      postConsultDiagnosis: diag,
      surgeryMethod: method,
      decision,
      advancePayment: payment,
      bloodMl,
      treatmentPlan,
      updatedAt: new Date().toISOString()
    };

    if (allRoomsState) {
      Object.values(allRoomsState).forEach(r => {
        if (r && r.patientRecords && r.patientRecords[mabn]) {
          const rec = r.patientRecords[mabn];
          if (!rec.surgicalConsultationsByDate) rec.surgicalConsultationsByDate = {};
          rec.surgicalConsultationsByDate[dKey] = consultObj;
          rec.surgicalConsultation = consultObj;
          if (diag) rec.customDiagnosis = diag;
          if (treatmentPlan) {
            rec.consultTreatment = treatmentPlan;
            if (!rec.tasksByDate) rec.tasksByDate = {};
            if (!rec.tasksByDate[dKey]) rec.tasksByDate[dKey] = {};
            rec.tasksByDate[dKey].note = treatmentPlan;
          }
        }
      });
    }

    if (btnEl) {
      btnEl.innerHTML = '✓ Đã lưu';
      btnEl.style.background = '#16a34a';
      setTimeout(() => {
        btnEl.innerHTML = origText;
        btnEl.style.background = '#15803d';
      }, 1400);
    }

    // Cập nhật KPI và thanh phòng
    renderDeptConsultWorkspace();
    if (typeof renderWard5RoomsGrid === 'function') renderWard5RoomsGrid();
  }

  // Xoá bệnh nhân khỏi hội chẩn khoa
  async function removePatientFromDeptConsult(mabn) {
    const dKey = activeDeptConsultDate || getSelectedDateKey();
    let pName = mabn;
    if (allRoomsState) {
      for (const r of Object.values(allRoomsState)) {
        if (r?.patientRecords?.[mabn]) {
          pName = r.patientRecords[mabn].hoten;
          break;
        }
      }
    }

    if (!confirm(`Bạn có chắc muốn xoá bệnh nhân [${pName}] khỏi danh sách Hội chẩn khoa ngày ${formatDateDisplayVN(dKey)}?`)) {
      return;
    }

    await callTk1Api({
      action: 'DELETE_SURGICAL_CONSULTATION',
      mabn,
      dateKey: dKey
    });

    if (allRoomsState) {
      Object.values(allRoomsState).forEach(r => {
        if (r?.patientRecords?.[mabn]) {
          const rec = r.patientRecords[mabn];
          if (rec.surgicalConsultationsByDate) {
            delete rec.surgicalConsultationsByDate[dKey];
          }
          if (rec.surgicalConsultation && (!rec.surgicalConsultation.dateKey || rec.surgicalConsultation.dateKey === dKey)) {
            delete rec.surgicalConsultation;
          }
        }
      });
    }

    renderDeptConsultWorkspace();
    if (typeof renderWard5RoomsGrid === 'function') renderWard5RoomsGrid();
  }

  // Mở modal chọn bệnh nhân đưa vào Hội chẩn khoa (Yêu cầu 1 & 3)
  function openSelectPatientForConsultDeptModal(defaultRoomKey = 'ALL') {
    const dlg = document.getElementById('dept-consult-select-modal');
    if (!dlg) return;

    const dateInp = document.getElementById('dept-consult-modal-date');
    const roomSel = document.getElementById('dept-consult-modal-room-sel');
    const searchInp = document.getElementById('dept-consult-modal-search');
    const titleEl = document.getElementById('dept-consult-select-title');

    // Ngày hội chẩn (BẮT BUỘC)
    const targetDate = activeDeptConsultDate || getSelectedDateKey();
    if (dateInp) dateInp.value = targetDate;

    // Phòng điều trị
    const initialRoom = (defaultRoomKey && defaultRoomKey !== 'ALL') ? defaultRoomKey : currentRoomKey;
    const finalRoom = (initialRoom && initialRoom !== 'hoi-chan-khoa') ? initialRoom : 'tk1';
    if (roomSel) roomSel.value = finalRoom;

    if (searchInp) searchInp.value = '';

    const roomNames = {
      tk1: 'Thần kinh 1',
      tk2: 'Thần kinh 2',
      tk3: 'Thần kinh 3',
      tk4: 'Thần kinh 4',
      hstk: 'Hồi sức thần kinh'
    };
    if (titleEl) {
      titleEl.innerHTML = `Chọn bệnh nhân đưa vào Hội chẩn khoa — <strong>${roomNames[finalRoom] || 'Toàn khoa'}</strong>`;
    }

    renderDeptConsultSelectModalList();
    dlg.showModal();
  }

  // Render danh sách bệnh nhân trong modal chọn bệnh nhân
  function renderDeptConsultSelectModalList() {
    const listEl = document.getElementById('dept-consult-modal-patient-list');
    const dateInp = document.getElementById('dept-consult-modal-date');
    const roomSel = document.getElementById('dept-consult-modal-room-sel');
    const searchInp = document.getElementById('dept-consult-modal-search');
    if (!listEl || !dateInp || !roomSel) return;

    const selDate = dateInp.value || getTodayKey();
    const selRoom = roomSel.value || 'tk1';
    const q = (searchInp?.value || '').toLowerCase().trim();

    const targetRoomState = allRoomsState?.[selRoom] || (currentRoomKey === selRoom ? tk1State : null);
    const patients = Object.values(targetRoomState?.patientRecords || {}).filter(r => !r.removed?.isRemoved);

    const filtered = patients.filter(p => {
      if (!q) return true;
      let bed = '';
      for (const [b, m] of Object.entries(targetRoomState?.bedAssignments || {})) {
        if (m === p.mabn) { bed = b; break; }
      }
      const text = `${p.hoten} ${p.mabn} ${p.tuoi} ${bed} ${p.chanDoanHis || ''} ${p.customDiagnosis || ''}`.toLowerCase();
      return text.includes(q);
    });

    if (filtered.length === 0) {
      listEl.innerHTML = `
        <div style="text-align:center;padding:1.5rem;color:#64748b;font-size:0.85rem;">
          Không tìm thấy bệnh nhân nào trong phòng này${q ? ` khớp từ khoá "${escapeHtml(q)}"` : ''}.
        </div>
      `;
      return;
    }

    listEl.innerHTML = filtered.map(p => {
      let bedCode = null;
      for (const [b, m] of Object.entries(targetRoomState?.bedAssignments || {})) {
        if (m === p.mabn) { bedCode = b; break; }
      }
      const bedLabel = bedCode ? formatBedLabel(bedCode) : 'Chưa xếp giường';
      const sc = getPatientSurgicalConsultation(p, selDate);
      const isAlreadyAdded = Boolean(sc && sc.isConsulted);

      return `
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;background:#ffffff;border:1.5px solid ${isAlreadyAdded ? '#86efac' : '#e2e8f0'};border-radius:10px;padding:0.65rem 0.9rem;">
          <div style="flex:1;min-width:0;">
            <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
              <span class="dc-bed-badge">${bedLabel}</span>
              <strong style="color:#0f172a;font-size:0.92rem;">${p.hoten}</strong>
              <span style="font-size:0.75rem;color:#64748b;">· ${p.tuoi || '--'} · SVV: ${p.soVaoVien || p.maKcb || p.mabn}</span>
            </div>
            <div style="font-size:0.75rem;color:#475569;margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
              <strong>CĐ ban đầu:</strong> ${escapeHtml(p.customDiagnosis || p.chanDoanHis || 'Chưa có')}
            </div>
          </div>

          <div style="flex-shrink:0;">
            ${
              isAlreadyAdded
                ? `<span style="font-size:0.75rem;font-weight:800;color:#15803d;background:#dcfce7;border:1px solid #86efac;padding:4px 10px;border-radius:6px;display:inline-flex;align-items:center;gap:4px;">
                    ✓ Đã trong HC ngày ${formatDateDisplayVN(selDate)}
                  </span>`
                : `<button
                    type="button"
                    class="btn-primary-sm"
                    style="background:#15803d;border-color:#14532d;font-weight:800;font-size:0.8rem;padding:0.4rem 0.9rem;cursor:pointer;"
                    onclick="window.TK1Module.addPatientToConsultFromModal('${p.mabn}', this)"
                  >
                    ➕ Đưa vào HC
                  </button>`
            }
          </div>
        </div>
      `;
    }).join('');
  }

  // Thao tác bấm thêm bệnh nhân từ trong modal
  async function addPatientToConsultFromModal(mabn, btnEl) {
    const dateInp = document.getElementById('dept-consult-modal-date');
    const targetDate = dateInp?.value || getTodayKey();

    let pRec = null;
    if (allRoomsState) {
      for (const r of Object.values(allRoomsState)) {
        if (r?.patientRecords?.[mabn]) {
          pRec = r.patientRecords[mabn];
          break;
        }
      }
    }
    const defaultDiag = pRec?.customDiagnosis || pRec?.chanDoanHis || '';

    if (btnEl) {
      btnEl.innerHTML = '⏳';
      btnEl.disabled = true;
    }

    await callTk1Api({
      action: 'SAVE_SURGICAL_CONSULTATION',
      mabn,
      dateKey: targetDate,
      postConsultDiagnosis: defaultDiag,
      surgeryMethod: '',
      decision: '',
      advancePayment: '',
      bloodMl: '',
      isSurgical: false,
      isConsulted: true
    });

    const consultObj = {
      isConsulted: true,
      isSurgical: false,
      dateKey: targetDate,
      postConsultDiagnosis: defaultDiag,
      surgeryMethod: '',
      decision: '',
      advancePayment: '',
      bloodMl: '',
      updatedAt: new Date().toISOString()
    };

    if (allRoomsState) {
      Object.values(allRoomsState).forEach(r => {
        if (r?.patientRecords?.[mabn]) {
          const rec = r.patientRecords[mabn];
          if (!rec.surgicalConsultationsByDate) rec.surgicalConsultationsByDate = {};
          rec.surgicalConsultationsByDate[targetDate] = consultObj;
          rec.surgicalConsultation = consultObj;
        }
      });
    }

    // Hiển thị nút xem Tab Hội Chẩn Khoa
    const gotoBtn = document.getElementById('btn-dept-consult-modal-goto-tab');
    if (gotoBtn) gotoBtn.style.display = 'inline-flex';

    const statusText = document.getElementById('dept-consult-modal-status-text');
    if (statusText) {
      statusText.textContent = `✓ Đã thêm ${pRec?.hoten || 'BN'} vào HC ngày ${formatDateDisplayVN(targetDate)}!`;
    }

    renderDeptConsultSelectModalList();
    renderDeptConsultWorkspace();
    renderTk1Workspace();
    if (typeof renderWard5RoomsGrid === 'function') renderWard5RoomsGrid();
  }

  // Hộp thoại đơn giản riêng cho Thần kinh 4 (Yêu cầu 2: Chỉ chọn ngày hội chẩn & chẩn đoán ban đầu)
  function openTk4SimpleConsultDialog(mabn) {
    activeTk4SimpleMabn = mabn;
    const rec = tk1State.patientRecords?.[mabn] || allRoomsState?.tk4?.patientRecords?.[mabn];
    if (!rec) return;

    const dlg = document.getElementById('tk4-add-consult-simple-dialog');
    const patientBox = document.getElementById('tk4-simple-consult-patient-box');
    const dateInp = document.getElementById('tk4-simple-consult-date');
    const diagInp = document.getElementById('tk4-simple-consult-diag');
    if (!dlg) return;

    const curDateKey = getSelectedDateKey();
    const bedCode = getBedOfPatient(mabn);
    const bedLabel = bedCode ? formatBedLabel(bedCode) : 'Chưa xếp giường';

    if (patientBox) {
      patientBox.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:6px;">
          <div>
            <span class="dc-bed-badge" style="background:#dcfce7;color:#166534;border-color:#86efac;">${bedLabel}</span>
            <strong style="font-size:0.96rem;color:#0f172a;margin-left:5px;">${rec.hoten}</strong>
            <span style="font-size:0.78rem;color:#64748b;">· ${rec.tuoi || '--'}</span>
          </div>
          <span style="font-size:0.78rem;color:#004aad;font-weight:700;">SVV: ${rec.soVaoVien || rec.maKcb || rec.mabn}</span>
        </div>
        <div style="font-size:0.76rem;color:#475569;margin-top:4px;">
          <strong>Chẩn đoán HIS:</strong> ${escapeHtml(rec.chanDoanHis || 'Chưa có')}
        </div>
      `;
    }

    if (dateInp) {
      dateInp.value = curDateKey;
    }

    if (diagInp) {
      const existingSc = getPatientSurgicalConsultation(rec, curDateKey);
      diagInp.value = existingSc?.postConsultDiagnosis || rec.customDiagnosis || rec.chanDoanHis || '';
    }

    dlg.showModal();
  }

  // Xác nhận lưu từ hộp thoại đơn giản riêng của TK4
  async function saveTk4SimpleConsult() {
    if (!activeTk4SimpleMabn) return;
    const mabn = activeTk4SimpleMabn;
    const dateInp = document.getElementById('tk4-simple-consult-date');
    const diagInp = document.getElementById('tk4-simple-consult-diag');
    const saveBtn = document.getElementById('btn-tk4-simple-consult-save');

    const targetDate = dateInp?.value;
    if (!targetDate) {
      alert('Vui lòng chọn ngày hội chẩn!');
      return;
    }

    const diag = (diagInp?.value || '').trim();

    if (saveBtn) {
      saveBtn.innerHTML = '⏳ Đang lưu...';
      saveBtn.disabled = true;
    }

    await callTk1Api({
      action: 'SAVE_SURGICAL_CONSULTATION',
      mabn,
      dateKey: targetDate,
      postConsultDiagnosis: diag,
      surgeryMethod: '',
      decision: '',
      advancePayment: '',
      bloodMl: '',
      isSurgical: false,
      isConsulted: true
    });

    const consultObj = {
      isConsulted: true,
      isSurgical: false,
      dateKey: targetDate,
      postConsultDiagnosis: diag,
      surgeryMethod: '',
      decision: '',
      advancePayment: '',
      bloodMl: '',
      updatedAt: new Date().toISOString()
    };

    if (allRoomsState) {
      Object.values(allRoomsState).forEach(r => {
        if (r?.patientRecords?.[mabn]) {
          const rec = r.patientRecords[mabn];
          if (!rec.surgicalConsultationsByDate) rec.surgicalConsultationsByDate = {};
          rec.surgicalConsultationsByDate[targetDate] = consultObj;
          rec.surgicalConsultation = consultObj;
          if (diag) rec.customDiagnosis = diag;
        }
      });
    }

    if (saveBtn) {
      saveBtn.innerHTML = '💾 Xác nhận đưa vào Hội chẩn';
      saveBtn.disabled = false;
    }

    const dlg = document.getElementById('tk4-add-consult-simple-dialog');
    if (dlg) dlg.close();

    renderTk1Workspace();
    renderDeptConsultWorkspace();
    if (typeof renderWard5RoomsGrid === 'function') renderWard5RoomsGrid();

    // Thông báo toast
    let pName = mabn;
    if (allRoomsState?.tk4?.patientRecords?.[mabn]) {
      pName = allRoomsState.tk4.patientRecords[mabn].hoten;
    }
    showWardToast(`✓ Đã đưa BN ${pName} vào Hội chẩn khoa ngày ${formatDateDisplayVN(targetDate)}! Các thông tin còn lại thao tác tại Tab Hội chẩn khoa.`);
  }

  // Chuyển tới Tab Hội Chẩn Khoa và cuộn đến bệnh nhân cụ thể
  function goToDeptConsultDate(dateKey, mabn) {
    if (dateKey) {
      activeDeptConsultDate = dateKey;
    }
    if (typeof selectWardRoom === 'function') {
      selectWardRoom('hoi-chan-khoa');
    }
    renderDeptConsultWorkspace();

    if (mabn) {
      setTimeout(() => {
        const card = document.getElementById(`dc-card-${mabn}`);
        if (card) {
          card.scrollIntoView({ behavior: 'smooth', block: 'center' });
          card.style.outline = '3px solid #16a34a';
          card.style.boxShadow = '0 0 20px rgba(22, 163, 74, 0.4)';
          setTimeout(() => {
            card.style.outline = '';
            card.style.boxShadow = '';
          }, 2400);
        }
      }, 250);
    }
  }

  // In danh sách Hội Chẩn Khoa A4 chuẩn y tế
  function openDeptConsultPrintModal() {
    const dlg = document.getElementById('dept-consult-print-modal');
    const area = document.getElementById('dept-consult-print-area');
    if (!dlg || !area) return;

    const dKey = activeDeptConsultDate || getTodayKey();
    const pts = getAllConsultPatientsForDate(dKey);

    area.innerHTML = `
      <div style="text-align:center;margin-bottom:1.5rem;">
        <div style="font-size:0.9rem;font-weight:700;color:#334155;text-transform:uppercase;">BỆNH VIỆN ĐA KHOA TRUNG TÂM TỈNH GIA LAI</div>
        <div style="font-size:1rem;font-weight:800;color:#15803d;text-transform:uppercase;">KHOA NGOẠI THẦN KINH - CỘT SỐNG</div>
        <div style="margin:1rem 0 0.5rem;font-size:1.35rem;font-weight:900;color:#0f172a;letter-spacing:-0.3px;">
          DANH SÁCH BỆNH NHÂN HỘI CHẨN MỔ
        </div>
        <div style="font-size:0.88rem;color:#475569;font-weight:700;">
          Ngày hội chẩn: ${formatDateDisplayVN(dKey)} · Tổng số: ${pts.length} ca
        </div>
      </div>

      <table style="width:100%;border-collapse:collapse;font-size:0.82rem;font-family:'Be Vietnam Pro',sans-serif;">
        <thead>
          <tr style="background:#f1f5f9;border-top:1.5px solid #0f172a;border-bottom:1.5px solid #0f172a;">
            <th style="padding:7px 5px;border:1px solid #cbd5e1;width:35px;text-align:center;">STT</th>
            <th style="padding:7px 8px;border:1px solid #cbd5e1;width:110px;">Phòng / Giường</th>
            <th style="padding:7px 8px;border:1px solid #cbd5e1;width:160px;">Họ và tên</th>
            <th style="padding:7px 5px;border:1px solid #cbd5e1;width:45px;text-align:center;">Tuổi</th>
            <th style="padding:7px 8px;border:1px solid #cbd5e1;">Chẩn đoán sau hội chẩn</th>
            <th style="padding:7px 8px;border:1px solid #cbd5e1;">Phương pháp phẫu thuật</th>
            <th style="padding:7px 5px;border:1px solid #cbd5e1;width:75px;text-align:center;">Máu</th>
            <th style="padding:7px 5px;border:1px solid #cbd5e1;width:75px;text-align:center;">Ứng</th>
            <th style="padding:7px 8px;border:1px solid #cbd5e1;width:100px;text-align:center;">Kết luận duyệt</th>
          </tr>
        </thead>
        <tbody>
          ${
            pts.length > 0
              ? pts.map((p, idx) => {
                  const c = p.consultData || {};
                  const bedLabel = p.patientBedCode ? formatBedLabel(p.patientBedCode) : 'Chưa xếp';
                  const isSurg = Boolean(c.isSurgical !== undefined ? c.isSurgical : (c.decision === 'Đồng ý' || (c.surgeryMethod && c.surgeryMethod.length > 0)));
                  return `
                    <tr style="border-bottom:1px solid #cbd5e1;">
                      <td style="padding:6px 4px;border:1px solid #cbd5e1;text-align:center;font-weight:700;">${idx + 1}</td>
                      <td style="padding:6px 8px;border:1px solid #cbd5e1;">
                        <span style="font-weight:700;">${p.patientRoomName}</span><br>
                        <span style="color:#0369a1;font-weight:800;">${bedLabel}</span>
                      </td>
                      <td style="padding:6px 8px;border:1px solid #cbd5e1;">
                        <strong style="color:#0f172a;font-size:0.86rem;">${p.hoten}</strong><br>
                        <span style="font-size:0.72rem;color:#64748b;">SVV: ${p.soVaoVien || p.maKcb || p.mabn}</span>
                      </td>
                      <td style="padding:6px 4px;border:1px solid #cbd5e1;text-align:center;">${p.tuoi || '--'}</td>
                      <td style="padding:6px 8px;border:1px solid #cbd5e1;font-weight:700;">
                        ${escapeHtml(c.postConsultDiagnosis || p.customDiagnosis || p.chanDoanHis || '--')}
                      </td>
                      <td style="padding:6px 8px;border:1px solid #cbd5e1;color:#1e40af;font-weight:700;">
                        ${escapeHtml(c.surgeryMethod || (isSurg ? 'Chưa nhập phương pháp' : 'Điều trị nội khoa'))}
                      </td>
                      <td style="padding:6px 4px;border:1px solid #cbd5e1;text-align:center;color:#b91c1c;font-weight:800;">
                        ${c.bloodMl || '--'}
                      </td>
                      <td style="padding:6px 4px;border:1px solid #cbd5e1;text-align:center;color:#b45309;font-weight:800;">
                        ${c.advancePayment || '--'}
                      </td>
                      <td style="padding:6px 8px;border:1px solid #cbd5e1;text-align:center;font-weight:800;">
                        ${c.decision || (isSurg ? 'Đồng ý' : 'Nội khoa')}
                      </td>
                    </tr>
                  `;
                }).join('')
              : `<tr><td colspan="9" style="text-align:center;padding:1.5rem;color:#64748b;">Không có bệnh nhân nào trong danh sách ngày này.</td></tr>`
          }
        </tbody>
      </table>

      <div style="display:flex;justify-content:space-between;margin-top:2.5rem;padding:0 2rem;font-size:0.88rem;">
        <div style="text-align:center;">
          <strong>BÁC SĨ ĐIỀU TRỊ</strong><br>
          <span style="font-size:0.75rem;color:#64748b;">(Ký và ghi rõ họ tên)</span>
        </div>
        <div style="text-align:center;">
          <strong>PHẪU THUẬT VIÊN</strong><br>
          <span style="font-size:0.75rem;color:#64748b;">(Ký và ghi rõ họ tên)</span>
        </div>
        <div style="text-align:center;">
          <strong>CHỦ TOẠ / TRƯỞNG KHOA</strong><br>
          <span style="font-size:0.75rem;color:#64748b;">(Ký và ghi rõ họ tên)</span>
        </div>
      </div>
    `;

    dlg.showModal();
  }

  // =========================================================================
  // THẦN KINH 4: HỘI CHẨN MỔ (BOX DANH SÁCH BỆNH NHÂN + MODAL + INLINE SAVE)
  // =========================================================================
  let tk4ScBoxCollapsed = false;
  let tk4ScSearchQuery = '';
  let activeScDialogMabn = null;

  function renderTk4SurgicalConsultBox() {
    const boxEl = document.getElementById('tk4-surgical-consult-box');
    if (!boxEl) return;

    if (currentRoomKey !== 'tk4') {
      boxEl.style.display = 'none';
      return;
    }

    boxEl.style.display = 'block';

    const curDateKey = getSelectedDateKey();
    const bodyEl = document.getElementById('tk4-sc-box-body');
    const statsBadge = document.getElementById('tk4-sc-box-stats-badge');
    const collapseBtn = document.getElementById('btn-toggle-tk4-sc-collapse');

    const mainTitleEl = document.getElementById('tk4-sc-box-main-title');
    const subTitleEl = document.getElementById('tk4-sc-box-sub-title');
    if (mainTitleEl) {
      mainTitleEl.textContent = `HỘI CHẨN MỔ — THẦN KINH 4 (${formatDateDisplayVN(curDateKey)})`;
    }
    if (subTitleEl) {
      subTitleEl.textContent = `Danh sách hội chẩn mổ ngày ${formatDateDisplayVN(curDateKey)} · Nhập thông tin & kết luận duyệt mổ`;
    }

    if (bodyEl) {
      bodyEl.style.display = tk4ScBoxCollapsed ? 'none' : 'flex';
    }
    if (collapseBtn) {
      collapseBtn.textContent = tk4ScBoxCollapsed ? '▸ Mở rộng' : '▾ Thu gọn';
    }

    const allActivePatients = Object.values(tk1State.patientRecords || {})
      .filter(r => !r.removed?.isRemoved);

    const totalPatients = allActivePatients.length;
    const consultedList = allActivePatients.filter(r => {
      const sc = getPatientSurgicalConsultation(r, curDateKey);
      return Boolean(sc && sc.isConsulted);
    });
    const agreeCount = consultedList.filter(r => getPatientSurgicalConsultation(r, curDateKey)?.decision === 'Đồng ý').length;
    const discussCount = consultedList.filter(r => getPatientSurgicalConsultation(r, curDateKey)?.decision === 'Hội ý').length;
    const disagreeCount = consultedList.filter(r => getPatientSurgicalConsultation(r, curDateKey)?.decision === 'Không đồng ý').length;

    if (statsBadge) {
      statsBadge.textContent = `${consultedList.length} ca HC hôm nay (✓ ${agreeCount} · 💬 ${discussCount} · ✕ ${disagreeCount})`;
    }

    // Filter patients by search query in consultedList
    const q = tk4ScSearchQuery.toLowerCase().trim();
    const filteredPatients = consultedList.filter(r => {
      if (!q) return true;
      const bed = getBedOfPatient(r.mabn) || '';
      const sc = getPatientSurgicalConsultation(r, curDateKey) || {};
      const searchStr = `${r.hoten} ${r.mabn} ${r.tuoi} ${bed} ${r.chanDoanHis || ''} ${sc.postConsultDiagnosis || ''} ${sc.surgeryMethod || ''} ${sc.decision || ''} ${sc.bloodMl || ''} ${sc.advancePayment || ''}`.toLowerCase();
      return searchStr.includes(q);
    });

    // Sort: assigned to bed first (by bed order), then unassigned
    filteredPatients.sort((a, b) => {
      const bedA = getBedOfPatient(a.mabn);
      const bedB = getBedOfPatient(b.mabn);
      if (bedA && !bedB) return -1;
      if (!bedA && bedB) return 1;
      if (bedA && bedB) {
        return bedA.localeCompare(bedB, undefined, { numeric: true });
      }
      return a.hoten.localeCompare(b.hoten, 'vi');
    });

    if (!bodyEl) return;

    if (consultedList.length === 0) {
      bodyEl.innerHTML = `
        <div style="text-align:center;padding:2rem 1rem;color:#64748b;font-size:0.88rem;">
          <div style="font-size:1.8rem;margin-bottom:6px;">📋</div>
          <div style="font-weight:700;color:#334155;margin-bottom:4px;">Chưa có ca nào trong danh sách Hội chẩn mổ hôm nay (${formatDateDisplayVN(curDateKey)})</div>
          <div style="font-size:0.82rem;color:#64748b;margin-bottom:12px;">Mặc định danh sách này không có ca nào. Bấm nút <strong>"➕ Thêm hội chẩn mổ"</strong> trên thẻ giường bệnh hoặc bấm nút bên dưới:</div>
          <button type="button" class="btn-primary-sm" onclick="window.TK1Module.openAddPatientToScDialog()" style="background:#15803d;border-color:#14532d;padding:0.45rem 1.1rem;font-weight:800;font-size:0.85rem;cursor:pointer;">
            ➕ Thêm bệnh nhân vào Hội chẩn mổ
          </button>
        </div>
      `;
      return;
    }

    if (filteredPatients.length === 0) {
      bodyEl.innerHTML = `
        <div style="text-align:center;padding:1.5rem;color:#64748b;font-size:0.88rem;">
          Không tìm thấy bệnh nhân nào trong danh sách hội chẩn mổ khớp từ khóa "<strong>${q}</strong>".
        </div>
      `;
      return;
    }

    bodyEl.innerHTML = filteredPatients.map(rec => {
      const bedCode = getBedOfPatient(rec.mabn);
      const bedLabel = bedCode ? formatBedLabel(bedCode) : 'Chưa xếp';
      const sc = getPatientSurgicalConsultation(rec, curDateKey) || {};
      const dec = sc.decision || '';
      const isConsulted = Boolean(sc && sc.isConsulted);

      let decColor = '#475569';
      if (dec === 'Đồng ý') decColor = '#15803d';
      else if (dec === 'Hội ý') decColor = '#b45309';
      else if (dec === 'Không đồng ý') decColor = '#dc2626';

      return `
        <div class="tk4-sc-row-card is-consulted" id="tk4-sc-row-${rec.mabn}">
          <!-- Cột 1: Thông tin bệnh nhân -->
          <div>
            <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
              <span class="tk1-bed-num-badge" style="min-width:26px;height:22px;font-size:0.75rem;padding:0 5px;background:#e0e7ff;color:#3730a3;border:1px solid #c7d2fe;">${bedLabel}</span>
              <a href="javascript:void(0)" onclick="window.TK1Module.openPatientModal('${rec.mabn}')" style="font-weight:800;color:#004aad;text-decoration:none;font-size:0.85rem;" title="Xem chi tiết bệnh nhân">
                ${rec.hoten}
              </a>
              <span style="font-size:0.75rem;color:#64748b;">· ${String(rec.tuoi || '--').replace(/\s*tuổi/gi, '').trim()} · SVV: ${rec.soVaoVien || rec.maKcb || rec.mabn}</span>
            </div>
          </div>

          <!-- Cột 2: Chẩn đoán sau hội chẩn -->
          <div>
            <input
              type="text"
              class="date-input"
              id="sc-diag-${rec.mabn}"
              value="${(sc.postConsultDiagnosis || '').replace(/"/g, '&quot;')}"
              placeholder="Chẩn đoán sau hội chẩn..."
              style="width:100%;height:34px;font-size:0.8rem;font-weight:700;font-family:'Be Vietnam Pro',sans-serif;"
            />
          </div>

          <!-- Cột 3: Phương pháp phẫu thuật -->
          <div>
            <input
              type="text"
              class="date-input"
              id="sc-method-${rec.mabn}"
              value="${(sc.surgeryMethod || '').replace(/"/g, '&quot;')}"
              placeholder="Phương pháp phẫu thuật..."
              style="width:100%;height:34px;font-size:0.8rem;font-weight:700;color:#1e40af;font-family:'Be Vietnam Pro',sans-serif;"
            />
          </div>

          <!-- Cột 4: Kết luận phẫu thuật -->
          <div>
            <select
              class="date-input"
              id="sc-decision-${rec.mabn}"
              style="width:100%;height:34px;font-size:0.8rem;font-weight:800;color:${decColor};font-family:'Be Vietnam Pro',sans-serif;"
              onchange="this.style.color = this.value === 'Đồng ý' ? '#15803d' : this.value === 'Hội ý' ? '#b45309' : this.value === 'Không đồng ý' ? '#dc2626' : '#475569';"
            >
              <option value="" ${!dec ? 'selected' : ''}>-- Kết luận mổ --</option>
              <option value="Đồng ý" ${dec === 'Đồng ý' ? 'selected' : ''} style="color:#15803d;font-weight:800;">✓ Đồng ý phẫu thuật</option>
              <option value="Hội ý" ${dec === 'Hội ý' ? 'selected' : ''} style="color:#b45309;font-weight:800;">💬 Cần hội ý thêm</option>
              <option value="Không đồng ý" ${dec === 'Không đồng ý' ? 'selected' : ''} style="color:#dc2626;font-weight:800;">✕ Không đồng ý</option>
            </select>
          </div>

          <!-- Cột 5: Máu -->
          <div>
            <input
              type="text"
              class="date-input"
              id="sc-blood-${rec.mabn}"
              value="${cleanBloodForInput(sc.bloodMl)}"
              placeholder="Máu: ...ml"
              title="Lượng máu cần chuẩn bị (ml)"
              style="width:100%;height:34px;font-size:0.8rem;font-weight:700;color:#b91c1c;font-family:'Be Vietnam Pro',sans-serif;"
            />
          </div>

          <!-- Cột 6: Tiền ứng -->
          <div>
            <input
              type="text"
              class="date-input"
              id="sc-payment-${rec.mabn}"
              value="${cleanPaymentForInput(sc.advancePayment)}"
              placeholder="Ứng: ... tr"
              title="Chỉ cần nhập số, đơn vị mặc định là triệu"
              style="width:100%;height:34px;font-size:0.8rem;font-weight:800;color:#b45309;font-family:'Be Vietnam Pro',sans-serif;"
            />
          </div>

          <!-- Cột 7: Thao tác -->
          <div style="display:flex;align-items:center;gap:4px;justify-content:flex-end;">
            <button
              type="button"
              class="btn-primary-sm"
              style="height:34px;padding:0 9px;font-size:0.78rem;background:#15803d;border-color:#14532d;font-weight:800;white-space:nowrap;cursor:pointer;"
              onclick="window.TK1Module.saveInlineScRow('${rec.mabn}', this)"
              title="Lưu thông tin hội chẩn mổ của bệnh nhân này"
            >
              💾 Lưu
            </button>
            <button
              type="button"
              class="btn-bed-mini"
              style="height:34px;padding:0 8px;font-size:0.78rem;background:#ffffff;border-color:#86efac;color:#166534;font-weight:700;cursor:pointer;"
              data-open-tk4-consult="${rec.mabn}"
              title="Mở bảng chi tiết"
            >
              🔍
            </button>
            <button
              type="button"
              class="btn-bed-mini"
              style="height:34px;padding:0 7px;font-size:0.78rem;background:#fee2e2;border-color:#fca5a5;color:#dc2626;font-weight:700;cursor:pointer;"
              data-remove-tk4-consult="${rec.mabn}"
              title="Xoá ca này khỏi danh sách hội chẩn mổ hôm nay"
            >
              🗑️
            </button>
          </div>
        </div>
      `;
    }).join('');

    bodyEl.querySelectorAll('[data-open-tk4-consult]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const mabn = btn.getAttribute('data-open-tk4-consult');
        if (mabn) openTk4SurgConsultDialog(mabn);
      });
    });

    bodyEl.querySelectorAll('.tk4-sc-row-card').forEach(card => {
      card.style.cursor = 'pointer';
      card.addEventListener('click', (e) => {
        if (e.target.closest('input, select, button, a')) return;
        const id = card.id;
        const mabn = id.replace('tk4-sc-row-', '');
        if (mabn) openTk4SurgConsultDialog(mabn);
      });
    });

    bodyEl.querySelectorAll('[data-remove-tk4-consult]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const mabn = btn.getAttribute('data-remove-tk4-consult');
        if (mabn) removePatientFromSurgicalConsultation(mabn);
      });
    });
  }

  async function saveInlineScRow(mabn, btnEl) {
    const curDateKey = getSelectedDateKey();
    const diag = (document.getElementById(`sc-diag-${mabn}`)?.value || '').trim();
    const method = (document.getElementById(`sc-method-${mabn}`)?.value || '').trim();
    const decision = document.getElementById(`sc-decision-${mabn}`)?.value || '';
    const rawBlood = (document.getElementById(`sc-blood-${mabn}`)?.value || '').trim();
    const rawPayment = (document.getElementById(`sc-payment-${mabn}`)?.value || '').trim();
    const bloodMl = formatBloodMl(rawBlood);
    const payment = formatPaymentWithMillion(rawPayment);

    const origHtml = btnEl ? btnEl.innerHTML : '💾 Lưu';
    if (btnEl) btnEl.innerHTML = '⏳';

    await callTk1Api({
      action: 'SAVE_SURGICAL_CONSULTATION',
      mabn,
      dateKey: curDateKey,
      postConsultDiagnosis: diag,
      surgeryMethod: method,
      decision,
      bloodMl,
      advancePayment: payment,
      isConsulted: true
    });

    const rec = tk1State.patientRecords[mabn];
    if (rec) {
      if (!rec.surgicalConsultationsByDate) rec.surgicalConsultationsByDate = {};
      const scObj = {
        isConsulted: true,
        dateKey: curDateKey,
        postConsultDiagnosis: diag,
        surgeryMethod: method,
        decision,
        bloodMl,
        advancePayment: payment,
        updatedAt: new Date().toISOString()
      };
      rec.surgicalConsultationsByDate[curDateKey] = scObj;
      rec.surgicalConsultation = scObj;
    }

    if (btnEl) {
      btnEl.innerHTML = '✓ Đã lưu';
      btnEl.style.background = '#16a34a';
      setTimeout(() => {
        btnEl.innerHTML = origHtml;
        btnEl.style.background = '#15803d';
      }, 1200);
    }

    renderTk1SummaryTabs();
  }

  function openTk4SurgConsultDialog(mabn) {
    const rec = tk1State.patientRecords[mabn];
    if (!rec) return;
    activeScDialogMabn = mabn;

    const curDateKey = getSelectedDateKey();
    const dlg = document.getElementById('tk4-surg-consult-dialog');
    if (!dlg) return;

    const titleEl = document.getElementById('tk4-sc-modal-title');
    const infoEl = document.getElementById('tk4-sc-modal-patient-info');
    const inpDiag = document.getElementById('tk4-sc-modal-inp-diag');
    const inpMethod = document.getElementById('tk4-sc-modal-inp-method');
    const inpBlood = document.getElementById('tk4-sc-modal-inp-blood');
    const inpPayment = document.getElementById('tk4-sc-modal-inp-payment');

    const bedCode = getBedOfPatient(mabn);
    const bedLabel = bedCode ? formatBedLabel(bedCode) : 'Chưa xếp giường';

    if (titleEl) {
      titleEl.innerHTML = `🔪 Hội chẩn mổ (${formatDateDisplayVN(curDateKey)}) — <strong>${rec.hoten}</strong> (${bedLabel})`;
    }

    if (infoEl) {
      infoEl.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:6px;">
          <span><strong>${bedLabel}</strong> · ${String(rec.tuoi || '--').replace(/\s*tuổi/gi, '').trim()} · Vào viện: <strong>${rec.ngayVaoStr || '--'}</strong></span>
          <span style="color:#004aad;font-weight:700;">Số vào viện: ${rec.soVaoVien || rec.maKcb || rec.mabn}</span>
        </div>
        <div style="margin-top:4px;color:#475569;">
          <strong>Chẩn đoán HIS:</strong> ${rec.chanDoanHis || 'Chưa có chẩn đoán ban đầu'}
        </div>
      `;
    }

    const sc = getPatientSurgicalConsultation(rec, curDateKey) || {};
    if (inpDiag) inpDiag.value = sc.postConsultDiagnosis || rec.chanDoanHis || '';
    if (inpMethod) inpMethod.value = sc.surgeryMethod || '';
    if (inpBlood) inpBlood.value = cleanBloodForInput(sc.bloodMl);
    if (inpPayment) inpPayment.value = cleanPaymentForInput(sc.advancePayment);

    const curDec = sc.decision || '';
    document.querySelectorAll('input[name="tk4-sc-decision"]').forEach(r => {
      r.checked = r.value === curDec;
    });

    dlg.showModal();
  }

  async function saveTk4SurgConsultFromDialog() {
    if (!activeScDialogMabn) return;
    const mabn = activeScDialogMabn;
    const curDateKey = getSelectedDateKey();
    const inpDiag = document.getElementById('tk4-sc-modal-inp-diag');
    const inpMethod = document.getElementById('tk4-sc-modal-inp-method');
    const inpBlood = document.getElementById('tk4-sc-modal-inp-blood');
    const inpPayment = document.getElementById('tk4-sc-modal-inp-payment');
    const selectedRadio = document.querySelector('input[name="tk4-sc-decision"]:checked');

    const diag = (inpDiag?.value || '').trim();
    const method = (inpMethod?.value || '').trim();
    const decision = selectedRadio ? selectedRadio.value : '';
    const bloodMl = formatBloodMl((inpBlood?.value || '').trim());
    const payment = formatPaymentWithMillion((inpPayment?.value || '').trim());

    await callTk1Api({
      action: 'SAVE_SURGICAL_CONSULTATION',
      mabn,
      dateKey: curDateKey,
      postConsultDiagnosis: diag,
      surgeryMethod: method,
      decision,
      bloodMl,
      advancePayment: payment,
      isConsulted: true
    });

    const rec = tk1State.patientRecords[mabn];
    if (rec) {
      if (!rec.surgicalConsultationsByDate) rec.surgicalConsultationsByDate = {};
      const scObj = {
        isConsulted: true,
        dateKey: curDateKey,
        postConsultDiagnosis: diag,
        surgeryMethod: method,
        decision,
        bloodMl,
        advancePayment: payment,
        updatedAt: new Date().toISOString()
      };
      rec.surgicalConsultationsByDate[curDateKey] = scObj;
      rec.surgicalConsultation = scObj;
    }

    const dlg = document.getElementById('tk4-surg-consult-dialog');
    if (dlg) dlg.close();

    renderTk1Workspace();
  }

  async function deleteTk4SurgConsultFromDialog() {
    if (!activeScDialogMabn) return;
    const mabn = activeScDialogMabn;
    const rec = tk1State.patientRecords[mabn];
    const name = rec ? rec.hoten : mabn;

    if (!confirm(`Bạn có chắc muốn xoá/huỷ ca ${name} khỏi danh sách Hội chẩn mổ ngày hôm nay?`)) {
      return;
    }

    await removePatientFromSurgicalConsultation(mabn, true);

    const dlg = document.getElementById('tk4-surg-consult-dialog');
    if (dlg) dlg.close();
  }

  async function addPatientToSurgicalConsultation(mabn, openDialogAfter = true) {
    const curDateKey = getSelectedDateKey();
    const rec = tk1State.patientRecords[mabn];
    if (!rec) return;

    const defaultDiag = rec.chanDoanHis || '';
    await callTk1Api({
      action: 'SAVE_SURGICAL_CONSULTATION',
      mabn,
      dateKey: curDateKey,
      postConsultDiagnosis: defaultDiag,
      surgeryMethod: '',
      decision: '',
      advancePayment: '',
      isConsulted: true
    });

    if (!rec.surgicalConsultationsByDate) rec.surgicalConsultationsByDate = {};
    const scObj = {
      isConsulted: true,
      dateKey: curDateKey,
      postConsultDiagnosis: defaultDiag,
      surgeryMethod: '',
      decision: '',
      advancePayment: '',
      updatedAt: new Date().toISOString()
    };
    rec.surgicalConsultationsByDate[curDateKey] = scObj;
    rec.surgicalConsultation = scObj;

    renderTk1Workspace();

    if (openDialogAfter) {
      openTk4SurgConsultDialog(mabn);
    }
  }

  async function removePatientFromSurgicalConsultation(mabn, skipConfirm = false) {
    const curDateKey = getSelectedDateKey();
    const rec = tk1State.patientRecords[mabn];
    const name = rec ? rec.hoten : mabn;

    if (!skipConfirm) {
      if (!confirm(`Bỏ bệnh nhân ${name} khỏi danh sách Hội chẩn mổ ngày hôm nay?`)) {
        return;
      }
    }

    await callTk1Api({
      action: 'DELETE_SURGICAL_CONSULTATION',
      mabn,
      dateKey: curDateKey
    });

    if (rec) {
      if (rec.surgicalConsultationsByDate) {
        delete rec.surgicalConsultationsByDate[curDateKey];
      }
      if (rec.surgicalConsultation && (!rec.surgicalConsultation.dateKey || rec.surgicalConsultation.dateKey === curDateKey)) {
        delete rec.surgicalConsultation;
      }
    }

    renderTk1Workspace();
  }

  function openAddPatientToScDialog() {
    const dlg = document.getElementById('tk4-pick-patient-sc-dialog');
    const bodyEl = document.getElementById('tk4-pick-patient-sc-body');
    const titleEl = document.getElementById('tk4-pick-sc-title');
    if (!dlg || !bodyEl) return;

    const curDateKey = getSelectedDateKey();
    if (titleEl) {
      titleEl.innerHTML = `➕ Chọn bệnh nhân vào Hội chẩn mổ (${formatDateDisplayVN(curDateKey)})`;
    }

    const allActivePatients = Object.values(tk1State.patientRecords || {})
      .filter(r => !r.removed?.isRemoved);

    let isConsultedCollapsed = true;

    function renderScPicker(searchTerm = '') {
      const term = searchTerm.toLowerCase().trim();

      const filtered = allActivePatients.filter(p => {
        if (!term) return true;
        const b = getBedOfPatient(p.mabn) || '';
        return `${p.hoten || ''} ${p.mabn || ''} ${p.tuoi || ''} ${b} ${p.chanDoanHis || ''}`.toLowerCase().includes(term);
      });

      const unconsultedList = filtered.filter(p => {
        const sc = getPatientSurgicalConsultation(p, curDateKey);
        return !sc || !sc.isConsulted;
      }).sort((a, b) => {
        const bedA = getBedOfPatient(a.mabn);
        const bedB = getBedOfPatient(b.mabn);
        if (bedA && !bedB) return -1;
        if (!bedA && bedB) return 1;
        if (bedA && bedB) return bedA.localeCompare(bedB, undefined, { numeric: true });
        return a.hoten.localeCompare(b.hoten, 'vi');
      });

      const consultedList = filtered.filter(p => {
        const sc = getPatientSurgicalConsultation(p, curDateKey);
        return Boolean(sc && sc.isConsulted);
      }).sort((a, b) => {
        const bedA = getBedOfPatient(a.mabn);
        const bedB = getBedOfPatient(b.mabn);
        if (bedA && !bedB) return -1;
        if (!bedA && bedB) return 1;
        if (bedA && bedB) return bedA.localeCompare(bedB, undefined, { numeric: true });
        return a.hoten.localeCompare(b.hoten, 'vi');
      });

      const showConsulted = term.length > 0 ? true : !isConsultedCollapsed;

      bodyEl.innerHTML = `
        <div style="margin-bottom:0.75rem;">
          <input
            type="text"
            id="tk4-sc-picker-search-input"
            value="${searchTerm.replace(/"/g, '&quot;')}"
            placeholder="🔍 Tìm kiếm bệnh nhân theo tên, số giường, số vào viện..."
            style="width:100%;height:38px;padding:6px 12px;border:1.5px solid #94a3b8;border-radius:8px;font-size:0.86rem;font-weight:600;font-family:'Be Vietnam Pro',sans-serif;outline:none;"
          />
        </div>

        <div style="font-size:0.83rem;color:#475569;margin-bottom:0.6rem;">
          Bấm chọn bệnh nhân để đưa ngay vào danh sách <strong>Hội chẩn mổ</strong> hôm nay:
        </div>

        <!-- PHẦN 1: BỆNH NHÂN CHƯA CÓ TRONG DS HỘI CHẨN MỔ (LUÔN MỞ, NỔI BẬT) -->
        <div style="margin-bottom:1rem;">
          <div style="font-size:0.85rem;font-weight:800;color:#15803d;margin-bottom:0.45rem;display:flex;align-items:center;gap:6px;">
            <span>⚠️ Bệnh nhân phòng Thần kinh 4 chưa có trong DS Hội chẩn mổ (${unconsultedList.length} BN)</span>
          </div>
          ${
            unconsultedList.length > 0
              ? `<div style="display:flex;flex-wrap:wrap;gap:0.45rem;max-height:35vh;overflow-y:auto;padding:2px;">
                  ${unconsultedList.map(p => {
                    const bedCode = getBedOfPatient(p.mabn);
                    const bedLabel = bedCode ? formatBedLabel(bedCode) : 'Chưa xếp giường';
                    return `
                      <button
                        type="button"
                        class="tk1-unassigned-chip"
                        style="cursor:pointer;border-color:#16a34a;background:#f0fdf4;"
                        data-pick-sc-mabn="${p.mabn}"
                        title="Bấm để đưa ${p.hoten} vào danh sách Hội chẩn mổ hôm nay"
                      >
                        <span><strong>${p.hoten}</strong> (${p.tuoi || '--'}T)</span>
                        <span class="btn-chip-pick-bed" style="background:#15803d;">${bedLabel}</span>
                      </button>
                    `;
                  }).join('')}
                </div>`
              : `<div style="font-size:0.8rem;color:#64748b;font-style:italic;padding:4px 0;">Không có bệnh nhân nào${term ? ' khớp từ khoá' : ''}.</div>`
          }
        </div>

        <!-- PHẦN 2: BỆNH NHÂN ĐÃ CÓ TRONG DS HỘI CHẨN MỔ (THƯỜNG XUYÊN THU GỌN) -->
        <div style="border-top:1px solid #e2e8f0;padding-top:0.75rem;">
          <button
            type="button"
            id="btn-toggle-sc-consulted-section"
            style="width:100%;display:flex;align-items:center;justify-content:space-between;background:#f8fafc;border:1px solid #cbd5e1;border-radius:8px;padding:8px 12px;cursor:pointer;font-family:'Be Vietnam Pro',sans-serif;font-size:0.83rem;font-weight:700;color:#334155;"
          >
            <span>✓ Đã có trong DS Hội chẩn mổ (${consultedList.length} BN — Bấm để mở chi tiết)</span>
            <span style="font-size:0.8rem;color:#64748b;">${showConsulted ? '▾ Thu gọn' : '▸ Bấm để mở rộng'}</span>
          </button>

          <div id="tk4-sc-consulted-wrap" style="display:${showConsulted ? 'flex' : 'none'};flex-wrap:wrap;gap:0.45rem;margin-top:0.6rem;max-height:35vh;overflow-y:auto;padding:2px;">
            ${
              consultedList.length > 0
                ? consultedList.map(p => {
                    const bedCode = getBedOfPatient(p.mabn);
                    const bedLabel = bedCode ? formatBedLabel(bedCode) : 'Chưa xếp';
                    return `
                      <button
                        type="button"
                        class="tk1-unassigned-chip"
                        style="cursor:pointer;border-color:#93c5fd;background:#eff6ff;"
                        data-open-detail-sc-mabn="${p.mabn}"
                        title="Bấm để xem / sửa chi tiết hội chẩn mổ của ${p.hoten}"
                      >
                        <span><strong>${p.hoten}</strong> (${p.tuoi || '--'}T)</span>
                        <span class="btn-chip-pick-bed" style="background:#0284c7;">${bedLabel} · Sửa chi tiết</span>
                      </button>
                    `;
                  }).join('')
                : `<div style="font-size:0.8rem;color:#64748b;font-style:italic;padding:4px 0;">Chưa có bệnh nhân nào trong danh sách.</div>`
            }
          </div>
        </div>
      `;

      const searchInp = document.getElementById('tk4-sc-picker-search-input');
      if (searchInp) {
        searchInp.focus();
        searchInp.selectionStart = searchInp.selectionEnd = searchInp.value.length;
        searchInp.addEventListener('input', (e) => {
          renderScPicker(e.target.value);
        });
      }

      const toggleBtn = document.getElementById('btn-toggle-sc-consulted-section');
      if (toggleBtn) {
        toggleBtn.addEventListener('click', () => {
          isConsultedCollapsed = !isConsultedCollapsed;
          const currentTerm = document.getElementById('tk4-sc-picker-search-input')?.value || '';
          renderScPicker(currentTerm);
        });
      }

      bodyEl.querySelectorAll('[data-pick-sc-mabn]').forEach(btn => {
        btn.addEventListener('click', () => {
          const mabn = btn.getAttribute('data-pick-sc-mabn');
          if (mabn) {
            dlg.close();
            addPatientToSurgicalConsultation(mabn, false);
          }
        });
      });

      bodyEl.querySelectorAll('[data-open-detail-sc-mabn]').forEach(btn => {
        btn.addEventListener('click', () => {
          const mabn = btn.getAttribute('data-open-detail-sc-mabn');
          if (mabn) {
            dlg.close();
            openTk4SurgConsultDialog(mabn);
          }
        });
      });
    }

    renderScPicker('');
    dlg.showModal();
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
    const isRemovedAlertDismissed = tk1State.dismissedRemovedAlert || sessionStorage.getItem('tk1_dismissed_removed_alert') === 'true';
    const removedActivePatients = isRemovedAlertDismissed ? [] : (tk1State.latestExcelMabns || [])
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
            <div style="display:flex;flex-wrap:wrap;gap:0.4rem;align-items:center;">
              ${removedActivePatients.map(p => `
                <button type="button" class="btn-bed-mini" style="background:#fef08a;color:#713f12;border-color:#eab308;font-weight:700;" data-restore-removed-mabn="${p.mabn}">
                  🔄 Khôi phục [${p.hoten.split(' ').pop()}]
                </button>
              `).join('')}
              <button type="button" class="btn-bed-mini" id="btn-dismiss-removed-alert" style="background:#fee2e2;color:#991b1b;border-color:#fca5a5;font-weight:700;" title="Đóng thông báo này">
                ✕ Đóng thông báo
              </button>
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

    const btnDismissRemoved = alertContainer.querySelector('#btn-dismiss-removed-alert');
    if (btnDismissRemoved) {
      btnDismissRemoved.addEventListener('click', () => {
        tk1State.dismissedRemovedAlert = true;
        sessionStorage.setItem('tk1_dismissed_removed_alert', 'true');
        renderTk1Alerts();
      });
    }

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

    if (currentRoomKey !== 'tk4') {
      const scBox = document.getElementById('tk4-surgical-consult-box');
      if (scBox) scBox.style.display = 'none';
      const scTabBtn = document.getElementById('tk1-sum-tab-btn-hcm');
      if (scTabBtn) scTabBtn.style.display = 'none';
      const scModal = document.getElementById('tk4-modal-sc-section');
      if (scModal) scModal.style.display = 'none';
    }

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
    const totalBedsA = endA - startA + 1;

    const wingCardA = document.getElementById('tk1-wing-card-a');
    const wingCardB = document.getElementById('tk1-wing-card-b');
    const wingATitle = document.getElementById('tk1-wing-a-title');
    const wingBTitle = document.getElementById('tk1-wing-b-title');
    const wingASub = document.getElementById('tk1-wing-a-sub');
    const wingBSub = document.getElementById('tk1-wing-b-sub');
    const wingABody = document.getElementById('tk1-wing-a-body');
    const wingBBody = document.getElementById('tk1-wing-b-body');

    let countMainA = 0, countFoldA = 0;
    for (let i = startA; i <= endA; i++) {
      if (tk1State.bedAssignments[String(i)]) countMainA++;
      if (tk1State.bedAssignments[`${i}X`]) countFoldA++;
    }

    if (!wingB) {
      if (wingCardB) wingCardB.style.display = 'none';
      if (wingCardA) {
        wingCardA.style.gridColumn = '1 / -1';
        wingCardA.style.width = '100%';
      }
      if (wingATitle) {
        wingATitle.textContent = `DÃY GIƯỜNG HỒI SỨC — GIƯỜNG ${String(startA).padStart(2, '0')} ĐẾN ${String(endA).padStart(2, '0')}`;
      }
      if (wingASub) {
        wingASub.textContent = `Đang nằm: ${countMainA}/${totalBedsA}${countFoldA > 0 ? ` (+${countFoldA} xếp)` : ''} · Trống: ${totalBedsA - countMainA}`;
      }
      if (wingABody) {
        wingABody.style.display = 'grid';
        wingABody.style.gridTemplateColumns = 'repeat(3, minmax(280px, 1fr))';
        wingABody.style.gap = '1rem';
        wingABody.style.alignItems = 'start';

        // 3 Cột tăng theo chiều dọc: Cột 1: 1-4, Cột 2: 5-8, Cột 3: 9-12
        const col1Beds = [];
        const col2Beds = [];
        const col3Beds = [];
        for (let i = 1; i <= 4; i++) col1Beds.push(renderBedPairHtml(i));
        for (let i = 5; i <= 8; i++) col2Beds.push(renderBedPairHtml(i));
        for (let i = 9; i <= 12; i++) col3Beds.push(renderBedPairHtml(i));

        wingABody.innerHTML = `
          <div class="hstk-bed-column" style="display:flex;flex-direction:column;gap:0.75rem;min-width:0;">
            <div style="font-weight:800;font-size:0.8rem;color:#0369a1;background:#e0f2fe;padding:4px 8px;border-radius:6px;border:1px solid #bae6fd;text-align:center;">
              CỘT 1 (GIƯỜNG 01 - 04)
            </div>
            ${col1Beds.join('')}
          </div>
          <div class="hstk-bed-column" style="display:flex;flex-direction:column;gap:0.75rem;min-width:0;">
            <div style="font-weight:800;font-size:0.8rem;color:#0369a1;background:#e0f2fe;padding:4px 8px;border-radius:6px;border:1px solid #bae6fd;text-align:center;">
              CỘT 2 (GIƯỜNG 05 - 08)
            </div>
            ${col2Beds.join('')}
          </div>
          <div class="hstk-bed-column" style="display:flex;flex-direction:column;gap:0.75rem;min-width:0;">
            <div style="font-weight:800;font-size:0.8rem;color:#0369a1;background:#e0f2fe;padding:4px 8px;border-radius:6px;border:1px solid #bae6fd;text-align:center;">
              CỘT 3 (GIƯỜNG 09 - 12)
            </div>
            ${col3Beds.join('')}
          </div>
        `;
      }
    } else {
      if (wingCardB) wingCardB.style.display = '';
      if (wingCardA) {
        wingCardA.style.gridColumn = '';
        wingCardA.style.width = '';
      }
      const [startB, endB] = wingB;
      const totalBedsB = endB - startB + 1;
      let countMainB = 0, countFoldB = 0;
      for (let i = startB; i <= endB; i++) {
        if (tk1State.bedAssignments[String(i)]) countMainB++;
        if (tk1State.bedAssignments[`${i}X`]) countFoldB++;
      }

      if (wingATitle) {
        if (currentRoomKey === 'tk3') {
          wingATitle.textContent = `DÃY TRÊN — GIƯỜNG ${String(startA).padStart(2, '0')} ĐẾN ${String(endA).padStart(2, '0')}`;
        } else if (currentRoomKey === 'tk4') {
          wingATitle.textContent = 'DÃY A — GIƯỜNG A01 ĐẾN A16';
        } else {
          wingATitle.textContent = `DÃY A — GIƯỜNG ${String(startA).padStart(2, '0')} ĐẾN ${String(endA).padStart(2, '0')}`;
        }
      }
      if (wingBTitle) {
        if (currentRoomKey === 'tk3') {
          wingBTitle.textContent = `DÃY DỊCH VỤ — GIƯỜNG ${String(startB).padStart(2, '0')} ĐẾN ${String(endB).padStart(2, '0')}`;
        } else if (currentRoomKey === 'tk4') {
          wingBTitle.textContent = 'DÃY B — GIƯỜNG B01 ĐẾN B15 (GIƯỜNG 17-31)';
        } else {
          wingBTitle.textContent = `DÃY B — GIƯỜNG ${String(startB).padStart(2, '0')} ĐẾN ${String(endB).padStart(2, '0')}`;
        }
      }
      if (wingASub) {
        wingASub.textContent = `Đang nằm: ${countMainA}/${totalBedsA}${countFoldA > 0 ? ` (+${countFoldA} xếp)` : ''} · Trống: ${totalBedsA - countMainA}`;
      }
      if (wingBSub) {
        wingBSub.textContent = `Đang nằm: ${countMainB}/${totalBedsB}${countFoldB > 0 ? ` (+${countFoldB} xếp)` : ''} · Trống: ${totalBedsB - countMainB}`;
      }
      if (wingABody) {
        wingABody.style.display = 'flex';
        wingABody.style.gridTemplateColumns = '';
        wingABody.style.gap = '0.65rem';
        const listA = [];
        for (let i = startA; i <= endA; i++) listA.push(renderBedPairHtml(i));
        wingABody.innerHTML = listA.join('');
      }
      if (wingBBody) {
        const listB = [];
        for (let i = startB; i <= endB; i++) listB.push(renderBedPairHtml(i));
        wingBBody.innerHTML = listB.join('');
      }
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

      slotEl.querySelectorAll('.tk2-card-chk-nonsurgical').forEach(chk => {
        chk.addEventListener('change', async (e) => {
          e.stopPropagation();
          const mabn = chk.getAttribute('data-mabn');
          const isNonSurgical = chk.checked;
          await toggleTk2NonSurgical(mabn, isNonSurgical);
        });
      });

      slotEl.querySelectorAll('[data-open-tk4-consult]').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const mabn = btn.getAttribute('data-open-tk4-consult');
          if (mabn) openTk4SurgConsultDialog(mabn);
        });
      });

      slotEl.querySelectorAll('[data-add-tk4-consult]').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const mabn = btn.getAttribute('data-add-tk4-consult');
          if (mabn) addPatientToSurgicalConsultation(mabn, true);
        });
      });

      slotEl.querySelectorAll('[data-remove-tk4-consult]').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const mabn = btn.getAttribute('data-remove-tk4-consult');
          if (mabn) removePatientFromSurgicalConsultation(mabn);
        });
      });
    }

    renderTk1SummaryTabs();
    renderTk4SurgicalConsultBox();
  }

  async function toggleTk2NonSurgical(mabn, isNonSurgical) {
    const rec = tk1State.patientRecords[mabn];
    if (!rec) return;
    if (!rec.surgeryInfo) {
      rec.surgeryInfo = {
        isNonSurgical: false,
        surgeryName: '',
        surgeryDate: convertVnDateToIso(rec.ngayVaoStr) || getSelectedDateKey()
      };
    }
    rec.surgeryInfo.isNonSurgical = isNonSurgical;

    const curDateKey = getSelectedDateKey();
    if (isNonSurgical) {
      rec.customDiagnosis = rec.chanDoanHis || '';
    } else {
      const sDate = rec.surgeryInfo.surgeryDate || convertVnDateToIso(rec.ngayVaoStr) || curDateKey;
      const postOpDay = calculatePostOpDay(sDate, curDateKey);
      const sName = (rec.surgeryInfo.surgeryName || '').trim();
      rec.customDiagnosis = `Hậu phẫu ngày ${postOpDay} phẫu thuật ${sName}`.trim();
    }

    renderTk1Workspace();

    await callTk1Api({
      action: 'SAVE_PATIENT_ROUND',
      mabn,
      dateKey: curDateKey,
      customDiagnosis: rec.customDiagnosis,
      surgeryInfo: rec.surgeryInfo,
      tasks: (rec.tasksByDate && rec.tasksByDate[curDateKey]) || {},
      consultDetails: rec.consultDetails || {}
    });
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
          <span class="vbed-num">${formatBedLabel(mainCode)}</span>
          <button
            type="button"
            class="vbed-fold-btn"
            title="Chọn giường xếp ${formatBedLabel(foldCode)}"
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

    const tilesA = [];
    for (let i = startA; i <= endA; i++) tilesA.push(renderVisualBedTileHtml(i, mabn));

    let wingsGridHtml = '';
    if (!wingB) {
      wingsGridHtml = `
        <div class="tk1-vbed-wings-wrap" style="grid-template-columns: 1fr;">
          <div class="tk1-vbed-wing-box">
            <div class="tk1-vbed-wing-title">
              <span>Dãy Giường Hồi Sức (${startA} – ${endA})</span>
            </div>
            <div class="tk1-vbed-grid grid-wing-a" style="grid-template-columns: repeat(3, minmax(130px, 1fr)); grid-auto-flow: column; grid-template-rows: repeat(4, auto);">
              ${tilesA.join('')}
            </div>
          </div>
        </div>
      `;
    } else {
      const [startB, endB] = wingB;
      const tilesB = [];
      for (let i = startB; i <= endB; i++) tilesB.push(renderVisualBedTileHtml(i, mabn));
      wingsGridHtml = `
        <div class="tk1-vbed-wings-wrap">
          <div class="tk1-vbed-wing-box">
            <div class="tk1-vbed-wing-title">
              <span>${currentRoomKey === 'tk3' ? 'Dãy Trên (01 – 10)' : currentRoomKey === 'tk4' ? 'Dãy A (A01 – A16)' : `Dãy A (${startA} – ${endA})`}</span>
            </div>
            <div class="tk1-vbed-grid grid-wing-a">
              ${tilesA.join('')}
            </div>
          </div>

          <div class="tk1-vbed-wing-box">
            <div class="tk1-vbed-wing-title" style="color:#0f766e;">
              <span>${currentRoomKey === 'tk3' ? 'Dãy Dịch Vụ (11 – 16)' : currentRoomKey === 'tk4' ? 'Dãy B (B01 – B15 / Giường 17–31)' : `Dãy B (${startB} – ${endB})`}</span>
            </div>
            <div class="tk1-vbed-grid grid-wing-b">
              ${tilesB.join('')}
            </div>
          </div>
        </div>
      `;
    }

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

      ${wingsGridHtml}
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
    const labelTitle = currentRoomKey === 'hstk' ? '🫁 Thủ thuật Hồi sức:' : (currentRoomKey === 'tk2' ? '🩹 Thủ thuật (Thần kinh 2):' : '🩹 Thủ thuật:');
    barEl.innerHTML = `
      <span style="font-size:0.79rem;font-weight:800;color:#0f766e;margin-right:4px;">
        ${labelTitle}
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
    let rec = tk1State.patientRecords ? tk1State.patientRecords[mabn] : null;
    let foundRoomKey = currentRoomKey;
    if (!rec && allRoomsState) {
      for (const [rk, rObj] of Object.entries(allRoomsState)) {
        if (rObj?.patientRecords?.[mabn]) {
          rec = rObj.patientRecords[mabn];
          foundRoomKey = rk;
          break;
        }
      }
    }
    if (!rec) return;
    activeModalMabn = mabn;

    const curDateKey = getSelectedDateKey();
    let curBed = getBedOfPatient(mabn);
    if (!curBed && allRoomsState?.[foundRoomKey]?.bedAssignments) {
      for (const [b, m] of Object.entries(allRoomsState[foundRoomKey].bedAssignments)) {
        if (m === mabn) { curBed = b; break; }
      }
    }
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

    const bedLabel = curBed ? formatBedLabel(curBed) : 'Chưa xếp';
    document.getElementById('tk1-modal-patient-title').textContent = `${bedLabel} — ${rec.hoten}`;

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
        btnPrev.style.display = 'none';
        btnNext.style.display = 'none';
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
      <div><span style="color:#64748b;">Số vào viện:</span> <strong style="color:#004aad;">${rec.soVaoVien || rec.maKcb || rec.madieutri || rec.mabn || '--'}</strong></div>
      <div><span style="color:#64748b;">Tên:</span> <strong>${rec.hoten}</strong></div>
      <div><span style="color:#64748b;">Tuổi:</span> <strong>${String(rec.tuoi || '--').replace(/\s*tuổi/gi, '').trim()}</strong></div>
      <div><span style="color:#64748b;">Đối tượng:</span> ${bhytBadge}</div>
      <div style="flex:1 1 100%;border-top:1px dashed #e2e8f0;padding-top:5px;">
        <span style="color:#64748b;">Địa chỉ:</span> <strong>${rec.diaChi || '--'}</strong>
      </div>
    `;

    const isTk2 = currentRoomKey === 'tk2';
    const tk2SurgSec = document.getElementById('tk2-surgery-section');
    const diagInp = document.getElementById('tk1-modal-diagnosis-input');

    if (tk2SurgSec) {
      if (isTk2) {
        tk2SurgSec.style.display = 'block';
        const isNonSurgical = Boolean(rec.surgeryInfo?.isNonSurgical);
        const sName = (rec.surgeryInfo?.surgeryName || '').trim();
        const sDate = rec.surgeryInfo?.surgeryDate || convertVnDateToIso(rec.ngayVaoStr) || curDateKey;
        const postOpDay = calculatePostOpDay(sDate, curDateKey);

        const chkNonSurgical = document.getElementById('tk2-modal-chk-nonsurgical');
        const inpSurgName = document.getElementById('tk2-modal-inp-surgery-name');
        const inpSurgDate = document.getElementById('tk2-modal-inp-surgery-date');
        const badgePostOp = document.getElementById('tk2-modal-post-op-badge');
        const wrapFields = document.getElementById('tk2-surgery-fields-wrap');

        if (chkNonSurgical) chkNonSurgical.checked = isNonSurgical;
        if (inpSurgName) inpSurgName.value = sName;
        if (inpSurgDate) inpSurgDate.value = sDate;
        if (badgePostOp) badgePostOp.textContent = `Ngày thứ ${postOpDay}`;
        if (wrapFields) wrapFields.style.display = isNonSurgical ? 'none' : 'grid';

        if (isNonSurgical) {
          if (diagInp) diagInp.value = rec.customDiagnosis || rec.chanDoanHis || '';
        } else {
          // If surgical:
          // Default diagnosis format: Hậu phẫu ngày.....Phẫu thuật.......
          if (rec.customDiagnosis && !rec.customDiagnosis.startsWith('Hậu phẫu ngày') && rec.customDiagnosis !== rec.chanDoanHis) {
            if (diagInp) diagInp.value = rec.customDiagnosis;
          } else {
            if (diagInp) diagInp.value = `Hậu phẫu ngày ${postOpDay} phẫu thuật ${sName}`.trim();
          }
        }
      } else {
        tk2SurgSec.style.display = 'none';
        if (diagInp) diagInp.value = rec.customDiagnosis || rec.chanDoanHis || '';
      }
    } else {
      if (diagInp) diagInp.value = rec.customDiagnosis || rec.chanDoanHis || '';
    }

    // Khối thông tin Hội chẩn mổ riêng cho Thần kinh 4
    const isTk4 = currentRoomKey === 'tk4';
    const tk4ScSec = document.getElementById('tk4-modal-sc-section');
    if (tk4ScSec) {
      if (isTk4) {
        tk4ScSec.style.display = 'block';
        const sc = getPatientSurgicalConsultation(rec, curDateKey) || {};
        const isIncluded = Boolean(sc && sc.isConsulted);
        const dec = sc.decision || '';

        const chkIncluded = document.getElementById('tk4-modal-sc-chk-included');
        const fieldsWrap = document.getElementById('tk4-modal-sc-fields-wrap');
        const badgeEl = document.getElementById('tk4-modal-sc-status-badge');

        function updateTk4ModalScStatusBadge(currentDec, included) {
          if (!badgeEl) return;
          if (!included) {
            badgeEl.style.background = '#f1f5f9';
            badgeEl.style.color = '#64748b';
            badgeEl.textContent = 'Chưa đưa vào HC mổ hôm nay';
            return;
          }
          if (currentDec === 'Đồng ý') {
            badgeEl.style.background = '#dcfce7';
            badgeEl.style.color = '#15803d';
            badgeEl.textContent = '✓ Đồng ý phẫu thuật';
          } else if (currentDec === 'Hội ý') {
            badgeEl.style.background = '#fef3c7';
            badgeEl.style.color = '#b45309';
            badgeEl.textContent = '💬 Cần hội ý thêm';
          } else if (currentDec === 'Không đồng ý') {
            badgeEl.style.background = '#fee2e2';
            badgeEl.style.color = '#dc2626';
            badgeEl.textContent = '✕ Không đồng ý phẫu thuật';
          } else {
            badgeEl.style.background = '#e2e8f0';
            badgeEl.style.color = '#475569';
            badgeEl.textContent = 'Đã đưa vào HC mổ (Chưa duyệt)';
          }
        }

        if (chkIncluded) {
          chkIncluded.checked = isIncluded;
          chkIncluded.onchange = () => {
            const checked = chkIncluded.checked;
            if (fieldsWrap) {
              fieldsWrap.style.opacity = checked ? '1' : '0.4';
              fieldsWrap.style.pointerEvents = checked ? 'auto' : 'none';
            }
            const selDec = document.getElementById('tk4-modal-sc-sel-decision');
            updateTk4ModalScStatusBadge(selDec ? selDec.value : '', checked);
          };
        }

        if (fieldsWrap) {
          fieldsWrap.style.opacity = isIncluded ? '1' : '0.4';
          fieldsWrap.style.pointerEvents = isIncluded ? 'auto' : 'none';
        }

        updateTk4ModalScStatusBadge(dec, isIncluded);

        const inpDiag = document.getElementById('tk4-modal-sc-inp-diag');
        const inpMethod = document.getElementById('tk4-modal-sc-inp-method');
        const selDec = document.getElementById('tk4-modal-sc-sel-decision');
        const inpBlood = document.getElementById('tk4-modal-sc-inp-blood');
        const inpPay = document.getElementById('tk4-modal-sc-inp-payment');

        if (inpDiag) inpDiag.value = sc.postConsultDiagnosis || (isIncluded ? rec.chanDoanHis || '' : '');
        if (inpMethod) inpMethod.value = sc.surgeryMethod || '';
        if (selDec) {
          selDec.value = dec;
          selDec.onchange = () => {
            const chkInc = document.getElementById('tk4-modal-sc-chk-included');
            updateTk4ModalScStatusBadge(selDec.value, Boolean(chkInc && chkInc.checked));
          };
        }
        if (inpBlood) inpBlood.value = cleanBloodForInput(sc.bloodMl);
        if (inpPay) inpPay.value = cleanPaymentForInput(sc.advancePayment);
      } else {
        tk4ScSec.style.display = 'none';
      }
    }

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

    let surgeryInfo = undefined;
    if (currentRoomKey === 'tk2') {
      const chk = document.getElementById('tk2-modal-chk-nonsurgical');
      const inpName = document.getElementById('tk2-modal-inp-surgery-name');
      const inpDate = document.getElementById('tk2-modal-inp-surgery-date');
      surgeryInfo = {
        isNonSurgical: Boolean(chk && chk.checked),
        surgeryName: inpName ? inpName.value.trim() : '',
        surgeryDate: inpDate ? inpDate.value : ''
      };
      rec.surgeryInfo = surgeryInfo;
    }

    let surgicalConsultation = undefined;
    if (currentRoomKey === 'tk4') {
      const chkIncluded = document.getElementById('tk4-modal-sc-chk-included');
      const isIncluded = Boolean(chkIncluded && chkIncluded.checked);
      const diag = (document.getElementById('tk4-modal-sc-inp-diag')?.value || '').trim();
      const method = (document.getElementById('tk4-modal-sc-inp-method')?.value || '').trim();
      const decision = document.getElementById('tk4-modal-sc-sel-decision')?.value || '';
      const bloodMl = formatBloodMl((document.getElementById('tk4-modal-sc-inp-blood')?.value || '').trim());
      const payment = formatPaymentWithMillion((document.getElementById('tk4-modal-sc-inp-payment')?.value || '').trim());

      if (isIncluded) {
        surgicalConsultation = {
          isConsulted: true,
          dateKey: curDateKey,
          postConsultDiagnosis: diag || (rec.chanDoanHis || ''),
          surgeryMethod: method,
          decision,
          bloodMl,
          advancePayment: payment,
          updatedAt: new Date().toISOString()
        };
        if (!rec.surgicalConsultationsByDate) rec.surgicalConsultationsByDate = {};
        rec.surgicalConsultationsByDate[curDateKey] = surgicalConsultation;
        rec.surgicalConsultation = surgicalConsultation;
      } else {
        surgicalConsultation = {
          isConsulted: false,
          dateKey: curDateKey,
          postConsultDiagnosis: '',
          surgeryMethod: '',
          decision: '',
          bloodMl: '',
          advancePayment: '',
          updatedAt: new Date().toISOString()
        };
        if (rec.surgicalConsultationsByDate) {
          delete rec.surgicalConsultationsByDate[curDateKey];
        }
        if (rec.surgicalConsultation && (!rec.surgicalConsultation.dateKey || rec.surgicalConsultation.dateKey === curDateKey)) {
          delete rec.surgicalConsultation;
        }
      }
    }

    rec.customDiagnosis = customDiagnosis;

    await callTk1Api({
      action: 'SAVE_PATIENT_ROUND',
      mabn: activeModalMabn,
      dateKey: curDateKey,
      customDiagnosis,
      surgeryInfo,
      surgicalConsultation,
      tasks: modalDraftTasks,
      consultDetails: {
        specialty,
        consultDiagnosis: cd.consultDiagnosis || '',
        consultTreatment: cd.consultTreatment || '',
        followUpDays,
        followUpClinic
      }
    });

    renderTk1Workspace();
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
    const [startB, endB] = wingB || [0, 0];

    function collectWingItems(startBed, endBed) {
      const items = [];
      for (let i = startBed; i <= endBed; i++) {
        const mainCode = String(i);
        const foldCode = `${i}X`;
        const mRec = tk1State.bedAssignments[mainCode] ? tk1State.patientRecords[tk1State.bedAssignments[mainCode]] : null;
        const fRec = tk1State.bedAssignments[foldCode] ? tk1State.patientRecords[tk1State.bedAssignments[foldCode]] : null;
        const isFoldHidden = Boolean(tk1State.hiddenFoldingBeds && tk1State.hiddenFoldingBeds[mainCode]);

        const mainLabel = currentRoomKey === 'tk4' ? `G.${formatBedLabel(mainCode)}` : `G.${String(i).padStart(2, '0')}`;
        const foldLabel = currentRoomKey === 'tk4' ? formatBedLabel(foldCode) : `Xếp ${String(i).padStart(2, '0')}`;
        items.push({ bedCode: mainCode, label: mainLabel, isFolding: false, rec: mRec });
        if (fRec && !isFoldHidden) {
          items.push({ bedCode: foldCode, label: foldLabel, isFolding: true, rec: fRec });
        }
      }
      return items;
    }

    const wingAItems = collectWingItems(startA, endA);
    const wingBItems = wingB ? collectWingItems(startB, endB) : [];

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

      let diagLines = [];
      if (currentRoomKey === 'tk2') {
        const isNonSurgical = Boolean(rec.surgeryInfo?.isNonSurgical);
        const sName = (rec.surgeryInfo?.surgeryName || '').trim();
        const sDate = rec.surgeryInfo?.surgeryDate || convertVnDateToIso(rec.ngayVaoStr) || curDateKey;
        const postOpDay = calculatePostOpDay(sDate, curDateKey);
        const diagStr = isNonSurgical
          ? `CĐ: ${rec.customDiagnosis || rec.chanDoanHis || 'Chưa có CĐ'}`
          : `Hậu phẫu ngày thứ ${postOpDay}${sName ? ` (${sName})` : ''}`;
        diagLines = wrapCanvasText(mCtx, diagStr, colWidth - 28);
      }

      let surgConsultLines = [];
      if (currentRoomKey === 'tk4') {
        const sc = rec.surgicalConsultation;
        if (sc && (sc.decision || sc.postConsultDiagnosis || sc.surgeryMethod || sc.bloodMl || sc.advancePayment)) {
          const decStr = sc.decision ? `[HC MỔ: ${sc.decision}]` : '[HC MỔ]';
          const methodStr = sc.surgeryMethod ? ` · PP: ${sc.surgeryMethod}` : '';
          const diagStr = sc.postConsultDiagnosis ? ` · CĐ: ${sc.postConsultDiagnosis}` : '';
          const bloodStr = sc.bloodMl ? ` · Máu: ${sc.bloodMl}` : '';
          const payStr = sc.advancePayment ? ` · Ứng: ${sc.advancePayment}` : '';
          surgConsultLines = wrapCanvasText(mCtx, `${decStr}${methodStr || diagStr}${bloodStr}${payStr}`, colWidth - 28);
        }
      }

      let h = 34;
      if (diagLines.length > 0) h += 4 + diagLines.length * 18;
      if (surgConsultLines.length > 0) h += 4 + surgConsultLines.length * 18;
      if (taskLines.length > 0) h += 4 + taskLines.length * 18;
      if (followUpLines.length > 0) h += 4 + followUpLines.length * 18;
      return {
        height: Math.max(50, h + 8),
        diagLines,
        surgConsultLines,
        taskLines,
        followUpLines
      };
    }

    let layoutsA = [];
    let layoutsB = [];
    let colTitleA = '';
    let colTitleB = '';

    if (!wingB) {
      const half = Math.ceil(wingAItems.length / 2);
      const itemsA = wingAItems.slice(0, half);
      const itemsB = wingAItems.slice(half);
      layoutsA = itemsA.map(it => ({ item: it, layout: computeBedBoxLayout(it) }));
      layoutsB = itemsB.map(it => ({ item: it, layout: computeBedBoxLayout(it) }));
      const firstA = itemsA[0]?.label || '01';
      const lastA = itemsA[itemsA.length - 1]?.label || '06';
      const firstB = itemsB[0]?.label || '07';
      const lastB = itemsB[itemsB.length - 1]?.label || '12';
      colTitleA = `DÃY HỒI SỨC — ${firstA} ĐẾN ${lastA}`;
      colTitleB = `DÃY HỒI SỨC — ${firstB} ĐẾN ${lastB}`;
    } else {
      layoutsA = wingAItems.map(it => ({ item: it, layout: computeBedBoxLayout(it) }));
      layoutsB = wingBItems.map(it => ({ item: it, layout: computeBedBoxLayout(it) }));
      colTitleA = currentRoomKey === 'tk3'
        ? `DÃY TRÊN — GIƯỜNG ${String(startA).padStart(2, '0')} ĐẾN ${String(endA).padStart(2, '0')}`
        : (currentRoomKey === 'tk4' ? 'DÃY A — GIƯỜNG A01 ĐẾN A16' : `DÃY A — GIƯỜNG ${String(startA).padStart(2, '0')} ĐẾN ${String(endA).padStart(2, '0')}`);
      colTitleB = currentRoomKey === 'tk3'
        ? `DÃY DỊCH VỤ — GIƯỜNG ${String(startB).padStart(2, '0')} ĐẾN ${String(endB).padStart(2, '0')}`
        : (currentRoomKey === 'tk4' ? 'DÃY B — GIƯỜNG B01 ĐẾN B15 (GIƯỜNG 17-31)' : `DÃY B — GIƯỜNG ${String(startB).padStart(2, '0')} ĐẾN ${String(endB).padStart(2, '0')}`);
    }

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
    ctx.fillText(`BẢNG ĐI BUỒNG HẰNG NGÀY — ${(tk1State.roomName || 'THẦN KINH 1').toUpperCase()}${wingB ? ' (DÃY A & DÃY B)' : ''} — NGÀY ${dateStrVN}`, 36, 72);

    ctx.textAlign = 'right';
    ctx.font = '700 14px "Be Vietnam Pro", sans-serif';
    ctx.fillText(`Xuất lúc: ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`, canvasWidth - 36, 68);
    ctx.textAlign = 'left';

    ctx.fillStyle = '#1d4ed8';
    ctx.fillRect(leftColX, 110, colWidth, 34);
    ctx.fillStyle = '#ffffff';
    ctx.font = '800 16px "Montserrat", sans-serif';
    ctx.fillText(colTitleA, leftColX + 14, 133);

    ctx.fillStyle = '#0f766e';
    ctx.fillRect(rightColX, 110, colWidth, 34);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(colTitleB, rightColX + 14, 133);

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

        if (layout.diagLines && layout.diagLines.length > 0) {
          ctx.fillStyle = '#0f766e';
          ctx.font = '700 13px "Be Vietnam Pro", sans-serif';
          for (const line of layout.diagLines) {
            ctx.fillText(line, startX + 14, textY);
            textY += 18;
          }
        }

        if (layout.surgConsultLines && layout.surgConsultLines.length > 0) {
          ctx.fillStyle = '#15803d';
          ctx.font = '700 13px "Be Vietnam Pro", sans-serif';
          for (const line of layout.surgConsultLines) {
            ctx.fillText(line, startX + 14, textY);
            textY += 18;
          }
        }

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

    function showWardToast(msg, duration = 3500) {
      let box = document.getElementById('toast-box');
      if (!box) {
        box = document.createElement('div');
        box.className = 'toast-box';
        box.id = 'toast-box';
        document.body.appendChild(box);
      }
      const item = document.createElement('div');
      item.className = 'toast-msg';
      item.textContent = msg;
      box.appendChild(item);
      setTimeout(() => item.remove(), duration);
    }

    const excelInp = document.getElementById('tk1-upload-excel-input');
    if (excelInp) {
      excelInp.addEventListener('change', async (e) => {
        const files = Array.from(e.target.files || []);
        if (files.length === 0) return;

        let successCount = 0;
        let lastData = null;

        for (const file of files) {
          try {
            const arrayBuf = await file.arrayBuffer();
            const uint8 = new Uint8Array(arrayBuf);
            let binary = '';
            for (let i = 0; i < uint8.byteLength; i++) {
              binary += String.fromCharCode(uint8[i]);
            }
            const base64Data = btoa(binary);

            const res = await fetch('/api/upload-his-excel', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ fileName: file.name, base64Data })
            });
            const data = await res.json();
            if (data.ok) {
              successCount++;
              lastData = data;
              const catLabel = data.detectedCat ? data.detectedCat.label : 'Dữ liệu HIS';
              showWardToast(`📂 Đã nhận diện [${catLabel}] (${data.rowCount || 0} dòng) từ file "${file.name}"!`);
            } else {
              showWardToast(`❌ Lỗi tải file ${file.name}: ${data.error || 'Thao tác thất bại'}`);
            }
          } catch (err) {
            console.error('Lỗi tải file:', err);
            showWardToast(`❌ Không thể tải file ${file.name}`);
          }
        }

        if (successCount > 1) {
          showWardToast(`🎉 Đã cập nhật thành công ${successCount} file Excel từ HIS!`, 4000);
        }

        if (lastData && lastData.lastExcelUploadTime) {
          const timeEl = document.getElementById('tk1-excel-time-text');
          if (timeEl) timeEl.textContent = lastData.lastExcelUploadTime;
        }

        await fetchTk1InitialState();
        if (typeof renderWard5RoomsGrid === 'function') renderWard5RoomsGrid();
        if (typeof renderAllRoomWorkspaces === 'function') renderAllRoomWorkspaces();

        e.target.value = '';
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

    // Cụm thông tin phẫu thuật Thần kinh 2: Tự động tính ngày hậu phẫu & điền chẩn đoán mặc định
    function updateTk2ModalDiagnosisAndBadge() {
      if (currentRoomKey !== 'tk2') return;
      const chkNonSurgical = document.getElementById('tk2-modal-chk-nonsurgical');
      const inpSurgName = document.getElementById('tk2-modal-inp-surgery-name');
      const inpSurgDate = document.getElementById('tk2-modal-inp-surgery-date');
      const badgePostOp = document.getElementById('tk2-modal-post-op-badge');
      const wrapFields = document.getElementById('tk2-surgery-fields-wrap');
      const diagInp = document.getElementById('tk1-modal-diagnosis-input');
      if (!chkNonSurgical || !inpSurgName || !inpSurgDate || !diagInp) return;

      const isNonSurgical = chkNonSurgical.checked;
      if (wrapFields) wrapFields.style.display = isNonSurgical ? 'none' : 'grid';

      const rec = activeModalMabn ? tk1State.patientRecords[activeModalMabn] : null;

      if (isNonSurgical) {
        diagInp.value = rec ? (rec.customDiagnosis || rec.chanDoanHis || '') : '';
      } else {
        const curDateKey = getSelectedDateKey();
        const sDate = inpSurgDate.value || (rec ? convertVnDateToIso(rec.ngayVaoStr) : '') || curDateKey;
        const postOpDay = calculatePostOpDay(sDate, curDateKey);
        if (badgePostOp) badgePostOp.textContent = `Ngày thứ ${postOpDay}`;
        const sName = inpSurgName.value.trim();
        diagInp.value = `Hậu phẫu ngày ${postOpDay} phẫu thuật ${sName}`.trim();
      }
    }

    const chkModalNonSurg = document.getElementById('tk2-modal-chk-nonsurgical');
    if (chkModalNonSurg) {
      chkModalNonSurg.addEventListener('change', updateTk2ModalDiagnosisAndBadge);
    }
    const inpModalSurgName = document.getElementById('tk2-modal-inp-surgery-name');
    if (inpModalSurgName) {
      inpModalSurgName.addEventListener('input', updateTk2ModalDiagnosisAndBadge);
    }
    const inpModalSurgDate = document.getElementById('tk2-modal-inp-surgery-date');
    if (inpModalSurgDate) {
      inpModalSurgDate.addEventListener('change', updateTk2ModalDiagnosisAndBadge);
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

    const scSearchInp = document.getElementById('tk4-sc-box-search');
    if (scSearchInp) {
      scSearchInp.addEventListener('input', (e) => {
        tk4ScSearchQuery = e.target.value;
        renderTk4SurgicalConsultBox();
      });
    }

    const btnToggleScCollapse = document.getElementById('btn-toggle-tk4-sc-collapse');
    if (btnToggleScCollapse) {
      btnToggleScCollapse.addEventListener('click', () => {
        tk4ScBoxCollapsed = !tk4ScBoxCollapsed;
        renderTk4SurgicalConsultBox();
      });
    }

    const btnScModalSave = document.getElementById('btn-tk4-sc-modal-save');
    if (btnScModalSave) {
      btnScModalSave.addEventListener('click', saveTk4SurgConsultFromDialog);
    }

    const btnScModalDelete = document.getElementById('btn-tk4-sc-modal-delete');
    if (btnScModalDelete) {
      btnScModalDelete.addEventListener('click', deleteTk4SurgConsultFromDialog);
    }

    const btnBoxAddPatient = document.getElementById('btn-tk4-box-add-patient');
    if (btnBoxAddPatient) {
      btnBoxAddPatient.addEventListener('click', openAddPatientToScDialog);
    }

    // Gắn sự kiện cho các nút Hội Chẩn Khoa mới
    const btnDeptConsult = document.getElementById('btn-open-select-consult-dept');
    if (btnDeptConsult) {
      btnDeptConsult.addEventListener('click', () => {
        openSelectPatientForConsultDeptModal(currentRoomKey);
      });
    }

    const dcDatePicker = document.getElementById('dept-consult-date-picker');
    if (dcDatePicker) {
      dcDatePicker.addEventListener('change', (e) => {
        activeDeptConsultDate = e.target.value || getTodayKey();
        renderDeptConsultWorkspace();
        if (typeof renderWard5RoomsGrid === 'function') renderWard5RoomsGrid();
      });
    }

    const btnDcToday = document.getElementById('btn-dept-consult-today');
    if (btnDcToday) {
      btnDcToday.addEventListener('click', () => {
        activeDeptConsultDate = getTodayKey();
        const dp = document.getElementById('dept-consult-date-picker');
        if (dp) dp.value = activeDeptConsultDate;
        renderDeptConsultWorkspace();
        if (typeof renderWard5RoomsGrid === 'function') renderWard5RoomsGrid();
      });
    }

    const dcSearchInp = document.getElementById('dept-consult-search-input');
    if (dcSearchInp) {
      dcSearchInp.addEventListener('input', (e) => {
        deptConsultSearchQuery = e.target.value;
        renderDeptConsultWorkspace();
      });
    }

    const btnDcAddPatient = document.getElementById('btn-dept-consult-add-patient');
    if (btnDcAddPatient) {
      btnDcAddPatient.addEventListener('click', () => {
        openSelectPatientForConsultDeptModal('ALL');
      });
    }

    const btnDcPrint = document.getElementById('btn-dept-consult-print');
    if (btnDcPrint) {
      btnDcPrint.addEventListener('click', openDeptConsultPrintModal);
    }

    document.querySelectorAll('#dept-consult-room-filters .dept-filter-pill').forEach(btn => {
      btn.addEventListener('click', () => {
        activeDeptConsultFilterRoom = btn.getAttribute('data-filter-room') || 'ALL';
        renderDeptConsultWorkspace();
      });
    });

    // Modal chọn bệnh nhân vào Hội chẩn khoa
    const modalDcDate = document.getElementById('dept-consult-modal-date');
    if (modalDcDate) {
      modalDcDate.addEventListener('change', renderDeptConsultSelectModalList);
    }

    const modalDcRoom = document.getElementById('dept-consult-modal-room-sel');
    if (modalDcRoom) {
      modalDcRoom.addEventListener('change', renderDeptConsultSelectModalList);
    }

    const modalDcSearch = document.getElementById('dept-consult-modal-search');
    if (modalDcSearch) {
      modalDcSearch.addEventListener('input', renderDeptConsultSelectModalList);
    }

    const btnModalGotoTab = document.getElementById('btn-dept-consult-modal-goto-tab');
    if (btnModalGotoTab) {
      btnModalGotoTab.addEventListener('click', () => {
        const dlg = document.getElementById('dept-consult-select-modal');
        if (dlg) dlg.close();
        const modalDate = document.getElementById('dept-consult-modal-date')?.value || getTodayKey();
        goToDeptConsultDate(modalDate);
      });
    }

    // Modal đơn giản riêng cho Thần kinh 4 (Yêu cầu 2)
    const btnTk4SimpleSave = document.getElementById('btn-tk4-simple-consult-save');
    if (btnTk4SimpleSave) {
      btnTk4SimpleSave.addEventListener('click', saveTk4SimpleConsult);
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
        
        if (currentRoomKey === 'hoi-chan-khoa') {
          renderDeptConsultWorkspace();
        } else {
          renderTk1Workspace();
        }
        if (typeof renderWard5RoomsGrid === 'function') renderWard5RoomsGrid();
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

      if (roomKey === 'hoi-chan-khoa') {
        renderDeptConsultWorkspace();
        if (typeof renderWard5RoomsGrid === 'function') renderWard5RoomsGrid();
        return;
      }

      if (roomKey !== 'tk4') {
        const boxEl = document.getElementById('tk4-surgical-consult-box');
        if (boxEl) boxEl.style.display = 'none';
        const tabBtn = document.getElementById('tk1-sum-tab-btn-hcm');
        if (tabBtn) tabBtn.style.display = 'none';
        const modalSc = document.getElementById('tk4-modal-sc-section');
        if (modalSc) modalSc.style.display = 'none';
        if (activeSummaryTab === 'hoi-chan-mo') {
          activeSummaryTab = 'xn-cdha';
        }
      }

      if (allRoomsState && allRoomsState[roomKey]) {
        tk1State = allRoomsState[roomKey];
        if (!tk1State.lastExcelUploadTime && lastExcelUploadTimeGlobal) {
          tk1State.lastExcelUploadTime = lastExcelUploadTimeGlobal;
        }
        renderTk1Workspace();
      } else {
        fetchTk1InitialState();
      }
      if (typeof renderWard5RoomsGrid === 'function') renderWard5RoomsGrid();
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
        
        if (currentRoomKey === 'hoi-chan-khoa') {
          renderDeptConsultWorkspace();
        } else {
          renderTk1Workspace();
        }
        if (typeof renderWard5RoomsGrid === 'function') renderWard5RoomsGrid();
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
    },
    // Expose các tính năng Hội Chẩn Khoa
    renderDeptConsultWorkspace,
    getDeptConsultStatsForDate,
    openSelectPatientForConsultDeptModal,
    addPatientToConsultFromModal,
    openTk4SimpleConsultDialog,
    saveTk4SimpleConsult,
    saveDeptConsultCard,
    removePatientFromDeptConsult,
    toggleCardSurgStatus,
    onDeptDecisionChange,
    getDeptConsultTagMeta,
    goToDeptConsultDate,
    openDeptConsultPrintModal,
    // Legacy support
    openTk4SurgConsultDialog,
    saveInlineScRow,
    renderTk4SurgicalConsultBox,
    addPatientToSurgicalConsultation,
    removePatientFromSurgicalConsultation,
    openAddPatientToScDialog
  };
})();
