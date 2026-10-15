/**
 * RW-003 harness — minimal Chrome DevTools Protocol client.
 *
 * Uses Node's built-in WebSocket (no puppeteer/playwright dependency, so the
 * harness runs on a stock Ubuntu runner with just Node >= 22 installed).
 * Two sockets are used: one against the page target (Runtime/Page/Emulation)
 * and one against the browser endpoint (Browser.* window controls).
 */

export class CdpConnection {
  constructor(url, label) {
    this.url = url;
    this.label = label;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = [];
    this.closed = false;
  }

  async connect() {
    this.ws = new WebSocket(this.url);
    this.ws.addEventListener("message", (event) => this.#onMessage(event));
    this.ws.addEventListener("close", () => {
      this.closed = true;
      for (const pending of this.pending.values()) {
        pending.reject(new Error(`${this.label}: connection closed`));
      }
      this.pending.clear();
    });
    await new Promise((resolve, reject) => {
      this.ws.addEventListener("open", resolve, { once: true });
      this.ws.addEventListener("error", reject, { once: true });
    });
    return this;
  }

  #onMessage(event) {
    let message;
    try {
      message = JSON.parse(String(event.data));
    } catch {
      return;
    }
    if (message.id != null && this.pending.has(message.id)) {
      const pending = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(`${this.label}: ${JSON.stringify(message.error)}`));
      else pending.resolve(message.result ?? {});
      return;
    }
    for (const listener of this.listeners) listener(message);
  }

  onEvent(listener) {
    this.listeners.push(listener);
  }

  send(method, params = {}) {
    if (this.closed) return Promise.reject(new Error(`${this.label}: already closed`));
    const id = this.nextId++;
    const payload = JSON.stringify({ id, method, params });
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(payload);
    });
  }

  async close() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        await this.ws.close();
      } catch {
        /* ignore */
      }
    }
    this.closed = true;
  }

  /** Runtime.evaluate with awaitPromise; returns the CDP result envelope. */
  async evaluate(expression, options = {}) {
    return this.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
      ...options,
    });
  }

  /** Evaluate and unwrap the JS value (null on exception — recorded). */
  async evaluateValue(expression) {
    const response = await this.evaluate(expression);
    if (response.exceptionDetails) {
      return { __error: JSON.stringify(response.exceptionDetails).slice(0, 500) };
    }
    return response.result?.value ?? null;
  }

  async screenshot(filenameHint = "") {
    const result = await this.send("Page.captureScreenshot", { format: "png" });
    return { data: result.data, hint: filenameHint };
  }
}

export async function connectBrowser(port) {
  const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  return new CdpConnection(version.webSocketDebuggerUrl, "browser").connect();
}

export async function connectTarget(target) {
  return new CdpConnection(target.webSocketDebuggerUrl, `page:${target.id}`).connect();
}

/** Collect console + network + exception evidence from a page session. */
export function attachConsoleCollector(cdp) {
  const entries = [];
  cdp.onEvent((message) => {
    const { method, params } = message;
    if (method === "Runtime.consoleAPICalled") {
      const text = (params.args ?? [])
        .map((arg) => arg.value ?? arg.description ?? arg.type)
        .join(" ")
        .slice(0, 300);
      entries.push({ source: `console.${params.type}`, text });
    } else if (method === "Runtime.exceptionThrown") {
      entries.push({
        source: "exception",
        text: JSON.stringify(params.exceptionDetails ?? {}).slice(0, 300),
      });
    } else if (method === "Log.entryAdded") {
      const entry = params.entry ?? {};
      entries.push({
        source: `log.${entry.level ?? "info"}`,
        text: `${entry.source ?? "?"}: ${entry.text ?? ""} ${entry.url ?? ""}`.slice(0, 300),
      });
    }
  });
  return entries;
}

/** Ensure the domains we need; ignore errors from one-off availability. */
export async function preparePageSession(cdp) {
  const errors = [];
  for (const command of ["Runtime.enable", "Page.enable", "Log.enable"]) {
    try {
      await cdp.send(command);
    } catch (error) {
      errors.push(`${command}: ${String(error.message ?? error)}`);
    }
  }
  return errors;
}
