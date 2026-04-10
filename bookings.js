// Thin wrapper rond db.js bookingsDb — API blijft hetzelfde zodat index.js/dashboard.js niks hoeven te veranderen.
import { bookingsDb } from "./db.js";

export function addBooking(booking) {
  return bookingsDb.add(booking);
}

export function getTodaysBookings() {
  return bookingsDb.getToday();
}

export function getAllUpcoming() {
  return bookingsDb.getUpcoming();
}

export function getAll() {
  return bookingsDb.all();
}
