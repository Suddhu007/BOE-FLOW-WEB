import os
import re

COMMON_COMPANY_SUFFIXES = [
    r"CO\.,?\s*LTD\.?",
    r"COMPANY\s+LIMITED",
    r"CORP(?:ORATION)?\.?",
    r"INC(?:ORPORATED)?\.?",
    r"LIMITED",
    r"LTD\.?",
    r"LLC\.?",
    r"S\.?A\.?",
    r"S\.?P\.?A\.?",
    r"GMBH",
    r"PTE\.?\s*LTD\.?",
    r"SDN\.?\s*BHD\.?",
    r"B\.?V\.?",
    r"A\.?G\.?",
    r"S\.?R\.?L\.?",
    r"N\.?V\.?",
    r"O0O",
    r"JSC",
    r"PLC",
]

# Regex pattern matching legal company suffixes at word boundary
SUFFIX_PATTERN = re.compile(
    r"\b(" + "|".join(COMMON_COMPANY_SUFFIXES) + r")\b",
    re.IGNORECASE,
)


def extract_supplier_with_rules(supplier_info: str) -> tuple[str, str]:
    """
    Extract (Supplier Name, Supplier Address) from raw supplier text using rule-based parsing.
    """
    if not supplier_info or supplier_info.strip().upper() == "N/A":
        return "N/A", "N/A"

    text = supplier_info.strip()

    # 1. First, check if there's explicit newline separation
    lines = [l.strip() for l in text.splitlines() if l.strip()]
    if len(lines) > 1:
        # Check if line 0 looks like a company name
        match = SUFFIX_PATTERN.search(lines[0])
        if match:
            # End of company name is at the end of the matched suffix in line 0
            name = lines[0][:match.end()].strip()
            address_rest = lines[0][match.end():].strip()
            remaining_lines = " ".join(lines[1:]).strip()
            address = (address_rest + " " + remaining_lines).strip()
            return name, address or "N/A"
        else:
            name = lines[0]
            address = " ".join(lines[1:]).strip()
            return name, address or "N/A"

    # 2. Single-line string logic: find company legal suffix (e.g., CO.,LTD., INC., LTD.)
    matches = list(SUFFIX_PATTERN.finditer(text))
    if matches:
        # Take the first matched company suffix as boundary between name & address
        first_match = matches[0]
        end_idx = first_match.end()

        # Handle trailing period or comma immediately following suffix if present
        if end_idx < len(text) and text[end_idx] in (".", ","):
            end_idx += 1

        name = text[:end_idx].strip()
        address = text[end_idx:].strip()

        # Clean up leading punctuation from address
        address = re.sub(r"^[\s,.\-:;]+", "", address).strip()

        if name:
            return name, address or "N/A"

    # 3. Fallback: If no company suffix matches, split at the first comma or return original as name
    if "," in text:
        parts = text.split(",", 1)
        return parts[0].strip(), parts[1].strip() or "N/A"

    return text, text


def extract_supplier_with_ai(supplier_info: str) -> tuple[str, str] | None:
    """
    Attempt to use a free AI model API (e.g. Gemini API if GEMINI_API_KEY is available,
    or Groq API if GROQ_API_KEY is available) to parse Supplier Name and Address.
    Returns (name, address) or None if no AI key configured / API call failed.
    """
    gemini_key = os.getenv("GEMINI_API_KEY")
    groq_key = os.getenv("GROQ_API_KEY")

    prompt = (
        "You are a helpful assistant parsing Bill of Entry supplier details.\n"
        f"Input text: \"{supplier_info}\"\n"
        "Extract the Supplier Name and Supplier Address.\n"
        "Respond strictly in valid JSON format with keys 'supplier_name' and 'supplier_address'.\n"
        "Do not include markdown or extra commentary."
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
                text_content = data['candidates'][0]['content']['parts'][0]['text']
                import json
                parsed = json.loads(text_content)
                name = parsed.get("supplier_name", "").strip()
                addr = parsed.get("supplier_address", "").strip()
                if name:
                    return name, addr or "N/A"
        except Exception:
            pass

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
                import json
                parsed = json.loads(data['choices'][0]['message']['content'])
                name = parsed.get("supplier_name", "").strip()
                addr = parsed.get("supplier_address", "").strip()
                if name:
                    return name, addr or "N/A"
        except Exception:
            pass

    return None


def parse_supplier_details(supplier_info: str) -> tuple[str, str]:
    """
    Parses supplier_info string into (supplier_name, supplier_address).
    Uses AI model API if API key is present, otherwise uses extraction logic.
    """
    if not supplier_info or supplier_info.strip().upper() == "N/A":
        return "N/A", "N/A"

    ai_result = extract_supplier_with_ai(supplier_info)
    if ai_result:
        return ai_result

    return extract_supplier_with_rules(supplier_info)
