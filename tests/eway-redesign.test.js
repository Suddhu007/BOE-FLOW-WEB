import test from "node:test";
import assert from "node:assert/strict";

import { isMissing, mapUqcToNic } from "../src/formatters.js";
import {
  checkGroupTotals,
  checkHeaderIgst,
  detectMixedRates,
} from "../src/eway-audit.js";
import { buildNicBulkJson, NIC_BULK_TEMPLATE } from "../src/eway-json.js";

test("missing-value detection treats blanks, nulls and N/A as missing", () => {
  assert.equal(isMissing(null), true);
  assert.equal(isMissing(undefined), true);
  assert.equal(isMissing("  "), true);
  assert.equal(isMissing("n/a"), true);
  assert.equal(isMissing("0"), false);
});

test("group audit matches only when backend group totals equal matching item-line totals", () => {
  const group = {
    "HSN Code": "synthetic-hsn",
    UQC: "SQM",
    Quantity: 5,
    "GST Taxable Value (for E-Way)": 125,
    "Calculated IGST": 22.5,
  };
  const items = [
    {
      "HSN Code": "synthetic-hsn",
      UQC: "SQM",
      Quantity: 2,
      "GST Taxable Value (for E-Way)": 50,
      "Calculated IGST": 9,
    },
    {
      "HSN Code": "synthetic-hsn",
      UQC: "SQM",
      Quantity: 3,
      "GST Taxable Value (for E-Way)": 75,
      "Calculated IGST": 13.5,
    },
  ];
  assert.equal(checkGroupTotals(group, items).matches, true);
  assert.equal(checkGroupTotals({ ...group, "Calculated IGST": 24 }, items).matches, false);
  assert.equal(checkGroupTotals({ ...group, Quantity: null }, items).matches, false);
});

test("mixed-rate detection returns the distinct backend rates without selecting one", () => {
  assert.deepEqual(detectMixedRates([
    { "IGST Rate (%)": 5 },
    { "IGST Rate (%)": 18 },
    { "IGST Rate (%)": 5 },
  ]), { mixed: true, rates: [5, 18] });
  assert.deepEqual(detectMixedRates([
    { "IGST Rate (%)": 5 },
    { "IGST Rate (%)": 5 },
  ]), { mixed: false, rates: [5] });
});

test("NIC UQC mapping returns known codes and leaves unknown units unmapped", () => {
  assert.equal(mapUqcToNic("SQM"), "SQM");
  assert.equal(mapUqcToNic("unknown-test-unit"), "");
});

test("header IGST audit compares the header value to item-line IGST", () => {
  const matching = checkHeaderIgst(
    { "IGST Total": 22.5 },
    [{ "IGST Amount": 9 }, { "IGST Amount": 13.5 }],
  );
  assert.equal(matching.matches, true);
  assert.equal(checkHeaderIgst(
    { "IGST Total": 25 },
    [{ "IGST Amount": 9 }, { "IGST Amount": 13.5 }],
  ).matches, false);
  assert.equal(checkHeaderIgst({}, [{ "Calculated IGST": 9 }]).matches, false);
});

test("NIC JSON builder preserves the bulk schema version and blocks incomplete data", () => {
  const result = buildNicBulkJson({
    response: {
      header: {},
      items: [],
      grouped: [{
        "HSN Code": "synthetic-hsn",
        UQC: "unknown-test-unit",
        Quantity: null,
        "GST Taxable Value (for E-Way)": null,
        "Calculated IGST": null,
      }],
    },
    form: {},
  });
  assert.equal(result.json.version, NIC_BULK_TEMPLATE.version);
  assert.equal(Array.isArray(result.json.billLists), true);
  assert.equal(result.ready, false);
  assert.ok(result.blockingErrors.length > 0);
  assert.equal(result.json.billLists[0].itemList[0].qtyUnit, "");
  assert.equal("taxableAmount" in result.json.billLists[0].itemList[0], true);
  assert.equal(result.json.billLists[0].itemList[0].taxableAmount, null);
});
