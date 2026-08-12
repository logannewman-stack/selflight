import React, { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Check, ChevronRight, Copy, ExternalLink, RotateCw } from "lucide-react";
import CodeBlock from "./CodeBlock.jsx";

// react-markdown hands `pre` its `code` child as an element, so the fenced
// block is unwrapped here and re-rendered as a real component.
function preToCodeBlock(children) {
  const child = Array.isArray(children) ? children[0] : children;
  const className = child?.props?.className || "";
  const raw = child?.props?.children;

  const code = typeof raw === "string" ? raw : Array.isArray(raw) ? raw.join("") : "";
  const language = /language-([\w+-]+)/.exec(className)?.[1] || "";
  return { code: code.replace(/\n$/, ""), language };
}

function buildMarkdown({ lineNumbers, codeWrap }) {
  return {
    p: (props) => <p className="mb-[var(--para-gap)] leading-[inherit] last:mb-0" {...props} />,
    ul: (props) => <ul className="mb-[var(--para-gap)] list-disc space-y-1.5 pl-[1.4em] last:mb-0" {...props} />,
    ol: (props) => <ol className="mb-[var(--para-gap)] list-decimal space-y-1.5 pl-[1.4em] last:mb-0" {...props} />,
    li: (props) => <li className="pl-0.5 leading-[inherit]" {...props} />,

    h1: (props) => (
      <h1
        className="mb-2.5 mt-6 font-sans text-[length:var(--h1)] font-semibold leading-tight tracking-[-0.02em] first:mt-0"
        {...props}
      />
    ),
    h2: (props) => (
      <h2
        className="mb-2 mt-6 font-sans text-[length:var(--h2)] font-semibold leading-tight tracking-[-0.015em] first:mt-0"
        {...props}
      />
    ),
    h3: (props) => (
      <h3
        className="mb-1.5 mt-5 font-sans text-[length:var(--h3)] font-semibold leading-snug first:mt-0"
        {...props}
      />
    ),

    strong: (props) => <strong className="font-semibold" {...props} />,
    em: (props) => <em className="italic" {...props} />,
    hr: () => <hr className="my-6 border-line" />,

    a: (props) => (
      <a
        className="font-medium text-accent underline decoration-accent/30 underline-offset-[3px] transition-colors hover:decoration-accent"
        target="_blank"
        rel="noreferrer"
        {...props}
      />
    ),

    blockquote: (props) => (
      <blockquote
        className="mb-4 border-l-2 border-accent/40 pl-3.5 italic text-muted last:mb-0"
        {...props}
      />
    ),

    pre: ({ children }) => {
      const { code, language } = preToCodeBlock(children);
      return <CodeBlock code={code} language={language} lineNumbers={lineNumbers} wrap={codeWrap} />;
    },

    code: ({ children, ...rest }) => (
      <code
        className="rounded-md bg-codebg px-[0.35em] py-[0.15em] font-mono text-[0.85em] text-ink"
        {...rest}
      >
        {children}
      </code>
    ),

    table: (props) => (
      <div className="thin-scrollbar mb-4 overflow-x-auto rounded-xl border border-line last:mb-0">
        <table className="w-full border-collapse text-left text-[0.92em] leading-normal" {...props} />
      </div>
    ),
    thead: (props) => <thead className="bg-panel" {...props} />,
    th: (props) => (
      <th
        className="whitespace-nowrap border-b border-line px-3 py-2 font-sans text-sm font-semibold"
        {...props}
      />
    ),
    td: (props) => (
      <td className="border-b border-line px-3 py-2 align-top last:border-b-0" {...props} />
    )
  };
}

export default function Message({ message, streaming, onRegenerate, options = {} }) {
  const markdown = useMemo(
    () => buildMarkdown({ lineNumbers: options.lineNumbers, codeWrap: options.codeWrap }),
    [options.lineNumbers, options.codeWrap]
  );

  if (message.role === "user") {
    const style = {
      fontSize: "var(--msg-size)",
      lineHeight: "var(--leading-msg)",
      letterSpacing: "var(--tracking-body)"
    };

    if (options.bubbles === "plain") {
      return (
        <div className="rise border-l-2 border-accent/50 pl-3.5 font-medium" style={style}>
          <p className="whitespace-pre-wrap">{message.text}</p>
        </div>
      );
    }

    return (
      <div className="rise flex justify-end">
        <div
          className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-bubble px-4 py-2.5 text-bubbleInk"
          style={style}
        >
          {message.text}
        </div>
      </div>
    );
  }

  // Dots only while there is genuinely nothing yet. Once it's thinking out
  // loud, that narration is the better thing to look at.
  if (!message.text && !message.thinking && streaming) {
    return (
      <div className="flex gap-1.5 py-2">
        <Dot delay="0ms" />
        <Dot delay="150ms" />
        <Dot delay="300ms" />
      </div>
    );
  }

  return (
    <div className="group">
      {message.thinking && (
        <Thinking text={message.thinking} ms={message.thoughtMs} streaming={streaming} />
      )}

      <div
        className="font-reading text-ink"
        style={{
          fontSize: "var(--msg-size)",
          lineHeight: "var(--leading-msg)",
          fontWeight: "var(--weight-body)",
          letterSpacing: "var(--tracking-body)"
        }}
      >
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdown}>
          {message.text}
        </ReactMarkdown>
        {streaming && <span className="caret" aria-hidden="true" />}
      </div>

      {!streaming && message.sources?.length > 0 && <Sources sources={message.sources} />}

      {!streaming && message.text && (
        <div className="mt-2.5 flex items-center gap-0.5 opacity-0 transition-opacity duration-150 focus-within:opacity-100 group-hover:opacity-100">
          <CopyButton text={message.text} />
          {onRegenerate && (
            <Action onClick={onRegenerate} label="Regenerate this reply">
              <RotateCw className="h-3.5 w-3.5" strokeWidth={2} />
              Retry
            </Action>
          )}
        </div>
      )}
    </div>
  );
}

// The model working, shown while it works.
//
// Deliberately quiet: a step down in size, lighter weight, secondary colour, and
// set apart by a rule rather than a box. It's context for the answer, not the
// answer — if it competed with the reply for attention it would be worse than
// not showing it. While streaming it stays open and auto-scrolls; once the reply
// arrives it folds away to a single line, because by then you want the answer.
function Thinking({ text, ms, streaming }) {
  // Open while it's happening, shut when it isn't. Starting from `streaming`
  // rather than `true` is what makes a reply loaded from history — or one that
  // finishes before the first paint — arrive already folded, instead of the
  // reader having to close every old thought process by hand.
  const [open, setOpen] = useState(streaming);
  const scroller = useRef(null);
  const wasStreaming = useRef(streaming);

  // Fold it away on the transition out of streaming, but never re-open or
  // re-close it after that — by then the reader has an opinion.
  useEffect(() => {
    if (wasStreaming.current && !streaming) setOpen(false);
    wasStreaming.current = streaming;
  }, [streaming]);

  // Follow the newest line rather than making someone chase it.
  useEffect(() => {
    if (open && streaming && scroller.current) {
      scroller.current.scrollTop = scroller.current.scrollHeight;
    }
  }, [text, open, streaming]);

  const seconds = ms ? Math.max(1, Math.round(ms / 1000)) : null;

  return (
    <div className="mb-3.5 border-l-2 border-line pl-3.5">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex items-center gap-1.5 font-sans text-sm text-soft transition-colors hover:text-muted"
      >
        <ChevronRight
          className={`h-3 w-3 transition-transform ${open ? "rotate-90" : ""}`}
          strokeWidth={2.2}
        />
        {streaming ? "Thinking…" : seconds ? `Thought for ${seconds}s` : "Thought process"}
      </button>

      {open && (
        <div
          ref={scroller}
          className="thin-scrollbar mt-1.5 max-h-[13rem] overflow-y-auto whitespace-pre-wrap pr-2 font-sans text-sm font-light leading-relaxed text-soft"
        >
          {text}
          {streaming && <span className="caret" aria-hidden="true" />}
        </div>
      )}
    </div>
  );
}

// What the answer was actually built from. A search-grounded reply without its
// sources is just an assertion, so these are shown rather than tucked away —
// collapsed past four, because a long list buries the reply under itself.
function Sources({ sources }) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? sources : sources.slice(0, 4);
  const hidden = sources.length - shown.length;

  return (
    <div className="mt-3.5 border-t border-line pt-2.5 font-sans">
      <p className="mb-1.5 text-xs font-semibold uppercase tracking-[0.1em] text-soft">Sources</p>
      <ol className="flex flex-wrap gap-1.5">
        {shown.map((source, i) => (
          <li key={source.url}>
            <a
              href={source.url}
              target="_blank"
              rel="noreferrer"
              title={source.url}
              className="flex max-w-[15rem] items-center gap-1.5 rounded-lg border border-line bg-surface px-2 py-1 text-sm text-muted transition-colors hover:border-soft hover:text-ink"
            >
              <span className="text-2xs font-bold text-soft">{i + 1}</span>
              <span className="truncate">{source.title}</span>
              <ExternalLink className="h-3 w-3 shrink-0 text-soft" strokeWidth={2} />
            </a>
          </li>
        ))}

        {hidden > 0 && (
          <li>
            <button
              onClick={() => setExpanded(true)}
              className="rounded-lg border border-dashed border-line px-2 py-1 text-sm text-muted transition-colors hover:border-soft hover:text-ink"
            >
              +{hidden} more
            </button>
          </li>
        )}
      </ol>
    </div>
  );
}

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      // Clipboard is blocked outside a secure context; the text is selectable.
    }
  };

  return (
    <Action onClick={copy} label="Copy reply">
      {copied ? (
        <Check className="h-3.5 w-3.5 text-accent" strokeWidth={2.4} />
      ) : (
        <Copy className="h-3.5 w-3.5" strokeWidth={2} />
      )}
      {copied ? "Copied" : "Copy"}
    </Action>
  );
}

function Action({ children, onClick, label }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className="flex items-center gap-1.5 rounded-lg px-2 py-1 font-sans text-sm font-medium text-muted transition-colors hover:bg-panel hover:text-ink"
    >
      {children}
    </button>
  );
}

function Dot({ delay }) {
  return (
    <span
      className="h-1.5 w-1.5 animate-bounce rounded-full bg-soft"
      style={{ animationDelay: delay }}
    />
  );
}
