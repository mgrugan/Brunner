import React from "https://esm.sh/react@18.3.1";
import { createRoot } from "https://esm.sh/react-dom@18.3.1/client?deps=react@18.3.1";
import { ThinkingOrb } from "https://esm.sh/thinking-orbs@0.3.2?deps=react@18.3.1";
import { BorderBeam } from "https://esm.sh/border-beam@1.4.1?deps=react@18.3.1,react-dom@18.3.1";

const h = React.createElement;
const { useEffect, useRef, useState } = React;

const REMOTE_ENDPOINT = document.querySelector('meta[name="ask-endpoint"]')?.content?.trim();
const SAME_ORIGIN = /vercel\.app$|^localhost$|^127\.0\.0\.1$/.test(window.location.hostname);
const ENDPOINT = SAME_ORIGIN || !REMOTE_ENDPOINT ? "/api/ask" : REMOTE_ENDPOINT;

const SUGGESTIONS = [
  "Why is the ride home slower?",
  "Does cold weather really slow the commute?",
  "Is Route D actually faster?",
  "How accurate are the models?",
];

const THINKING_STEPS = [
  { state: "searching", label: "Reading the trips" },
  { state: "solving", label: "Checking the models" },
  { state: "composing", label: "Writing an answer" },
];

function SparkIcon() {
  return h(
    "svg",
    { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", "aria-hidden": "true" },
    h("path", {
      d: "M12 2.5l1.9 5.6 5.6 1.9-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.9L12 2.5z",
      fill: "currentColor",
    }),
    h("path", { d: "M19 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2z", fill: "currentColor", opacity: 0.7 })
  );
}

function ThinkingRow() {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setStep((value) => (value + 1) % THINKING_STEPS.length), 1800);
    return () => clearInterval(timer);
  }, []);
  const current = THINKING_STEPS[step];
  return h(
    "div",
    { className: "ask-thinking", role: "status" },
    h(ThinkingOrb, { state: current.state, size: 20, theme: "dark", "aria-label": current.label }),
    h("span", { key: current.label, className: "ask-thinking-label" }, `${current.label}…`)
  );
}

function Message({ role, content }) {
  return h("div", { className: `ask-message ask-${role}` }, content);
}

function Panel({ onClose }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const scroller = useRef(null);
  const field = useRef(null);

  useEffect(() => {
    field.current?.focus();
  }, []);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [messages, pending]);

  async function ask(question) {
    const text = question.trim();
    if (!text || pending) return;
    const history = messages.filter((m) => m.role !== "error").map(({ role, content }) => ({ role, content }));
    setMessages((current) => [...current, { role: "user", content: text }]);
    setInput("");
    setPending(true);
    try {
      const response = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: text, history }),
      });
      if (response.status === 404 || response.status === 405) {
        throw new Error("The assistant runs on the live Vercel deployment of this page.");
      }
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.answer) throw new Error(data.error || "Something went wrong. Try again.");
      setMessages((current) => [...current, { role: "assistant", content: data.answer }]);
    } catch (error) {
      const message =
        error instanceof TypeError ? "Couldn't reach the assistant. Check your connection and try again." : error.message;
      setMessages((current) => [...current, { role: "error", content: message }]);
    } finally {
      setPending(false);
    }
  }

  function onSubmit(event) {
    event.preventDefault();
    ask(input);
  }

  function onKeyDown(event) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      ask(input);
    }
  }

  const empty = messages.length === 0;

  return h(
    BorderBeam,
    { size: "md", colorVariant: "sunset", theme: "dark", strength: 0.75, active: pending },
    h(
      "section",
      { className: "ask-panel", role: "dialog", "aria-label": "Ask about the commute data" },
      h(
        "header",
        { className: "ask-header" },
        h(
          "div",
          { className: "ask-title" },
          h(ThinkingOrb, { state: pending ? "working" : "breathing", size: 20, theme: "dark" }),
          h("div", null, h("p", null, "Ask about the data"), h("span", null, "Answers draw only on this commute dataset"))
        ),
        h("button", { className: "ask-close", onClick: onClose, "aria-label": "Close" }, "×")
      ),
      h(
        "div",
        { className: "ask-body", ref: scroller },
        empty &&
          h(
            "div",
            { className: "ask-intro" },
            h("p", null, "143 trips, seven seasons and every model on this page. Ask about any of it."),
            h(
              "div",
              { className: "ask-suggestions" },
              SUGGESTIONS.map((text) => h("button", { key: text, onClick: () => ask(text) }, text))
            )
          ),
        messages.map((message, index) => h(Message, { key: index, ...message })),
        pending && h(ThinkingRow)
      ),
      h(
        "form",
        { className: "ask-form", onSubmit },
        h("textarea", {
          ref: field,
          rows: 1,
          value: input,
          maxLength: 600,
          placeholder: "Ask about the commute…",
          onChange: (event) => setInput(event.target.value),
          onKeyDown,
          "aria-label": "Your question",
        }),
        h(
          "button",
          { type: "submit", className: "ask-send", disabled: pending || !input.trim(), "aria-label": "Send" },
          h("svg", { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", "aria-hidden": "true" }, h("path", { d: "M5 12h13M13 6l6 6-6 6", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" }))
        )
      )
    )
  );
}

function useScrolledPastHero() {
  const [past, setPast] = useState(false);
  useEffect(() => {
    const hero = document.getElementById("hero");
    const update = () => {
      const threshold = hero ? hero.offsetHeight - window.innerHeight * 1.2 : window.innerHeight * 0.6;
      setPast(window.scrollY > threshold);
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);
  return past;
}

function AskWidget() {
  const [open, setOpen] = useState(false);
  const visible = useScrolledPastHero() || open;

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return h(
    "div",
    { className: `ask-root${visible ? "" : " is-hidden"}` },
    open && h("div", { className: "ask-panel-wrap" }, h(Panel, { onClose: () => setOpen(false) })),
    h(
      "div",
      { className: "ask-launcher-wrap" },
      h(
        BorderBeam,
        { size: "sm", colorVariant: "sunset", theme: "dark", strength: open ? 0.4 : 0.9 },
        h(
          "button",
          { className: `ask-launcher${open ? " is-open" : ""}`, onClick: () => setOpen((value) => !value), "aria-expanded": open },
          h(SparkIcon),
          h("span", null, open ? "Close" : "Ask AI")
        )
      )
    )
  );
}

const mount = document.createElement("div");
mount.id = "ask-ai";
document.body.appendChild(mount);
createRoot(mount).render(h(AskWidget));
