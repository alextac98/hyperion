import { DataRecovery } from "./DataRecovery";
import {
  Archive,
  BookOpenText,
  Check,
  Database,
  DownloadSimple,
  GearSix,
  Moon,
  Sparkle,
  Stack,
  Sun,
  UploadSimple,
  X,
} from "@phosphor-icons/react";
import { useId, useState } from "react";
import type {
  TemplateRecord,
  ThemePreference,
  VaultPreferences,
  VaultRecord,
} from "../lib/local-database";
import type { StorageInfo } from "../platform/desktop-api";
import { Dialog } from "./Dialog";
import { HyperionMark } from "./HyperionMark";

export function SettingsDialog({
  vault,
  vaultCount,
  busy,
  templates,
  preferences,
  storageInfo,
  onStorageLocation,
  onClose,
  onPreferences,
  onVault,
  onHistory,
  onExport,
  onImport,
  onDelete,
}: {
  vault: VaultRecord;
  vaultCount: number;
  busy: boolean;
  templates: TemplateRecord[];
  preferences: VaultPreferences;
  storageInfo: StorageInfo | null;
  onStorageLocation: () => Promise<void>;
  onClose: () => void;
  onPreferences: (patch: Partial<VaultPreferences>) => Promise<void>;
  onVault: (patch: Partial<VaultRecord>) => Promise<void>;
  onHistory: () => void;
  onExport: () => void;
  onImport: () => void;
  onDelete: () => void;
}) {
  const [tab, setTab] = useState<
    "general" | "editor" | "templates" | "appearance" | "data"
  >("general");
  const [name, setName] = useState(vault.name);
  const [description, setDescription] = useState(vault.description);
  const themes: {
    value: ThemePreference;
    label: string;
    icon: React.ReactNode;
  }[] = [
    { value: "system", label: "System", icon: <Sparkle size={18} /> },
    { value: "light", label: "Light", icon: <Sun size={18} /> },
    { value: "dark", label: "Dark", icon: <Moon size={18} /> },
  ];
  return (
    <Dialog
      busy={busy}
      className="settings-layer"
      label="Settings"
      onClose={onClose}
    >
      <section className="settings-dialog">
        <header>
          <div>
            <HyperionMark small />
            <span>
              <strong>Settings</strong>
              <small>{vault.name}</small>
            </span>
          </div>
          <button aria-label="Close settings" onClick={onClose}>
            <X size={19} />
          </button>
        </header>
        <div className="settings-body">
          <nav>
            {(
              ["general", "editor", "templates", "appearance", "data"] as const
            ).map((item) => (
              <button
                key={item}
                className={tab === item ? "active" : ""}
                onClick={() => setTab(item)}
              >
                {item === "general" ? (
                  <GearSix size={17} />
                ) : item === "editor" ? (
                  <BookOpenText size={17} />
                ) : item === "templates" ? (
                  <Stack size={17} />
                ) : item === "appearance" ? (
                  <Sun size={17} />
                ) : (
                  <Database size={17} />
                )}
                <span>{item[0].toUpperCase() + item.slice(1)}</span>
              </button>
            ))}
          </nav>
          <div className="settings-content">
            {tab === "general" && (
              <>
                <div className="settings-heading">
                  <h2>General</h2>
                  <p>Name and describe this local vault.</p>
                </div>
                <label className="setting-field">
                  <span>Vault name</span>
                  <input
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    onBlur={() =>
                      name.trim() && void onVault({ name: name.trim() })
                    }
                  />
                </label>
                <label className="setting-field">
                  <span>Description</span>
                  <input
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    onBlur={() => void onVault({ description })}
                  />
                </label>
                <SettingToggle
                  title="Open page details"
                  description="Show outline, backlinks, and properties when opening a page."
                  checked={preferences.showDetails}
                  onChange={(checked) =>
                    void onPreferences({ showDetails: checked })
                  }
                />
              </>
            )}
            {tab === "editor" && (
              <>
                <div className="settings-heading">
                  <h2>Editor</h2>
                  <p>Configure the AFFiNE block editor for this vault.</p>
                </div>
                <SettingToggle
                  title="Spell check"
                  description="Use the browser’s local spell checker while writing."
                  checked={preferences.spellcheck}
                  onChange={(checked) =>
                    void onPreferences({ spellcheck: checked })
                  }
                />
                <label className="setting-range">
                  <span>
                    <strong>Editor text size</strong>
                    <small>Adjust text between 14 and 22 pixels.</small>
                  </span>
                  <input
                    type="range"
                    min="14"
                    max="22"
                    value={preferences.editorFontSize}
                    onChange={(event) =>
                      void onPreferences({
                        editorFontSize: Number(event.target.value),
                      })
                    }
                  />
                  <output>{preferences.editorFontSize}px</output>
                </label>
                <div className="settings-note">
                  <BookOpenText size={19} />
                  <span>
                    <strong>Rich blocks are enabled</strong>
                    <small>
                      Type / for tables, database views, code, LaTeX, callouts,
                      media, embeds, and more. Select text for inline
                      formatting.
                    </small>
                  </span>
                </div>
              </>
            )}
            {tab === "templates" && (
              <>
                <div className="settings-heading">
                  <h2>Template defaults</h2>
                  <p>
                    Choose what new pages and journal entries start with in this
                    vault.
                  </p>
                </div>
                <label className="setting-field">
                  <span>Default for new pages</span>
                  <select
                    value={preferences.defaultTemplateIds.note ?? ""}
                    onChange={(event) =>
                      void onPreferences({
                        defaultTemplateIds: {
                          ...preferences.defaultTemplateIds,
                          note: event.target.value || null,
                        },
                      })
                    }
                  >
                    <option value="">Blank page</option>
                    {templates.map((template) => (
                      <option value={template.id} key={template.id}>
                        {template.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="setting-field">
                  <span>Default for journal entries</span>
                  <select
                    value={preferences.defaultTemplateIds.journal ?? ""}
                    onChange={(event) =>
                      void onPreferences({
                        defaultTemplateIds: {
                          ...preferences.defaultTemplateIds,
                          journal: event.target.value || null,
                        },
                      })
                    }
                  >
                    <option value="">Blank page</option>
                    {templates.map((template) => (
                      <option value={template.id} key={template.id}>
                        {template.name}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="settings-note">
                  <Stack size={19} />
                  <span>
                    <strong>Existing pages never change</strong>
                    <small>
                      Changing a default only affects pages and journal entries
                      created afterward.
                    </small>
                  </span>
                </div>
              </>
            )}
            {tab === "appearance" && (
              <>
                <div className="settings-heading">
                  <h2>Appearance</h2>
                  <p>Choose a theme and comfortable writing width.</p>
                </div>
                <div className="setting-block">
                  <span>Theme</span>
                  <div className="theme-options">
                    {themes.map((theme) => (
                      <button
                        key={theme.value}
                        className={
                          preferences.theme === theme.value ? "active" : ""
                        }
                        onClick={() =>
                          void onPreferences({ theme: theme.value })
                        }
                      >
                        {theme.icon}
                        <span>{theme.label}</span>
                        {preferences.theme === theme.value && (
                          <Check size={14} />
                        )}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="setting-block">
                  <span>Editor width</span>
                  <div className="segmented-control">
                    {(["compact", "comfortable", "wide"] as const).map(
                      (width) => (
                        <button
                          key={width}
                          className={
                            preferences.editorWidth === width ? "active" : ""
                          }
                          onClick={() =>
                            void onPreferences({ editorWidth: width })
                          }
                        >
                          {width[0].toUpperCase() + width.slice(1)}
                        </button>
                      ),
                    )}
                  </div>
                </div>
              </>
            )}
            {tab === "data" && (
              <>
                <div className="settings-heading">
                  <h2>Data</h2>
                  <p>Everything remains local unless you export it yourself.</p>
                </div>
                <DataRecovery onHistory={onHistory} />
                {storageInfo && (
                  <div className="data-setting storage-location-setting">
                    <span className="data-setting-icon">
                      <Database size={20} />
                    </span>
                    <span>
                      <strong>SQLite storage folder</strong>
                      <small title={storageInfo.databasePath}>
                        {storageInfo.directory}
                        {storageInfo.isDefault ? " · Default" : ""}
                      </small>
                    </span>
                    <button onClick={() => void onStorageLocation()}>
                      Choose…
                    </button>
                  </div>
                )}
                <div className="data-setting">
                  <span className="data-setting-icon">
                    <DownloadSimple size={20} />
                  </span>
                  <span>
                    <strong>Export this vault</strong>
                    <small>
                      Download pages, hierarchy, settings, and full block
                      documents.
                    </small>
                  </span>
                  <button onClick={onExport}>Export</button>
                </div>
                <div className="data-setting">
                  <span className="data-setting-icon">
                    <UploadSimple size={20} />
                  </span>
                  <span>
                    <strong>Import a vault</strong>
                    <small>
                      Import a Hyperion backup as a new, separate local vault.
                    </small>
                  </span>
                  <button onClick={onImport}>Import</button>
                </div>
                <div className="local-data-note">
                  <Archive size={18} />
                  <span>
                    <strong>No account or cloud sync</strong>
                    <small>
                      {storageInfo
                        ? "Hyperion stores records, editor documents, and assets in a local SQLite file. Native local-AI services remain on this device."
                        : "Open Hyperion on desktop to access your data."}
                    </small>
                  </span>
                </div>
                {vaultCount > 1 && (
                  <div className="danger-zone">
                    <span>
                      <strong>Delete vault</strong>
                      <small>
                        Remove this vault and its metadata from this{" "}
                        {storageInfo ? "database" : "browser"}.
                      </small>
                    </span>
                    <button onClick={onDelete}>Delete vault</button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
        <footer>
          <span>
            Changes save automatically to this{" "}
            {storageInfo ? "device" : "browser"}.
          </span>
          <button className="primary-button" onClick={onClose}>
            Done
          </button>
        </footer>
      </section>
    </Dialog>
  );
}

export function SettingToggle({
  title,
  description,
  checked,
  onChange,
}: {
  title: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  const inputId = useId();
  return (
    <label className="setting-toggle" htmlFor={inputId}>
      <span>
        <strong>{title}</strong>
        <small>{description}</small>
      </span>
      <input
        id={inputId}
        aria-label={title}
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <i />
    </label>
  );
}
