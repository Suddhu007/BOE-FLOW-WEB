from backend.core.parser import _extract_roll_material_fields


def test_extracts_adhesive_tape_roll_description():
    result = _extract_roll_material_fields(
        "ADHESIVE TAPE JYA-SS100D(SW) (1000mmX100M) "
        "(6 ROLL) (FOR USEIN MFG OF MOBILE PHONE)"
    )
    assert result == {
        "Material Type": "ADHESIVE TAPE",
        "Material Name": "JYA-SS100D(SW)",
        "Size": "1000MM X 100M",
        "Description Quantity": 6,
        "Description UQC": "ROLL",
        "Roll Quantity": 6,
    }


def test_accepts_rol_abbreviation_and_decimal_quantity():
    result = _extract_roll_material_fields(
        "ADHESIVE TAPE ABC-123 (1000 MM X 50 M) (2.5 ROL)"
    )
    assert result["Description Quantity"] == 2.5
    assert result["Description UQC"] == "ROLL"
    assert result["Size"] == "1000MM X 50M"


def test_does_not_add_roll_fields_without_roll_marker():
    assert _extract_roll_material_fields(
        "ADHESIVE TAPE ABC-123 (1000mmX50M)"
    ) == {}
