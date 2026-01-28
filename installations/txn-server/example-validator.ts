/**
 * Example Transaction Validator
 *
 * This is a simple validator that demonstrates how to create
 * custom validation logic for your transaction node.
 *
 * Replace this with your own validator for production use.
 */

import type { Transaction, TransactionValidator, ValidationContext } from "@bandeira-tech/b3nd-sdk/txn";

/**
 * A permissive validator that accepts all transactions
 * with basic structure validation.
 *
 * This is suitable for development/testing but should be
 * replaced with proper validation for production.
 */
const validator: TransactionValidator = async (
  tx: Transaction,
  ctx: ValidationContext,
) => {
  const [uri, data] = tx;

  // Basic URI validation
  if (!uri || typeof uri !== "string") {
    return {
      valid: false,
      error: "invalid_uri",
      details: { message: "Transaction URI must be a non-empty string" },
    };
  }

  // URI format validation (must contain ://)
  if (!uri.includes("://")) {
    return {
      valid: false,
      error: "invalid_uri_format",
      details: { message: "Transaction URI must be in format protocol://path" },
    };
  }

  // Data must exist
  if (data === undefined || data === null) {
    return {
      valid: false,
      error: "invalid_data",
      details: { message: "Transaction data must not be null or undefined" },
    };
  }

  // Accept the transaction
  return { valid: true };
};

export default validator;
