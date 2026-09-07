import {
  Archive,
  CaretRight,
  FileText,
  FolderSimple,
  Hash,
  Plus,
  Sparkle,
  Stack,
  Trash,
} from "@phosphor-icons/react";
import type {
  NoteRecord,
  TemplateRecord,
  VaultPreferences,
} from "../lib/local-database";
import {
  notePreview,
  relativeTime,
  templatePageRecord,
} from "../lib/presentation";
import { PageIcon } from "./PageIcon";

export function HomeView({
  notes,
  onSelect,
  onCreate,
}: {
  notes: NoteRecord[];
  onSelect: (id: string) => void;
  onCreate: () => void;
}) {
  const recent = notes.slice(0, 5);
  const noteIds = new Set(notes.map((note) => note.id));
  const topLevelPages = notes.filter(
    (note) => !note.parentId || !noteIds.has(note.parentId),
  );
  return (
    <div className="library-view home-view">
      <div className="view-heading home-heading">
        <div>
          <span className="eyebrow">
            <Sparkle size={14} weight="fill" /> Your local knowledge space
          </span>
          <h1>Good to see your ideas again.</h1>
          <p>
            Capture quickly, then shape pages into a hierarchy that grows with
            your thinking.
          </p>
        </div>
        <button className="primary-button" onClick={onCreate}>
          <Plus size={17} weight="bold" /> New page
        </button>
      </div>
      <div className="stat-row">
        <div>
          <FileText size={20} />
          <strong>{notes.length}</strong>
          <span>pages</span>
        </div>
        <div>
          <FolderSimple size={20} />
          <strong>{topLevelPages.length}</strong>
          <span>top level</span>
        </div>
        <div>
          <Hash size={20} />
          <strong>{new Set(notes.flatMap((note) => note.tags)).size}</strong>
          <span>topics</span>
        </div>
      </div>
      {topLevelPages.length > 0 && (
        <section className="library-section">
          <div className="library-section-title">
            <h2>Top-level pages</h2>
            <span>Pages can contain pages</span>
          </div>
          <div className="collection-card-grid">
            {topLevelPages.slice(0, 4).map((page) => {
              const childCount = notes.filter(
                (note) => note.parentId === page.id,
              ).length;
              return (
                <button key={page.id} onClick={() => onSelect(page.id)}>
                  <span className="collection-card-icon">
                    <PageIcon
                      note={page}
                      size={21}
                      weight={childCount ? "fill" : "regular"}
                    />
                  </span>
                  <span>
                    <strong>{page.title}</strong>
                    <small>
                      {childCount
                        ? `${childCount} child ${childCount === 1 ? "page" : "pages"}`
                        : notePreview(page)}
                    </small>
                  </span>
                  <CaretRight size={14} />
                </button>
              );
            })}
          </div>
        </section>
      )}
      <section className="library-section">
        <div className="library-section-title">
          <h2>Continue writing</h2>
          <span>Recently edited</span>
        </div>
        <div className="note-card-grid">
          {recent.map((note) => (
            <button
              className="note-card"
              key={note.id}
              onClick={() => onSelect(note.id)}
            >
              <span className="note-card-top">
                <PageIcon note={note} size={18} />
                <small>{relativeTime(note.updatedAt)}</small>
              </span>
              <strong>{note.title}</strong>
              <p>{notePreview(note)}</p>
              <span className="note-card-tags">
                {note.tags.slice(0, 2).map((tag) => (
                  <i key={tag}>#{tag}</i>
                ))}
              </span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

export function TagsView({
  tags,
  notes,
  activeTag,
  onTag,
  onSelect,
}: {
  tags: [string, number][];
  notes: NoteRecord[];
  activeTag: string | null;
  onTag: (tag: string) => void;
  onSelect: (id: string) => void;
}) {
  const selectedTag =
    activeTag && tags.some(([tag]) => tag === activeTag)
      ? activeTag
      : (tags[0]?.[0] ?? null);
  const tagged = selectedTag
    ? notes.filter((note) => note.tags.includes(selectedTag))
    : [];
  return (
    <div className="library-view tags-view">
      <div className="view-heading">
        <div>
          <span className="eyebrow">Themes across your vault</span>
          <h1>Tags</h1>
          <p>Lightweight labels can connect pages across the hierarchy.</p>
        </div>
      </div>
      <div className="tags-layout">
        <aside>
          <h2>All tags</h2>
          {tags.map(([tag, count]) => (
            <button
              key={tag}
              className={tag === selectedTag ? "active" : ""}
              onClick={() => onTag(tag)}
            >
              <Hash size={15} />
              <span>{tag}</span>
              <em>{count}</em>
            </button>
          ))}
        </aside>
        <section>
          <h2>{selectedTag ? `#${selectedTag}` : "Choose a tag"}</h2>
          <div className="simple-note-list">
            {tagged.map((note) => (
              <button key={note.id} onClick={() => onSelect(note.id)}>
                <PageIcon note={note} size={17} />
                <span>
                  <strong>{note.title}</strong>
                  <small>{notePreview(note)}</small>
                </span>
                <span>{relativeTime(note.updatedAt)}</span>
              </button>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

export function ArchiveView({
  notes,
  onRestore,
  onTrash,
}: {
  notes: NoteRecord[];
  onRestore: (note: NoteRecord) => void;
  onTrash: (note: NoteRecord) => void;
}) {
  return (
    <div className="library-view">
      <div className="view-heading">
        <div>
          <span className="eyebrow">Pages kept out of the way</span>
          <h1>Archive</h1>
          <p>Archived pages stay local and can be restored at any time.</p>
        </div>
      </div>
      {notes.length ? (
        <div className="trash-list">
          {notes.map((note) => (
            <div key={note.id}>
              <PageIcon note={note} size={18} />
              <span>
                <strong>{note.title}</strong>
                <small>Archived {relativeTime(note.updatedAt)}</small>
              </span>
              <button onClick={() => onRestore(note)}>Restore</button>
              <button className="danger-text" onClick={() => onTrash(note)}>
                Move to trash
              </button>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={<Archive size={28} />}
          title="Archive is empty"
          description="Right-click a page in the sidebar to archive it."
        />
      )}
    </div>
  );
}

export function TrashView({
  notes,
  onRestore,
  onDelete,
}: {
  notes: NoteRecord[];
  onRestore: (note: NoteRecord) => void;
  onDelete: (note: NoteRecord) => void;
}) {
  return (
    <div className="library-view">
      <div className="view-heading">
        <div>
          <span className="eyebrow">Removed pages</span>
          <h1>Trash</h1>
          <p>Restore a page or delete it permanently.</p>
        </div>
      </div>
      {notes.length ? (
        <div className="trash-list">
          {notes.map((note) => (
            <div key={note.id}>
              <PageIcon note={note} size={18} />
              <span>
                <strong>{note.title}</strong>
                <small>Deleted {relativeTime(note.updatedAt)}</small>
              </span>
              <button onClick={() => onRestore(note)}>Restore</button>
              <button
                className="danger-text"
                onClick={() => void onDelete(note)}
              >
                Delete
              </button>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={<Trash size={28} />}
          title="Trash is empty"
          description="Pages moved to trash will appear here."
        />
      )}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-state-icon">{icon}</div>
      <h2>{title}</h2>
      <p>{description}</p>
      {action}
    </div>
  );
}

export function TemplatesView({
  templates,
  preferences,
  onCreate,
  onUse,
  onEdit,
  onDelete,
  onDefaults,
}: {
  templates: TemplateRecord[];
  preferences: VaultPreferences;
  onCreate: () => void;
  onUse: (template: TemplateRecord) => void;
  onEdit: (template: TemplateRecord) => void;
  onDelete: (template: TemplateRecord) => void;
  onDefaults: (defaults: VaultPreferences["defaultTemplateIds"]) => void;
}) {
  return (
    <div className="library-view templates-view">
      <div className="view-heading">
        <div>
          <span className="eyebrow">
            <Stack size={14} /> Reusable starting points
          </span>
          <h1>Templates</h1>
          <p>
            Turn any page into a template, then use it for new pages or daily
            journal entries.
          </p>
        </div>
        <button className="primary-button" onClick={onCreate}>
          <Plus size={17} weight="bold" /> New template
        </button>
      </div>
      <section className="template-defaults-panel">
        <div>
          <strong>Default for new pages</strong>
          <small>Used by New page and ⌘ N.</small>
          <select
            value={preferences.defaultTemplateIds.note ?? ""}
            onChange={(event) =>
              onDefaults({
                ...preferences.defaultTemplateIds,
                note: event.target.value || null,
              })
            }
          >
            <option value="">Blank page</option>
            {templates.map((template) => (
              <option key={template.id} value={template.id}>
                {template.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <strong>Default for journal entries</strong>
          <small>Used when you write on a date for the first time.</small>
          <select
            value={preferences.defaultTemplateIds.journal ?? ""}
            onChange={(event) =>
              onDefaults({
                ...preferences.defaultTemplateIds,
                journal: event.target.value || null,
              })
            }
          >
            <option value="">Blank page</option>
            {templates.map((template) => (
              <option key={template.id} value={template.id}>
                {template.name}
              </option>
            ))}
          </select>
        </div>
      </section>
      {templates.length ? (
        <div className="template-card-grid">
          {templates.map((template) => {
            const page = templatePageRecord(template);
            const pageDefault =
              preferences.defaultTemplateIds.note === template.id;
            const journalDefault =
              preferences.defaultTemplateIds.journal === template.id;
            return (
              <article className="template-card" key={template.id}>
                <div className="template-card-heading">
                  <span className="template-card-icon">
                    <PageIcon note={page} size={21} />
                  </span>
                  <span>
                    {pageDefault && <i>Page default</i>}
                    {journalDefault && <i>Journal default</i>}
                  </span>
                </div>
                <h2>{template.name}</h2>
                <strong className="template-default-title">
                  {template.defaultTitle || "Untitled"}
                </strong>
                <p>
                  {template.body.replace(/\s+/g, " ").trim() ||
                    "Empty page template"}
                </p>
                <div className="template-card-tags">
                  {template.tags.slice(0, 3).map((tag) => (
                    <span key={tag}>#{tag}</span>
                  ))}
                </div>
                <footer>
                  <button
                    className="primary-button"
                    onClick={() => onUse(template)}
                  >
                    Use
                  </button>
                  <button
                    className="secondary-button"
                    onClick={() => onEdit(template)}
                  >
                    Edit
                  </button>
                  <button
                    className="template-delete-button"
                    aria-label={`Delete ${template.name}`}
                    title="Delete template"
                    onClick={() => onDelete(template)}
                  >
                    <Trash size={15} />
                  </button>
                </footer>
              </article>
            );
          })}
        </div>
      ) : (
        <EmptyState
          icon={<Stack size={28} />}
          title="No templates yet"
          description="Create a blank template here, or save an existing page from its More menu."
          action={
            <button className="primary-button" onClick={onCreate}>
              <Plus size={16} /> New template
            </button>
          }
        />
      )}
    </div>
  );
}
