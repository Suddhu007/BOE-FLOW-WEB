import pymupdf
import re

def _number(value):
    """Safely convert an ICEGATE text value to float."""
    try:
        return float(str(value).replace(",", "").strip())
    except (TypeError, ValueError):
        return None


def _extract_duty_amounts(lines, first_cth, n, invsno_idx, coo_idx):
    """
    Extract actual per-item BCD, SWS and official total-duty amounts.

    ICEGATE does not use one fixed text order. In some BOEs the duty table
    appears after the INV header; in others some values are flattened before
    it. Therefore the extraction is anchored to the visual section labels:

        A. ITEM DETAILS -> SWS
        B. ITEM DUTY    -> BCD
        PART - III - DUTIES -> official total duty

    For a two-item block, ICEGATE repeats each column vertically:
        notification[n] -> serial[n] -> rate[n] -> amount[n] -> duty_fg[n]
    """
    bcd_amounts = [0.0] * n
    sws_amounts = [0.0] * n
    total_duty_amounts = [0.0] * n

    if n <= 0:
        return bcd_amounts, sws_amounts, total_duty_amounts

    def numeric_block(values):
        out = []
        for value in values:
            number = _number(value)
            if number is not None:
                out.append(number)
        return out

    def first_indices(pattern, start, end):
        return [
            i for i in range(start, min(end, len(lines)))
            if re.fullmatch(pattern, lines[i])
        ]

    # -------- SWS --------
    # In ICEGATE's flattened item table, all A. ITEM DETAILS rows can occur
    # before the first B. ITEM DUTY row. The final 2*n numeric values in this
    # section are the SWS rates followed by the SWS amounts.
    a_item_idx = next(
        (i for i, line in enumerate(lines) if re.fullmatch(r"A\.\s*ITEM", line, re.IGNORECASE)),
        -1,
    )
    b_item_idx = next(
        (i for i, line in enumerate(lines) if re.fullmatch(r"B\.\s*ITEM", line, re.IGNORECASE)),
        -1,
    )

    if a_item_idx != -1 and b_item_idx > a_item_idx:
        a_numeric = numeric_block(lines[a_item_idx + 1:b_item_idx])
        if len(a_numeric) >= 2 * n:
            sws_amounts = a_numeric[-n:]

    # -------- BCD + official 30.TOTAL DUTY --------
    # In the assessed-copy layout, the numeric tail immediately before the
    # assessable-value/unit-price fields is:
    #   TOTAL DUTY (n) -> BCD RATE (n) -> BCD AMOUNT (n) -> zero-duty columns.
    # The previous implementation incorrectly treated the first notification
    # under B.ITEM DUTY as BCD; that notification can actually be IGST.
    if coo_idx != -1:
        av_start = coo_idx - 2 * n
        tail = []
        for i in range(av_start - 1, max(first_cth, 0) - 1, -1):
            value = _number(lines[i])
            if value is not None and value != 0:
                tail.append((i, value))
            if len(tail) >= 3 * n:
                break

        if len(tail) >= 3 * n:
            # The PDF text stream preserves this numeric block in the
            # visual column order:
            # TOTAL DUTY -> BCD RATE -> BCD AMOUNT.
            # Do not reverse it; reversing makes TOTAL DUTY become BCD.
            vals = [value for _, value in reversed(tail)]
            total_candidate = vals[0:n]
            bcd_rates = vals[n:2 * n]
            bcd_candidate = vals[2 * n:3 * n]

            # Validate against the known assessable values. This prevents
            # unrelated numbers from earlier item fields being selected.
            sane = True
            for k in range(n):
                av = _number(lines[av_start + k])
                if av is None:
                    sane = False
                    break
                expected = av * bcd_rates[k] / 100.0
                if abs(expected - bcd_candidate[k]) > 2.0:
                    sane = False
                    break

            if sane:
                bcd_amounts = bcd_candidate
                total_duty_amounts = total_candidate

    # -------- Official Total Duty --------
    # PART - III contains the official "30. TOTAL DUTY" amount. Its first
    # notification is normally 011/2021, followed by serial/rate/amount
    # blocks. Read the amount block instead of assuming values before the
    # notification belong to total duty.
    part_iii_idx = next(
        (i for i, line in enumerate(lines)
         if "PART - III - DUTIES" in line.upper()),
        -1,
    )

    if part_iii_idx != -1:
        total_notifications = first_indices(
            r"\d{3}/\d{4}",
            part_iii_idx + 1,
            len(lines),
        )

        if len(total_notifications) >= n:
            first_notification = total_notifications[0]
            serial_start = first_notification + n
            rate_start = serial_start + n
            amount_start = rate_start + n

            candidate = []
            for k in range(n):
                idx = amount_start + k
                if idx < len(lines):
                    value = _number(lines[idx])
                    candidate.append(value if value is not None else 0.0)

            if len(candidate) == n:
                total_duty_amounts = candidate

    return bcd_amounts, sws_amounts, total_duty_amounts


def _extract_commercial_qty_uqc_by_coordinates(page, n):
    """
    Read commercial quantity/unit directly from the ICEGATE ITEM DETAILS table.
    Use 13.C.QTY and 14.C.UQC, not 15.S.QTY / 16.S.UQC.
    """
    if page is None or n <= 0:
        return None

    def num(text):
        try:
            return float(str(text).replace(",", "").strip())
        except (TypeError, ValueError):
            return None

    words = page.get_text("words")
    cth_words = [
        w for w in words
        if re.fullmatch(r"\d{8}", w[4].strip() or "")
        and 135 <= w[0] <= 195
    ]
    cth_words.sort(key=lambda w: w[1])

    if len(cth_words) < n:
        return None

    cth_words = cth_words[:n]

    def text_at(x_min, x_max, y, tolerance=5.0):
        candidates = []
        for w in words:
            x0, y0, x1, y1, text = w[:5]
            if x0 < x_min or x0 > x_max or abs(y0 - y) > tolerance:
                continue
            candidates.append(
                (
                    abs(y0 - y)
                    + abs(((x0 + x1) / 2) - ((x_min + x_max) / 2)),
                    text,
                )
            )
        return min(candidates)[1].strip() if candidates else None

    result = []
    for cth in cth_words:
        item_y = cth[1] + 36.0
        qty_text = text_at(145, 195, item_y)
        uqc_text = text_at(195, 245, item_y)

        qty = num(qty_text)
        uqc = str(uqc_text or "").strip().upper()

        if qty is None or not re.fullmatch(r"[A-Z]{2,6}", uqc):
            return None

        result.append({"quantity": qty, "uqc": uqc})

    return result


def _extract_duty_amounts_by_coordinates(page, n):
    """Extract SEPFUST-style item duty fields from ICEGATE table cells."""
    if page is None or n <= 0:
        return None

    def num(text):
        try:
            return float(str(text).replace(",", "").strip())
        except (TypeError, ValueError):
            return None

    words = page.get_text("words")
    bcd_headers = [
        w for w in words
        if w[4].strip().upper() == "BCD" and 105 <= w[0] <= 145
    ]
    bcd_headers.sort(key=lambda w: w[1])
    if len(bcd_headers) < n:
        return None
    bcd_headers = bcd_headers[:n]

    cols = {
        "bcd": (100, 145),
        "sws": (190, 240),
        "igst": (295, 345),
        "assessable": (400, 490),
        "total_duty": (500, 580),
    }

    def value_at(x_min, x_max, y, tolerance=4.5):
        candidates = []
        for w in words:
            x0, y0, x1, y1, text = w[:5]
            if x0 < x_min or x0 > x_max or abs(y0 - y) > tolerance:
                continue
            value = num(text)
            if value is not None:
                candidates.append(
                    (abs(y0-y) + abs(((x0+x1)/2)-((x_min+x_max)/2)), value)
                )
        return min(candidates)[1] if candidates else None

    result = []
    for header in bcd_headers:
        hy = header[1]
        summary_y = hy - 9.0
        rate_y = hy + 27.0
        amount_y = hy + 36.0

        assessable = value_at(*cols["assessable"], summary_y)
        total_duty = value_at(*cols["total_duty"], summary_y)
        bcd_rate = value_at(*cols["bcd"], rate_y)
        bcd_amount = value_at(*cols["bcd"], amount_y)
        sws_rate = value_at(*cols["sws"], rate_y)
        sws_amount = value_at(*cols["sws"], amount_y)
        bcd_duty_forgone = value_at(*cols["bcd"], hy + 45.0)
        sws_duty_forgone = value_at(*cols["sws"], hy + 45.0)
        igst_rate = value_at(*cols["igst"], rate_y)
        igst_amount = value_at(*cols["igst"], amount_y)

        required = (
            assessable, total_duty, bcd_rate, bcd_amount,
            sws_rate, sws_amount, igst_rate, igst_amount
        )
        if any(v is None for v in required):
            return None

        # BCD/SWS/IGST Amounts are read from the printed ICEGATE Amount
        # cells. Do not reject them just because an assumed arithmetic basis
        # differs from the tariff calculation; customs duty can include
        # exemptions, notifications, specific-duty rules and other bases.
        # The printed Amount is the authoritative value for this BOE review.
        other_duty = round(
            total_duty - bcd_amount - sws_amount - igst_amount,
            2,
        )
        if other_duty < -3.0:
            other_duty = 0.0

        result.append({
            "assessable": round(assessable, 2),
            "total_duty": round(total_duty, 2),
            "bcd_duty_forgone": round(bcd_duty_forgone or 0.0, 2),
            "sws_duty_forgone": round(sws_duty_forgone or 0.0, 2),
            "bcd_rate": round(bcd_rate, 2),
            "bcd_amount": round(bcd_amount, 2),
            "sws_rate": round(sws_rate, 2),
            "sws_amount": round(sws_amount, 2),
            "igst_rate": round(igst_rate, 2),
            "igst_amount": round(igst_amount, 2),
            "other_duty": max(0.0, other_duty),
        })

    return result

def parse_icegate_page_stream(page_text, page=None):
    """
    Parses item pages containing 1 or 2 items from the ICEGATE text stream.
    """
    lines = [l.strip() for l in page_text.split('\n') if l.strip()]
    if '1.INVSNO' not in lines and '3.CTH' not in lines:
        return []

    # Find the contiguous CTH/HSN item block after ASSESSED.
    # Some ICEGATE item pages contain 1 item, others 2 or 3 items. The
    # previous parser hard-coded a maximum of 2 and therefore dropped every
    # third item on multi-item pages (for example this 53-item BOE has three
    # items on most duty pages).
    assessed_idx = next(
        (i for i, line in enumerate(lines) if "ASSESSED" in line.upper()),
        -1,
    )

    if assessed_idx == -1:
        return []

    cth_indices = [
        i for i, line in enumerate(lines)
        if i > assessed_idx and line.isdigit() and len(line) == 8
    ]

    if not cth_indices:
        return []

    # Split into contiguous CTH runs. Invoice/valuation pages may contain
    # many HSN values but do not have the item-number / quantity / UQC layout
    # used by the assessed duty pages.
    runs = []
    current = [cth_indices[0]]
    for idx in cth_indices[1:]:
        if idx == current[-1] + 1:
            current.append(idx)
        else:
            runs.append(current)
            current = [idx]
    runs.append(current)

    selected_run = None
    for run in runs:
        n_candidate = len(run)
        first_candidate = run[0]
        serial_start = first_candidate - (2 * n_candidate)
        qty_start = first_candidate + (2 * n_candidate)
        uqc_start = first_candidate + (3 * n_candidate)

        if serial_start < 0 or uqc_start + n_candidate > len(lines):
            continue

        serial_block = lines[serial_start:first_candidate - n_candidate]
        qty_block = lines[qty_start:uqc_start]
        uqc_block = lines[uqc_start:uqc_start + n_candidate]

        serial_ok = (
            len(serial_block) == n_candidate
            and all(re.fullmatch(r"\d+", value) for value in serial_block)
        )
        qty_ok = (
            len(qty_block) == n_candidate
            and all(_number(value) is not None for value in qty_block)
        )
        uqc_ok = (
            len(uqc_block) == n_candidate
            and all(value.strip() for value in uqc_block)
        )

        if serial_ok and qty_ok and uqc_ok:
            selected_run = run
            break

    if selected_run is None:
        return []

    n = len(selected_run)
    first_cth = selected_run[0]
    cths = [lines[idx] for idx in selected_run]

    serial_block = lines[first_cth - (2 * n):first_cth - n]
    item_sns = [int(value) for value in serial_block]

    commercial_fields = _extract_commercial_qty_uqc_by_coordinates(page, n)

    if commercial_fields is not None:
        qtys = [field["quantity"] for field in commercial_fields]
        uqcs = [field["uqc"] for field in commercial_fields]
    else:
        qtys = [
            float(lines[first_cth + (2 * n) + k])
            for k in range(n)
        ]
        uqcs = [
            lines[first_cth + (3 * n) + k]
            for k in range(n)
        ]

    # ICEGATE can return the column header either as a standalone
    # "1.INVSNO" line or combined as "1.INVSNO 2.ITEMSN".
    invsno_idx = next(
        (i for i, line in enumerate(lines) if '1.INVSNO' in line),
        len(lines),
    )

    coo_idx = -1
    for i in range(first_cth, invsno_idx):
        if len(lines[i]) == 2 and lines[i].isalpha() and lines[i].isupper():
            coo_idx = i
            break

    coo_codes = []
    for k in range(n):
        try:
            if coo_idx != -1 and coo_idx + k < len(lines):
                code = lines[coo_idx + k].strip().upper()
                coo_codes.append(code if re.fullmatch(r"[A-Z]{2}", code) else "N/A")
            else:
                coo_codes.append("N/A")
        except Exception:
            coo_codes.append("N/A")

    assessable_vals = []
    unit_prices = []
    if coo_idx != -1:
        for k in range(n):
            try:
                av = float(lines[coo_idx - 2 * n + k])
                up = float(lines[coo_idx - n + k])
                assessable_vals.append(av)
                unit_prices.append(up)
            except Exception:
                assessable_vals.append(0.0)
                unit_prices.append(0.0)
    else:
        assessable_vals = [0.0] * n
        unit_prices = [0.0] * n

    # PRIMARY DUTY SOURCE:
    # Read the printed Part-III item table by physical column/row.
    # Do NOT use flattened text order or PART-III "C. OTHER DUTIES" values:
    # those can contain CAIDC/other-duty figures that are not 30.TOTAL DUTY.
    coordinate_duties = _extract_duty_amounts_by_coordinates(page, n)

    if coordinate_duties is not None:
        bcd_amounts = [d["bcd_amount"] for d in coordinate_duties]
        sws_amounts = [d["sws_amount"] for d in coordinate_duties]
        total_duty_amounts = [d["total_duty"] for d in coordinate_duties]
        assessable_vals = [d["assessable"] for d in coordinate_duties]
    else:
        # Legacy fallback only for BOEs whose table layout cannot be located.
        bcd_amounts, sws_amounts, total_duty_amounts = _extract_duty_amounts(
            lines,
            first_cth,
            n,
            invsno_idx,
            coo_idx,
        )

    assessed_line = -1
    for i in range(first_cth - 2 * n - 1, -1, -1):
        if 'ASSESSED' in lines[i]:
            assessed_line = i
            break
    desc_chunk = lines[assessed_line + 1 : first_cth - 2 * n] if assessed_line != -1 else []
    lines_per_desc = max(1, len(desc_chunk) // n) if n > 0 else 1
    descriptions = []
    for k in range(n):
        d = ' '.join(desc_chunk[k * lines_per_desc : (k + 1) * lines_per_desc])
        descriptions.append(d.strip())

    items = []
    for k in range(n):
        av = assessable_vals[k]
        up = unit_prices[k]
        hsn = cths[k]
        # Use the actual duty amounts printed on the BOE.
        bcd = round(bcd_amounts[k], 2)
        sws = round(sws_amounts[k], 2)
        taxable = round(av + bcd + sws, 2)

        if coordinate_duties is not None:
            duty = coordinate_duties[k]
            bcd_rate = duty["bcd_rate"]
            sws_rate = duty["sws_rate"]
            igst_rate = duty["igst_rate"]
            igst = duty["igst_amount"]
            other_duty = duty["other_duty"]
        else:
            bcd_rate = 0.0
            sws_rate = 0.0
            igst_rate = 18.0
            igst = round(taxable * igst_rate / 100.0, 2)
            other_duty = 0.0

        total_payable_duty = round(total_duty_amounts[k], 2)

        items.append({
            'Item No': item_sns[k],
            'Description': descriptions[k],
            'HSN Code': hsn,
            'Country of Origin Code': coo_codes[k],
            'Quantity': qtys[k],
            'UQC': uqcs[k],
            'Unit Price (FC)': up,
            'Assessable Value (CIF INR)': av,
            'BCD Rate (%)': bcd_rate,
            'BCD Amount': bcd,
            'BCD Duty Forgone': (
                round(coordinate_duties[k]["bcd_duty_forgone"], 2)
                if coordinate_duties is not None
                else 0.0
            ),
            'SWS Rate (%)': sws_rate,
            'SWS Amount': sws,
            'SWS Duty Forgone': (
                round(coordinate_duties[k]["sws_duty_forgone"], 2)
                if coordinate_duties is not None
                else 0.0
            ),
            'Other Customs Duty': other_duty,
            'GST Taxable Value (for E-Way)': taxable,
            'IGST Rate (%)': igst_rate,
            'IGST Amount': igst,
            'Calculated IGST': igst,
            'Item Total Duty': total_payable_duty,
            'Total Duty Payable (Incl. GST)': total_payable_duty
        })
    return items

def process_complete_boe_portal(pdf_bytes):
    """
    Safely processes an Indian Customs Bill of Entry.
    """
    try:
        doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")
    except Exception:
        return None, None

    if len(doc) == 0:
        return None, None

    all_pages_text = [page.get_text() for page in doc]
    full_text = "\n".join(all_pages_text)

    # Verification Gate: Must be an Indian Customs BOE
    is_boe = any(k in full_text.upper() for k in [
        "BILL OF ENTRY", "ICEGATE", "B/E NO", "PORT CODE", "INDIAN CUSTOMS", "ASSESSED COPY", "FIRST COPY"
    ])
    if not is_boe:
        return None, None

    # Header from Page 1
    p1_lines = [l.strip() for l in all_pages_text[0].split('\n') if l.strip()]
    boe_no = p1_lines[0] if len(p1_lines) > 0 and p1_lines[0].isdigit() else "N/A"
    boe_date = p1_lines[1] if len(p1_lines) > 1 and "/" in p1_lines[1] else "N/A"
    gross_wt = p1_lines[7] if len(p1_lines) > 7 else "N/A"
    total_items = int(p1_lines[6]) if len(p1_lines) > 6 and p1_lines[6].isdigit() else 0

    port_match = re.search(r"\b(IN[A-Z0-9]{4})\b", full_text)
    port_code = port_match.group(1) if port_match else "N/A"

    gstin_match = re.search(r"([0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1})", full_text)
    gstin = gstin_match.group(1) if gstin_match else "N/A"

    # Customs Broker (CHA) Name & Code
    cb_code_m = re.search(r"([A-Z0-9]{15})\s*\n+\s*IN[A-Z0-9]{4}", full_text)
    cb_code = cb_code_m.group(1) if cb_code_m else "N/A"
    
    cha_decl = re.search(r"CHA\s*NAME\s*:\s*([^\n]+)", full_text, re.IGNORECASE)
    if cha_decl:
        cb_name = cha_decl.group(1).strip()
    else:
        cb_name = "N/A"
        for i, l in enumerate(p1_lines):
            if "INR=INR" in l and i > 0:
                cb_name = p1_lines[i - 1].strip()
                break

    # Exchange Rate
    ex_m = re.search(r"1\s*([A-Z]{3})\s*=\s*([\d\.]+)\s*INR", full_text, re.IGNORECASE)
    exchange_rate = f"1 {ex_m.group(1)} = ₹{ex_m.group(2)}" if ex_m else "N/A"

    # Commercial Invoice & Invoice Amount
    # Use the dedicated ICEGATE "O. INVOICE DETAILS" section.
    # Example from the uploaded BOE:
    # 1 SSINDIA26224O 67935.52 USD
    invoice_summary_match = re.search(
        r"O\.\s*INVOICE\s*DETAILS.*?(?=PART\s*-\s*V\b|$)",
        full_text,
        re.IGNORECASE | re.DOTALL,
    )
    invoice_summary = invoice_summary_match.group(0) if invoice_summary_match else ""

    invoice_summary_row = re.search(
        r"(?m)^\s*1\s+"
        r"([A-Za-z0-9][A-Za-z0-9_/-]{3,30})\s+"
        r"([\d,]+(?:\.\d+)?)\s+"
        r"(USD|EUR|GBP|KRW|JPY|CNY|INR)\s*$",
        invoice_summary,
        re.IGNORECASE,
    )

    inv_no = "N/A"
    inv_date = "N/A"
    inv_amount = "N/A"

    if invoice_summary_row:
        inv_no = invoice_summary_row.group(1).strip()
        inv_value = invoice_summary_row.group(2).replace(",", "")
        inv_currency = invoice_summary_row.group(3).upper()
        inv_amount = f"{float(inv_value):,.2f} {inv_currency}"

        # Invoice date is stored separately in Part-II.
        invoice_date_m = re.search(
            r"PART\s*-\s*II\s*-\s*INVOICE.*?(?=\b1\.INVSNO\b|$)",
            full_text,
            re.IGNORECASE | re.DOTALL,
        )
        invoice_date_section = (
            invoice_date_m.group(0) if invoice_date_m else ""
        )
        date_m = re.search(
            r"(?m)^\s*(\d{2}-[A-Za-z]{3}-\d{2,4})\s*$",
            invoice_date_section,
        )
        inv_date = date_m.group(1).strip() if date_m else "N/A"

    else:
        # Safe fallback: find the invoice number in Part-II and then
        # take the first standalone amount after the invoice/date block.
        invoice_section_match = re.search(
            r"PART\s*-\s*II\s*-\s*INVOICE\s*&\s*VALUATION\s*DETAILS.*?(?=\b1\.INVSNO\b|$)",
            full_text,
            re.IGNORECASE | re.DOTALL,
        )
        invoice_section = (
            invoice_section_match.group(0)
            if invoice_section_match
            else ""
        )

        inv_no_m = re.search(
            r"(?m)^\s*1\s+([A-Za-z0-9][A-Za-z0-9_/-]{3,30})\s*$",
            invoice_section,
        )
        date_m = re.search(
            r"(?m)^\s*(\d{2}-[A-Za-z]{3}-\d{2,4})\s*$",
            invoice_section,
        )

        if inv_no_m:
            inv_no = inv_no_m.group(1).strip()
        if date_m:
            inv_date = date_m.group(1).strip()

        if inv_no_m:
            tail = invoice_section[inv_no_m.end():]
            if date_m:
                tail = invoice_section[date_m.end():]

            amount_m = re.search(
                r"(?m)^\s*([\d,]+(?:\.\d+)?)\s*$",
                tail,
            )
            if amount_m:
                inv_value = amount_m.group(1).replace(",", "")
                inv_amount = f"{float(inv_value):,.2f}"

# Manifest Waybill (MAWB / HAWB)
    mawb_m = re.search(r"\b(\d{11})\s+(\d{2}/\d{2}/\d{4})\b", all_pages_text[0])
    mawb_no = mawb_m.group(1) if mawb_m else "N/A"

    hawb_m = re.search(r"\b([A-Z0-9]{8,14})\s+(\d{2}/\d{2}/\d{4})\b", all_pages_text[0])
    hawb_no = hawb_m.group(1) if hawb_m else "N/A"

    # Mode & Container
    # Read the actual transport mode printed in the BOE.
    mode_m = re.search(
        r"(?:FIRST COPY|ASSESSED COPY)\s+(Air|Sea|Land)",
        all_pages_text[0],
        re.IGNORECASE,
    )
    actual_mode = mode_m.group(1).capitalize() if mode_m else "N/A"

    # Website display rule:
    # Land -> Ship, otherwise show the actual BOE mode.
    ship_mode = "Ship" if actual_mode.lower() == "land" else actual_mode

    cont_m = re.search(r"\b([A-Z]{4}\d{7})\b", full_text)
    container_no = cont_m.group(1) if cont_m else f"N/A ({ship_mode} Cargo)"

    lcl_m = re.search(r"\b(FCL|LCL)\b", full_text)
    lcl_fcl = lcl_m.group(1) if lcl_m else f"N/A ({ship_mode} Cargo)"

    # Supplier Extraction
    #
    # IMPORTANT: Do not infer the supplier by walking backwards from the
    # valuation/rule section. PyMuPDF's normal text order is based on the
    # PDF's internal content order and can place the table heading
    # "3.SUPPLIER NAME & ADDRESS" after the actual supplier values.
    #
    # On ICEGATE Part-II the supplier is the value block visually belonging
    # to that exact heading. Use block coordinates to bind the value to the
    # heading instead of relying on page position or company-name keywords.
    supplier_info = "N/A"
    if len(doc) > 1:
        supplier_page = doc[1]
        blocks = supplier_page.get_text("blocks")

        def clean_block_text(text):
            return " ".join(
                line.strip()
                for line in str(text).splitlines()
                if line.strip()
            ).strip()

        heading = None
        for block in blocks:
            x0, y0, x1, y1, text = block[:5]
            cleaned = clean_block_text(text)
            if re.search(
                r"^3\s*\.\s*SUPPLIER\s+NAME\s*&\s*ADDRESS\s*$",
                cleaned,
                re.IGNORECASE,
            ):
                heading = (x0, y0, x1, y1)
                break

        if heading is not None:
            hx0, hy0, hx1, hy1 = heading

            # Find the next row/section boundary below the supplier field.
            # This prevents the following "5.AEO" field from being included.
            boundary_y = supplier_page.rect.height
            for block in blocks:
                x0, y0, x1, y1, text = block[:5]
                cleaned = clean_block_text(text)
                if y0 <= hy1:
                    continue
                # The next row label can be in a different column, so
                # boundary detection is based on Y position only.
                if re.match(r"^5\s*\.\s*AEO\b", cleaned, re.IGNORECASE):
                    boundary_y = min(boundary_y, y0)

            supplier_blocks = []
            for block in blocks:
                x0, y0, x1, y1, text = block[:5]
                # Supplier values are printed immediately below the
                # labelled heading. Use the block's top Y coordinate so a
                # slightly overlapping text box is still captured.
                if y0 < hy0 or y0 >= boundary_y:
                    continue

                # Keep text in the same left-hand supplier column.
                horizontal_overlap = min(x1, hx1) - max(x0, hx0)
                if horizontal_overlap <= 0:
                    continue

                cleaned = clean_block_text(text)
                if not cleaned:
                    continue

                # Exclude unrelated table labels/values.
                if re.match(
                    r"^(3\s*\.\s*SUPPLIER\b|4\s*\.|5\s*\.|6\s*\.|"
                    r"1\.INV\b|2\.CTH\b|3\.DESCRIPTION\b|4\.UNIT\b|"
                    r"5\.QUANTITY\b)",
                    cleaned,
                    re.IGNORECASE,
                ):
                    continue

                supplier_blocks.append((y0, cleaned))

            supplier_blocks.sort(key=lambda item: item[0])
            if supplier_blocks:
                supplier_info = " ".join(
                    text for _, text in supplier_blocks
                ).strip()
                # ICEGATE may split a word at the PDF text-column boundary.
                supplier_info = re.sub(r"\bDIGITA\s+L\b", "DIGITAL", supplier_info, flags=re.IGNORECASE)

    # Fallback only if the labelled supplier field could not be located.
    # Never use the importer name as a supplier fallback.
    if supplier_info == "N/A" and len(all_pages_text) > 1:
        p2_lines = [x.strip() for x in all_pages_text[1].split("\n") if x.strip()]
        supplier_heading_idx = next(
            (
                i for i, line in enumerate(p2_lines)
                if re.search(
                    r"3\s*\.\s*SUPPLIER\s+NAME\s*&\s*ADDRESS",
                    line,
                    re.IGNORECASE,
                )
            ),
            -1,
        )
        if supplier_heading_idx != -1:
            # Text-order fallback is intentionally narrow; do not walk back
            # from RULE/TRANSACTION VALUE because that can select the importer.
            candidate = []
            for line in p2_lines[supplier_heading_idx - 8:supplier_heading_idx]:
                if re.search(
                    r"^(SHIN|SUPPLIER|BUYER|SELLER|RULE|TRANSACTION|"
                    r"VALUATION|INV\s+VALUE|USD|FOB)\b",
                    line,
                    re.IGNORECASE,
                ):
                    continue
                if line:
                    candidate.append(line)
            if candidate:
                supplier_info = " ".join(candidate).strip()

    # Line Items Loop Across All Pages
    all_items = []
    for page_number, page_text in enumerate(all_pages_text):
        page = doc[page_number]
        items = parse_icegate_page_stream(page_text, page)
        all_items.extend(items)

    unique_items = {}
    for item in all_items:
        unique_items.setdefault(str(item.get("Item No", "")), item)
    df_items = sorted(unique_items.values(), key=lambda item: str(item.get("Item No", "")))

    def item_total(column):
        return sum(float(item.get(column, 0) or 0) for item in df_items)

    # Normalize the supplier into the same two fields used by the
    # reference SEPFUST workbook.
    supplier_name = "N/A"
    supplier_address = supplier_info
    if supplier_info and supplier_info != "N/A":
        supplier_parts = supplier_info.split(" ", 1)
        # Prefer the first PDF line as the supplier legal name. The existing
        # supplier_info is already bound to the labelled supplier field.
        supplier_name = supplier_info.split("  ", 1)[0].strip()
        if "\n" in supplier_info:
            supplier_name = supplier_info.split("\n", 1)[0].strip()
            supplier_address = supplier_info.split("\n", 1)[1].strip()

    # Document-level duty totals are derived from validated item rows. This
    # avoids confusing repeated summary cells with item-level 30.TOTAL DUTY.
    document_bcd = round(item_total("BCD Amount"), 2)
    document_sws = round(item_total("SWS Amount"), 2)
    document_igst = round(item_total("IGST Amount"), 2)
    document_total_duty = round(item_total("Item Total Duty"), 2)

    header = {
        "BOE Number": boe_no,
        "BOE Date": boe_date,
        "Port Code": port_code,
        "Importer GSTIN": gstin,
        "Importer Name": "N/A",
        "Invoice Number": inv_no,
        "Invoice Date": inv_date,
        "Invoice Amount": inv_amount,
        "Exchange Rate": exchange_rate,
        "CB Name": cb_name,
        "CB Code": cb_code,
        "MAWB No": mawb_no,
        "HAWB No": hawb_no,
        "Mode": ship_mode,
        "Container No": container_no,
        "LCL / FCL": lcl_fcl,
        "Supplier Details": supplier_info,
        "Supplier Name": supplier_name,
        "Supplier Address": supplier_address,
        "BCD Total": document_bcd,
        "SWS Total": document_sws,
        "IGST Total": document_igst,
        "Total Duty": document_total_duty,
        "Gross Weight (KGS)": gross_wt,
        "Total Items Count": total_items if total_items > 0 else len(df_items)
    }

    return header, df_items
