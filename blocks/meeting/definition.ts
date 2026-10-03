import type { BlockDefinition } from "../contract.js";
import { isCalendarDate, localToday } from "../date/definition.js";

export type MeetingTab = "notes" | "transcript" | "summary";
export type MeetingRecording = {
  name: string;
  mimeType: string;
  durationSeconds: number;
  startedAt: string;
  state: "capturing" | "ready";
};
export type MeetingProps = {
  title: string;
  date: string;
  notes: string;
  transcript: string;
  summary: string;
  summaryStatus: "unavailable";
  recording: MeetingRecording | null;
  references: { assets: Record<string, string> };
};

/** Choose the insertion date without changing dates in existing meetings. */
export function initialMeetingDate(journalDate?: string, now = new Date()) {
  return isCalendarDate(journalDate) ? journalDate : localToday(now);
}

function plain(value: unknown): unknown {
  if (
    value &&
    typeof value === "object" &&
    "toJSON" in value &&
    typeof value.toJSON === "function"
  )
    return value.toJSON();
  return value;
}

export const meetingDefinition: BlockDefinition = {
  flavour: "hyperion:meeting",
  label: "Meeting",
  version: 1,
  children: ["affine:note"],
  defaults: (): MeetingProps => ({
    title: "Meeting",
    date: "",
    notes: "",
    transcript: "",
    summary: "",
    summaryStatus: "unavailable",
    recording: null,
    references: { assets: {} },
  }),
  validate(props) {
    if (
      !["title", "date", "notes", "transcript", "summary"].every(
        (key) => typeof props[key] === "string",
      )
    )
      return false;
    if (props.date !== "" && !isCalendarDate(props.date)) return false;
    if (props.summaryStatus !== "unavailable") return false;
    const references = plain(props.references) as
      | MeetingProps["references"]
      | undefined;
    if (
      !references ||
      !references.assets ||
      typeof references.assets !== "object" ||
      Array.isArray(references.assets) ||
      !Object.values(references.assets).every(
        (value) => typeof value === "string",
      )
    )
      return false;
    const recording = plain(props.recording) as MeetingRecording | null;
    return (
      recording === null ||
      Boolean(
        recording &&
          typeof recording.name === "string" &&
          typeof recording.mimeType === "string" &&
          typeof recording.startedAt === "string" &&
          Number.isFinite(recording.durationSeconds) &&
          recording.durationSeconds >= 0 &&
          ["capturing", "ready"].includes(recording.state),
      )
    );
  },
  project: ({ props }) => ({
    text: [
      props.title,
      props.date,
      props.notes,
      props.transcript,
      props.summary,
    ]
      .filter(Boolean)
      .join("\n"),
    ...(props.title
      ? { outline: { title: String(props.title), level: 2 } }
      : {}),
  }),
  insertion: {
    description: "Recording, transcript, summary, and meeting notes",
    aliases: ["recording", "minutes", "transcript"],
    icon: "◉",
  },
};

/** Explicit, ordered asset slots also work in unavailable blocks and portable backups. */
export function recordingKeys(props: MeetingProps) {
  return Object.entries(props.references.assets)
    .filter(([slot]) => /^audio-\d{8}$/.test(slot))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, key]) => key);
}
