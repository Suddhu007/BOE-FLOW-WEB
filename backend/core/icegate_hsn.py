import json
import os
import re
from datetime import datetime, timezone

import certifi
import requests
from bs4 import BeautifulSoup
from urllib.parse import urljoin

ICEGATE_IMPORT_URL = "https://www.icegate.gov.in/Webappl/index_imp.jsp"
ICEGATE_DUTY_URL = "https://www.icegate.gov.in/Webappl/cdc_duty_details.jsp"

CACHE_PATH = os.path.join(
    os.path.dirname(os.path.dirname(__file__)),
    "data",
    "boe_hsn_data.json",
)


def validate_cth(cth):
    code = re.sub(r"\D", "", str(cth or ""))
    if not re.fullmatch(r"\d{4,8}", code):
        raise ValueError("HSN/CTH must contain 4 to 8 digits.")
    return code


def load_hsn_cache():
    if not os.path.exists(CACHE_PATH):
        return {
            "updated_at": None,
            "source": "ICEGATE Trade Guide on Imports",
            "entries": {},
        }

    try:
        with open(CACHE_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, json.JSONDecodeError):
        return {
            "updated_at": None,
            "source": "ICEGATE Trade Guide on Imports",
            "entries": {},
        }

    if not isinstance(data, dict):
        data = {}

    data.setdefault("updated_at", None)
    data.setdefault("source", "ICEGATE Trade Guide on Imports")
    data.setdefault("entries", {})
    return data


def save_hsn_cache(data):
    os.makedirs(os.path.dirname(CACHE_PATH), exist_ok=True)
    data["updated_at"] = datetime.now(timezone.utc).isoformat()

    with open(CACHE_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


def _clean(text):
    return re.sub(r"\s+", " ", str(text or "")).strip()


def _table_to_rows(table):
    rows = []
    headers = []

    for tr in table.find_all("tr"):
        cells = [
            _clean(cell.get_text(" ", strip=True))
            for cell in tr.find_all(["th", "td"])
        ]
        if not cells:
            continue

        if not headers and tr.find("th"):
            headers = cells
            continue

        if headers and len(cells) == len(headers):
            rows.append(dict(zip(headers, cells)))
        else:
            rows.append(cells)

    return rows


def _extract_relevant_lines(soup):
    lines = []
    text = soup.get_text("\n", strip=True)

    keywords = (
        "CTH",
        "TARIFF",
        "DESCRIPTION",
        "BCD",
        "SWS",
        "IGST",
        "AIDC",
        "ANTI DUMPING",
        "SAFEGUARD",
        "COMPENSATION",
        "TOTAL DUTY",
        "PREFERENTIAL",
        "IMPORT POLICY",
        "PGA",
        "COMPLIANCE",
        "NOTIFICATION",
        "COUNTRY OF ORIGIN",
        "UQC",
    )

    for raw in text.splitlines():
        line = _clean(raw)
        if not line:
            continue

        upper = line.upper()
        if any(key in upper for key in keywords):
            lines.append(line)

    return list(dict.fromkeys(lines))


def _extract_duty_records(tables):
    """Convert ICEGATE duty table rows into a small readable structure."""
    known = [
        "Basic Customs Duty(BCD)",
        "Additional Duty Of customs(ADC(M))",
        "Customs AIDC",
        "Custom Health CESS(CHCESS)",
        "CESS",
        "National Calamity Contingent Duty (NCCD)",
        "Health Cess",
        "Excise AIDC(EAIDC)",
        "Social Welfare Surcharge(SWC)",
        "Antidumping Duty(ADD)",
        "Safeguard Duty(SG)",
        "Countervailing Duty(CD)",
        "IGST Levy",
        "Compensation Cess(CC)",
        "Total Duty",
        "Total Duty (Preferential)",
    ]

    records = []
    seen = set()

    def clean_num(value):
        text = _clean(value)
        if re.fullmatch(r"[-+]?\d+(?:\.\d+)?%?", text):
            return text
        return ""

    for table in tables:
        for row in table:
            values = []

            if isinstance(row, dict):
                values = [str(v) for v in row.values()]
                duty_name = ""
                for value in values:
                    for name in known:
                        if name.upper() in value.upper():
                            duty_name = name
                            break
                    if duty_name:
                        break

                if not duty_name:
                    continue

                tariff = ""
                effective = ""
                amount = ""

                for key, value in row.items():
                    key_upper = str(key).upper()
                    value_text = _clean(value)

                    if "TARIFF" in key_upper and not tariff:
                        tariff = clean_num(value_text)
                    elif "EFFECTIVE" in key_upper and not effective:
                        effective = clean_num(value_text)
                    elif "DUTY AMOUNT" in key_upper and not amount:
                        amount = clean_num(value_text)

                records.append(
                    {
                        "duty": duty_name,
                        "tariff_rate": tariff,
                        "effective_rate": effective,
                        "amount": amount,
                    }
                )
                continue

            if isinstance(row, list) and row:
                joined = " ".join(str(x) for x in row)
                duty_name = next(
                    (
                        name
                        for name in known
                        if name.upper() in joined.upper()
                    ),
                    "",
                )
                if not duty_name:
                    continue

                numeric = [
                    clean_num(x)
                    for x in row
                    if clean_num(x)
                ]

                tariff = numeric[0] if len(numeric) >= 1 else ""
                effective = numeric[1] if len(numeric) >= 2 else ""
                amount = numeric[-1] if len(numeric) >= 3 else ""

                records.append(
                    {
                        "duty": duty_name,
                        "tariff_rate": tariff,
                        "effective_rate": effective,
                        "amount": amount,
                    }
                )

    unique_records = []
    for record in records:
        key = (
            record["duty"],
            record["tariff_rate"],
            record["effective_rate"],
            record["amount"],
        )
        if key not in seen:
            seen.add(key)
            unique_records.append(record)

    return unique_records



COUNTRY_CACHE_PATH = os.path.join(
    os.path.dirname(os.path.dirname(__file__)),
    "data",
    "icegate_country_codes.json",
)


def _control_value(element):
    if element.name == "select":
        option = element.find("option", selected=True)
        if option:
            return _clean(option.get("value") or option.get_text(" ", strip=True))
        return ""
    return _clean(element.get("value", ""))


def _icegate_get(url, params=None, referer=None):
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 Chrome/154 Safari/537.36"
        ),
        "Accept": "text/html,application/xhtml+xml",
    }
    if referer:
        headers["Referer"] = referer

    try:
        response = requests.get(
            url,
            params=params or {},
            timeout=25,
            headers=headers,
            verify=certifi.where(),
        )
        response.raise_for_status()
        return response
    except requests.exceptions.SSLError as exc:
        raise RuntimeError(
            f"ICEGATE SSL connection failed: {exc}"
        ) from exc
    except requests.exceptions.RequestException as exc:
        raise RuntimeError(
            f"ICEGATE request failed: {exc}"
        ) from exc


def _read_country_cache():
    try:
        with open(COUNTRY_CACHE_PATH, "r", encoding="utf-8") as f:
            value = json.load(f)
        return value if isinstance(value, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def fetch_icegate_country_codes():
    """Fetch the current Country Code directory from ICEGATE CODES."""
    codes_url = "https://www.icegate.gov.in/Webappl/Codes"
    response = _icegate_get(
        codes_url,
        referer="https://www.icegate.gov.in/Webappl/home",
    )
    soup = BeautifulSoup(response.text, "html.parser")

    country_link = None
    for link in soup.find_all("a", href=True):
        label = _clean(link.get_text(" ", strip=True)).lower()
        if label == "country code" or label.startswith("country code"):
            country_link = urljoin(codes_url, link["href"])
            break

    if not country_link:
        raise RuntimeError("ICEGATE Country Code directory link was not found.")

    country_response = _icegate_get(
        country_link,
        referer=codes_url,
    )
    country_soup = BeautifulSoup(country_response.text, "html.parser")

    countries = {}
    for tr in country_soup.find_all("tr"):
        cells = [
            _clean(cell.get_text(" ", strip=True))
            for cell in tr.find_all(["td", "th"])
        ]

        if len(cells) < 2:
            continue

        code = cells[0].upper()
        name = cells[1]

        if re.fullmatch(r"[A-Z]{2}", code) and len(name) >= 2:
            countries[code] = name

    if not countries:
        raise RuntimeError("ICEGATE Country Code directory returned no records.")

    os.makedirs(os.path.dirname(COUNTRY_CACHE_PATH), exist_ok=True)
    with open(COUNTRY_CACHE_PATH, "w", encoding="utf-8") as f:
        json.dump(countries, f, indent=2, ensure_ascii=False)

    return countries


def icegate_country_name(country_code):
    code = str(country_code or "").strip().upper()
    if not re.fullmatch(r"[A-Z]{2}", code):
        return code or "N/A"

    fallback = {
        "KR": "KOREA,REPUBLIC OF",
        "KP": "KOREA,DEMOCRATIC PEOPLE'S REPUBLIC OF",
    }

    cached = _read_country_cache()
    if code in cached:
        return cached[code]

    try:
        countries = fetch_icegate_country_codes()
        return countries.get(code, fallback.get(code, code))
    except Exception:
        return fallback.get(code, code)


def _row_values(tr):
    values = []
    for cell in tr.find_all(["td", "th"]):
        controls = cell.find_all(["input", "textarea", "select"])

        if controls:
            base_parts = []
            for text_node in cell.find_all(string=True):
                if getattr(text_node.parent, "name", "") != "option":
                    base_parts.append(str(text_node).strip())
            parts = [_clean(" ".join(base_parts))]

            for control in controls:
                value = _control_value(control)
                if value:
                    parts.append(value)

            value = _clean(" ".join(part for part in parts if part))
        else:
            value = _clean(cell.get_text(" ", strip=True))

        values.append(value)

    return values


def _rate(value):
    match = re.search(r"(-?\d+(?:\.\d+)?)", _clean(value))
    return match.group(1) + "%" if match else ""


def _extract_description(soup):
    # Prefer a value attached to the DESCRIPTION FOR CTH field.
    node = soup.find(
        string=re.compile(r"DESCRIPTION\s+FOR\s+CTH\s*:", re.I)
    )

    if node:
        row = node.find_parent("tr")
        if row:
            for control in row.find_all(["input", "textarea"]):
                value = _control_value(control)
                if len(value) >= 10 and not value.lower().startswith("description"):
                    return value

        for ancestor in [node.parent] + list(node.parents)[:4]:
            for control in ancestor.find_all(["input", "textarea"]):
                value = _control_value(control)
                if len(value) >= 10 and not value.lower().startswith("description"):
                    return value

    # Fall back to nearby plain text only if it does not look like the
    # ICEGATE column-heading block.
    lines = [_clean(line) for line in soup.get_text("\n", strip=True).splitlines()]
    for i, line in enumerate(lines):
        if re.search(r"DESCRIPTION\s+FOR\s+CTH", line, re.I):
            candidates = []
            for candidate in lines[i + 1:i + 4]:
                if candidate and not re.search(
                    r"IMPORT POLICY|CUSTOMS DUTY|RATE OF DUTY|DUTY AMOUNT",
                    candidate,
                    re.I,
                ):
                    candidates.append(candidate)
            if candidates:
                return _clean(" ".join(candidates))

    return ""


def _extract_import_policy(soup):
    for tr in soup.find_all("tr"):
        values = _row_values(tr)
        if not values:
            continue
        if any(re.search(r"Import\s+Policy", value, re.I) for value in values):
            for value in values[1:]:
                cleaned = _clean(value)
                if cleaned and not re.search(
                    r"Policy\s+Condition|Notn\s+No|Notn\s+Date",
                    cleaned,
                    re.I,
                ):
                    return cleaned
    return ""


def _extract_duty_records(soup):
    duty_names = [
        "Basic Customs Duty(BCD)",
        "Additional Duty Of customs(ADC(M))",
        "Customs AIDC",
        "Custom Health CESS(CHCESS)",
        "CESS",
        "National Calamity Contingent Duty (NCCD)",
        "Health Cess",
        "Excise AIDC(EAIDC)",
        "Social Welfare Surcharge(SWC)",
        "Antidumping Duty(ADD)",
        "Safeguard Duty(SG)",
        "Countervailing Duty(CD)",
        "IGST Levy",
        "Compensation Cess(CC)",
        "Total Duty",
        "Total Duty (Preferential)",
    ]

    records = []
    seen = set()

    for tr in soup.find_all("tr"):
        cells = _row_values(tr)
        if len(cells) < 2:
            continue

        duty_name = next(
            (name for name in duty_names if any(
                name.lower() in cell.lower() for cell in cells
            )),
            None,
        )
        if not duty_name:
            continue

        # ICEGATE duty table layout:
        # 0 Duty | 1 Tariff | 2 Spec Duty | 3 Unit | 4 Notification |
        # 5 Effective | 6 Spec Duty | 7 Unit | 8 Duty Amount
        tariff = _rate(cells[1]) if len(cells) > 1 else ""
        effective = _rate(cells[5]) if len(cells) > 5 else ""

        amount = ""
        if len(cells) > 8:
            amount_match = re.search(
                r"\b\d[\d,]*(?:\.\d+)?\b",
                cells[8].replace(",", ""),
            )
            if amount_match:
                amount = amount_match.group(0)

        record = {
            "duty": duty_name,
            "tariff_rate": tariff,
            "effective_rate": effective,
            "amount": amount,
        }
        key = tuple(record.values())
        if key not in seen:
            seen.add(key)
            records.append(record)

    return records


def fetch_icegate_hsn(cth, country_of_origin=None):
    code = validate_cth(cth)
    country_code = str(country_of_origin or "").strip().upper()

    if country_code and not re.fullmatch(r"[A-Z]{2}", country_code):
        country_code = ""

    country_name = icegate_country_name(country_code) if country_code else "All"

    params = {
        "cth_duty_nw": code,
        "cntrycd": country_code,
    }

    response = _icegate_get(
        ICEGATE_DUTY_URL,
        params=params,
        referer=ICEGATE_IMPORT_URL,
    )

    soup = BeautifulSoup(response.text, "html.parser")
    page_text = soup.get_text("\n", strip=True)
    upper_text = page_text.upper()

    if not page_text.strip():
        raise RuntimeError("ICEGATE returned an empty duty-detail page.")

    if "CAPTCHA" in upper_text:
        raise RuntimeError(
            "ICEGATE requested a CAPTCHA. Automatic HSN fetch is unavailable."
        )

    if "PLEASE CHECK AND ENTER TARIFF" in upper_text:
        raise RuntimeError(
            "ICEGATE did not return the duty result for this HSN."
        )

    description = _extract_description(soup)
    import_policy = _extract_import_policy(soup)
    duty_records = _extract_duty_records(soup)

    compliance_rows = []
    for tr in soup.find_all("tr"):
        values = _row_values(tr)
        joined = " ".join(values).upper()
        if "PGA CODE" in joined or "PGA NAME" in joined or "QFR CODE" in joined:
            compliance_rows.append(values)

    return {
        "version": 2,
        "hsn_code": code,
        "country_of_origin": country_code,
        "country_name": country_name,
        "source": "ICEGATE Trade Guide on Imports",
        "source_url": response.url,
        "scraped_at": datetime.now(timezone.utc).isoformat(),
        "status_code": response.status_code,
        "description": description,
        "import_policy": import_policy,
        "duty_records": duty_records,
        "compliance_rows": compliance_rows,
    }



def _cache_key(cth, country_of_origin=None):
    code = validate_cth(cth)
    country = re.sub(r"\s+", "", str(country_of_origin or "").upper())
    return f"{code}|{country}" if country else code


def cache_hsn_result(result):
    data = load_hsn_cache()
    key = _cache_key(
        result.get("hsn_code"),
        result.get("country_of_origin"),
    )
    data["entries"][key] = result
    save_hsn_cache(data)
    return data


def get_cached_hsn(cth, country_of_origin=None):
    code = validate_cth(cth)
    data = load_hsn_cache()
    key = _cache_key(code, country_of_origin)
    result = data.get("entries", {}).get(key)

    # Backward compatibility with older HSN-only cache entries.
    if result is None and country_of_origin:
        result = data.get("entries", {}).get(code)

    return result


def cache_path():
    return CACHE_PATH
