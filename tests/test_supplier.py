import pytest
import sys
from pathlib import Path

# Add backend directory to path
backend_dir = Path(__file__).resolve().parent.parent
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

from core.supplier_ai import extract_supplier_with_rules, parse_supplier_details


def test_sample_user_supplier_details():
    sample_text = (
        "SHIN SUNG C&T CO.,LTD. S BUSINESS CENTER, 11, GASAN DIGITAL 2-RO, "
        "GEUMCHEON-GU, SEOUL Incheon Intl Apt/Seoul, , Korea, Republic Korea, Republic of"
    )
    name, address = extract_supplier_with_rules(sample_text)
    assert name == "SHIN SUNG C&T CO.,LTD."
    assert "S BUSINESS CENTER, 11, GASAN DIGITAL 2-RO" in address
    assert "Seoul" in address


def test_multiline_supplier_details():
    text = "ACME CORPORATION\n123 INDUSTRIAL PARKWAY\nSHANGHAI, CHINA"
    name, address = extract_supplier_with_rules(text)
    assert name == "ACME CORPORATION"
    assert address == "123 INDUSTRIAL PARKWAY SHANGHAI, CHINA"


def test_inc_suffix():
    text = "GLOBAL ELECTRONICS INC. 456 TECH BLVD, SILICON VALLEY, CA"
    name, address = extract_supplier_with_rules(text)
    assert name == "GLOBAL ELECTRONICS INC."
    assert address == "456 TECH BLVD, SILICON VALLEY, CA"


def test_gmbh_suffix():
    text = "BAUER TRADING GMBH HAUPTSTRASSE 10, FRANKFURT, GERMANY"
    name, address = extract_supplier_with_rules(text)
    assert name == "BAUER TRADING GMBH"
    assert address == "HAUPTSTRASSE 10, FRANKFURT, GERMANY"


def test_na_and_empty():
    name, address = parse_supplier_details("N/A")
    assert name == "N/A"
    assert address == "N/A"

    name, address = parse_supplier_details("")
    assert name == "N/A"
    assert address == "N/A"
