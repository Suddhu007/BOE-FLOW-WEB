import os
import sys
from unittest.mock import MagicMock, patch
import pytest
from pathlib import Path

# Add backend directory to path
backend_dir = Path(__file__).resolve().parent.parent / "backend"
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

import core.supplier_ai as supplier_ai
from core.supplier_ai import (
    extract_supplier_with_ai,
    extract_supplier_with_rules,
    parse_supplier_details,
)


def test_shin_sung_same_line_address():
    sample_text = (
        "SHIN SUNG C&T CO.,LTD. S BUSINESS CENTER, 11, GASAN DIGITAL 2-RO, "
        "GEUMCHEON-GU, SEOUL Incheon Intl Apt/Seoul, , Korea, Republic Korea, Republic of"
    )
    name, address, is_confident = extract_supplier_with_rules(sample_text)
    assert name == "SHIN SUNG C&T CO.,LTD."
    assert "S BUSINESS CENTER, 11, GASAN DIGITAL 2-RO" in address
    assert "Incheon Intl Apt/Seoul" in address
    assert "Korea, Republic Korea, Republic of" in address
    assert is_confident is True


def test_company_suffixes_pte_ltd_sdn_bhd():
    # PTE LTD
    text1 = "SINGAPORE TRADING PTE. LTD. 10 MARINA BOULEVARD, SINGAPORE"
    name1, addr1, conf1 = extract_supplier_with_rules(text1)
    assert name1 == "SINGAPORE TRADING PTE. LTD."
    assert addr1 == "10 MARINA BOULEVARD, SINGAPORE"
    assert conf1 is True

    # SDN BHD
    text2 = "MALAYSIA EXPORTS SDN. BHD. BUKIT BINTANG, KUALA LUMPUR"
    name2, addr2, conf2 = extract_supplier_with_rules(text2)
    assert name2 == "MALAYSIA EXPORTS SDN. BHD."
    assert addr2 == "BUKIT BINTANG, KUALA LUMPUR"
    assert conf2 is True


def test_missing_company_suffix_ambiguous():
    text = "ACME ENTERPRISES 100 MAIN STREET NEW YORK NY 10001"
    name, address, is_confident = extract_supplier_with_rules(text)
    assert name == text
    assert address == "N/A (Review Required)"
    assert is_confident is False


def test_duplicate_country_and_airport_preservation():
    text = "KOREA COMPONENTS CO., LTD. 123 INCHEON AIRPORT RD, SEOUL Incheon Intl Apt/Seoul, Korea, Republic Korea, Republic of"
    name, address, is_confident = extract_supplier_with_rules(text)
    assert name == "KOREA COMPONENTS CO., LTD."
    assert "Incheon Intl Apt/Seoul" in address
    assert "Korea, Republic Korea, Republic of" in address
    assert is_confident is True


def test_ai_disabled_scenario():
    with patch.dict(os.environ, {}, clear=True):
        text = "ACME ENTERPRISES 100 MAIN STREET NEW YORK NY 10001"
        name, address = parse_supplier_details(text)
        assert name == text
        assert address == "N/A (Review Required)"


def test_ai_timeout_or_error_scenario():
    with patch.dict(os.environ, {"GEMINI_API_KEY": "fake_key"}):
        fake_requests = MagicMock()
        fake_requests.post.side_effect = Exception("Connection timeout")
        with patch.dict("sys.modules", {"requests": fake_requests}):
            text = "ACME ENTERPRISES 100 MAIN STREET NEW YORK NY 10001"
            name, address = parse_supplier_details(text)
            assert name == text
            assert address == "N/A (Review Required)"


def test_ai_malformed_json_response():
    with patch.dict(os.environ, {"GEMINI_API_KEY": "fake_key"}):
        fake_requests = MagicMock()
        mock_res = MagicMock()
        mock_res.status_code = 200
        mock_res.json.return_value = {
            "candidates": [{"content": {"parts": [{"text": "INVALID JSON STRING"}]}}]
        }
        fake_requests.post.return_value = mock_res
        with patch.dict("sys.modules", {"requests": fake_requests}):
            text = "ACME ENTERPRISES 100 MAIN STREET NEW YORK NY 10001"
            name, address = parse_supplier_details(text)
            assert name == text
            assert address == "N/A (Review Required)"
