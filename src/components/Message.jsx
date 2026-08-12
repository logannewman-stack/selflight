import React, { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Check, Copy, RotateCw } from "lucide-react";

const markdown = {
  p: (props) => <p className="mb-3 leading-[1.65] last:mb-0" {...props} />,
  ul: (props) => <ul className="mb-3 list-disc space-y-1 pl-5 last:mb-0" {...props} />,
  ol: (props) => <ol className="mb-3 list-decimal space-y-1 pl-5 last:mb-0" {...props} />,
  li: (props) => <li className="leading-[1.6]" {...props} />,
  h1: (props) => <h1 className="mb-2 mt-5 text-[1.14em] font-semibold first:mt-0" {...props} />,
  h2: (props) => <h2 className="mb-2 mt-5 text-[1.07em] font-semibold first:mt-0" {...props} />,
  h3: (props) => <h3 className="mb-2 mt-4 text-[1em] font-semibold first:mt-0" {...props} />,
  strong: (props) => <strong className="font-semibold" {...props} />,
  hr: () => <hr className="my-4 border-line" />,
  a: (props) => (
    <a
      className="text-accent underline underline-offset-2"
      target="_blank"
      rel="noreferrer"
      {...props}
    />
  ),
  blockquote: (props) => (
    <blockquote className="mb-3 border-l-2 border-line pl-3 text-muted last:mb-0" {...props} />
  ),
  pre: (props) => (
    <pre
      className="thin-scrollbar mb-3 overflow-x-auto rounded-xl bg-codebg p-3.5 text-[0.86em] leading-relaxed last:mb-0"
      {...props}
    />
  ),
  code: ({ className, children, ...rest }) =>
    className ? (
      <code className={`${className} font-mono`} {...rest}>
        {children}
      </code>
    ) : (
      <code className="rounded bg-codebg px-1.5 py-0.5 font-mono text-[0.88em]" {...rest}>
        {children}
      </code>
    ),
  table: (props) => (
    <div className="thin-scrollbar mb-3 overflow-x-auto last:mb-0">
      <table className="w-full border-collapse text-left text-[0.94em]" {...props} />
    </div>
  ),
  th: (props) => (
    <th className="border-b border-line px-3 py-2 font-semibold whitespace-nowrap" {...props} />
  ),
  td: (props) => <td className="border-b border-line px-3 py-2 align-top" {...props} />
};

export default function Message({ message, streaming, onRegenerate }) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end rise">
        <div
          className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-bubble px-4 py-2.5 leading-relaxed text-bubbleInk"
          style={{ fontSize: "var(--msg-size)" }}
        >
          {message.text}
        </div>
      </div>
    );
  }

  if (!message.text && streaming) {
    return (
      <div className="flex gap-1.5 py-1.5">
        <Dot delay="0ms" />
        <Dot delay="160ms" />
        <Dot delay="320ms" />
      </div>
    );
  }

  return (
    <div className="group">
      <div className="text-ink" style={{ fontSize: "var(--msg-size)" }}>
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdown}>
          {message.text}
        </ReactMarkdown>
        {streaming && <span className="caret" aria-hidden="true" />}
      </div>

      {!streaming && message.text && (
        <div className="mt-2 flex items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
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
      className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] font-medium text-muted transition-colors hover:bg-panel hover:text-ink"
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
