import test from "node:test";
import assert from "node:assert/strict";

import {
  checkGroupedTotals,
  formatMoney,
  formatNicDate,
  isMissing,
  mapUqcToNic,
  parseInrAmount,
} from "../src/formatters.js";
import { buildNicBulkJson, NIC_BULK_TEMPLATE } from "../src/eway-json.js";

const fakeResponse = {
  filename: "fake-sample.pdf",
  header: { "BOE Number": "SAMPLE-BOE-001", "BOE Date": "05/04/2026", "Invoice Amount": "120.00 INR" },
  items: [
    {
      "Item No": "1",
      "Description": "Sample polymer roll",
      "HSN Code": "39199090",
      UQC: "KGS",
      Quantity: 10,
      "Assessable Value (CIF INR)": 90,
      "GST Taxable Value (for E-Way)": 100,
      "Calculated IGST": 18,
      "IGST Rate (%)": 18,
    },
    {
      "Item No": "2",
      "Description": "Sample polymer roll",
      "HSN Code": "39199090",
      UQC: "KGS",
      Quantity: 15,
      "Assessable Value (CIF INR)": 190,
      "GST Taxable Value (for E-Way)": 200,
      "Calculated IGST": 36,
      "IGST Rate (%)": 18,
    },
  ],
  grouped: [
    {
      "HSN Code": "39199090",
      UQC: "KGS",
      Quantity: 25,
      "Assessable Value (CIF INR)": 280,
      "GST Taxable Value (for E-Way)": 300,
      "Calculated IGST": 54,
    },
  ],
};

function fakeForm(overrides = {}) {
  return {
    userGstin: "29ABCDE1234F1Z5",
    supplyType: "I",
    subSupplyType: "2",
    docType: "BOE",
    docNo: "SAMPLE-BOE-001",
    docDate: "05/04/2026",
    fromGstin: "URP",
    fromTrdName: "Sample overseas supplier",
    fromAddr1: "Sample supplier address",
    fromPlace: "Sample origin",
    fromPincode: "999999",
    fromStateCode: "99",
    actualFromStateCode: "99",
    toGstin: "29ABCDE1234F1Z5",
    toTrdName: "Sample importer",
    toAddr1: "Sample importer address",
    toPlace: "Sample destination",
    toPincode: "560001",
    toStateCode: "29",
    actualToStateCode: "29",
    transactionType: "1",
    totalInvoiceValue: "354",
    cgstValue: "0",
    sgstValue: "0",
    cessValue: "0",
    transMode: "1",
    transDistance: "50",
    transporterName: "",
    transporterId: "",
    transDocNo: "",
    transDocDate: "",
    vehicleNo: "",
    vehicleType: "R",
    ...overrides,
  };
}

test("formats INR amounts with Indian grouping and two decimals", () => {
  assert.equal(formatMoney(1234567.5), "12,34,567.50");
  assert.equal(formatMoney(null), "—");
});

test("detects missing values without coercing a real zero to missing", () => {
  assert.equal(isMissing(null), true);
  assert.equal(isMissing("N/A"), true);
  assert.equal(isMissing("   "), true);
  assert.equal(isMissing(0), false);
});

test("formats valid dates as NIC dd/mm/yyyy", () => {
  assert.equal(formatNicDate("2026-04-05"), "05/04/2026");
  assert.equal(formatNicDate("5/4/2026"), "05/04/2026");
  assert.equal(formatNicDate("31/02/2026"), "");
});

test("maps only known NIC units and leaves unknown UQC blank", () => {
  assert.equal(mapUqcToNic("kgs"), "KGS");
  assert.equal(mapUqcToNic("SQM"), "SQM");
  assert.equal(mapUqcToNic("UNLISTED-UNIT"), "");
});

test("checks item totals against backend grouped totals, including IGST", () => {
  const checks = checkGroupedTotals(fakeResponse.items, fakeResponse.grouped);
  assert.ok(checks.every((check) => check.matches));
  const mismatched = [{ ...fakeResponse.grouped[0], "Calculated IGST": 55 }];
  const igstCheck = checkGroupedTotals(fakeResponse.items, mismatched, ["Calculated IGST"])[0];
  assert.equal(igstCheck.matches, false);
});

test("builds NIC bulk JSON using backend grouped amounts", () => {
  const result = buildNicBulkJson({ response: fakeResponse, form: fakeForm() });
  assert.equal(result.json.version, NIC_BULK_TEMPLATE.version);
  assert.equal(result.json.billLists.length, 1);

  const bill = result.json.billLists[0];
  assert.equal(bill.docType, "BOE");
  assert.equal(bill.docDate, "05/04/2026");
  assert.equal(bill.transType, 1);
  assert.equal(bill.totalValue, 300);
  assert.equal(bill.igstValue, 54);
  assert.equal(bill.itemList.length, 1);
  assert.equal(bill.itemList[0].qtyUnit, "KGS");
  assert.equal(bill.itemList[0].taxableAmount, 300);
  assert.equal(bill.itemList[0].igstRate, 18);
  assert.deepEqual(result.blockingErrors, [], "NIC builder blockers: " + JSON.stringify(result.warnings));
  assert.equal(result.ready, true);
});

test("does not emit a single rate for an unconfirmed mixed-rate group", () => {
  const response = {
    ...fakeResponse,
    items: [
      { ...fakeResponse.items[0], "IGST Rate (%)": 5 },
      { ...fakeResponse.items[1], "IGST Rate (%)": 18 },
    ],
  };
  const result = buildNicBulkJson({ response, form: fakeForm() });
  assert.equal(result.ready, false);
  assert.equal("igstRate" in result.json.billLists[0].itemList[0], false);
  assert.ok(result.warnings.some((warning) => warning.includes("Mixed IGST rates")));
});

test("requires explicit user confirmation for a selected mixed rate", () => {
  const response = {
    ...fakeResponse,
    items: [
      { ...fakeResponse.items[0], "IGST Rate (%)": 5 },
      { ...fakeResponse.items[1], "IGST Rate (%)": 18 },
    ],
  };
  const blocked = buildNicBulkJson({
    response,
    form: fakeForm(),
    confirmedMixedRates: { 0: { rate: "12", confirmed: false } },
  });
  assert.equal(blocked.ready, false);

  const confirmed = buildNicBulkJson({
    response,
    form: fakeForm(),
    confirmedMixedRates: { 0: { rate: "12", confirmed: true } },
  });
  assert.equal(confirmed.json.billLists[0].itemList[0].igstRate, 12);
  assert.ok(confirmed.warnings.some((warning) => warning.includes("Mixed IGST rates")));
});

test("leaves unknown NIC unit code blank and warns instead of guessing", () => {
  const response = {
    ...fakeResponse,
    items: fakeResponse.items.map((item) => ({ ...item, UQC: "ALIEN-UNIT" })),
    grouped: fakeResponse.grouped.map((group) => ({ ...group, UQC: "ALIEN-UNIT" })),
  };
  const result = buildNicBulkJson({ response, form: fakeForm() });
  assert.equal(result.json.billLists[0].itemList[0].qtyUnit, "");
  assert.ok(result.warnings.some((warning) => warning.includes("No confirmed NIC unit mapping")));
});

test("does not infer an INR total from an unlabelled or foreign-currency amount", () => {
  assert.equal(parseInrAmount("120.00 INR"), 120);
  assert.equal(parseInrAmount("USD 120.00"), null);
});
