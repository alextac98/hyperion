import { FileText, MagnifyingGlass, Stack, X } from "@phosphor-icons/react";
import { useState } from "react";
import type { TemplateRecord } from "../lib/local-database";
import { templatePageRecord } from "../lib/presentation";
import { Dialog } from "./Dialog";
import { PageIcon } from "./PageIcon";

export function TemplatePickerDialog({
  templates,
  defaultTemplateId,
  parentTitle,
  onClose,
  onBlank,
  onTemplate,
}: {
  templates: TemplateRecord[];
  defaultTemplateId: string | null;
  parentTitle?: string;
  onClose: () => void;
  onBlank: () => void;
  onTemplate: (template: TemplateRecord) => void;
}) {
  const [query, setQuery] = useState("");
  const filtered = templates.filter((template) =>
    `${template.name} ${template.defaultTitle} ${template.body} ${template.tags.join(" ")}`
      .toLocaleLowerCase()
      .includes(query.trim().toLocaleLowerCase()),
  );
  return (
    <Dialog label="New page from template" onClose={onClose}>
      <section className="template-picker-dialog">
        <header>
          <span>
            <Stack size={20} />
            <span>
              <strong>New page</strong>
              <small>
                {parentTitle
                  ? `Inside ${parentTitle}`
                  : "Choose a starting point"}
              </small>
            </span>
          </span>
          <button aria-label="Close template picker" onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        <label className="template-picker-search">
          <MagnifyingGlass size={17} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search templates…"
          />
        </label>
        <div className="template-picker-grid">
          {!query && (
            <button className="template-picker-card" onClick={onBlank}>
              <span className="template-picker-card-icon">
                <FileText size={21} />
              </span>
              <span>
                <strong>Blank page</strong>
                <small>Start with an empty page.</small>
              </span>
            </button>
          )}
          {filtered.map((template) => (
            <button
              className="template-picker-card"
              key={template.id}
              onClick={() => onTemplate(template)}
            >
              <span className="template-picker-card-icon">
                <PageIcon note={templatePageRecord(template)} size={21} />
              </span>
              <span>
                <strong>
                  <span className="template-picker-name" title={template.name}>
                    {template.name}
                  </span>
                  {defaultTemplateId === template.id && <i>Default</i>}
                </strong>
                <small>
                  {template.body.replace(/\s+/g, " ").trim() ||
                    template.defaultTitle ||
                    "Empty page template"}
                </small>
              </span>
            </button>
          ))}
          {!filtered.length && query && (
            <div className="template-picker-empty">No matching templates</div>
          )}
        </div>
      </section>
    </Dialog>
  );
}
