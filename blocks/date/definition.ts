import type { BlockDefinition } from "../contract.js";

/** A calendar date, independent of time zones and daylight-saving transitions. */
export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false;
  const [year, month, day] = value.split("-").map(Number);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return (
    day <=
    [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]
  );
}

export function parseCalendarDate(text: string): string | null {
  const value = text.trim();
  if (isCalendarDate(value)) return value;
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value);
  if (!match) return null;
  const iso = `${match[3]}-${match[1].padStart(2, "0")}-${match[2].padStart(2, "0")}`;
  return isCalendarDate(iso) ? iso : null;
}

export function localToday(now = new Date()): string {
  return `${String(now.getFullYear()).padStart(4, "0")}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export const dateDefinition: BlockDefinition = {
  flavour: "hyperion:date",
  label: "Date",
  version: 1,
  defaults: () => ({ date: "" }),
  validate: (props) => props.date === "" || isCalendarDate(props.date),
  project: ({ props }) => ({ text: props.date ? String(props.date) : "" }),
};
