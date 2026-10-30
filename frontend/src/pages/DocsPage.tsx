import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { ArrowLeft, BookOpen, Search } from "lucide-react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Lenis from "lenis";
import guide from "../../../docs/PROJECT_GUIDE.md?raw";
import { Logo } from "@/components/shell/Logo";
import { useReducedMotion } from "@/lib/motion";
import "./docs.css";

gsap.registerPlugin(ScrollTrigger);
const sections = guide.split(/^## /m).slice(1).map((part) => {
  const [title, ...body] = part.split("\n");
  return { title, body: body.join("\n").trim(), id: title.toLowerCase().replace(/[^a-z0-9]+/g, "-") };
});

function Content({ text }: { text: string }) {
  return text.split(/(```[\s\S]*?```)/g).filter(Boolean).map((block, i) => {
    if (block.startsWith("```")) {
      return <pre key={i} tabIndex={0}><code>{block.replace(/^```[^\n]*\n/, "").replace(/```$/, "").trimEnd()}</code></pre>;
    }
    return block.trim().split(/\n\s*\n/).filter(Boolean).map((paragraph, j) => {
      const lines = paragraph.split("\n");
      if (lines.every((line) => /^- /.test(line))) return <ul key={`${i}-${j}`}>{lines.map((line) => <li key={line}>{line.slice(2)}</li>)}</ul>;
      if (lines.every((line) => /^\d+\. /.test(line))) return <ol key={`${i}-${j}`}>{lines.map((line) => <li key={line}>{line.replace(/^\d+\. /, "")}</li>)}</ol>;
      return <p key={`${i}-${j}`}>{paragraph}</p>;
    });
  });
}

export default function DocsPage() {
  const [query, setQuery] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const visible = useMemo(() => sections.filter((section) => `${section.title} ${section.body}`.toLowerCase().includes(query.toLowerCase().trim())), [query]);

  useEffect(() => {
    const previous = document.title;
    document.title = "Documentation · WayDine";
    return () => { document.title = previous; };
  }, []);

  useEffect(() => {
    if (reduced) return;
    const context = gsap.context(() => gsap.from(".docs-intro > *", { y: 16, opacity: 0, stagger: 0.08, duration: 0.5 }), root);
    const lenis = new Lenis({ anchors: true });
    lenis.on("scroll", ScrollTrigger.update);
    const tick = (time: number) => lenis.raf(time * 1000);
    gsap.ticker.add(tick);
    return () => { context.revert(); gsap.ticker.remove(tick); lenis.destroy(); };
  }, [reduced]);

  return <div ref={root} className="docs-page">
    <a className="docs-skip" href="#documentation">Skip to documentation</a>
    <header className="docs-header"><Logo /><Link to="/" className="flex items-center gap-2 text-sm"><ArrowLeft size={16} aria-hidden />Back to WayDine</Link></header>
    <div className="docs-intro">
      <p className="docs-eyebrow"><BookOpen size={16} aria-hidden /> THE WAYDINE FIELD GUIDE</p>
      <h1>Every road. Every decision.<br /><span>Documented.</span></h1>
      <p>From the first route request to the last database row. Explore how WayDine finds food along your drive—and how to build, run and maintain it.</p>
      <div className="docs-tags"><span>Architecture</span><span>API reference</span><span>Operations</span><span>Developer guide</span></div>
    </div>
    <div className="docs-layout">
      <aside className="docs-sidebar">
        <label className="docs-search"><Search size={17} aria-hidden /><span className="sr-only">Search documentation</span><input type="search" placeholder="Find in the guide…" value={query} onChange={(e) => setQuery(e.target.value)} /></label>
        <p className="docs-eyebrow" role="status">{visible.length} SECTIONS</p>
        <nav aria-label="Documentation sections">{visible.map((section, i) => <a key={section.id} href={`#${section.id}`}><span>{String(i + 1).padStart(2, "0")}</span>{section.title}</a>)}</nav>
      </aside>
      <main id="documentation" className="docs-content">
        <div className="docs-note"><strong>Implementation, explained.</strong> This guide follows the repository. Road access, provider configuration and deployed database policies still need real-world verification.</div>
        {visible.length === 0 && <p role="status">No sections match “{query}”. Try route, database or authentication.</p>}
        {visible.map((section) => <section key={section.id} id={section.id}><h2><a href={`#${section.id}`}>{section.title}</a></h2><Content text={section.body} /></section>)}
        <footer>WayDine · Eat on the way, not out of the way. <a href="#top" onClick={() => window.scrollTo({ top: 0, behavior: reduced ? "instant" : "smooth" })}>Back to top ↑</a></footer>
      </main>
    </div>
  </div>;
}
