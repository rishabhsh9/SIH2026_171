/**
 * sessionStore.js
 * In-memory session store with auto TTL cleanup.
 */

const crypto = require('crypto');
const { settings } = require('./config');

class SessionStore {
  constructor() {
    this.sessions = new Map();
  }

  create(taskGoal, userId = null) {
    const sessionId = crypto.randomUUID();
    const now = Date.now();

    this.sessions.set(sessionId, {
      session_id: sessionId,
      task_goal: taskGoal,
      user_id: userId,
      created_at: now,
      last_active: now,
      turn: 0,
      history: [],
    });

    this._cleanupExpired();
    return sessionId;
  }

  exists(sessionId) {
    this._cleanupExpired();
    return this.sessions.has(sessionId);
  }

  get(sessionId) {
    if (!this.exists(sessionId)) return null;
    const session = this.sessions.get(sessionId);
    session.last_active = Date.now();
    return session;
  }

  appendTurn(sessionId, role, content) {
    const session = this.get(sessionId);
    if (!session) return;

    session.history.push({ role, content });

    // Keep history trimmed to MAX_HISTORY_TURNS * 2
    const maxLen = settings.MAX_HISTORY_TURNS * 2;
    if (session.history.length > maxLen) {
      session.history = session.history.slice(-maxLen);
    }

    if (role === 'assistant') {
      session.turn += 1;
    }
  }

  getHistory(sessionId) {
    const session = this.get(sessionId);
    return session ? session.history : [];
  }

  end(sessionId) {
    return this.sessions.delete(sessionId);
  }

  _cleanupExpired() {
    const now = Date.now();
    const ttlMs = settings.SESSION_TTL_SECONDS * 1000;

    for (const [id, session] of this.sessions.entries()) {
      if (now - session.last_active > ttlMs) {
        this.sessions.delete(id);
      }
    }
  }
}

const sessionStore = new SessionStore();

module.exports = { sessionStore };
