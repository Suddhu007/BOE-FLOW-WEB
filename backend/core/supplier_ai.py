import json
import logging
import os
import re

logger = logging.getLogger(__name__)

# Legal entity suffixes, sorted by specificity/length to match longer suffixes first (e.g., PTE LTD / CO LTD before LTD)
COMMON_COMPANY_SUFFIXES = [
    r"CO\.,?\s*LTD\.?",
    r"COMPANY\s+LIMITED",
    r"PTE\.?\s*LTD\.?",
    r"SDN\.?\s*BHD\.?",
    r"CORP(?:ORATION)?\.?",
    r"INC(?:ORPORATED)?\.?",
    r"LIMITED",
    r"LTD\.?",
    r"LLC\.?",
    r"S\.?A\.?",
    r"S\.?P\.?A\.?",
    r"GMBH",
    r"B\.?V\.?",
    r"A\.?G\.?",
    r"S\.?R\.?L\.?",
    r"N\.?V\.?",
    r"JSC",
    r"PLC",
]

# Match legal suffixes at word boundary, keeping punctuation attached to suffix
SUFFIX_PATTERN = re.compile(
    r"\b(" + "|".join(COMMON_COMPANY_SUFFIXES) + r")(?=[,\s.\-/]|$)",
    re.IGNORECASE,
)


def extract_supplier_with_rules(supplier_info: str) -> tuple[str, str, bool]:
    """
    Deterministically extract (Supplier Name, Supplier Address, is_confident) from raw supplier text.
    returns: (supplier_name, supplier_address, is_confident)
    """
    if not supplier_info or supplier_info.strip().upper() == "N/A":
        return "N/A", "N/A", True

    text = supplier_info.strip()

    # 1. Multi-line string check
    lines = [l.strip() for l in text.splitlines() if l.strip()]
    if len(lines) > 1:
        # Check if first line contains a company suffix
        match = SUFFIX_PATTERN.search(lines[0])
        if match:
            end_idx = match.end()
            # Include trailing period/comma if present right after suffix
            while end_idx < len(lines[0]) and lines[0][end_idx] in (".", ","):
                end_idx += 1
            name = lines[0][:end_idx].strip()
            address_rest = lines[0][end_idx:].strip()
            remaining_lines = " ".join(lines[1:]).strip()
            address = (address_rest + " " + remaining_lines).strip()
            address = re.sub(r"^[\s,.\-:;]+", "", address).strip()
            return name, address or "N/A", True
        else:
            name = lines[0]
            address = " ".join(lines[1:]).strip()
            return name, address or "N/A", True

    # 2. Single-line string logic: find legal company suffix boundary
    matches = list(SUFFIX_PATTERN.finditer(text))
    if matches:
        first_match = matches[0]
        end_idx = first_match.end()

        # Handle trailing period or comma immediately following suffix
        while end_idx < len(text) and text[end_idx] in (".", ","):
            end_idx += 1

        name = text[:end_idx].strip()
        address = text[end_idx:].strip()

        # Clean leading separator characters from address while preserving raw contents (e.g. airport/country info)
        address = re.sub(r"^[\s,.\-:;]+", "", address).strip()

        if name and address:
            return name, address, True
        elif name and not address:
            return name, "N/A", True

    # 3. Fallback when boundary cannot be determined with confidence
    # Do NOT duplicate full string into both fields. Return original string as Supplier Name with review flag in Address.
    return text, "N/A (Review Required)", False


def extract_supplier_with_ai(supplier_info: str) -> tuple[str, str] | None:
    """
    Attempt to use a free AI model API (Gemini or Groq) to parse Supplier Name and Address when deterministic rules are ambiguous.
    """
    gemini_key = os.getenv("GEMINI_API_KEY")
    groq_key = os.getenv("GROQ_API_KEY")

    if not gemini_key and not groq_key:
        return None

    prompt = (
        "You are a customs document processor parsing Bill of Entry supplier details.\n"
        f"Input text: \"{supplier_info}\"\n"
        "Separate the text into 'supplier_name' (legal company name) and 'supplier_address' (full street, city, country, airport details).\n"
        "Preserve all original address, airport, and country information without inventing new facts.\n"
        "Respond strictly in valid JSON format with keys 'supplier_name' and 'supplier_address'.\n"
        "Do not include markdown code block formatting or extra commentary."
    )

    if gemini_key:
        try:
            import requests

            url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key={gemini_key}"
            payload = {
                "contents": [{"parts": [{"text": prompt}]}],
                "generationConfig": {"response_mime_type": "application/json"}
            }
            res = requests.post(url, json=payload, timeout=5)
            if res.status_code == 200:
                data = res.json()
                candidates = data.get("candidates", [])
                if candidates:
                    parts = candidates[0].get("content", {}).get("parts", [])
                    if parts and "text" in parts[0]:
                        raw_text = parts[0]["text"]
                        parsed = json.loads(raw_text)
                        if isinstance(parsed, dict):
                            name = str(parsed.get("supplier_name", "")).strip()
                            addr = str(parsed.get("supplier_address", "")).strip()
                            if name:
                                return name, addr or "N/A"
        except Exception as exc:
            logger.warning("Gemini AI API call failed: %s", exc)

    if groq_key:
        try:
            import requests

            url = "https://api.groq.com/openai/v1/chat/completions"
            headers = {
                "Authorization": f"Bearer {groq_key}",
                "Content-Type": "application/json"
            }
            payload = {
                "model": "llama-3.1-8b-instant",
                "messages": [{"role": "user", "content": prompt}],
                "response_format": {"type": "json_object"}
            }
            res = requests.post(url, headers=headers, json=payload, timeout=5)
            if res.status_code == 200:
                data = res.json()
                choices = data.get("choices", [])
                if choices:
                    content = choices[0].get("message", {}).get("content", "")
                    if content:
                        parsed = json.loads(content)
                        if isinstance(parsed, dict):
                            name = str(parsed.get("supplier_name", "")).strip()
                            addr = str(parsed.get("supplier_address", "")).strip()
                            if name:
                                return name, addr or "N/A"
        except Exception as exc:
            logger.warning("Groq AI API call failed: %s", exc)

    return None


def parse_supplier_details(supplier_info: str) -> tuple[str, str]:
    """
    Parses supplier_info string into (supplier_name, supplier_address).
    1. First runs deterministic extraction.
    2. If rule-based result is confident, returns immediately (no AI API call made).
    3. If rule-based result is ambiguous/unconfident, attempts AI model parsing if API key is provided.
    4. Falls back gracefully to rule-based result if AI is disabled/unresponsive/fails.
    """
    if not supplier_info or supplier_info.strip().upper() == "N/A":
        return "N/A", "N/A"

    # Step 1: Deterministic extraction
    rule_name, rule_address, is_confident = extract_supplier_with_rules(supplier_info)
    if is_confident:
        return rule_name, rule_address

    # Step 2: Use AI only if rule-based extraction was uncertain
    ai_result = extract_supplier_with_ai(supplier_info)
    if ai_result and ai_result[0]:
        return ai_result

    # Step 3: Fallback if AI call failed / disabled
    return rule_name, rule_address
