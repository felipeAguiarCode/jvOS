import type Markdown from "react-markdown";

/** Markdown styles in the HUD palette: Jarvis Mark's preview and jv_lab's lessons. */
export const MARKDOWN_COMPONENTS: NonNullable<Parameters<typeof Markdown>[0]["components"]> = {
  h1: (props) => <h1 className="mt-4 mb-3 border-b border-hud-cyan/15 pb-2 text-xl font-semibold tracking-wide text-hud-light first:mt-0" {...props} />,
  h2: (props) => <h2 className="mt-4 mb-2 text-lg font-semibold text-hud-light first:mt-0" {...props} />,
  h3: (props) => <h3 className="mt-3 mb-2 text-base font-semibold text-hud-light/90" {...props} />,
  h4: (props) => <h4 className="mt-3 mb-1 text-sm font-semibold tracking-[0.08em] text-hud-light/80 uppercase" {...props} />,
  p: (props) => <p className="my-2 leading-relaxed" {...props} />,
  a: (props) => <a className="text-hud-cyan underline decoration-hud-cyan/40 underline-offset-2 hover:text-hud-light" target="_blank" rel="noreferrer" {...props} />,
  ul: (props) => <ul className="my-2 list-disc space-y-1 pl-5 marker:text-hud-cyan" {...props} />,
  ol: (props) => <ol className="my-2 list-decimal space-y-1 pl-5 marker:text-hud-cyan" {...props} />,
  li: (props) => <li className="leading-relaxed [&>input]:mr-2 [&>input]:accent-hud-cyan" {...props} />,
  blockquote: (props) => <blockquote className="my-2 border-l-2 border-hud-cyan/40 pl-3 text-hud-text/75 italic" {...props} />,
  code: ({ className, ...props }) => {
    const block = /language-/.test(className ?? "");
    return <code className={`font-mono text-[12px] ${block ? "" : "rounded bg-hud-cyan/10 px-1 py-px text-hud-holo"} ${className ?? ""}`} {...props} />;
  },
  pre: (props) => <pre className="hud-scroll my-2 overflow-x-auto rounded-lg border border-hud-cyan/12 bg-black/25 p-3 text-hud-text" {...props} />,
  hr: () => <hr className="my-4 border-hud-cyan/15" />,
  table: (props) => <table className="my-2 w-full border-collapse text-xs" {...props} />,
  th: (props) => <th className="border border-hud-cyan/15 bg-hud-cyan/[0.06] px-2 py-1 text-left font-semibold text-hud-light" {...props} />,
  td: (props) => <td className="border border-hud-cyan/15 px-2 py-1" {...props} />,
  img: (props) => <img className="my-2 max-w-full rounded-lg border border-hud-cyan/12" alt="" {...props} />,
  del: (props) => <del className="text-hud-text/50" {...props} />,
};
