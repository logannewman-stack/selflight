import React, { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Check, Copy, RotateCw } from "lucide-react";
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

const markdown = {
  p: (props) => <p className="mb-4 leading-[1.68] last:mb-0" {...props} />,
  ul: (props) => <ul className="mb-4 list-disc space-y-1.5 pl-[1.4em] last:mb-0" {...props} />,
  ol: (props) => <ol className="mb-4 list-decimal space-y-1.5 pl-[1.4em] last:mb-0" {...props} />,
  li: (props) => <li className="leading-[1.62] pl-0.5" {...props} />,

  h1: (props) => (
    <h1
      className="mb-2.5 mt-6 font-sans text-[1.22em] font-semibold tracking-[-0.02em] first:mt-0"
      {...props}
    />
  ),
  h2: (props) => (
    <h2
      className="mb-2 mt-6 font-sans text-[1.1em] font-semibold tracking-[-0.015em] first:mt-0"
      {...props}
    />
  ),
  h3: (props) => (
    <h3 className="mb-1.5 mt-5 font-sans text-[1em] font-semibold first:mt-0" {...props} />
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
    return <CodeBlock code={code} language={language} />;
  },

  code: ({ className, children, ...rest }) => (
    <code
      className="rounded-md bg-codebg px-[0.35em] py-[0.15em] font-mono text-[0.85em] text-ink"
      {...rest}
    >
      {children}
    </code>
  ),

  table: (props) => (
    <div className="thin-scrollbar mb-4 overflow-x-auto rounded-xl border border-line last:mb-0">
      <table className="w-full border-collapse text-left text-[0.92em]" {...props} />
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

export default function Message({ message, streaming, onRegenerate }) {
  if (message.role === "user") {
    return (
      <div className="rise flex justify-end">
        <div
          className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-bubble px-4 py-2.5 leading-[1.6] text-bubbleInk"
          style={{ fontSize: "var(--msg-size)" }}
        >
          {message.text}
        </div>
      </div>
    );
  }

  if (!message.text && streaming) {
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
      <div
        className="font-reading text-ink"
        style={{ fontSize: "var(--msg-size)" }}
      >
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdown}>
          {message.text}
        </ReactMarkdown>
        {streaming && <span className="caret" aria-hidden="true" />}
      </div>

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
