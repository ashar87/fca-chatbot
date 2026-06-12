"use client";

import { useState, useRef, useEffect } from "react";
import { PortalSection } from "./NavTabs";
import ReactMarkdown from "react-markdown";

interface Message {
  role: "user" | "assistant";
  content: string;
}

const STARTER_PROMPTS: Record<PortalSection, string[]> = {
  "nsm-search": [
    "Show me the most recent filings for Barclays",
    "What did Lloyds Banking Group file last month?",
    "Find prospectuses mentioning climate risk",
  ],
  "nsm-about": [
    "What types of documents are stored in the NSM?",
    "Which companies must file with the NSM?",
  ],
  firds: [
    "Is ISIN GB0002875804 reportable under UK MiFIR?",
    "What type of instrument is XS1234567890?",
    "Look up ISIN IE00B4L5Y983",
  ],
  fitrs: [
    "What FITRS files were published this week?",
    "Show me the latest full transparency files",
    "List delta files published in the last 7 days",
  ],
  "short-selling": [
    "What are the current disclosed short positions in Rolls-Royce?",
    "Which companies have short positions above 1% right now?",
    "What must I report if my short position hits 0.2%?",
  ],
};

interface Props {
  activeSection: PortalSection;
}

export default function ChatWidget({ activeSection }: Props) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [statusText, setStatusText] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  async function sendMessage(text: string) {
    if (!text.trim() || streaming) return;
    const userMsg: Message = { role: "user", content: text };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput("");
    setStreaming(true);

    const assistantMsg: Message = { role: "assistant", content: "" };
    setMessages([...newMessages, assistantMsg]);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: newMessages, context: activeSection }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const err = await res.json();
        setMessages([...newMessages, { role: "assistant", content: `Error: ${err.error || "Something went wrong. Please try again."}` }]);
        return;
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let accumulated = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value);
        const lines = chunk.split("\n");
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6).trim();
            if (data === "[DONE]") break;
            try {
              const parsed = JSON.parse(data);
              if (parsed.type === "status") {
                setStatusText(parsed.text);
              } else if (parsed.text) {
                accumulated += parsed.text;
                setStatusText("");
                setMessages([...newMessages, { role: "assistant", content: accumulated }]);
              }
            } catch {
              // non-JSON line, ignore
            }
          }
        }
      }
    } catch (err: unknown) {
      if ((err as Error).name !== "AbortError") {
        setMessages([...newMessages, { role: "assistant", content: "Connection error. Please try again." }]);
      }
    } finally {
      setStreaming(false);
      setStatusText("");
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    sendMessage(input);
  }

  return (
    <>
      {/* Floating trigger button */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-6 right-6 flex items-center gap-2 px-4 py-3 text-white shadow-lg text-sm font-semibold z-50 hover:opacity-90 transition-opacity"
          style={{ backgroundColor: "var(--fca-purple)", borderRadius: 0 }}
        >
          <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
          </svg>
          Ask a question
        </button>
      )}

      {/* Chat panel */}
      {open && (
        <div
          className="fixed bottom-6 right-6 w-[380px] max-w-[calc(100vw-2rem)] bg-white flex flex-col z-50"
          style={{ height: 520, border: "1px solid #b1b4b6", boxShadow: "0 4px 20px rgba(0,0,0,0.2)", borderRadius: 0 }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 text-white" style={{ backgroundColor: "var(--fca-purple)" }}>
            <div className="flex items-center gap-2">
              <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
              </svg>
              <span className="font-bold text-sm">FCA Data Assistant</span>
            </div>
            <div className="flex items-center gap-3">
              {messages.length > 0 && (
                <button onClick={() => setMessages([])} className="text-white/70 hover:text-white text-xs">
                  Clear
                </button>
              )}
              <button onClick={() => setOpen(false)} className="text-white/80 hover:text-white">
                <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          {/* Messages */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto chat-scroll px-3 py-3 space-y-3">
            {messages.length === 0 && (
              <div className="space-y-2">
                <p className="text-xs text-gray-500 text-center">Suggested questions:</p>
                {STARTER_PROMPTS[activeSection].map((prompt) => (
                  <button
                    key={prompt}
                    onClick={() => sendMessage(prompt)}
                    className="w-full text-left text-xs px-3 py-2 border hover:bg-gray-50 text-gray-700 transition-colors"
                    style={{ borderColor: "var(--fca-border)", background: "#f9f9f9", borderRadius: 0 }}
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            )}

            {messages.map((msg, i) => {
              const isLastAssistant = msg.role === "assistant" && i === messages.length - 1;
              const showStatus = isLastAssistant && streaming && statusText && !msg.content;
              const showCursor = isLastAssistant && streaming && msg.content;
              return (
                <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div
                    className={`max-w-[90%] px-3 py-2 text-sm ${
                      msg.role === "user" ? "text-white" : "text-gray-800"
                    }`}
                    style={{
                      backgroundColor: msg.role === "user" ? "var(--fca-purple)" : "#f4f4f4",
                      border: msg.role === "assistant" ? "1px solid #d0d0d0" : "none",
                      borderRadius: 0,
                    }}
                  >
                    {msg.role === "assistant" ? (
                      <div className="prose prose-sm max-w-none text-xs leading-relaxed">
                        {showStatus ? (
                          <span className="inline-flex items-center gap-1.5 text-xs text-gray-500 animate-pulse">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="shrink-0">
                              <circle cx="12" cy="12" r="10" />
                              <path d="M12 6v6l4 2" />
                            </svg>
                            {statusText}
                          </span>
                        ) : (
                          <>
                            <ReactMarkdown>{msg.content + (showCursor ? "▌" : "")}</ReactMarkdown>
                            {msg.content && !streaming && (
                              <p className="text-[10px] text-gray-400 mt-2 border-t border-gray-200 pt-1">
                                Not financial or regulatory advice. Verify at{" "}
                                <a href="https://data.fca.org.uk" target="_blank" rel="noopener noreferrer">data.fca.org.uk</a>.
                              </p>
                            )}
                          </>
                        )}
                      </div>
                    ) : (
                      msg.content
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Input */}
          <form onSubmit={handleSubmit} className="border-t px-3 py-2 flex gap-2" style={{ borderColor: "#d0d0d0" }}>
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about FCA data…"
              disabled={streaming}
              className="flex-1 text-sm px-3 py-2 disabled:bg-gray-50"
              style={{ border: "1px solid var(--fca-border)", borderRadius: 0, outline: "none", fontFamily: "inherit" }}
              onFocus={(e) => { e.target.style.outline = "3px solid #ffdd00"; }}
              onBlur={(e) => { e.target.style.outline = "none"; }}
            />
            <button
              type="submit"
              disabled={streaming || !input.trim()}
              className="px-3 py-2 text-white disabled:opacity-50 transition-opacity"
              style={{ backgroundColor: "var(--fca-purple)", border: "none", borderRadius: 0, cursor: "pointer" }}
            >
              <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
            </button>
          </form>
        </div>
      )}
    </>
  );
}
