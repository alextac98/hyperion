import { useEffect, useState, type CSSProperties } from "react";
import { ArrowLeft, ArrowUpRight, Check, DownloadSimple, FileText, LinkSimple, MagnifyingGlass, Moon, Plus, Sun } from "@phosphor-icons/react";
import { HyperionMark } from "../components/HyperionMark";
import { themeToken } from "../theme/palette";
import "./brand.css";

const asset = `${import.meta.env.BASE_URL}brand/hyperion-icon-master.png`;
const colors = [
  { name: "Midnight", token: "--brand-midnight", use: "Identity & depth", light: true },
  { name: "Royal blue", token: "--brand-blue", use: "Our signature color", light: true },
  { name: "Cornflower", token: "--brand-blue-light", use: "Light in dark spaces", light: false },
  { name: "Blue mist", token: "--brand-blue-soft", use: "Quiet emphasis", light: false },
];

export default function BrandPage() {
  const [theme, setTheme] = useState(document.documentElement.dataset.theme === "dark" ? "dark" : "light");
  const [query, setQuery] = useState("");
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.title = "Hyperion — Brand & design guidelines";
  }, [theme]);

  return <div className="brand-page">
    <a className="brand-skip" href="#brand-content">Skip to content</a>
    <header className="brand-header">
      <a className="brand-wordmark" href="?" aria-label="Hyperion app"><HyperionMark /><span>Hyperion</span></a>
      <span className="brand-header-label">Brand &amp; design</span>
      <button className="secondary-button" onClick={() => setTheme(theme === "light" ? "dark" : "light")} aria-label={`Preview ${theme === "light" ? "dark" : "light"} theme`}>
        {theme === "light" ? <Moon size={16} /> : <Sun size={16} />}<span>{theme === "light" ? "Dark" : "Light"} preview</span>
      </button>
    </header>
    <div className="brand-layout">
      <nav className="brand-nav" aria-label="Brand guidelines">
        <span className="brand-eyebrow">The Hyperion identity</span>
        {[['01', 'foundation', 'Foundation'], ['02', 'identity', 'Our mark'], ['03', 'color', 'Color'], ['04', 'typography', 'Typography'], ['05', 'interface', 'Interface'], ['06', 'voice', 'Voice & care']].map(([number, id, label]) => <a key={id} href={`#${id}`}><span>{number}</span>{label}</a>)}
        <a className="brand-back" href="?"><ArrowLeft size={15} /> Back to app</a>
      </nav>
      <main id="brand-content" className="brand-content">
        <section className="brand-hero" id="foundation">
          <div><span className="brand-eyebrow">A place for connected thinking</span><h1>Make room<br />for what you know.</h1><p>Hyperion brings ideas, notes, and knowledge together. Our identity pairs the depth of blue with a quiet, open space to think.</p><a href="#identity">Meet the identity <ArrowUpRight size={18} /></a></div>
          <div className="brand-hero-art"><img src={asset} alt="Hyperion icon: a pale orbital ribbon connecting the uprights of an H on an indigo tile" width={1254} height={1254} /><span>THE ORBITAL H</span></div>
        </section>
        <div className="brand-principles">
          <article><span>01 / Calm</span><h3>Give ideas space.</h3><p>Readable text comes first. Clear hierarchy, strong contrast, and comfortable spacing keep attention on the writing.</p></article>
          <article><span>02 / Connected</span><h3>Make relationships visible.</h3><p>Blue guides actions and selections. Links and navigation help people find their way back.</p></article>
          <article><span>03 / Personal</span><h3>Keep the person in control.</h3><p>Local ownership, familiar controls, and clear language make the workspace feel like their own.</p></article>
        </div>

        <section className="brand-section" id="identity">
          <div className="brand-section-heading"><span className="brand-eyebrow">02 / Our mark</span><h2>One letter. A continuous connection.</h2><p>The orbital ribbon joins two pillars into an H. Its soft dimensional finish gives the app a recognizable presence in the dock.</p></div>
          <div className="brand-identity-grid">
            <div className="brand-logo-stage"><div className="brand-wordmark"><img src={asset} alt="" width={88} height={88} /><span>Hyperion</span></div><span>Primary lockup · original-color icon + live type</span></div>
            <div className="brand-size-stage"><div>{[24, 32, 48, 64].map(size => <figure key={size}><img src={asset} alt={`Hyperion icon at ${size} pixels`} width={size} height={size} /><figcaption>{size}px</figcaption></figure>)}</div><span>Small sizes · preserve the silhouette</span></div>
          </div>
          <div className="brand-rules"><p><strong>Give it room.</strong> Leave at least one quarter of the icon’s width clear on every side. Use 24px or larger in the interface; 16px is reserved for the favicon.</p><p><strong>Keep it recognizable.</strong> Preserve the original proportions, colors, ribbon, and transparent corners. Avoid stretching, recoloring, added shadows, or placing it on busy imagery.</p></div>
          <a className="secondary-button brand-download" href={asset} download="hyperion-icon.png"><DownloadSimple size={16} /> Download master PNG <span>1254 × 1254</span></a>
        </section>

        <section className="brand-section" id="color">
          <div className="brand-section-heading"><span className="brand-eyebrow">03 / Color</span><h2>Blue at heart.</h2><p>Keep the brand colors constant. Let semantic colors adapt to the light around them.</p></div>
          <div className="brand-palette">{colors.map(color => <article key={color.token}><div className={`brand-swatch${color.light ? " brand-swatch-light" : ""}`} style={{ background: `var(${color.token})` }}><strong>{color.name}</strong><code>{themeToken(color.token).toUpperCase()}</code></div><p>{color.use}</p><code>{color.token}</code></article>)}</div>
          <div className="brand-surface-demo"><div><span className="brand-eyebrow">Live semantic palette / {theme}</span><h3>A quiet foundation.</h3><p>Light surfaces carry a subtle cool tint. Dark mode uses neutral charcoal, with blue reserved for accents and actions.</p></div><div className="brand-semantic-swatches">{[['Canvas', '--bg'], ['Panel', '--panel'], ['Raised', '--surface-raised'], ['Selected', '--selected-bg']].map(([name, token]) => <div key={token}><span style={{ background: `var(${token})` }} /><strong>{name}</strong><code>{token}</code></div>)}</div></div>
          <p className="brand-caption">Primary actions pair <code>--action</code> with <code>--on-action</code>. Links use <code>--accent-text</code>. Success, warning, and destructive actions retain their own colors and text labels.</p>
        </section>

        <section className="brand-section" id="typography">
          <div className="brand-section-heading"><span className="brand-eyebrow">04 / Typography</span><h2>Clear words. Comfortable rhythm.</h2><p>A familiar system sans keeps Hyperion fast and fully local. Inter is used when installed; otherwise the platform’s native typeface takes over.</p></div>
          <div className="brand-type-specimen"><div className="brand-type-glyph">Aa<span>Ideas become knowledge.</span></div><div className="brand-type-scale">{[['Page title', 'A thought worth keeping', '32px / 650', 32], ['Section heading', 'Find the connections', '22px / 650', 22], ['Reading text', 'Leave space for the next idea.', '17px / 400 · 1.65 line height', 17], ['Interface', 'Notes, links, and a place to begin.', '13px / 500', 13]].map(([label, sample, spec, size]) => <div key={label}><span style={{ fontSize: `${size}px` } as CSSProperties}>{sample}</span><small>{label} · {spec}</small></div>)}</div></div>
          <p className="brand-caption">Use sentence case, short labels, and modest weights. Readability comes first: use 14px interface text and at least 12px for metadata. Use the monospace stack only for code and technical values.</p>
        </section>

        <section className="brand-section" id="interface">
          <div className="brand-section-heading"><span className="brand-eyebrow">05 / Interface</span><h2>Familiar shapes. Consistent behavior.</h2><p>These examples use the same controls and tokens as the app. Try a search, save a sample, or switch the page’s theme.</p></div>
          <div className="brand-component-grid">
            <article className="brand-example"><span className="brand-eyebrow">Actions &amp; feedback</span><div className="brand-example-actions"><button className="primary-button" onClick={() => setSaved(!saved)}>{saved ? <Check size={16} /> : <Plus size={16} />}{saved ? "Saved" : "Save sample"}</button><button className="secondary-button" onClick={() => { setSaved(false); setQuery(""); }}>Reset</button><button className="secondary-button" disabled>Unavailable</button></div><p role="status">{saved ? "Sample saved for this preview." : "One primary action per group. Secondary actions stay quiet."}</p><div className="brand-statuses"><span><Check size={14} /> Saved locally</span><span>Review needed</span><span>Could not save</span></div></article>
            <article className="brand-example"><span className="brand-eyebrow">Search &amp; selection</span><label className="brand-search"><MagnifyingGlass size={17} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search the examples…" aria-label="Search example notes" /></label><div className="brand-note-example">{(!query || "connected ideas".includes(query.toLowerCase())) ? <><FileText size={20} /><div><strong>Connected ideas</strong><span>A little space to think.</span></div><LinkSimple size={17} /></> : <p>No matching examples. Try “ideas”.</p>}</div></article>
          </div>
          <div className="brand-rules"><p><strong>Shape &amp; space.</strong> Use a 4px spacing rhythm: 4, 8, 12, 16, 24, 32. Corners step from 6px for compact items to 8px controls, 12px cards, and 16px dialogs.</p><p><strong>Depth &amp; movement.</strong> Use borders to organize; reserve shadows for raised controls and overlays. Keep transitions at 120–180ms and honor reduced motion.</p><p><strong>Iconography.</strong> Use the existing Phosphor outline family, usually 16–20px. Keep weight consistent, label unfamiliar actions, and preserve personal page icons.</p><p><strong>Focus &amp; meaning.</strong> Prioritize readable text over subtle styling. Every interactive control needs a visible keyboard focus state. Pair status colors with words or symbols. Use the semantic foreground/background pairs together.</p></div>
        </section>

        <section className="brand-section brand-voice" id="voice"><div><span className="brand-eyebrow">06 / Voice &amp; care</span><h2>Thoughtful.<br />Direct. Human.</h2></div><div><p>Help people understand what happened and what they can do next. Describe local storage honestly. Keep ownership, recovery, and destructive actions explicit.</p><blockquote>“No matching pages. Try another search.”</blockquote><blockquote>“Your notes are saved on this device.”</blockquote><p className="brand-caption">Avoid hype, unexplained technical language, and promises the product cannot keep. Leave the personality in the details.</p></div></section>
        <footer className="brand-footer"><div className="brand-wordmark"><HyperionMark small /><span>Hyperion</span></div><span>A calm space for connected thinking.</span><a href="?">Open your workspace <ArrowUpRight size={15} /></a></footer>
      </main>
    </div>
  </div>;
}
