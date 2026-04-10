// Thin wrapper rond db.js customersDb
import { customersDb } from "./db.js";

export function getCustomer(phone) {
  return customersDb.get(phone);
}

export function upsertCustomer(phone, data) {
  return customersDb.upsert(phone, data);
}

export function recordBooking(phone, booking) {
  return customersDb.recordBooking(phone, booking);
}

export function getAllCustomers() {
  return customersDb.all();
}

export function getInactiveCustomers(weeksThreshold = 5) {
  return customersDb.inactive(weeksThreshold);
}

export function getCustomerStats() {
  return customersDb.stats();
}
