import React, { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Check,
  ChevronRight,
  Copy,
  ExternalLink,
  FileText,
  Pencil,
  RotateCw,
  ThumbsDown
} from "lucide-react";
import { REPORT_REASONS, reportReply } from "../lib/api.js";
import { splitAttachments, withAttachments } from "../lib/attach.js";
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

export default function Message({
  message,
  streaming,
  onRegenerate,
  onStartEdit,
  onEdit,
  onCancelEdit,
  editing,
  options = {}
}) {
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

    // An attached file lives inside the message text, because that's the shape
    // every provider takes and what the messages table stores. Here it comes
    // back apart, so a conversation shows "server.log" rather than the forty
    // thousand characters that were actually sent.
    const { body: written, files } = splitAttachments(message.text);

    // Fixing the question beats arguing with the answer. Editing here drops
    // everything after this turn and asks again — which is what the messages
    // table was keyed by position for. Only what was typed is editable; the
    // files ride along unchanged.
    if (editing) {
      return (
        <EditMessage
          text={written}
          files={files}
          style={style}
          onSave={(next) => onEdit(withAttachments(next, files))}
          onCancel={onCancelEdit}
        />
      );
    }

    const chips = files.length > 0 && (
      <div
        className={`mb-1.5 flex flex-wrap gap-1.5 ${
          options.bubbles === "plain" ? "" : "justify-end"
        }`}
      >
        {files.map((file) => (
          <Attachment key={file.name} file={file} />
        ))}
      </div>
    );

    const body =
      options.bubbles === "plain" ? (
        <div className="rise border-l-2 border-accent/50 pl-3.5 font-medium" style={style}>
          {chips}
          {written && <p className="whitespace-pre-wrap">{written}</p>}
        </div>
      ) : (
        <div className="rise">
          {chips}
          {written && (
            <div className="flex justify-end">
              <div
                className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-bubble px-4 py-2.5 text-bubbleInk"
                style={style}
              >
                {written}
              </div>
            </div>
          )}
        </div>
      );

    if (!onEdit) return body;

    return (
      <div className="group">
        {body}
        <div
          className={`on-demand mt-1.5 flex items-center gap-0.5 ${
            options.bubbles === "plain" ? "" : "justify-end"
          }`}
        >
          <Action onClick={onStartEdit} label="Edit this message and ask again">
            <Pencil className="h-3.5 w-3.5" strokeWidth={2} />
            Edit
          </Action>
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
        <div className="on-demand mt-2.5 flex flex-wrap items-center gap-0.5">
          <CopyButton text={message.text} />
          {onRegenerate && (
            <Action onClick={onRegenerate} label="Regenerate this reply">
              <RotateCw className="h-3.5 w-3.5" strokeWidth={2} />
              Retry
            </Action>
          )}
          {/* The failure log catches crashes on its own. A reply that streamed
              fine, saved fine, and was simply wrong is invisible to the server —
              this is the only thing that can see it. */}
          <ReportButton message={message} options={options} />
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

// Reporting a bad reply, in one press and then one more to say why.
//
// The reasons are fixed rather than free text on purpose: a box asking "what
// went wrong?" gets filled in by roughly nobody, and four buttons get pressed.
// "It made something up" being its own reason is the whole point — that's the
// failure the product cares most about and the one nothing else can detect.
function ReportButton({ message, options }) {
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState(false);

  const send = async (reason) => {
    setOpen(false);
    setSent(true);
    // The reply itself is never sent — only its shape. See api/feedback.js.
    await reportReply(reason, {
      depth: options.depth,
      hadSources: Boolean(message.sources?.length),
      hadThinking: Boolean(message.thinking)
    });
  };

  if (sent) {
    return (
      <span className="flex items-center gap-1.5 px-2 py-1 font-sans text-sm font-medium text-muted">
        <Check className="h-3.5 w-3.5 text-accent" strokeWidth={2.4} />
        Noted — thank you
      </span>
    );
  }

  if (open) {
    return (
      <span className="flex flex-wrap items-center gap-0.5">
        {Object.entries(REPORT_REASONS).map(([id, label]) => (
          <button
            key={id}
            onClick={() => send(id)}
            className="rounded-lg px-2 py-1 font-sans text-sm font-medium text-muted transition-colors hover:bg-panel hover:text-ink"
          >
            {label}
          </button>
        ))}
        <button
          onClick={() => setOpen(false)}
          aria-label="Cancel"
          className="rounded-lg px-2 py-1 font-sans text-sm text-soft transition-colors hover:text-ink"
        >
          Cancel
        </button>
      </span>
    );
  }

  return (
    <Action onClick={() => setOpen(true)} label="Report a problem with this reply">
      <ThumbsDown className="h-3.5 w-3.5" strokeWidth={2} />
      Report
    </Action>
  );
}

// Editing in place, at the size the message was.
//
// Everything after this turn is about to be dropped, so the button says so
// rather than leaving it to be discovered — this is a destructive action
// wearing an ordinary word.
function EditMessage({ text, files = [], style, onSave, onCancel }) {
  const [value, setValue] = useState(text);
  const area = useRef(null);

  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.focus();
    // Cursor at the end, not the start: people edit the thing they just wrote.
    el.setSelectionRange(el.value.length, el.value.length);
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  const save = () => {
    const next = value.trim();
    // With a file attached the question can be empty — the file is the message.
    if (next || files.length) onSave(next);
    else onCancel();
  };

  return (
    <div className="rise rounded-2xl border border-accent/40 bg-surface p-3">
      {files.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {files.map((file) => (
            <Attachment key={file.name} file={file} />
          ))}
        </div>
      )}
      <textarea
        ref={area}
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          e.target.style.height = "auto";
          e.target.style.height = `${e.target.scrollHeight}px`;
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") onCancel();
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) save();
        }}
        rows={1}
        className="thin-scrollbar w-full resize-none bg-transparent text-ink outline-none"
        style={style}
      />
      <div className="mt-2 flex items-center gap-2 border-t border-line pt-2">
        <button
          onClick={save}
          className="rounded-lg bg-ink px-2.5 py-1 font-sans text-sm font-medium text-page transition-opacity hover:opacity-90"
        >
          Ask again
        </button>
        <button
          onClick={onCancel}
          className="rounded-lg px-2 py-1 font-sans text-sm font-medium text-muted transition-colors hover:text-ink"
        >
          Cancel
        </button>
        <span className="ml-auto text-2xs text-soft">Replies after this one are replaced</span>
      </div>
    </div>
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

// A file that was sent with a message.
//
// It opens, because the contents genuinely went to the model and a conversation
// you can't audit is one you have to take on trust. Collapsed by default, since
// the thread is for reading and a thousand lines of CSV isn't.
function Attachment({ file }) {
  const [open, setOpen] = useState(false);
  const lines = file.text ? file.text.split("\n").length : 0;

  return (
    <span className="flex max-w-full flex-col">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title={open ? "Hide the contents" : "Show what was sent"}
        className="flex max-w-full items-center gap-1.5 self-end rounded-lg border border-line bg-surface py-1 pl-2 pr-2.5 font-sans text-sm transition-colors hover:border-soft"
      >
        <FileText className="h-3.5 w-3.5 shrink-0 text-soft" strokeWidth={2} />
        <span className="min-w-0 truncate text-muted">{file.name}</span>
        <span className="shrink-0 text-2xs text-soft">
          {lines.toLocaleString()} {lines === 1 ? "line" : "lines"}
          {file.truncated ? " · shortened" : ""}
        </span>
        <ChevronRight
          className={`h-3 w-3 shrink-0 text-soft transition-transform ${open ? "rotate-90" : ""}`}
          strokeWidth={2.4}
        />
      </button>

      {open && (
        <span className="mt-1.5 block max-w-full">
          {file.truncated && (
            <span className="mb-1 block text-2xs text-soft">
              Only this much was sent — the rest of the file was too long.
            </span>
          )}
          <pre className="thin-scrollbar max-h-72 overflow-auto rounded-xl border border-line bg-page p-3 text-left text-sm leading-relaxed">
            <code style={{ fontFamily: "var(--font-code)" }}>{file.text}</code>
          </pre>
        </span>
      )}
    </span>
  );
}
