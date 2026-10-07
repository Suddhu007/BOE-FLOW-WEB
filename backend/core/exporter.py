import io
import pandas as pd

def build_excel(header, grouped_df, df_items):
    """Generates an audit-ready multi-tab Excel file."""
    excel_buffer = io.BytesIO()
    with pd.ExcelWriter(excel_buffer, engine="openpyxl") as writer:
        pd.DataFrame([header]).to_excel(writer, sheet_name="Consignment & Parties", index=False)
        grouped_df.to_excel(writer, sheet_name="E-Way Bill Summary", index=False)
        df_items.to_excel(writer, sheet_name="Line Items Audit", index=False)

        # SEPFUST-style normalized extraction sheet. These are the fields
        # present in the reference workbook supplied for this project.
        # Normalized schema aligned to the field naming used by the
        # SEPFUST reference workbook supplied for this project.
        item_rows = pd.DataFrame({
            "BE_NO": [header.get("BOE Number", "")] * len(df_items),
            "BE_DATE": [header.get("BOE Date", "")] * len(df_items),
            "PORT_CODE": [header.get("Port Code", "")] * len(df_items),
            "GSTIN": [header.get("Importer GSTIN", "")] * len(df_items),
            "CB_CODE": [header.get("CB Code", "")] * len(df_items),
            "CB_NAME": [header.get("CB Name", "")] * len(df_items),
            "IMPORTER_NAME": [header.get("Importer Name", "")] * len(df_items),
            "SUPPLIER_NAME": [header.get("Supplier Name", "")] * len(df_items),
            "SUPPLIER_ADDRESS": [header.get("Supplier Address", "")] * len(df_items),
            "INVOICE_NUMBER": [header.get("Invoice Number", "")] * len(df_items),
            "INVOICE_DATE": [header.get("Invoice Date", "")] * len(df_items),
            "INVOICE_VALUE": [header.get("Invoice Amount", "")] * len(df_items),
            "MAWB_NUMBER": [header.get("MAWB No", "")] * len(df_items),
            "HAWB_NUMBER": [header.get("HAWB No", "")] * len(df_items),
            "BCD": [header.get("BCD Total", 0)] * len(df_items),
            "SWS": [header.get("SWS Total", 0)] * len(df_items),
            "IGST": [header.get("IGST Total", 0)] * len(df_items),
            "TOTAL_DUTY": [header.get("Total Duty", 0)] * len(df_items),
            "TOTAL_ASSESSABLE_VALUE": [df_items["Assessable Value (CIF INR)"].sum()] * len(df_items),
            "ITEM_SN": df_items["Item No"].values,
            "ITEM_CTH": df_items["HSN Code"].values,
            "ITEM_DESCRIPTION": df_items["Description"].values,
            "ITEM_UNIT_PRICE": df_items["Unit Price (FC)"].values,
            "ITEM_QUANTITY": df_items["Quantity"].values,
            "ITEM_UQC": df_items["UQC"].values,
            "ITEM_ASSESSABLE_VALUE": df_items["Assessable Value (CIF INR)"].values,
            "ITEM_TOTAL_DUTY": df_items["Item Total Duty"].values,
            "BCD_RATE": df_items["BCD Rate (%)"].values,
            "BCD_AMOUNT": df_items["BCD Amount"].values,
            "SWS_RATE": df_items["SWS Rate (%)"].values,
            "SWS_AMOUNT": df_items["SWS Amount"].values,
            "IGST_RATE": df_items["IGST Rate (%)"].values,
            "IGST_AMOUNT": df_items["IGST Amount"].values,
            "OTHER_CUSTOMS_DUTY": df_items["Other Customs Duty"].values,
        })

        item_rows.to_excel(writer, sheet_name="SEPFUST Style Extract", index=False)
    return excel_buffer.getvalue()
