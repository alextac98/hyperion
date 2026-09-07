import {
  CalendarBlank,
  CaretDown,
  CaretLeft,
  CaretRight,
  MagnifyingGlass,
  PencilSimple,
  Star,
} from "@phosphor-icons/react";
import { useEffect, useId, useRef, useState } from "react";
import type { NoteRecord } from "../lib/local-database";
import { journalDateKey } from "../lib/local-database";
import { journalDate, notePreview, relativeTime } from "../lib/presentation";

import { EmptyState } from "./LibraryViews";
const JOURNAL_MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export function JournalView({
  entries,
  onSelect,
  onOpenDate,
}: {
  entries: NoteRecord[];
  onSelect: (id: string) => void;
  onOpenDate: (dateKey: string) => void;
}) {
  const [query, setQuery] = useState("");
  const journalSearchRef = useRef<HTMLInputElement>(null);
  const monthPickerRef = useRef<HTMLDivElement>(null);
  const monthPickerId = useId();
  const [visibleMonth, setVisibleMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1, 12);
  });
  const [monthPickerOpen, setMonthPickerOpen] = useState(false);
  const [monthPickerMode, setMonthPickerMode] = useState<"month" | "year">(
    "month",
  );
  const [pickerYear, setPickerYear] = useState(() => new Date().getFullYear());
  const [pickerYearPageStart, setPickerYearPageStart] = useState(
    () => Math.floor(new Date().getFullYear() / 10) * 10,
  );
  const today = journalDateKey();
  const todayEntry = entries.find((entry) => entry.journalDate === today);
  const entriesByDate = new Map<string, NoteRecord[]>();
  entries.forEach((entry) => {
    if (!entry.journalDate) return;
    entriesByDate.set(entry.journalDate, [
      ...(entriesByDate.get(entry.journalDate) ?? []),
      entry,
    ]);
  });
  const calendarYear = visibleMonth.getFullYear();
  const calendarMonth = visibleMonth.getMonth();
  const firstWeekday = new Date(calendarYear, calendarMonth, 1, 12).getDay();
  const daysInMonth = new Date(
    calendarYear,
    calendarMonth + 1,
    0,
    12,
  ).getDate();
  const calendarCellCount = Math.ceil((firstWeekday + daysInMonth) / 7) * 7;
  const calendarDays = Array.from({ length: calendarCellCount }, (_, index) => {
    const day = index - firstWeekday + 1;
    return day > 0 && day <= daysInMonth
      ? new Date(calendarYear, calendarMonth, day, 12)
      : null;
  });
  const calendarLabel = new Intl.DateTimeFormat("en", {
    month: "long",
    year: "numeric",
  }).format(visibleMonth);
  const pickerYears = Array.from(
    { length: 12 },
    (_, index) => pickerYearPageStart + index,
  ).filter((year) => year <= 9999);
  const filtered = entries
    .filter((entry) =>
      `${entry.title} ${entry.body} ${entry.tags.join(" ")}`
        .toLowerCase()
        .includes(query.toLowerCase()),
    )
    .sort(
      (a, b) =>
        (b.journalDate ?? b.createdAt).localeCompare(
          a.journalDate ?? a.createdAt,
        ) || b.updatedAt.localeCompare(a.updatedAt),
    );
  const groups = new Map<string, NoteRecord[]>();
  filtered.forEach((entry) => {
    const date = journalDate(
      entry.journalDate ?? journalDateKey(new Date(entry.createdAt)),
    );
    const month = new Intl.DateTimeFormat("en", {
      month: "long",
      year: "numeric",
    }).format(date);
    groups.set(month, [...(groups.get(month) ?? []), entry]);
  });

  useEffect(() => {
    const focusJournalSearch = (event: KeyboardEvent) => {
      if (
        !(event.metaKey || event.ctrlKey) ||
        event.shiftKey ||
        event.key.toLowerCase() !== "f"
      )
        return;
      event.preventDefault();
      journalSearchRef.current?.focus();
      journalSearchRef.current?.select();
    };
    window.addEventListener("keydown", focusJournalSearch);
    return () => window.removeEventListener("keydown", focusJournalSearch);
  }, []);

  useEffect(() => {
    if (!monthPickerOpen) return;
    const closeMonthPicker = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMonthPickerOpen(false);
    };
    const closeMonthPickerOutside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !monthPickerRef.current?.contains(event.target)
      )
        setMonthPickerOpen(false);
    };
    window.addEventListener("keydown", closeMonthPicker);
    window.addEventListener("pointerdown", closeMonthPickerOutside);
    return () => {
      window.removeEventListener("keydown", closeMonthPicker);
      window.removeEventListener("pointerdown", closeMonthPickerOutside);
    };
  }, [monthPickerOpen]);

  const toggleMonthPicker = () => {
    if (monthPickerOpen) {
      setMonthPickerOpen(false);
      return;
    }
    setMonthPickerMode("month");
    setPickerYear(calendarYear);
    setPickerYearPageStart(
      Math.min(9988, Math.max(1, Math.floor(calendarYear / 10) * 10)),
    );
    setMonthPickerOpen(true);
  };

  const choosePickerMonth = (month: number) => {
    const nextMonth = new Date(0);
    nextMonth.setHours(12, 0, 0, 0);
    nextMonth.setFullYear(pickerYear, month, 1);
    setVisibleMonth(nextMonth);
    setMonthPickerOpen(false);
  };

  return (
    <div className="library-view journal-view">
      <div className="view-heading journal-heading">
        <div>
          <span className="eyebrow">
            <CalendarBlank size={14} /> A private record over time
          </span>
          <h1>Journal</h1>
          <p>Daily writing, kept separate from your organized pages.</p>
        </div>
        <div className="journal-heading-actions">
          <label className="journal-search">
            <MagnifyingGlass size={16} />
            <input
              ref={journalSearchRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search journal…"
              aria-label="Search journal"
            />
          </label>
          <button className="primary-button" onClick={() => onOpenDate(today)}>
            <PencilSimple size={17} />{" "}
            {todayEntry ? "Open today" : "Write today"}
          </button>
        </div>
      </div>

      <section
        className="journal-calendar"
        aria-label={`${calendarLabel} journal calendar`}
      >
        <header>
          <div ref={monthPickerRef}>
            <button
              className="journal-calendar-period"
              aria-controls={monthPickerId}
              aria-expanded={monthPickerOpen}
              aria-haspopup="dialog"
              onClick={toggleMonthPicker}
            >
              <strong>{calendarLabel}</strong>
              <CaretDown size={13} weight="bold" />
            </button>
            <small>Select a day to open or create an entry.</small>
            {monthPickerOpen && (
              <div
                className="journal-calendar-picker"
                id={monthPickerId}
                role="dialog"
                aria-label="Choose a month and year"
              >
                <div className="journal-calendar-picker-nav">
                  <button
                    aria-label={
                      monthPickerMode === "month"
                        ? "Previous year"
                        : "Previous decade"
                    }
                    onClick={() =>
                      monthPickerMode === "month"
                        ? setPickerYear((year) => Math.max(1, year - 1))
                        : setPickerYearPageStart((year) =>
                            Math.max(1, year - 10),
                          )
                    }
                  >
                    <CaretLeft size={14} />
                  </button>
                  {monthPickerMode === "month" ? (
                    <button
                      className="journal-calendar-picker-title"
                      aria-label={`Choose a year, currently ${pickerYear}`}
                      onClick={() => {
                        setPickerYearPageStart(
                          Math.min(
                            9988,
                            Math.max(1, Math.floor(pickerYear / 10) * 10),
                          ),
                        );
                        setMonthPickerMode("year");
                      }}
                    >
                      {pickerYear}
                      <CaretDown size={11} weight="bold" />
                    </button>
                  ) : (
                    <strong>
                      {pickerYearPageStart}–{pickerYears.at(-1)}
                    </strong>
                  )}
                  <button
                    aria-label={
                      monthPickerMode === "month" ? "Next year" : "Next decade"
                    }
                    onClick={() =>
                      monthPickerMode === "month"
                        ? setPickerYear((year) => Math.min(9999, year + 1))
                        : setPickerYearPageStart((year) =>
                            Math.min(9988, year + 10),
                          )
                    }
                  >
                    <CaretRight size={14} />
                  </button>
                </div>
                {monthPickerMode === "month" ? (
                  <div className="journal-calendar-picker-grid months">
                    {JOURNAL_MONTHS.map((month, index) => (
                      <button
                        className={
                          pickerYear === calendarYear && index === calendarMonth
                            ? "active"
                            : ""
                        }
                        aria-pressed={
                          pickerYear === calendarYear && index === calendarMonth
                        }
                        key={month}
                        onClick={() => choosePickerMonth(index)}
                      >
                        {month.slice(0, 3)}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="journal-calendar-picker-grid years">
                    {pickerYears.map((year) => (
                      <button
                        className={year === pickerYear ? "active" : ""}
                        aria-pressed={year === pickerYear}
                        key={year}
                        onClick={() => {
                          setPickerYear(year);
                          setMonthPickerMode("month");
                        }}
                      >
                        {year}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="journal-calendar-controls">
            <button
              aria-label="Previous month"
              title="Previous month"
              onClick={() => {
                setMonthPickerOpen(false);
                setVisibleMonth(
                  new Date(calendarYear, calendarMonth - 1, 1, 12),
                );
              }}
            >
              <CaretLeft size={15} />
            </button>
            <button
              className="journal-calendar-today"
              onClick={() => {
                const now = new Date();
                setMonthPickerOpen(false);
                setVisibleMonth(
                  new Date(now.getFullYear(), now.getMonth(), 1, 12),
                );
              }}
            >
              Today
            </button>
            <button
              aria-label="Next month"
              title="Next month"
              onClick={() => {
                setMonthPickerOpen(false);
                setVisibleMonth(
                  new Date(calendarYear, calendarMonth + 1, 1, 12),
                );
              }}
            >
              <CaretRight size={15} />
            </button>
          </div>
        </header>
        <div className="journal-calendar-weekdays" aria-hidden="true">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
            <span key={day}>{day}</span>
          ))}
        </div>
        <div className="journal-calendar-grid">
          {calendarDays.map((date, index) => {
            if (!date)
              return (
                <span
                  className="journal-calendar-blank"
                  aria-hidden="true"
                  key={`blank-${index}`}
                />
              );
            const dateKey = journalDateKey(date);
            const dateEntries = entriesByDate.get(dateKey) ?? [];
            const description = new Intl.DateTimeFormat("en", {
              weekday: "long",
              month: "long",
              day: "numeric",
              year: "numeric",
            }).format(date);
            return (
              <button
                className={`${dateEntries.length ? "has-entry" : ""}${dateKey === today ? " is-today" : ""}`}
                aria-current={dateKey === today ? "date" : undefined}
                aria-label={`${dateEntries.length ? "Open" : "Write for"} ${description}${dateEntries.length > 1 ? `, ${dateEntries.length} entries` : ""}`}
                title={
                  dateEntries.length
                    ? `Open ${dateEntries[0].title}`
                    : `Write for ${description}`
                }
                key={dateKey}
                onClick={() => onOpenDate(dateKey)}
              >
                <strong>{date.getDate()}</strong>
                {dateEntries.length > 0 && (
                  <span className="journal-calendar-entry">
                    <i />
                    {dateEntries.length > 1
                      ? `${dateEntries.length} entries`
                      : "Entry"}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </section>

      {filtered.length ? (
        <div className="journal-months">
          {[...groups.entries()].map(([month, monthEntries]) => (
            <section className="journal-month" key={month}>
              <div className="journal-month-heading">
                <h2>{month}</h2>
              </div>
              <div className="journal-list">
                {monthEntries.map((entry) => {
                  const date = journalDate(
                    entry.journalDate ??
                      journalDateKey(new Date(entry.createdAt)),
                  );
                  return (
                    <button key={entry.id} onClick={() => onSelect(entry.id)}>
                      <span className="journal-date">
                        <strong>{date.getDate()}</strong>
                        <small>
                          {new Intl.DateTimeFormat("en", {
                            weekday: "short",
                          }).format(date)}
                        </small>
                      </span>
                      <span className="journal-copy">
                        <span className="journal-entry-title">
                          <strong>{entry.title}</strong>
                          {entry.favorite && <Star size={13} weight="fill" />}
                        </span>
                        <p>{notePreview(entry)}</p>
                        <small>
                          Edited {relativeTime(entry.updatedAt)}
                          {entry.tags.length
                            ? ` · ${entry.tags
                                .slice(0, 2)
                                .map((tag) => `#${tag}`)
                                .join(" ")}`
                            : ""}
                        </small>
                      </span>
                      <CaretRight size={15} />
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={<CalendarBlank size={28} />}
          title={query ? "No matching entries" : "Your journal starts here"}
          description={
            query
              ? "Try a different word or clear the search."
              : "Choose a date above to start writing. It stays out of Notes while remaining searchable and linkable."
          }
          action={
            !query && (
              <button
                className="primary-button"
                onClick={() => onOpenDate(today)}
              >
                <PencilSimple size={16} /> Write today
              </button>
            )
          }
        />
      )}
    </div>
  );
}
