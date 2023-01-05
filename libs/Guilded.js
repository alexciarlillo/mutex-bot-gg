const WebSocket = require("ws");
const axios = require("axios");

module.exports = class Guilded {
  constructor({
    token,
    apiUrl,
    socketUrl,
    authorizationHeaderType = "Bearer",
  } = {}) {
    if (!token) {
      throw new Error("token required");
    }
    if (!apiUrl) {
      throw new Error("apiUrl required");
    }
    if (!socketUrl) {
      throw new Error("socketUrl required");
    }

    this.token = token;
    this.api = new URL(apiUrl);
    this.socketServer = new URL(socketUrl);
    this.socketHost = `${this.socketServer.host}${this.socketServer.pathname}`;
    this.isSecure = this.api.protocol === "https:";
    this.reconnectTimer = null;
    this.eventListeners = {};
    this.heartbeatInterval = 30000;
    this.lastMessageAt = new Date();
    this.authorizationHeaders = {
      Authorization: `${authorizationHeaderType} ${this.token}`,
    };
  }

  handleHeartbeat(data) {
    const { op, d: eventData } = data;
    if (op === 1) {
      // welcome message
      this.heartbeatInterval = eventData.heartbeatIntervalMs;
    }
  }

  handleOpen(data) {
    // do nothing for guilded
  }

  handleMessage(data) {
    const { t: eventType, d: eventData, op, s } = data;
    const lastMessageId = s || (eventData && eventData.lastMessageId);
    if (lastMessageId) {
      this.lastMessageId = lastMessageId;
    }
    if (op === 8 /* invalid cursor */) {
      delete this.lastMessageId;
    }

    if (op === 1 /* welcome */) {
      this.user = eventData.user;
    }
  }

  constructHeaders() {
    const headers = {
      ...this.authorizationHeaders,
    };
    if (this.lastMessageId) {
      console.debug(
        "using last message ID for connection:",
        this.lastMessageId
      );
      headers["guilded-last-message-id"] = this.lastMessageId;
    }
    return headers;
  }

  stopOtherReconnects() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  connect() {
    const headers = this.constructHeaders();
    const socket = new WebSocket(
      `ws${this.isSecure ? "s" : ""}://${this.socketHost}`,
      {
        headers,
      }
    );

    socket.on("open", async (data) => {
      this.stopOtherReconnects();
      console.log("connected to socket!");
      await this.handleOpen(data);
    });

    socket.on("close", (statusCode, reason) => {
      console.log(
        `socket closed with status code ${statusCode} from ${this.socketHost}. reason: "${reason}"`
      );
      this.stopOtherReconnects();
      this.reconnectTimer = setTimeout(this.start.bind(this), 5000);
    });

    socket.on("ping", () => {
      this.lastMessageAt = new Date();
    });

    socket.on("message", async (data) => {
      data = JSON.parse(data);
      console.log("event received:", data);
      const { t: eventType, d: eventData } = data;

      this.handleMessage(data);
      this.handleHeartbeat(data);

      const cb = this.eventListeners[eventType];
      if (cb) {
        try {
          const result = cb(eventData, eventType);
          if (result && result.then) {
            await result;
          }
        } catch (error) {
          console.error(error);
        }
      }
    });

    socket.on("error", (error) => {
      console.error(error);
    });

    this.lastMessageAt = new Date();

    this.checkPings();

    return socket;
  }

  checkPings() {
    setTimeout(this.reconnectIfNoPings.bind(this), this.heartbeatInterval);
  }

  reconnectIfNoPings() {
    if (new Date() - this.lastMessageAt > this.heartbeatInterval * 4) {
      // missed 2 ping intervals, start
      this.start();
    } else {
      this.checkPings();
    }
  }

  start() {
    console.log(`attempting to connect to socket at ${this.socketHost} ...`);
    this.stopOtherReconnects();
    this.close();
    this.socket = this.connect();
    this.reconnectTimer = setTimeout(() => {
      this.socket.terminate();
      this.start();
    }, 2500);
  }

  close() {
    if (this.socket) this.socket.terminate();
  }

  when(eventOrEvents, cb) {
    if (!Array.isArray(eventOrEvents)) eventOrEvents = [eventOrEvents];

    eventOrEvents.forEach((event) => {
      this.eventListeners[event] = cb;
    });
  }

  postApi(path, data) {
    return axios({
      url: `${this.api.href}${path}`,
      method: "POST",
      data,
      headers: this.authorizationHeaders,
    });
  }
};
