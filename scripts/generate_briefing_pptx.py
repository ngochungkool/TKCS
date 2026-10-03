#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Generate a Morning Briefing PowerPoint (.pptx) matching the Khoa Ngoại Thần Kinh - Cột Sống official template.
Usage:
  python generate_briefing_pptx.py --date 2026-09-30 --out output.pptx
"""

import os
import sys
import json
import argparse
from PIL import Image

try:
    sys.stdout.reconfigure(encoding='utf-8')
except Exception:
    pass

try:
    import pptx
    from pptx.util import Inches, Pt
    from pptx.dml.color import RGBColor
    from pptx.enum.text import PP_ALIGN
    from pptx.enum.shapes import MSO_SHAPE
except ImportError:
    print("Error: python-pptx is not installed. Please run: pip install python-pptx pillow")
    sys.exit(1)

def format_date_display(date_str):
    # Converts YYYY-MM-DD to "Ngày DD – MM – YYYY"
    try:
        parts = date_str.split('-')
        if len(parts) == 3:
            return f"Ngày {parts[2]} – {parts[1]} – {parts[0]}"
    except Exception:
        pass
    return f"Ngày {date_str}"

def generate_pptx_for_date(date_key, db_path, out_pptx_path):
    with open(db_path, 'r', encoding='utf-8') as f:
        db = json.load(f)

    briefing_reports = db.get('briefingReports', {})
    report = briefing_reports.get(date_key)
    if not report:
        report = {
            "dateKey": date_key,
            "overall": {
                "doctorsOnDuty": ["HẢI", "CƯ", "LUÂN"],
                "grandCensus": {}
            },
            "highlightCases": []
        }

    prs = pptx.Presentation()
    # 16:9 Widescreen standard
    prs.slide_width = Inches(13.333)
    prs.slide_height = Inches(7.5)
    blank_layout = prs.slide_layouts[6]

    overall = report.get('overall', {})
    grand_census = overall.get('grandCensus', {})
    highlight_cases = report.get('highlightCases', [])

    # Doctors on duty string
    docs = overall.get('doctorsOnDuty', [])
    if isinstance(docs, list):
        docs_str = ' – '.join([str(d).replace('BS.', '').replace('BS', '').strip() for d in docs if str(d).strip()])
    else:
        docs_str = str(docs).strip()
    if not docs_str:
        docs_str = "HẢI – CƯ – LUÂN – LƯƠNG"

    # =========================================================================
    # SLIDE 1: COVER & BẢNG 8 CHỈ SỐ GIAO BAN
    # =========================================================================
    s1 = prs.slides.add_slide(blank_layout)

    # Title box
    tx_box = s1.shapes.add_textbox(Inches(0.5), Inches(0.8), Inches(12.333), Inches(2.6))
    tf = tx_box.text_frame
    tf.word_wrap = True

    p1 = tf.paragraphs[0]
    p1.text = "BÁO CÁO GIAO BAN"
    p1.font.name = "Times New Roman"
    p1.font.size = Pt(40)
    p1.font.bold = True
    p1.font.color.rgb = RGBColor(15, 23, 42)
    p1.alignment = PP_ALIGN.CENTER

    p2 = tf.add_paragraph()
    date_display = format_date_display(date_key)
    p2.text = f"{date_display}   BS:{docs_str}"
    p2.font.name = "Times New Roman"
    p2.font.size = Pt(24)
    p2.font.bold = True
    p2.font.color.rgb = RGBColor(30, 41, 59)
    p2.alignment = PP_ALIGN.CENTER

    # Census Table: 2 rows x 8 cols
    rows, cols = 2, 8
    t_left, t_top, t_w, t_h = Inches(1.2), Inches(3.8), Inches(10.9), Inches(1.8)
    tbl_shape = s1.shapes.add_table(rows, cols, t_left, t_top, t_w, t_h)
    tbl = tbl_shape.table

    # Column widths
    for i in range(8):
        tbl.columns[i].width = Inches(10.9 / 8)

    headers = ['Bệnh cũ', 'Vào', 'Ra', 'Tử vong', 'Chuyển', 'Mổ', 'Hiện có', 'Bảo hiểm']
    
    # Calculate values
    val_benh_cu = grand_census.get('benhCu', 0)
    val_vao = grand_census.get('vao', grand_census.get('vaoKK', 0) + grand_census.get('vaoKhac', 0))
    val_ra = grand_census.get('ra', grand_census.get('raRH', 0) + grand_census.get('raKhac', 0))
    val_tu_vong = grand_census.get('tuVong', 0)
    val_chuyen = grand_census.get('chuyen', grand_census.get('raKhac', 0))
    val_mo = grand_census.get('mo', grand_census.get('moCT', 0) + grand_census.get('moCC', 0))
    val_hien_co = grand_census.get('hienCo', 0)
    val_bhyt = grand_census.get('bhyt', 0)

    vals = [
        str(val_benh_cu),
        str(val_vao),
        str(val_ra),
        str(val_tu_vong),
        str(val_chuyen),
        str(val_mo),
        str(val_hien_co),
        str(val_bhyt)
    ]

    for col_idx, h_text in enumerate(headers):
        cell = tbl.cell(0, col_idx)
        cell.text = h_text
        for cp in cell.text_frame.paragraphs:
            cp.font.name = "Times New Roman"
            cp.font.size = Pt(20)
            cp.font.bold = True
            cp.font.color.rgb = RGBColor(15, 23, 42)
            cp.alignment = PP_ALIGN.CENTER

    for col_idx, v_text in enumerate(vals):
        cell = tbl.cell(1, col_idx)
        cell.text = v_text
        for cp in cell.text_frame.paragraphs:
            cp.font.name = "Times New Roman"
            cp.font.size = Pt(24)
            cp.font.bold = True
            # Highlight current and surgery in red / blue
            if col_idx == 6: # Hiện có
                cp.font.color.rgb = RGBColor(180, 83, 9)
            elif col_idx in [1, 5]: # Vào, Mổ
                cp.font.color.rgb = RGBColor(220, 38, 38)
            else:
                cp.font.color.rgb = RGBColor(15, 23, 42)
            cp.alignment = PP_ALIGN.CENTER

    # =========================================================================
    # SLIDES CHO TỪNG CA BỆNH TRỌNG ĐIỂM
    # =========================================================================
    project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

    for c_idx, c in enumerate(highlight_cases, 1):
        if c.get('selectedForSlide') is False:
            continue

        category = c.get('category', '').strip()
        if not category:
            room = c.get('roomName', 'Khoa')
            category = f"{room} – BỆNH THEO DÕI"

        hoten = c.get('hoten', '').strip().upper()
        tuoi = str(c.get('tuoi', '')).strip()
        gioi_tinh = c.get('gioiTinh', '').strip().upper()
        if not gioi_tinh:
            gioi_tinh = "NAM" if "VĂN" in hoten or "DUY" in hoten or "SINH" in hoten or "ÂN" in hoten else "NỮ"

        dia_chi = c.get('diaChi', '').strip()
        ngay_vao = c.get('ngayVaoVien', date_key).strip()
        ngay_pt = c.get('ngayPhauThuat', '').strip()
        ngay_ve = c.get('ngayXinVe', '').strip()
        chan_doan = c.get('chanDoan', '').strip()

        stt_num = c.get('stt', c_idx)

        # SLIDE THÔNG TIN BỆNH ÁN
        s_info = prs.slides.add_slide(blank_layout)

        tx_info = s_info.shapes.add_textbox(Inches(0.8), Inches(0.6), Inches(11.8), Inches(6.3))
        tf_info = tx_info.text_frame
        tf_info.word_wrap = True

        # Header dòng 1: Nhóm ca bệnh (VD: HSTK – BỆNH NẶNG XIN VỀ)
        p_cat = tf_info.paragraphs[0]
        p_cat.text = category
        p_cat.font.name = "Times New Roman"
        p_cat.font.size = Pt(32)
        p_cat.font.bold = True
        if "XIN VỀ" in category or "TỬ VONG" in category:
            p_cat.font.color.rgb = RGBColor(185, 28, 28)
        elif "MỔ" in category:
            p_cat.font.color.rgb = RGBColor(29, 78, 216)
        else:
            p_cat.font.color.rgb = RGBColor(15, 118, 110)

        # Header dòng 2: Tên BN, tuổi, giới tính
        p_name = tf_info.add_paragraph()
        p_name.text = f"{stt_num}. {hoten}\t{tuoi} tuổi\t{gioi_tinh}"
        p_name.font.name = "Times New Roman"
        p_name.font.size = Pt(28)
        p_name.font.bold = True
        p_name.font.color.rgb = RGBColor(15, 23, 42)
        p_name.space_before = Pt(14)

        # Dòng 3: Địa chỉ
        if dia_chi:
            p_dc = tf_info.add_paragraph()
            p_dc.text = f"Địa chỉ: {dia_chi}"
            p_dc.font.name = "Times New Roman"
            p_dc.font.size = Pt(22)
            p_dc.space_before = Pt(8)

        # Dòng 4: Ngày vào viện
        p_nv = tf_info.add_paragraph()
        p_nv.text = f"Ngày vào viện : {ngay_vao}"
        p_nv.font.name = "Times New Roman"
        p_nv.font.size = Pt(22)
        p_nv.space_before = Pt(8)

        # Dòng 5: Ngày phẫu thuật / Ngày xin về
        if ngay_pt:
            p_pt = tf_info.add_paragraph()
            p_pt.text = f"Ngày phẫu thuật: {ngay_pt}"
            p_pt.font.name = "Times New Roman"
            p_pt.font.size = Pt(22)
            p_pt.space_before = Pt(6)
        elif ngay_ve:
            p_ve = tf_info.add_paragraph()
            p_ve.text = f"Ngày xin về: {ngay_ve}"
            p_ve.font.name = "Times New Roman"
            p_ve.font.size = Pt(22)
            p_ve.space_before = Pt(6)

        # Dòng 6: Chẩn đoán
        p_cd = tf_info.add_paragraph()
        p_cd.text = f"Chẩn đoán: {chan_doan}"
        p_cd.font.name = "Times New Roman"
        p_cd.font.size = Pt(24)
        p_cd.font.bold = True
        p_cd.font.color.rgb = RGBColor(3, 105, 161)
        p_cd.space_before = Pt(14)

        # SLIDES HÌNH ẢNH CT / MRI / CẬN LÂM SÀNG
        images = c.get('images', [])
        valid_img_paths = []
        for img_obj in images:
            img_url = img_obj.get('url', '')
            if img_url.startswith('/'):
                rel_path = img_url.lstrip('/')
                full_path = os.path.join(project_root, rel_path)
            else:
                full_path = img_url
            if os.path.exists(full_path):
                valid_img_paths.append(full_path)

        # If 2 portrait images (e.g. X-rays like slide 10), we can place them side by side
        # Check aspect ratio
        i = 0
        while i < len(valid_img_paths):
            current_path = valid_img_paths[i]
            # Check if this and next are portrait
            is_pair_side_by_side = False
            if i + 1 < len(valid_img_paths):
                try:
                    with Image.open(current_path) as im1, Image.open(valid_img_paths[i+1]) as im2:
                        w1, h1 = im1.size
                        w2, h2 = im2.size
                        # If both are portrait aspect ratio (h > w)
                        if (h1 / w1 > 1.1) and (h2 / w2 > 1.1):
                            is_pair_side_by_side = True
                except Exception:
                    pass

            s_img = prs.slides.add_slide(blank_layout)

            if is_pair_side_by_side:
                # Add 2 images side-by-side
                p1_path = valid_img_paths[i]
                p2_path = valid_img_paths[i+1]
                s_img.shapes.add_picture(p1_path, Inches(0.0), Inches(0.24), width=Inches(6.6), height=Inches(6.6))
                s_img.shapes.add_picture(p2_path, Inches(6.7), Inches(0.24), width=Inches(6.6), height=Inches(6.6))
                i += 2
            else:
                # Add single image centered, fitting 13.33" x 7.2"
                try:
                    with Image.open(current_path) as im:
                        im_w, im_h = im.size
                    ratio = im_w / im_h
                    slide_ratio = 13.333 / 7.2

                    if ratio > slide_ratio:
                        # Width limited
                        fit_w = Inches(13.333)
                        fit_h = Inches(13.333 / ratio)
                        fit_l = Inches(0.0)
                        fit_t = Inches((7.5 - (13.333 / ratio)) / 2)
                    else:
                        # Height limited
                        fit_h = Inches(7.2)
                        fit_w = Inches(7.2 * ratio)
                        fit_l = Inches((13.333 - (7.2 * ratio)) / 2)
                        fit_t = Inches(0.15)

                    s_img.shapes.add_picture(current_path, fit_l, fit_t, width=fit_w, height=fit_h)
                except Exception as e:
                    print(f"Lỗi chèn ảnh {current_path}: {e}")
                    s_img.shapes.add_picture(current_path, Inches(0.5), Inches(0.5), width=Inches(12.33), height=Inches(6.5))
                i += 1

    prs.save(out_pptx_path)
    print(f"Đã xuất thành công file PowerPoint giao ban: {out_pptx_path}")

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description="Xuất file Báo cáo giao ban PowerPoint (.pptx)")
    parser.add_argument('--date', required=True, help="Ngày báo cáo (YYYY-MM-DD)")
    parser.add_argument('--out', required=True, help="Đường dẫn file PPTX đầu ra")
    parser.add_argument('--db', default=os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'state_db.json'), help="Đường dẫn file state_db.json")

    args = parser.parse_args()
    generate_pptx_for_date(args.date, args.db, args.out)
