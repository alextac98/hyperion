import { createBlankNote, type NoteRecord } from "./local-database";

export type StarterBlock =
  | { type: "text" | "h2" | "todo" | "callout"; text: string }
  | { type: "table"; rows: string[][] };
export type StarterPage = { note: NoteRecord; blocks: StarterBlock[] };

/** Short, editable examples. No fictional journal entries or user projects. */
export function makeStarterPages(vaultId: string): StarterPage[] {
  const definitions: {
    title: string;
    emoji: string;
    blocks: StarterBlock[];
  }[] = [
    {
      title: "Welcome",
      emoji: "👋",
      blocks: [
        {
          type: "text",
          text: "This is your space for thoughts, plans, and things worth remembering. Start with a sentence. You can organize it later.",
        },
        {
          type: "callout",
          text: "These three pages are yours to edit, experiment with, or delete. Everything saves automatically in your vault folder.",
        },
        { type: "h2", text: "Try something small" },
        {
          type: "todo",
          text: "Click here and add something you want to remember.",
        },
        {
          type: "todo",
          text: "Create a page with the New page button in the sidebar.",
        },
        {
          type: "todo",
          text: "Type / on a blank line to explore the block menu.",
        },
        { type: "h2", text: "Take a look around" },
        {
          type: "text",
          text: "Open [[Make it yours]] to try checklists, callouts, and a table. Then visit [[Connect your ideas]] to explore links and everyday writing. Both pages are nested under Welcome in the sidebar.",
        },
        {
          type: "text",
          text: "Your notes stay on this device. In Settings → Data, you can find your vault folder, move it, or make a backup.",
        },
      ],
    },
    {
      title: "Make it yours",
      emoji: "✏️",
      blocks: [
        {
          type: "text",
          text: "A page can be a quick thought, a useful checklist, or a plan taking shape. Try editing the examples below.",
        },
        { type: "h2", text: "A little room to think" },
        {
          type: "text",
          text: "Something I would like to make time for this week…",
        },
        { type: "todo", text: "Write down one small next step." },
        { type: "todo", text: "Check this box when you have tried it." },
        {
          type: "callout",
          text: "Give a useful thought its own space. Type / and choose Callout to add a box like this.",
        },
        { type: "h2", text: "Put a few ideas side by side" },
        {
          type: "table",
          rows: [
            ["Idea", "A small next step"],
            ["Read something interesting", "Save a question to explore"],
            ["Make something", "Sketch a first version"],
          ],
        },
        {
          type: "text",
          text: "Click a table cell to change it. Select some text to try bold, italics, or a highlight. The / menu also has images, files, code, and more.",
        },
        {
          type: "text",
          text: "Next: [[Connect your ideas]]. You can open linked pages from Page links in the details panel.",
        },
      ],
    },
    {
      title: "Connect your ideas",
      emoji: "🔗",
      blocks: [
        {
          type: "text",
          text: "A useful note often leads to another. You can connect pages as you write, then follow those connections later.",
        },
        { type: "h2", text: "Leave a trail" },
        {
          type: "text",
          text: "Write a page title inside double brackets, like [[Make it yours]]. Open the details panel to follow it under Page links. On the other page, Backlinks shows which pages point to it.",
        },
        {
          type: "text",
          text: "Try renaming Make it yours. Its existing links keep pointing to the same page.",
        },
        { type: "h2", text: "Keep related pages together" },
        {
          type: "text",
          text: "These guide pages sit inside [[Welcome]]. Drag a page onto another in the sidebar to nest it. Add tags for topics that cross folders, or favorite a page you return to often.",
        },
        { type: "h2", text: "Make space for the everyday" },
        {
          type: "text",
          text: "Open Journal in the sidebar to write about today. A few sentences, a question, or a small win is plenty.",
        },
        {
          type: "text",
          text: "When a page has a structure you want to reuse, choose Save as template from its menu. Templates can give future pages and journal entries a familiar starting point.",
        },
        {
          type: "callout",
          text: "You do not need a perfect system to begin. Add one real note and let the shape of your vault grow with you.",
        },
      ],
    },
  ];
  const notes = definitions.map((definition, index) => ({
    ...createBlankNote(vaultId),
    title: definition.title,
    icon: { type: "emoji" as const, unicode: definition.emoji },
    tags: ["getting-started"],
    favorite: index === 0,
    sortOrder: (index + 1) * 1000,
    body: definition.blocks
      .map((block) =>
        block.type === "table"
          ? block.rows.map((row) => row.join(" · ")).join("\n")
          : block.text,
      )
      .join("\n"),
  }));
  return definitions.map((definition, index) => ({
    blocks: definition.blocks,
    note: {
      ...notes[index],
      parentId: index ? notes[0].id : null,
      links: notes
        .filter(
          (note) =>
            note.id !== notes[index].id &&
            notes[index].body.includes(`[[${note.title}]]`),
        )
        .map((note) => ({
          targetId: note.id,
          label: note.title,
          kind: "inline" as const,
        })),
    },
  }));
}
