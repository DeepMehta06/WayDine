import { useEffect, useId, useRef, useState } from "react";

let mermaidPromise: Promise<typeof import("mermaid")["default"]> | null = null;
function loadMermaid() {
  mermaidPromise ??= import("mermaid").then((mod) => {
    mod.default.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      fontFamily: "'IBM Plex Sans', system-ui, sans-serif",
      theme: "base",
      themeVariables: {
        primaryColor: "#f0ede2",
        primaryTextColor: "#1e231e",
        primaryBorderColor: "#2f4f2f",
        lineColor: "#5c6b5c",
        secondaryColor: "#f8ecd8",
        tertiaryColor: "#ffffff",
        background: "#faf8f2",
        mainBkg: "#f0ede2",
        nodeBorder: "#2f4f2f",
        clusterBkg: "#f8ecd8",
        clusterBorder: "#dad4c4",
        edgeLabelBackground: "#faf8f2",
        actorBkg: "#f0ede2",
        actorBorder: "#2f4f2f",
        actorTextColor: "#1e231e",
        signalColor: "#5c6b5c",
        signalTextColor: "#1e231e",
        labelBoxBkgColor: "#f0ede2",
        labelBoxBorderColor: "#2f4f2f",
        labelTextColor: "#1e231e",
        noteBkgColor: "#fff4dc",
        noteBorderColor: "#d1891f",
        fontSize: "14px",
      },
      flowchart: { htmlLabels: true, curve: "basis" },
    });
    return mod.default;
  });
  return mermaidPromise;
}

export function Mermaid({ chart }: { chart: string }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const host = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadMermaid()
      .then((mermaid) => mermaid.render(`mermaid-${id}`, chart))
      .then(({ svg }) => {
        if (!cancelled && host.current) host.current.innerHTML = svg;
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Diagram failed to render.");
      });
    return () => { cancelled = true; };
  }, [chart, id]);

  if (error) return <pre className="docs-mermaid-error" role="alert"><code>Diagram failed to render: {error}{"\n\n"}{chart}</code></pre>;
  return <div className="docs-mermaid" ref={host} role="img" aria-label="Diagram" />;
}
